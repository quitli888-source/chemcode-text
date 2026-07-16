// ====== ConfirmManager ======
// Manages dangerous tool confirmations.
// When a tool has `dangerous: true`, the agent loop pauses execution,
// sends a confirm_request event to the frontend, and waits for the
// user's response. Supports 5-min timeout, per-tool whitelist, and
// full access mode to skip all confirmations.
//
// Key: the frontend uses `agentMsgId` as the confirmId in confirm_response.
// So we key by messageId (which is the agentMsgId from the frontend's perspective).
//
// Reference: OpenClaw exec-approval-request.ts / exec-approval-followup.ts

import type { StreamEvent } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../storage.js';

/** Append an audit log entry for dangerous tool confirmation decisions. */
function auditLog(entry: {
  ts: string;
  confirmId: string;
  optionId: string;
  accepted: boolean;
  prompt: string;
}): void {
  try {
    const file = path.join(dataDir(), 'audit.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(file, line, 'utf-8');
  } catch (e) {
    console.warn('[audit] failed to write audit log', e);
  }
}

export interface ConfirmRequest {
  /** The agent messageId (used as key, sent back by frontend as confirmId). */
  messageId: string;
  prompt: string;
  options: { id: string; label: string; destructive?: boolean }[];
  /** The tool name being confirmed (for whitelist lookup). */
  toolName?: string;
  /** Whether the UI may offer a per-tool "always allow" action. */
  allowAlways: boolean;
  /** Required workflow gates ignore full-access and allowlists. */
  required: boolean;
}

interface PendingEntry {
  resolve: (accepted: boolean) => void;
  request: ConfirmRequest;
}

export class ConfirmManager {
  private pending = new Map<string, PendingEntry>();
  /** P0 FIX: Timeout handles for each pending confirmation. */
  private timeouts = new Map<string, ReturnType<typeof setTimeout>>();
  /** 5 minutes - generous enough for user to read and decide. */
  private readonly timeoutMs: number;
  /** Tools the user has granted "always allow" for this session. */
  private allowedTools = new Set<string>();
  /** Full access mode: skip ALL confirmations for this session. */
  private fullAccess = false;

  constructor(options?: { timeoutMs?: number }) {
    this.timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000;
  }

  /** Check if a tool is auto-approved (either full access or whitelisted). */
  isAutoApproved(toolName: string): boolean {
    return this.fullAccess || this.allowedTools.has(toolName);
  }

  /** Add a tool to the "always allow" whitelist for this session. */
  addAllowedTool(toolName: string): void {
    this.allowedTools.add(toolName);
    console.log(`[confirm] tool "${toolName}" added to always-allow list`);
  }

  /** Set full access mode (skip all confirmations). */
  setFullAccess(enabled: boolean): void {
    this.fullAccess = enabled;
    console.log(`[confirm] full access mode ${enabled ? 'enabled' : 'disabled'}`);
  }

  /** Clear specific tools from the whitelist, or all if no args. */
  clearAllowedTools(tools?: string[]): void {
    if (tools && tools.length > 0) {
      for (const t of tools) this.allowedTools.delete(t);
    } else {
      this.allowedTools.clear();
    }
  }

  /** Look up the tool name for a pending confirm (used by "always allow"). */
  getPendingToolName(confirmId: string): string | undefined {
    return this.pending.get(confirmId)?.request.toolName;
  }

  /** Whether a pending confirmation may be converted into an allowlist rule. */
  getPendingAllowAlways(confirmId: string): boolean {
    return this.pending.get(confirmId)?.request.allowAlways ?? false;
  }

  /**
   * Request confirmation from the user.
   * Returns a Promise that resolves to `true` if accepted, `false` if rejected
   * or timed out (5 min auto-reject).
   *
   * @param messageId The agent message ID - the frontend will send this back as confirmId.
   * @param toolName The tool name being confirmed (for whitelist checking).
   */
  async requestConfirmation(
    prompt: string,
    options: { id: string; label: string; destructive?: boolean }[],
    emitEvent: (ev: StreamEvent) => void,
    messageId: string,
    toolName?: string,
    optionsConfig?: { required?: boolean; allowAlways?: boolean },
  ): Promise<boolean> {
    const required = optionsConfig?.required === true;
    const allowAlways = optionsConfig?.allowAlways !== false && !required;
    // Auto-approve if tool is whitelisted or full access is on.
    if (!required && toolName && this.isAutoApproved(toolName)) {
      console.log(`[confirm] auto-approved tool "${toolName}" (whitelisted or full access)`);
      return true;
    }

    const request: ConfirmRequest = { messageId, prompt, options, toolName, allowAlways, required };

    return new Promise<boolean>((resolve) => {
      // P0 FIX: Set a timeout so the agent doesn't hang forever if the
      // user switches tabs or disconnects. After 5 minutes, auto-reject.
      const timer = setTimeout(() => {
        if (this.pending.has(messageId)) {
          console.warn(`[confirm] timed out for messageId=${messageId}, auto-rejecting`);
          this.pending.delete(messageId);
          this.timeouts.delete(messageId);
          emitEvent({
            type: 'confirm_timeout',
            messageId,
            topic: 'chat',
          } as StreamEvent);
          resolve(false);
        }
      }, this.timeoutMs);
      this.timeouts.set(messageId, timer);

      this.pending.set(messageId, { resolve, request });

      // Send confirm_request to frontend (include toolName so the UI can show "always allow").
      emitEvent({
        type: 'confirm_request',
        messageId,
        prompt,
        options,
        toolName,
        allowAlways,
        required,
        topic: 'chat',
      } as StreamEvent);
    });
  }

  /**
   * Handle a confirm_response from the frontend.
   * The frontend sends `confirmId` which is the agentMsgId.
   * Resolves the pending confirmation Promise.
   */
  handleResponse(confirmId: string, optionId: string): boolean {
    const entry = this.pending.get(confirmId);
    if (!entry) return false;

    this.pending.delete(confirmId);
    // P0 FIX: Clear the timeout when resolved.
    const timer = this.timeouts.get(confirmId);
    if (timer) { clearTimeout(timer); this.timeouts.delete(confirmId); }

    // First option is always "accept".
    const accepted = optionId === entry.request.options[0]?.id || optionId === 'accept';
    entry.resolve(accepted);

    // Audit log: record the user's decision for dangerous tool approval.
    auditLog({
      ts: new Date().toISOString(),
      confirmId,
      optionId,
      accepted,
      prompt: entry.request.prompt.slice(0, 500),
    });

    return true;
  }

  /** Cancel all pending confirmations (e.g. on disconnect or cancel). */
  cancelAll(): void {
    // P0 FIX: Clear all timeouts to prevent memory leaks.
    for (const timer of this.timeouts.values()) { clearTimeout(timer); }
    this.timeouts.clear();
    for (const entry of this.pending.values()) {
      entry.resolve(false);
    }
    this.pending.clear();
  }

  /** Number of pending confirmations. */
  get pendingCount(): number {
    return this.pending.size;
  }
}
