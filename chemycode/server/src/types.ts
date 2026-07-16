// ====== Wire types shared with the frontend ======
// These mirror `src/api/types.ts`. They are deliberately kept in lockstep
// to avoid drift.

export type CalcType =
  | 'molecular_dynamics' | 'dpd' | 'quantum_chemistry'
  | 'dft' | 'monte_carlo' | 'machine_learning';

export type TaskStatus = 'completed' | 'waiting' | 'error' | 'running' | 'cancelled';

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

export interface GeneratedFile {
  name: string;
  type: string;
  size?: string;
  content?: string;
  url?: string;
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
  /** Tool invocation arguments, serialized as JSON string for persistence. */
  toolArgs?: string;
  thinking?: string;
  /** Token usage metadata (only on agent messages after done). */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number };
  /** Model used for this message. */
  model?: string;
  /** Context window size in tokens. */
  contextWindow?: number;
  generatedFiles?: Array<{ name: string; path: string; type: string }>;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  category: string;
  content: string;
  tags: string[];
  updatedAt: string;
  /** Where this knowledge came from */
  source?: 'manual' | 'chat' | 'upload';
  /** Original raw content (before LLM processing) */
  rawContent?: string;
  /** Creation timestamp */
  createdAt?: string;
  /** Whether LLM learning succeeded */
  learned?: boolean;
  /** Hierarchical path for tree organization (e.g. "ProjectA/SubTopic"). Empty = root level. */
  parentPath?: string;
  /** Importance level: 0=normal, 1=important, 2=critical. */
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
  id: string;
  name: string;
  apiUrl: string;
  apiKey?: string;
  supportsContext: boolean;
  provider: string;
  isDefault?: boolean;
  /** Maximum context window in tokens (e.g. 128000, 1000000). */
  contextWindow?: number;
  /** Maximum output tokens per request. */
  maxTokens?: number;
  /** Whether the model supports reasoning/thinking mode. */
  reasoning?: boolean;
  /** Sampling temperature (0-2). Defaults to 0.7 if not set. */
  temperature?: number;
}

export interface UserProfile {
  id: string;
  username: string;
  email?: string;
  avatarUrl?: string;
  createdAt?: string;
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

export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr { ok: false; error: { code: string; message: string; details?: unknown } }

// Stream events - exact match to frontend
export type StreamEvent =
  | { type: 'text_delta'; messageId: string; delta: string; index: number; topic?: string }
  | { type: 'tool_call_start'; toolCallId: string; toolName: string; args: Record<string, unknown>; messageId: string; topic?: string }
  | { type: 'tool_call_update'; toolCallId: string; status: 'running' | 'completed' | 'failed'; partialResult?: string; messageId?: string; topic?: string }
  | { type: 'tool_call_end'; toolCallId: string; result?: string; error?: string; files?: GeneratedFile[]; messageId?: string; topic?: string }
  | { type: 'thinking'; messageId: string; content: string; topic?: string }
  | { type: 'status'; status: TaskStatus; message?: string; progress?: number; messageId?: string; topic?: string }
  | { type: 'file'; messageId: string; file: GeneratedFile; topic?: string }
  | { type: 'confirm_request'; messageId: string; prompt: string; options: { id: string; label: string; destructive?: boolean }[]; toolName?: string; allowAlways?: boolean; required?: boolean; topic?: string }
  | { type: 'confirm_timeout'; messageId: string; topic?: string }
  | { type: 'error'; code: string; message: string; retryable: boolean; messageId?: string; topic?: string }
  | { type: 'done'; messageId: string; finishReason: 'stop' | 'tool_calls' | 'max_tokens' | 'cancelled' | 'error'; topic?: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number }; model?: string; contextWindow?: number; generatedFiles?: Array<{ name: string; path: string; type: string }> }
  | { type: 'turn_state'; state: TurnState; messageId?: string; topic?: string };

/**
 * Explicit turn state machine for the agent loop.
 * The server emits `turn_state` events whenever the state transitions,
 * so the frontend can show accurate UI indicators without guessing.
 *
 * State transitions:
 *   idle -> thinking (on user_message)
 *   thinking -> tool_running (on first tool_call_start)
 *   thinking -> responding (on first text_delta)
 *   tool_running -> thinking (on next LLM call after tools)
 *   tool_running -> awaiting_confirm (on confirm_request)
 *   awaiting_confirm -> tool_running (on confirm_response accept)
 *   responding -> done (on done event)
 *   any -> idle (on done/error/cancel)
 */
export type TurnState =
  | 'idle'
  | 'thinking'
  | 'tool_running'
  | 'awaiting_confirm'
  | 'responding'
  | 'done'
  | 'error';

export type StreamCommand =
  | { type: 'user_message'; sessionId: string; content: string; model?: string; attachments?: string[]; thinking?: string | boolean; workspace?: string; activeSkill?: string; useKnowledge?: boolean; messageId?: string }
  | { type: 'confirm_response'; confirmId: string; optionId: string; allowTool?: boolean }
  | { type: 'set_access'; sessionId: string; mode: 'full' | 'confirm'; tools?: string[] }
  | { type: 'cancel'; sessionId: string }
  | { type: 'ping' };
