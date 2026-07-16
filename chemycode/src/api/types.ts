// ====== API Type Definitions ======
// These types are the wire format sent to / received from the backend.
// They mirror the frontend's `types.ts` (AppState shape) so the UI
// can consume them without conversion, but extend it with transport-level
// concerns (streaming events, error envelopes, pagination, etc.).

// ---------- Shared enums ----------

export type CalcType =
  | 'molecular_dynamics'
  | 'dpd'
  | 'quantum_chemistry'
  | 'dft'
  | 'monte_carlo'
  | 'machine_learning';

export type TaskStatus = 'completed' | 'waiting' | 'error' | 'running' | 'cancelled';

export type ThemeMode = 'light' | 'dark';
export type Lang = 'zh' | 'en';

export type SettingsTab = 'account' | 'system' | 'models' | 'help';
export type PageView =
  | 'login'
  | 'chat'
  | 'task-detail'
  | 'knowledge'
  | 'skills'
  | 'settings'
  | 'usage';

// ---------- Domain models (mirror src/types.ts) ----------

export interface JobStep {
  name: string;
  status: TaskStatus;
  detail?: string;
}

export interface Task {
  id: string;
  name: string;
  calcType: CalcType;
  status: TaskStatus;
  description: string;
  progress?: number;
  createdAt: string;
  completedAt?: string;
  forceField?: string;
  temperature?: number;
  pressure?: number;
  timeStep?: number;
  totalSteps?: number;
  jobs?: JobStep[];
  parameters?: Record<string, string>;
  outputFiles?: string[];
  sessionId?: string;
  messageId?: string;
}

export interface ChatMessage {
  id: string;
  type: 'user' | 'agent' | 'system' | 'tool';
  content: string;
  timestamp: string;
  createdAt?: number;
  completedAt?: number;
  files?: GeneratedFile[];
  code?: string;
  toolCallId?: string;
  toolName?: string;
  toolStatus?: 'pending' | 'running' | 'completed' | 'failed';
  thinking?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number };
  model?: string;
  contextWindow?: number;
  generatedFiles?: Array<{ name: string; path: string; type: string }>;
}

export interface GeneratedFile {
  name: string;
  type: string;
  size?: string;
  content?: string;
  url?: string;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
  updatedAt: string;
  source?: 'manual' | 'chat' | 'upload';
  rawContent?: string;
  createdAt?: string;
  learned?: boolean;
  parentPath?: string;
  importance?: number;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  installed: boolean;
  author?: string;
  downloads?: number;
  toolCount?: number;
  toolNames?: string[];
}

export interface ConfiguredModel {
  id?: string;
  name: string;
  apiUrl: string;
  apiKey?: string;       // masked when returned from server
  supportsContext: boolean;
  provider: string;
  isDefault?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface UserProfile {
  id: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  createdAt?: string;
}

// ---------- API envelopes ----------

/** Standard success envelope. */
export interface ApiOk<T> {
  ok: true;
  data: T;
}

/** Standard error envelope. */
export interface ApiErr {
  ok: false;
  error: {
    code: string;        // machine-readable: "AUTH_REQUIRED", "RATE_LIMITED", etc.
    message: string;     // human-readable
    details?: unknown;
  };
}

export type ApiResult<T> = ApiOk<T> | ApiErr;

/** Generic result helper for the client layer. */
export type Result<T, E = ApiErr> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// ---------- Streaming protocol ----------

/** All events sent over the chat WebSocket are tagged unions. */
export type StreamEvent =
  | StreamEventTextDelta
  | StreamEventToolCallStart
  | StreamEventToolCallUpdate
  | StreamEventToolCallEnd
  | StreamEventThinking
  | StreamEventStatus
  | StreamEventFile
  | StreamEventConfirmRequest
  | StreamEventError
  | StreamEventDone
  | StreamEventTurnState;

/** Explicit turn state from the agent loop. */
export type TurnState =
  | 'idle'
  | 'thinking'
  | 'tool_running'
  | 'awaiting_confirm'
  | 'responding'
  | 'done'
  | 'error';

export interface StreamEventTurnState {
  type: 'turn_state';
  state: TurnState;
  messageId?: string;
  topic?: string;
}

export interface StreamEventTextDelta {
  type: 'text_delta';
  messageId: string;
  delta: string;       // incremental text chunk
  index: number;       // for ordered assembly
}

export interface StreamEventToolCallStart {
  type: 'tool_call_start';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  messageId: string;
}

export interface StreamEventToolCallUpdate {
  type: 'tool_call_update';
  toolCallId: string;
  status: 'running' | 'completed' | 'failed';
  partialResult?: string;
  messageId?: string;
}

export interface StreamEventToolCallEnd {
  type: 'tool_call_end';
  toolCallId: string;
  result?: string;
  error?: string;
  files?: GeneratedFile[];
  messageId?: string;
}

export interface StreamEventThinking {
  type: 'thinking';
  messageId: string;
  content: string;
}

export interface StreamEventStatus {
  type: 'status';
  status: TaskStatus;
  message?: string;
  progress?: number;
  topic?: string;
  messageId?: string;
}

export interface StreamEventFile {
  type: 'file';
  messageId: string;
  file: GeneratedFile;
}

export interface StreamEventConfirmRequest {
  type: 'confirm_request';
  messageId: string;
  prompt: string;
  options: { id: string; label: string; destructive?: boolean }[];
  /** The tool name being confirmed (for "always allow" UI). */
  toolName?: string;
}

export interface StreamEventError {
  type: 'error';
  code: string;
  message: string;
  retryable: boolean;
  messageId?: string;
}

export interface StreamEventDone {
  type: 'done';
  messageId: string;
  finishReason: 'stop' | 'tool_calls' | 'max_tokens' | 'cancelled' | 'error';
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
  };
  model?: string;
  contextWindow?: number;
  generatedFiles?: Array<{ name: string; path: string; type: string }>;
}

/** Client → server messages on the chat WebSocket. */
export type StreamCommand =
  | { type: 'user_message'; sessionId: string; content: string; model?: string; attachments?: string[]; thinking?: string | boolean; workspace?: string; activeSkill?: string; useKnowledge?: boolean; messageId?: string }
  | { type: 'confirm_response'; confirmId: string; optionId: string; allowTool?: boolean }
  | { type: 'set_access'; sessionId: string; mode: 'full' | 'confirm'; tools?: string[] }
  | { type: 'cancel'; sessionId: string }
  | { type: 'ping' };

// ---------- REST request/response payloads ----------

export interface LoginRequest {
  username: string;
  password: string;
  remember?: boolean;
}

export interface LoginResponse {
  token: string;
  user: UserProfile;
  expiresAt: number;     // epoch ms
}

export interface CreateSessionRequest {
  agentId?: string;
  model?: string;
  title?: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  agentId: string;
  model?: string;
  createdAt: string;
  lastInteractionAt: string;
  messageCount: number;
  status: 'active' | 'idle' | 'archived';
  /** Workspace directory locked to this session (set on first message). */
  workdir?: string;
}

export interface SessionHistoryResponse {
  session: SessionInfo;
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface ListTasksResponse {
  tasks: Task[];
  total: number;
}

export interface CreateTaskRequest {
  name: string;
  calcType: CalcType;
  description?: string;
  parameters?: Record<string, string>;
}

export interface AddModelRequest {
  name: string;
  apiUrl: string;
  apiKey: string;
  supportsContext: boolean;
  provider: string;
  isDefault?: boolean;
}

export interface TestModelResponse {
  success: boolean;
  latencyMs?: number;
  error?: string;
  models?: string[];
}

export interface SystemStatus {
  version: string;
  buildTime: string;
  activeAgent: string;
  activeModel?: string;
  uptimeSec: number;
  toolCount: number;
  skillCount: number;
}

// ---------- File upload ----------

export interface UploadResponse {
  fileId: string;
  filename: string;
  size: number;
  mimeType: string;
  url: string;
}

// ---------- Usage ----------

export interface UsageSummary {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalCostUsd: number;
  totalToolCalls: number;
  uniqueTools: number;
  avgTokensPerMessage: number;
  avgCostPerMessage: number;
  errorCount: number;
  sessionCount: number;
  topModels: Array<{ model: string; cost: number; tokens: number; messages: number }>;
  topProviders: Array<{ provider: string; cost: number; tokens: number; messages: number }>;
  topTools: Array<{ tool: string; count: number }>;
  dailyBreakdown: Array<{ date: string; messages: number; tokens: number; cost: number }>;
}

// ---------- Connection status ----------

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';
