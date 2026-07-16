// ====== Agent Loop Types ======

import type { LLMClientConfig } from '../llm/client.js';
import type { ConfirmManager } from './confirm.js';
import type { StreamEvent } from '../types.js';
import type { ToolPermissionConfig } from '../tools/types.js';

/** Callback to send events to the frontend via WebSocket. */
export type AgentEventSender = (event: StreamEvent) => void;

/** Configuration for a single agent run. */
export interface AgentRunConfig {
  /** LLM configuration (API key, URL, model). */
  llm: LLMClientConfig;
  /** User's message content. */
  userMessage: string;
  /** Session ID for context tracking. */
  sessionId: string;
  /** Message ID for the agent's response. */
  messageId: string;
  /** Working directory for tool execution. */
  workdir: string;
  /** User ID for audit. */
  userId: string;
  /** Optional: prior conversation messages for context. */
  history?: Array<{ role: 'user' | 'assistant'; content: string; reasoning_content?: string }>;
  /** Optional: file attachment IDs. */
  attachments?: string[];
  /** Confirm manager for dangerous tool approval. */
  confirmManager?: ConfirmManager;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Tool permission config (allowlist/denylist). */
  toolPermissions?: ToolPermissionConfig;
  /** Context window size in tokens (from model config). */
  contextWindow?: number;
  /** Active skill name — its SKILL.md will be injected into the system prompt. */
  activeSkill?: string;
  /** Whether to search the user's knowledge base for relevant context. */
  useKnowledge?: boolean;
  /** User's knowledge context (pre-retrieved relevant entries). */
  knowledgeContext?: string;
}
