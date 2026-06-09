// ====== Mock API Layer ======
// Drop-in replacement for `apiClient` that returns realistic, deterministic
// data without touching the network. Useful for:
//   - Frontend-only development
//   - Demos
//   - Storybook / visual regression
//
// Switch at runtime via `setApiMode('mock' | 'real')`. The UI layer doesn't
// care which one is active.
//
// Mock latencies and stream cadence are tuned to feel like a real backend.

import type {
  AddModelRequest,
  ChatMessage,
  ConfiguredModel,
  CreateSessionRequest,
  CreateTaskRequest,
  KnowledgeEntry,
  ListTasksResponse,
  LoginRequest,
  LoginResponse,
  Result,
  SessionHistoryResponse,
  SessionInfo,
  SkillEntry,
  StreamEvent,
  SystemStatus,
  Task,
  TestModelResponse,
  UploadResponse,
  UserProfile,
} from './types';
import type { ApiError } from './client';
import { setStoredUser, setToken } from './client';

// ---------- Mode ----------

let mode: 'mock' | 'real' = ((import.meta.env.VITE_USE_MOCK as string) === 'true') ? 'mock' : 'real';
const modeListeners = new Set<(m: 'mock' | 'real') => void>();

export function getApiMode(): 'mock' | 'real' {
  return mode;
}
export function setApiMode(m: 'mock' | 'real'): void {
  mode = m;
  modeListeners.forEach((fn) => fn(m));
}
export function onApiModeChange(fn: (m: 'mock' | 'real') => void): () => void {
  modeListeners.add(fn);
  return () => modeListeners.delete(fn);
}

const USE_MOCK = () => mode === 'mock';

// ---------- Helpers ----------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

function ok<T>(value: T): Result<T, ApiError> {
  return { ok: true, value };
}

let mockFailureRate = 0;        // 0..1; 0 in normal use
export function setMockFailureRate(p: number): void {
  mockFailureRate = Math.max(0, Math.min(1, p));
}

async function simulateLatency(): Promise<void> {
  if (mockFailureRate > 0 && Math.random() < mockFailureRate) {
    await sleep(jitter(50, 200));
    throw new Error('Simulated network error');
  }
  await sleep(jitter(80, 220));
}

const MOCK_TOKEN = 'mock-token-xxx';

function rid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

const now = () => new Date();
const isoNow = () => now().toISOString();

function timeLabel(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// ---------- Mock store ----------
//
// In-memory data that survives between mock calls in the same page session.

const mockUser: UserProfile = {
  id: 'usr_chemcode_001',
  username: 'Justinian',
  email: 'justinian@example.com',
  createdAt: '2026-01-01T00:00:00Z',
};

let _mockTasks: Task[] = [];

let _mockKnowledge: KnowledgeEntry[] = [];

let _mockSkills: SkillEntry[] = [];

let _mockModels: ConfiguredModel[] = [];

let _mockSessions: Map<string, { info: SessionInfo; messages: ChatMessage[] }> = new Map();

function newSession(req: CreateSessionRequest): SessionInfo {
  const id = rid('S');
  const info: SessionInfo = {
    id,
    title: req.title || '新对话',
    agentId: req.agentId || 'default',
    model: req.model,
    createdAt: isoNow(),
    lastInteractionAt: isoNow(),
    messageCount: 0,
    status: 'active',
  };
  _mockSessions.set(id, {

    info,
    messages: [
      {
        id: rid('sys'),
        type: 'system',
        content: '欢迎使用 Chemycode！我可以帮你完成计算化学任务，随时开始对话。',
        timestamp: timeLabel(now()),
      },
    ],
  });
  return info;
}

// ---------- Mock stream simulator ----------
//
// Generates a realistic stream of events for a chat turn: tool calls, text
// deltas, file attachments, and confirmations.

export interface MockStreamHandlers {
  onEvent: (e: StreamEvent) => void;
  onDone: () => void;
}

const REPLY_TEMPLATES: { keywords: RegExp; reply: { text: string; files?: { name: string; type: string; size: string }[] } }[] = [
  {
    keywords: /蛋白|molecular|动力学|md|am/i,
    reply: {
      text:
        `好的，我将为你准备蛋白质分子动力学模拟。\n\n**模拟方案：**\n- 力场：AMBER99SB-ILDN\n- 溶剂：TIP3P水模型\n- 温度：310K\n- 模拟时间：50ns\n\n我先进行能量最小化步骤。`,
      files: [
        { name: 'em.mdp', type: 'mdp', size: '1.2KB' },
        { name: 'nvt.mdp', type: 'mdp', size: '1.5KB' },
        { name: 'npt.mdp', type: 'mdp', size: '1.5KB' },
        { name: 'md.mdp', type: 'mdp', size: '1.3KB' },
      ],
    },
  },
  {
    keywords: /吸附|dft|mof/i,
    reply: {
      text:
        `我将为这个 MOF 体系准备 DFT 计算。\n\n**计算方案：**\n- 泛函：PBE-D3(BJ)\n- 基组：def2-TZVP\n- 色散：Grimme D3\n- 收敛：1e-6 Hartree\n\n请确认是否使用上述参数。`,
    },
  },
  {
    keywords: /过渡态|sn2|量子|quantum/i,
    reply: {
      text:
        `我将使用 QST2 方法进行过渡态搜索。\n\n**计算方案：**\n- 方法：QST2\n- 泛函：B3LYP/6-31G(d)\n- 优化算法：Berny\n\n预计需要 5-10 分钟。`,
    },
  },
];

function chooseReply(prompt: string): { text: string; files?: { name: string; type: string; size: string }[] } {
  for (const t of REPLY_TEMPLATES) {
    if (t.keywords.test(prompt)) return t.reply;
  }
  return {
    text:
      `好的，我已收到你的请求：\n\n> ${prompt}\n\n正在分析需求并准备执行计划...`,
  };
}

export function simulateChatStream(prompt: string, h: MockStreamHandlers): { cancel: () => void } {
  const messageId = rid('msg');
  const toolCallId = rid('tool');
  let cancelled = false;

  (async () => {
    // 1. status: thinking
    h.onEvent({ type: 'thinking', messageId, content: '正在分析请求...' });
    await sleep(400);
    if (cancelled) return;

    // 2. tool call: planner
    h.onEvent({
      type: 'tool_call_start',
      toolCallId,
      toolName: 'planner',
      args: { goal: prompt },
      messageId,
    });
    h.onEvent({ type: 'tool_call_update', toolCallId, status: 'running' });
    await sleep(700);
    if (cancelled) return;
    h.onEvent({ type: 'tool_call_end', toolCallId, result: 'plan-ready' });

    // 3. text deltas
    const { text, files } = chooseReply(prompt);
    const chars = Array.from(text);
    let buffer = '';
    for (let i = 0; i < chars.length; i += 3) {
      if (cancelled) return;
      buffer += chars.slice(i, i + 3).join('');
      h.onEvent({ type: 'text_delta', messageId, delta: chars.slice(i, i + 3).join(''), index: i });
      await sleep(20 + Math.random() * 40);
    }

    // 4. file blocks
    if (files && files.length) {
      for (const f of files) {
        if (cancelled) return;
        h.onEvent({
          type: 'file',
          messageId,
          file: { ...f, content: `; ${f.name} generated by Chemycode\n; size: ${f.size}\n\nintegrator = md\nnsteps = 50000000\ndt = 0.002\n\n; ...` },
        });
        await sleep(60);
      }
    }

    // 5. confirm request
    h.onEvent({
      type: 'confirm_request',
      messageId,
      prompt: '是否接受当前步骤的配置参数并继续？',
      options: [
        { id: 'accept', label: '接受' },
        { id: 'reject', label: '拒绝', destructive: true },
      ],
    });

    h.onDone();
  })();

  return { cancel: () => { cancelled = true; } };
}

// ---------- Mock implementations of every API method ----------

const mockAuth = {
  async login(req: LoginRequest): Promise<Result<LoginResponse, ApiError>> {
    await simulateLatency();
    if (req.username === 'demo' || req.username === 'Justinian') {
      const resp: LoginResponse = {
        token: MOCK_TOKEN,
        user: mockUser,
        expiresAt: Date.now() + 24 * 3600 * 1000,
      };
      setToken(MOCK_TOKEN);
      setStoredUser(mockUser);
      return ok(resp);
    }
    return err(makeError('AUTH_INVALID', 'Invalid credentials', 401));
  },
  async logout(): Promise<Result<void, ApiError>> {
    setToken(null);
    setStoredUser(null);
    return ok(undefined);
  },
  async me(): Promise<Result<UserProfile, ApiError>> {
    await simulateLatency();
    return ok(mockUser);
  },
  async updateProfile(patch: Partial<UserProfile>): Promise<Result<UserProfile, ApiError>> {
    await simulateLatency();
    Object.assign(mockUser, patch);
    return ok(mockUser);
  },
};

const mockSessions = {
  async list(): Promise<Result<SessionInfo[], ApiError>> {
    await simulateLatency();
    return ok(Array.from(_mockSessions.values()).map((s) => s.info));
  },
  async create(req: CreateSessionRequest = {}): Promise<Result<SessionInfo, ApiError>> {
    await simulateLatency();
    return ok(newSession(req));
  },
  async get(id: string): Promise<Result<SessionInfo, ApiError>> {
    await simulateLatency();
    const s = _mockSessions.get(id);
    if (!s) return err(makeError('NOT_FOUND', 'Session not found', 404));
    return ok(s.info);
  },
  async history(id: string, opts: { cursor?: string; limit?: number } = {}): Promise<Result<SessionHistoryResponse, ApiError>> {
    await simulateLatency();
    const s = _mockSessions.get(id);
    if (!s) return err(makeError('NOT_FOUND', 'Session not found', 404));
    return ok({
      session: s.info,
      messages: s.messages,
      hasMore: false,
    });
  },
  async delete(id: string): Promise<Result<void, ApiError>> {
    _mockSessions.delete(id);
    return ok(undefined as unknown as void);
  },
  async send(id: string, body: { content: string }): Promise<Result<void, ApiError>> {
    const s = _mockSessions.get(id);
    if (s) {
      s.messages.push({
        id: rid('msg'),
        type: 'user',
        content: body.content,
        timestamp: timeLabel(now()),
      });
    }
    return ok(undefined as unknown as void);
  },
  async cancel(): Promise<Result<void, ApiError>> {
    return ok(undefined as unknown as void);
  },
  async rename(id: string, title: string): Promise<Result<SessionInfo, ApiError>> {
    const s = _mockSessions.get(id);
    if (!s) return err(makeError('NOT_FOUND', 'Session not found', 404));
    s.info.title = title;
    return ok(s.info);
  },
};

const mockTasks = {
  async list(): Promise<Result<ListTasksResponse, ApiError>> {
    await simulateLatency();
    return ok({ tasks: _mockTasks.slice(), total: _mockTasks.length });
  },
  async get(id: string): Promise<Result<Task, ApiError>> {
    await simulateLatency();
    const t = _mockTasks.find((x) => x.id === id);
    if (!t) return err(makeError('NOT_FOUND', 'Task not found', 404));
    return ok(t);
  },
  async create(req: CreateTaskRequest): Promise<Result<Task, ApiError>> {
    await simulateLatency();
    const t: Task = {
      id: rid('T'),
      name: req.name,
      calcType: req.calcType,
      status: 'waiting',
      description: req.description || '',
      createdAt: timeLabel(now()),
      parameters: req.parameters,
    };
    _mockTasks.unshift(t);
    return ok(t);
  },
  async cancel(id: string): Promise<Result<void, ApiError>> {
    const t = _mockTasks.find((x) => x.id === id);
    if (t) t.status = 'completed';
    return ok(undefined as unknown as void);
  },
  async delete(id: string): Promise<Result<void, ApiError>> {
    _mockTasks = _mockTasks.filter((x) => x.id !== id);
    return ok(undefined as unknown as void);
  },
  watch(): () => void {
    // No-op in mock; events are pushed via `pushTaskUpdate` if needed.
    return () => {};
  },
};

const mockSkills = {
  async list(): Promise<Result<SkillEntry[], ApiError>> {
    await simulateLatency();
    return ok(_mockSkills.slice());
  },
  async install(id: string): Promise<Result<SkillEntry, ApiError>> {
    await simulateLatency();
    const s = _mockSkills.find((x) => x.id === id);
    if (!s) return err(makeError('NOT_FOUND', 'Skill not found', 404));
    s.installed = true;
    return ok(s);
  },
  async uninstall(id: string): Promise<Result<void, ApiError>> {
    await simulateLatency();
    const s = _mockSkills.find((x) => x.id === id);
    if (!s) return err(makeError('NOT_FOUND', 'Skill not found', 404));
    s.installed = false;
    return ok(undefined as unknown as void);
  },
  async import(file: File): Promise<Result<SkillEntry, ApiError>> {
    await simulateLatency();
    const s: SkillEntry = {
      id: rid('S'),
      name: file.name.replace(/\.[^.]+$/, ''),
      description: `Imported from ${file.name}`,
      version: '0.1.0',
      installed: true,
      author: 'Local',
      downloads: 0,
      toolCount: 0,
      toolNames: [],
    };
    _mockSkills.push(s);
    return ok(s);
  },
  async remove(id: string): Promise<Result<void, ApiError>> {
    await simulateLatency();
    const idx = _mockSkills.findIndex((x) => x.id === id);
    if (idx === -1) return err(makeError('NOT_FOUND', 'Skill not found', 404));
    _mockSkills.splice(idx, 1);
    return ok(undefined as unknown as void);
  },
};

const mockKnowledge = {
  async list(): Promise<Result<KnowledgeEntry[], ApiError>> {
    await simulateLatency();
    return ok(_mockKnowledge.slice());
  },
  async search(query: string): Promise<Result<KnowledgeEntry[], ApiError>> {
    await simulateLatency();
    const q = query.toLowerCase();
    return ok(
      _mockKnowledge.filter(
        (e) => e.title.toLowerCase().includes(q) ||
               e.content.toLowerCase().includes(q) ||
               e.tags.some((t) => t.toLowerCase().includes(q)),
      ),
    );
  },
  async get(id: string): Promise<Result<KnowledgeEntry, ApiError>> {
    await simulateLatency();
    const e = _mockKnowledge.find((x) => x.id === id);
    if (!e) return err(makeError('NOT_FOUND', 'Knowledge entry not found', 404));
    return ok(e);
  },
};

const mockModels = {
  async list(): Promise<Result<ConfiguredModel[], ApiError>> {
    await simulateLatency();
    return ok(_mockModels.slice());
  },
  async add(req: AddModelRequest): Promise<Result<ConfiguredModel, ApiError>> {
    await simulateLatency();
    const m: ConfiguredModel = {
      id: rid('m'),
      name: req.name,
      apiUrl: req.apiUrl,
      apiKey: 'sk-***',
      supportsContext: req.supportsContext,
      provider: req.provider,
      isDefault: req.isDefault,
    };
    _mockModels.push(m);
    return ok(m);
  },
  async update(id: string, patch: Partial<AddModelRequest>): Promise<Result<ConfiguredModel, ApiError>> {
    await simulateLatency();
    const m = _mockModels.find((x) => x.id === id);
    if (!m) return err(makeError('NOT_FOUND', 'Model not found', 404));
    Object.assign(m, patch);
    if (patch.apiKey) m.apiKey = 'sk-***';
    return ok(m);
  },
  async remove(id: string): Promise<Result<void, ApiError>> {
    _mockModels = _mockModels.filter((x) => x.id !== id);
    return ok(undefined as unknown as void);
  },
  async test(id: string): Promise<Result<TestModelResponse, ApiError>> {
    await sleep(800 + Math.random() * 1200);
    const m = _mockModels.find((x) => x.id === id);
    if (!m) return err(makeError('NOT_FOUND', 'Model not found', 404));
    return ok({
      success: true,
      latencyMs: 200 + Math.random() * 600,
      models: [m.name],
    });
  },
  async setDefault(id: string): Promise<Result<void, ApiError>> {
    _mockModels.forEach((m) => (m.isDefault = m.id === id));
    return ok(undefined as unknown as void);
  },
};

const mockUploads = {
  async file(file: File): Promise<Result<UploadResponse, ApiError>> {
    await sleep(300);
    return ok({
      fileId: rid('F'),
      filename: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      url: `/uploads/${encodeURIComponent(file.name)}`,
    });
  },
};

const mockSystem = {
  async status(): Promise<Result<SystemStatus, ApiError>> {
    await simulateLatency();
    return ok({
      version: '1.0.0',
      buildTime: '2026-05-31',
      activeAgent: 'default',
      activeModel: 'DeepSeek-V4',
      uptimeSec: Math.floor(performance.now() / 1000),
      toolCount: 30,
      skillCount: _mockSkills.filter((s) => s.installed).length,
    });
  },
  async health(): Promise<Result<{ ok: true; ts: number }, ApiError>> {
    return ok({ ok: true as const, ts: Date.now() });
  },
};

// ---------- Mode-aware facade ----------

function makeError(code: string, message: string, status: number): ApiError {
  return new (class extends Error {
    override readonly name = 'ApiError';
    constructor(public override message: string, public code: string, public status: number) {
      super(message);
    }
  })(message, code, status) as unknown as ApiError;
}

function err<T>(error: ApiError): Result<T, ApiError> {
  return { ok: false, error };
}

export const mockApiClient = {
  auth: mockAuth,
  sessions: mockSessions,
  tasks: mockTasks,
  skills: mockSkills,
  knowledge: mockKnowledge,
  models: mockModels,
  uploads: mockUploads,
  system: mockSystem,
};

import type { ApiClientShape } from './shared';

// ... (keep existing imports)

/**
 * Returns the active client (real or mock) based on the current mode.
 * Both implementations conform to ApiClientShape — no unsafe casting.
 */
export function getActiveClient(): ApiClientShape {
  return USE_MOCK() ? mockApiClient : realApiClient as ApiClientShape;
}

// Re-export the real client lazily to avoid a circular import.
import { apiClient as realApiClient } from './index';
