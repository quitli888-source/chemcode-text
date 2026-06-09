// ====== ConfirmManager ======
// Manages dangerous tool confirmations.
// When a tool has `dangerous: true`, the agent loop pauses execution,
// sends a confirm_request event to the frontend, and waits for the
// user's response indefinitely (no timeout).
//
// Key: the frontend uses `agentMsgId` as the confirmId in confirm_response.
// So we key by messageId (which is the agentMsgId from the frontend's perspective).
//
// Reference: OpenClaw exec-approval-request.ts / exec-approval-followup.ts

import type { StreamEvent } from '../types.js';

export interface ConfirmRequest {
  /** The agent messageId (used as key, sent back by frontend as confirmId). */
  messageId: string;
  prompt: string;
  options: { id: string; label: string; destructive?: boolean }[];
}

interface PendingEntry {
  resolve: (accepted: boolean) => void;
  request: ConfirmRequest;
}

export class ConfirmManager {
  private pending = new Map<string, PendingEntry>();

  /**
   * Request confirmation from the user.
   * Returns a Promise that resolves to `true` if accepted, `false` if rejected.
   * Waits indefinitely for user response (no timeout).
   *
   * @param messageId The agent message ID — the frontend will send this back as confirmId.
   */
  async requestConfirmation(
    prompt: string,
    options: { id: string; label: string; destructive?: boolean }[],
    emitEvent: (ev: StreamEvent) => void,
    messageId: string,
  ): Promise<boolean> {
    const request: ConfirmRequest = { messageId, prompt, options };

    return new Promise<boolean>((resolve) => {
      this.pending.set(messageId, { resolve, request });

      // Send confirm_request to frontend.
      emitEvent({
        type: 'confirm_request',
        messageId,
        prompt,
        options,
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

    // First option is always "accept".
    const accepted = optionId === entry.request.options[0]?.id || optionId === 'accept';
    entry.resolve(accepted);
    return true;
  }

  /** Cancel all pending confirmations (e.g. on disconnect). */
  cancelAll(): void {
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
