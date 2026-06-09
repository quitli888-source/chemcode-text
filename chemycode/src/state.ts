// ====== State Management ======
// Centralized store with subscribe/notify semantics. UI components opt in
// to specific slices via `subscribe()` and re-render when notified.
//
// Architecture changes from the original mock-only state:
//   1. Domain data (tasks/knowledge/skills/models) now flows in from the API
//      via `loadAll()` and individual `refresh*` functions.
//   2. New fields: `loading`, `error`, `connectionState`, `currentUser`,
//      `activeSessionId`, `pendingConfirm`.
//   3. Optimistic update helpers (`withOptimistic`) for snappy UI.
//   4. Mutations call the API; on failure we rollback and surface a toast.
//
// The original public function names (`getState`, `updateState`, `setView`,
// `selectTask`, `toggleSidebar`, `setThemeMode`, `setLanguage`, `setFontSize`,
// `setSettingsTab`, `subscribe`, `addChatMessage`, `toggleSkill`, `addModel`,
// `removeModel`) are preserved so existing components keep working.

import type {
  ChatMessage,
  ConfiguredModel,
  KnowledgeEntry,
  PageView,
  SettingsTab,
  SkillEntry,
  Task,
  ThemeMode,
  Lang,
  ConnectionState,
  UserProfile,
} from './types';
import type { StreamEvent } from './api/types';
import { getActiveClient, getApiMode, onApiModeChange } from './api/mock';
import { stream } from './api/stream';
import { ApiError, onAuthEvent, setToken } from './api/client';
import { showError } from './components/toast';
import { simulateChatStream } from './api/mock';

// ---------- State shape ----------

export interface AppState {
  // Navigation
  currentView: PageView;
  selectedTaskId: string | null;
  sidebarCollapsed: boolean;
  settingsTab: SettingsTab;

  // Domain data
  tasks: Task[];
  knowledge: KnowledgeEntry[];
  skills: SkillEntry[];
  chatMessages: ChatMessage[];
  configuredModels: ConfiguredModel[];

  // Session / chat
  activeSessionId: string | null;
  sessions: Array<{ id: string; title: string; lastInteractionAt: string; messageCount: number; model?: string }>;
  pendingConfirm: { prompt: string; options: { id: string; label: string; destructive?: boolean }[]; messageId: string } | null;

  // Settings (persisted to localStorage)
  theme: ThemeMode;
  language: Lang;
  fontSize: number;

  // Runtime
  isLoading: boolean;
  error: string | null;
  connectionState: ConnectionState;
  isAuthenticated: boolean;
  currentUser: UserProfile | null;
  apiMode: 'mock' | 'real';
  typingMessageId: string | null;     // the agent message currently being streamed
}

const LS_THEME = 'chemycode.theme';
const LS_LANG = 'chemycode.lang';
const LS_FONT = 'chemycode.font';

function readLS<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

// ---------- Initial state ----------

let state: AppState = {
  currentView: 'chat',
  selectedTaskId: null,
  sidebarCollapsed: false,
  settingsTab: 'account',

  tasks: [],
  knowledge: [],
  skills: [],
  chatMessages: [],
  configuredModels: [],

  activeSessionId: null,
  sessions: [],
  pendingConfirm: null,

  theme: readLS<ThemeMode>(LS_THEME, 'light'),
  language: readLS<Lang>(LS_LANG, 'zh'),
  fontSize: readLS<number>(LS_FONT, 14),

  isLoading: false,
  error: null,
  connectionState: 'idle',
  isAuthenticated: false,
  currentUser: null,
  apiMode: getApiMode(),
  typingMessageId: null,
};

// Apply theme as early as possible to avoid a flash.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', state.theme);
}

// ---------- Subscribers ----------

type Listener = () => void;
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function updateState(partial: Partial<AppState>): void {
  state = { ...state, ...partial };
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Helpers ----------

function isAuthError(e: ApiError): boolean {
  return e.status === 401 || e.code === 'AUTH_REQUIRED';
}

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: ApiError }): T {
  if (r.ok) return r.value;
  if (isAuthError(r.error)) {
    updateState({ isAuthenticated: false, currentUser: null });
  }
  showError(r.error.message);
  throw r.error;
}

// ---------- Boot: load all domain data ----------

let initialLoadStarted = false;

export async function bootstrap(): Promise<void> {
  if (initialLoadStarted) return;
  initialLoadStarted = true;

  // Watch connection state.
  stream.subscribe({
    onEvent: () => {},
    onState: (s) => updateState({ connectionState: s }),
  });

  // Watch auth events.
  onAuthEvent((ev) => {
    if (ev.kind === 'unauthorized') {
      updateState({ isAuthenticated: false, currentUser: null });
    }
  });

  // React to API mode changes (e.g. dev toggles mock).
  onApiModeChange((m) => {
    updateState({ apiMode: m });
    // Re-fetch domain data with the new mode.
    void loadAll();
  });

  // Probe auth: if a token is in localStorage, try /auth/me.
  const existing = typeof localStorage !== 'undefined' ? localStorage.getItem('chemycode.token') : null;
  if (existing) {
    await tryRestoreSession();
  }

  // Always load domain data AFTER auth is resolved.
  await loadAll();
}

async function tryRestoreSession(): Promise<void> {
  const client = getActiveClient();
  const r = await client.auth.me();
  if (r.ok) {
    updateState({ isAuthenticated: true, currentUser: r.value });
  } else {
    setToken(null);
  }
}

export async function loadAll(): Promise<void> {
  // Skip API calls if not authenticated (avoids 5× 401 toasts).
  if (!state.isAuthenticated && getApiMode() === 'real') {
    updateState({ isLoading: false });
    return;
  }
  updateState({ isLoading: true, error: null });
  const client = getActiveClient();
  const results = await Promise.allSettled([
    client.tasks.list(),
    client.skills.list(),
    client.knowledge.list(),
    client.models.list(),
    client.system.status(),
    client.sessions.list(),
  ]);

  const [tasksR, skillsR, knowledgeR, modelsR, statusR, sessionsR] = results;
  const patch: Partial<AppState> = { isLoading: false };

  if (tasksR.status === 'fulfilled' && tasksR.value.ok) {
    patch.tasks = tasksR.value.value.tasks;
  }
  if (skillsR.status === 'fulfilled' && skillsR.value.ok) {
    patch.skills = skillsR.value.value;
  }
  if (knowledgeR.status === 'fulfilled' && knowledgeR.value.ok) {
    patch.knowledge = knowledgeR.value.value;
  }
  if (modelsR.status === 'fulfilled' && modelsR.value.ok) {
    patch.configuredModels = modelsR.value.value;
  }
  if (sessionsR.status === 'fulfilled' && sessionsR.value.ok) {
    patch.sessions = sessionsR.value.value;
  }
  if (statusR.status === 'rejected' || (statusR.status === 'fulfilled' && !statusR.value.ok)) {
    // Soft-fail: don't block UI on status; the error will surface via toast elsewhere.
  }
  updateState(patch);

  // If no active session, create one.
  if (!state.activeSessionId) {
    const sessions = patch.sessions || [];
    if (sessions.length > 0) {
      // Load the most recent session's messages.
      const latest = sessions[0];
      updateState({ activeSessionId: latest.id });
      try {
        const histR = await client.sessions.history(latest.id);
        if (histR.ok && histR.value.messages.length > 0) {
          updateState({ chatMessages: histR.value.messages });
        }
      } catch { /* best effort */ }
    } else {
      // No sessions exist — create a new one.
      const r = await client.sessions.create({});
      if (r.ok) {
        updateState({ activeSessionId: r.value.id, sessions: [r.value] });
      }
    }
  }
}

// ---------- Auth flows ----------

export async function login(username: string, password: string): Promise<boolean> {
  updateState({ isLoading: true, error: null });
  const client = getActiveClient();
  const r = await client.auth.login({ username, password });
  updateState({ isLoading: false });
  if (r.ok) {
    updateState({ isAuthenticated: true, currentUser: r.value.user, currentView: 'chat' });
    await loadAll();
    return true;
  }
  updateState({ error: r.error.message });
  showError(r.error.message);
  return false;
}

export async function logout(): Promise<void> {
  const client = getActiveClient();
  await client.auth.logout();
  updateState({
    isAuthenticated: false,
    currentUser: null,
    currentView: 'login',
    tasks: [],
    skills: [],
    knowledge: [],
    configuredModels: [],
    chatMessages: [],
    activeSessionId: null,
    sessions: [],
  });
}

// ---------- Navigation ----------

export function setView(view: PageView): void {
  updateState({ currentView: view, selectedTaskId: view === 'task-detail' ? state.selectedTaskId : null });
}

export function selectTask(id: string): void {
  updateState({ currentView: 'task-detail', selectedTaskId: id });
}

export function toggleSidebar(): void {
  updateState({ sidebarCollapsed: !state.sidebarCollapsed });
}

// ---------- Settings ----------

export function setThemeMode(mode: ThemeMode): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(LS_THEME, JSON.stringify(mode));
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', mode);
  updateState({ theme: mode });
}

export function setLanguage(lang: Lang): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(LS_LANG, JSON.stringify(lang));
  updateState({ language: lang });
}

export function setFontSize(size: number): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(LS_FONT, JSON.stringify(size));
  updateState({ fontSize: size });
}

export function setSettingsTab(tab: SettingsTab): void {
  updateState({ settingsTab: tab });
}

// ---------- Tasks ----------

export async function refreshTasks(): Promise<void> {
  const client = getActiveClient();
  const r = await client.tasks.list();
  if (r.ok) updateState({ tasks: r.value.tasks });
  else showError(r.error.message);
}

export async function deleteTask(id: string): Promise<void> {
  // Optimistic remove.
  const prev = state.tasks;
  updateState({ tasks: state.tasks.filter((t) => t.id !== id) });
  const client = getActiveClient();
  const r = await client.tasks.delete(id);
  if (!r.ok) {
    updateState({ tasks: prev });
    showError(r.error.message);
  }
}

export function getTask(id: string): Task | undefined {
  return state.tasks.find((t) => t.id === id);
}

// ---------- Skills ----------

export async function toggleSkill(id: string): Promise<void> {
  const skill = state.skills.find((s) => s.id === id);
  if (!skill) return;
  const willInstall = !skill.installed;

  // Optimistic update.
  updateState({
    skills: state.skills.map((s) => (s.id === id ? { ...s, installed: willInstall } : s)),
  });

  const client = getActiveClient();
  const r = willInstall
    ? await client.skills.install(id)
    : await client.skills.uninstall(id);

  if (!r.ok) {
    // Rollback.
    updateState({
      skills: state.skills.map((s) => (s.id === id ? { ...s, installed: !willInstall } : s)),
    });
    showError(r.error.message);
  }
}

// ---------- Knowledge ----------

export async function searchKnowledge(query: string): Promise<KnowledgeEntry[]> {
  if (!query.trim()) return state.knowledge;
  const client = getActiveClient();
  const r = await client.knowledge.search(query);
  if (r.ok) return r.value;
  showError(r.error.message);
  return [];
}

export function getKnowledge(id: string): KnowledgeEntry | undefined {
  return state.knowledge.find((k) => k.id === id);
}

// ---------- Models ----------

export async function addModel(req: Parameters<ReturnType<typeof getActiveClient>['models']['add']>[0]): Promise<void> {
  const client = getActiveClient();
  const r = await client.models.add(req);
  if (r.ok) {
    updateState({ configuredModels: [...state.configuredModels, r.value] });
  } else {
    showError(r.error.message);
  }
}

export async function removeModel(id: string): Promise<void> {
  // Try to find by id first; fall back to name for backward compat.
  const m = state.configuredModels.find((x) => x.id === id || x.name === id);
  if (!m) return;
  const targetId = m.id || m.name;

  const prev = state.configuredModels;
  updateState({ configuredModels: state.configuredModels.filter((x) => x.id !== targetId && x.name !== targetId) });
  const client = getActiveClient();
  const r = await client.models.remove(targetId);
  if (!r.ok) {
    updateState({ configuredModels: prev });
    showError(r.error.message);
  }
}

export async function testModel(id: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const client = getActiveClient();
  const r = await client.models.test(id);
  if (r.ok) return { ok: r.value.success, latencyMs: r.value.latencyMs, error: r.value.error };
  return { ok: false, error: r.error.message };
}

export async function editModel(id: string, patch: { name?: string; apiUrl?: string; apiKey?: string; provider?: string; supportsContext?: boolean; contextWindow?: number; maxTokens?: number }): Promise<boolean> {
  const client = getActiveClient();
  const r = await client.models.update(id, patch);
  if (r.ok) {
    updateState({
      configuredModels: state.configuredModels.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    });
    return true;
  }
  showError(r.error.message);
  return false;
}

// ---------- Chat messages ----------

export function addChatMessage(msg: ChatMessage): void {
  updateState({ chatMessages: [...state.chatMessages, msg] });
}

export function updateMessage(id: string, patch: Partial<ChatMessage>): void {
  updateState({
    chatMessages: state.chatMessages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  });
}

export function clearChatMessages(): void {
  updateState({ chatMessages: [] });
}

// ---------- Send a chat message ----------
//
// The flow is:
//   1. Push the user message immediately (optimistic).
//   2. Create a session if none is active.
//   3. Open the stream if needed.
//   4. Send `user_message` over the stream OR fall back to mock stream
//      simulation when in mock mode.
//   5. Append a placeholder agent message and stream text into it.
//
// The stream event handler is shared between mock and real mode.

// ---------- Shared stream event handler ----------

interface StreamEventCallbacks {
  setPendingToolCall: (tc: { id: string; name: string } | null) => void;
  clearPendingToolCall: () => void;
  onDone: () => void;
}

function handleStreamEvent(
  ev: StreamEvent,
  agentMsgId: string,
  ts: string,
  getPendingToolCall: () => { id: string; name: string } | null,
  cbs: StreamEventCallbacks,
): void {
  switch (ev.type) {
    case 'thinking':
      updateMessage(agentMsgId, {
        thinking: (state.chatMessages.find((m) => m.id === agentMsgId)?.thinking || '') + ev.content,
      });
      break;
    case 'tool_call_start':
      cbs.setPendingToolCall({ id: ev.toolCallId, name: ev.toolName });
      addChatMessage({
        id: ev.toolCallId,
        type: 'tool',
        content: '',
        timestamp: ts,
        toolCallId: ev.toolCallId,
        toolName: ev.toolName,
        toolStatus: 'running',
        // Store args as a separate field so they survive content updates.
        code: JSON.stringify(ev.args, null, 2),
      });
      break;
    case 'tool_call_update':
      updateState({
        chatMessages: state.chatMessages.map((m) =>
          m.toolCallId === ev.toolCallId
            ? { ...m, content: ev.partialResult || m.content || '', toolStatus: ev.status }
            : m,
        ),
      });
      break;
    case 'tool_call_end': {
      const files = ev.files || [];
      const ptc = getPendingToolCall();
      updateState({
        chatMessages: state.chatMessages.map((m) =>
          m.toolCallId === ev.toolCallId
            ? { ...m, content: ev.result || (ev.error ? `Error: ${ev.error}` : `${ptc?.name || 'tool'} done`), toolStatus: ev.error ? 'failed' : 'completed', files }
            : m,
        ),
      });
      cbs.clearPendingToolCall();
      break;
    }
    case 'text_delta': {
      const cur = state.chatMessages.find((m) => m.id === agentMsgId);
      updateMessage(agentMsgId, { content: (cur?.content || '') + ev.delta });
      break;
    }
    case 'file': {
      const cur = state.chatMessages.find((m) => m.id === agentMsgId);
      updateMessage(agentMsgId, { files: [...(cur?.files || []), ev.file] });
      break;
    }
    case 'confirm_request':
      updateState({
        pendingConfirm: { prompt: ev.prompt, options: ev.options, messageId: agentMsgId },
      });
      break;
    case 'error':
      showError(ev.message);
      // Fatal errors (AGENT_ERROR, LLM_ERROR) should end the typing state.
      // The backend does not send a 'done' event after these errors.
      if (ev.code === 'AGENT_ERROR' || ev.code === 'LLM_ERROR' || ev.code === 'MAX_ROUNDS') {
        cbs.onDone();
      }
      break;
    case 'status':
      // Status updates from the agent (e.g. task created, compacting).
      // Refresh tasks to pick up new task from sidebar.
      if (ev.topic === 'tasks') {
        void refreshTasks();
      }
      break;
    case 'done':
      // Store usage, model metadata, and generated files on the agent message.
      if (ev.usage || ev.model || ev.generatedFiles) {
        updateMessage(agentMsgId, {
          usage: ev.usage ? {
            promptTokens: ev.usage.promptTokens ?? 0,
            completionTokens: ev.usage.completionTokens ?? 0,
            totalTokens: ev.usage.totalTokens ?? 0,
            reasoningTokens: ev.usage.reasoningTokens ?? 0,
          } : undefined,
          model: ev.model,
          contextWindow: ev.contextWindow,
          generatedFiles: ev.generatedFiles,
        });
      }
      cbs.onDone();
      // Refresh tasks after agent completes (tasks may have been created/updated).
      // Use a short delay to ensure backend has persisted all changes.
      setTimeout(() => { void refreshTasks(); }, 500);
      break;
  }
}

export async function sendMessage(content: string, opts: { model?: string; attachments?: string[]; thinking?: string | boolean; workspace?: string; activeSkill?: string } = {}): Promise<void> {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const userMsg: ChatMessage = {
    id: `msg-${Date.now()}`,
    type: 'user',
    content,
    timestamp: ts,
  };
  addChatMessage(userMsg);

  // Ensure a session exists.
  let sessionId: string | null = state.activeSessionId;
  if (!sessionId) {
    const client = getActiveClient();
    const r = await client.sessions.create({ model: opts.model });
    if (r.ok) {
      sessionId = r.value.id;
      updateState({ activeSessionId: sessionId });
    } else {
      showError(r.error.message);
      return;
    }
  }
  // At this point sessionId is guaranteed to be a string (else we returned).
  const sid = sessionId!;

  // Open stream.
  stream.ensureConnected();

  if (state.apiMode === 'mock') {
    // Mock mode: drive a local simulator using the shared handler.
    const agentMsgId = `msg-${Date.now()}-agent`;
    addChatMessage({
      id: agentMsgId,
      type: 'agent',
      content: '',
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    });
    updateState({ typingMessageId: agentMsgId });

    let pendingToolCall: { id: string; name: string } | null = null;
    const handle = simulateChatStream(content, {
      onEvent: (ev) => {
        handleStreamEvent(ev, agentMsgId, ts, () => pendingToolCall, {
          setPendingToolCall: (tc) => { pendingToolCall = tc; },
          clearPendingToolCall: () => { pendingToolCall = null; },
          onDone: () => updateState({ typingMessageId: null }),
        });
      },
      onDone: () => {}, // 'done' is handled inside handleStreamEvent
    });
    void handle;
    return;
  }

  // Real mode: send over the stream and process the response events.
  const agentMsgId = `msg-${Date.now()}-agent`;
  addChatMessage({
    id: agentMsgId,
    type: 'agent',
    content: '',
    timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
  });
  updateState({ typingMessageId: agentMsgId });

  let pendingToolCall: { id: string; name: string } | null = null;
  let unsub: (() => void) | null = null;

  unsub = stream.subscribe({
    // Use '*' to receive both 'chat' and 'sub-agent' events.
    // Sub-agent events (from sessions_spawn with emitToParent:true)
    // are tagged with topic:'sub-agent' and would be missed by
    // a topic:'chat'-only subscription.
    topic: '*',
    onEvent: (ev) => {
      handleStreamEvent(ev, agentMsgId, ts, () => pendingToolCall, {
        setPendingToolCall: (tc) => { pendingToolCall = tc; },
        clearPendingToolCall: () => { pendingToolCall = null; },
        onDone: () => {
          updateState({ typingMessageId: null });
          unsub?.();
        },
      });
    },
    onState: (s) => {
      // If connection drops before we receive 'done', clean up.
      if (s === 'disconnected' || s === 'error') {
        updateState({ typingMessageId: null });
        unsub?.();
      }
    },
  });

  const sent = stream.send({
    type: 'user_message',
    sessionId: sid,
    content,
    model: opts.model,
    attachments: opts.attachments,
    thinking: opts.thinking,
    workspace: opts.workspace,
    activeSkill: opts.activeSkill,
  });
  if (!sent) {
    // Message was queued (WebSocket not yet open).
    // stream.send() already called ensureConnected() and queued the command.
    // It will be flushed when the connection opens. Keep the subscription active
    // so we receive the response when it arrives.
    showError('连接中，消息将在连接建立后自动发送…');
    // Do NOT unsub() or clear typingMessageId — the response will arrive later.
  }
}

export function respondToConfirm(optionId: string): void {
  const confirm = state.pendingConfirm;
  if (!confirm) return;

  // Add a user message showing the choice.
  const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  addChatMessage({
    id: `msg-${Date.now()}`,
    type: 'user',
    content: optionId === 'accept' ? '确认，继续执行' : '已拒绝',
    timestamp: ts,
  });
  updateState({ pendingConfirm: null });

  if (state.apiMode === 'mock') {
    // Mock mode: simulate a follow-up agent response.
    const agentMsgId = `msg-${Date.now()}-agent`;
    addChatMessage({
      id: agentMsgId,
      type: 'agent',
      content: '',
      timestamp: ts,
    });
    updateState({ typingMessageId: agentMsgId });

    if (optionId === 'accept') {
      let pendingToolCall: { id: string; name: string } | null = null;
      simulateChatStream('继续执行', {
        onEvent: (ev) => {
          handleStreamEvent(ev, agentMsgId, ts, () => pendingToolCall, {
            setPendingToolCall: (tc) => { pendingToolCall = tc; },
            clearPendingToolCall: () => { pendingToolCall = null; },
            onDone: () => updateState({ typingMessageId: null }),
          });
        },
        onDone: () => {},
      });
    } else {
      // Rejected: show a brief response.
      updateMessage(agentMsgId, { content: '好的，已取消当前操作。如需帮助请随时告诉我。' });
      updateState({ typingMessageId: null });
    }
    return;
  }

  // Real mode: send a confirm_response command.
  // Reuse the existing agent message ID so follow-up events
  // (text_delta, tool_call_*, done) update the same message.
  const agentMsgId = confirm.messageId;
  updateState({ typingMessageId: agentMsgId });

  // Re-subscribe to the stream because the original subscription
  // from sendMessage() was removed when the first 'done' fired.
  let pendingToolCall: { id: string; name: string } | null = null;
  let unsub: (() => void) | null = null;
  unsub = stream.subscribe({
    topic: '*',
    onEvent: (ev) => {
      handleStreamEvent(ev, agentMsgId, ts, () => pendingToolCall, {
        setPendingToolCall: (tc) => { pendingToolCall = tc; },
        clearPendingToolCall: () => { pendingToolCall = null; },
        onDone: () => {
          updateState({ typingMessageId: null });
          unsub?.();
        },
      });
    },
    onState: (s) => {
      if (s === 'disconnected' || s === 'error') {
        updateState({ typingMessageId: null });
        unsub?.();
      }
    },
  });

  stream.send({
    type: 'confirm_response',
    confirmId: confirm.messageId,
    optionId,
  });
}

export function dismissConfirm(): void {
  updateState({ pendingConfirm: null });
}

// ---------- Stop generation ----------

export function stopGeneration(): void {
  const sessionId = state.activeSessionId;
  if (!sessionId) return;
  stream.send({ type: 'cancel', sessionId });
  updateState({ typingMessageId: null });
  // Clean up the pending confirm if any.
  if (state.pendingConfirm) {
    updateState({ pendingConfirm: null });
  }
}

// ---------- Sessions ----------

export async function createNewSession(): Promise<void> {
  const client = getActiveClient();
  const r = await client.sessions.create({});
  if (r.ok) {
    updateState({
      activeSessionId: r.value.id,
      chatMessages: [],
      currentView: 'chat',
    });
    // Add to sessions list.
    const sessions = state.sessions || [];
    updateState({ sessions: [r.value, ...sessions] });
  } else {
    showError(r.error.message);
  }
}

export async function switchSession(sessionId: string): Promise<void> {
  if (sessionId === state.activeSessionId) return;
  const client = getActiveClient();
  const histR = await client.sessions.history(sessionId);
  if (histR.ok) {
    updateState({
      activeSessionId: sessionId,
      chatMessages: histR.value.messages || [],
      currentView: 'chat',
    });
  } else {
    showError(histR.error.message);
  }
}

export async function refreshSessions(): Promise<void> {
  const client = getActiveClient();
  const r = await client.sessions.list();
  if (r.ok) updateState({ sessions: r.value });
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const client = getActiveClient();
  const r = await client.sessions.rename(sessionId, title);
  if (r.ok) {
    updateState({
      sessions: (state.sessions || []).map((s) => s.id === sessionId ? { ...s, title } : s),
    });
  } else {
    showError(r.error.message);
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const client = getActiveClient();
  const r = await client.sessions.delete(sessionId);
  if (r.ok) {
    const sessions = (state.sessions || []).filter((s) => s.id !== sessionId);
    updateState({ sessions });
    // If deleted session was active, switch to first available.
    if (state.activeSessionId === sessionId) {
      if (sessions.length > 0) {
        await switchSession(sessions[0].id);
      } else {
        await createNewSession();
      }
    }
  } else {
    showError(r.error.message);
  }
}

// ---------- Mode toggle (dev) ----------

export function setApiModePublic(m: 'mock' | 'real'): void {
  // Imported lazily to avoid circular deps.
  import('./api/mock').then(({ setApiMode }) => setApiMode(m));
}

/** Re-export the active client so views can stay decoupled from api/mock. */
export async function getClient() {
  const m = await import('./api/mock');
  return m.getActiveClient();
}
