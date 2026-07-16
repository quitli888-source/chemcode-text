// ====== Tool Types ======
// Follows OpenClaw's ToolDescriptor pattern: name, description, inputSchema, execute.
// Reference: openclaw-tools-src/tools/types.ts + agents/tools/common.ts

export interface ToolParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  title?: string;
  description: string;
  parameters: ToolParameters;
  /** Whether this tool requires user confirmation before execution. */
  dangerous?: boolean;
}

export interface ToolResult {
  content: string;
  /** Whether the tool execution succeeded. */
  success: boolean;
  /** Optional structured details. */
  details?: Record<string, unknown>;
}

export interface ToolExecutionContext {
  /** Working directory for the tool. */
  workdir: string;
  /** User ID for audit logging. */
  userId: string;
  /** Session ID for plan state access. */
  sessionId?: string;
  /** Parent agent message ID for event correlation. */
  messageId?: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Optional: send a streaming event to the client (used by sub-agents). */
  sendEvent?: (ev: any) => void;
}

export type ToolExecuteFn = (
  params: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolResult>;

/**
 * Tool permission configuration.
 * Supports allowlist (whitelist) and denylist (blacklist) modes.
 *
 * Rules:
 *   - If `deny` is set, those tools are blocked. All others are allowed.
 *   - If `allow` is set, ONLY those tools are available.
 *   - If both are set, `deny` takes precedence (deny wins over allow).
 *   - If neither is set, all tools are available (default open).
 */
export interface ToolPermissionConfig {
  /** Whitelist: only these tool names are available. If empty/omitted, all are available. */
  allow?: string[];
  /** Blacklist: these tool names are blocked. Takes precedence over allow. */
  deny?: string[];
}
