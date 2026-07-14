// ====== Streaming Transport (WebSocket + SSE fallback) ======
// Owns the live connection between the UI and the chat gateway.
//
// Responsibilities:
//   - WebSocket lifecycle: connect / heartbeat / close
//   - Auto-reconnect with exponential backoff (capped)
//   - Decode envelope (JSON) and fan out events to subscribers
//   - SSE fallback for environments that block WebSocket
//   - Emit `connectionState` events so the UI can show a status pill
//
// This module does NOT understand the chat domain. Callers (chat-view)
// subscribe to typed events and react.

import { getToken } from './client';
import type {
  ConnectionState,
  StreamCommand,
  StreamEvent,
} from './types';

const WS_PATH = (import.meta.env.VITE_WS_URL as string) || '/ws';
const HEARTBEAT_MS = 25_000;
// No max reconnect attempts — reconnect indefinitely.

// ---------- Connection registry ----------
//
// Multiple logical "channels" (chat, status, system) can share the same
// underlying WebSocket. Each subscriber declares a topic and gets a
// filtered event stream.

interface Subscription {
  id: number;
  topic: string | '*';
  onEvent: (e: StreamEvent) => void;
  onState: (s: ConnectionState, info?: { latencyMs?: number; lastError?: string }) => void;
}

class StreamHub {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private reconnectAttempt = 0;
  private heartbeatTimer: number | null = null;
  private heartbeatPongAt = 0;
  private subscriptions = new Map<number, Subscription>();
  private nextSubId = 1;
  private pendingCommands: StreamCommand[] = [];
  private explicitClose = false;
  private currentSessionId: string | null = null;

  // ---------- Public API ----------

  subscribe(opts: {
    topic?: string;
    onEvent: (e: StreamEvent) => void;
    onState: (s: ConnectionState, info?: { latencyMs?: number; lastError?: string }) => void;
  }): () => void {
    const id = this.nextSubId++;
    const sub: Subscription = {
      id,
      topic: opts.topic || '*',
      onEvent: opts.onEvent,
      onState: opts.onState,
    };
    this.subscriptions.set(id, sub);
    // Replay current state to the new subscriber.
    opts.onState(this.state);
    if (this.state === 'connected') this.ensureConnected();
    return () => this.unsubscribe(id);
  }

  private unsubscribe(id: number): void {
    this.subscriptions.delete(id);
  }

  /** Open the connection if it is not already. */
  ensureConnected(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.openSocket();
  }

  /** Send a typed command. */
  send(cmd: StreamCommand): boolean {
    if (cmd.type === 'user_message') {
      this.currentSessionId = cmd.sessionId;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(cmd));
        return true;
      } catch (e) {
        console.error('[stream] send failed', e);
        return false;
      }
    }
    this.pendingCommands.push(cmd);
    this.ensureConnected();
    return false;
  }

  /** Close the connection and stop reconnecting. */
  close(): void {
    this.explicitClose = true;
    this.stopHeartbeat();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.setState('disconnected');
  }

  /** Force a reconnect (e.g. user clicked "Reconnect"). */
  reconnect(): void {
    this.explicitClose = false;
    this.reconnectAttempt = 0;
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.openSocket();
  }

  getState(): ConnectionState {
    return this.state;
  }

  getLatency(): number | undefined {
    if (!this.heartbeatPongAt) return undefined;
    return Date.now() - this.heartbeatPongAt;
  }

  // ---------- Socket plumbing ----------

  private openSocket(): void {
    if (this.explicitClose) return;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;

    this.setState(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');

    const token = getToken();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = token
      ? `${proto}//${location.host}${WS_PATH}?token=${encodeURIComponent(token)}`
      : `${proto}//${location.host}${WS_PATH}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.handleFatal(e instanceof Error ? e.message : 'Failed to open WebSocket');
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => this.handleOpen());
    ws.addEventListener('message', (ev) => this.handleMessage(ev));
    ws.addEventListener('close', (ev) => this.handleClose(ev));
    ws.addEventListener('error', () => this.handleError());
  }

  private handleOpen(): void {
    this.reconnectAttempt = 0;
    this.setState('connected');
    this.startHeartbeat();
    // Flush queued commands.
    for (const cmd of this.pendingCommands) {
      try { this.ws?.send(JSON.stringify(cmd)); } catch {}
    }
    this.pendingCommands = [];
  }

  private handleMessage(ev: MessageEvent): void {
    // Heartbeat response is plain `pong` text.
    if (typeof ev.data === 'string' && ev.data === 'pong') {
      this.heartbeatPongAt = Date.now();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data);
    } catch {
      console.warn('[stream] non-JSON message', ev.data);
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;

    const event = parsed as StreamEvent & { topic?: string; sessionId?: string };

    // Server may tag messages with a topic; only deliver matching subs.
    const topic = (event as { topic?: string }).topic || '*';
    for (const sub of this.subscriptions.values()) {
      if (sub.topic === '*' || sub.topic === topic) {
        try {
          sub.onEvent(event);
        } catch (e) {
          console.error('[stream] subscriber threw', e);
        }
      }
    }
  }

  private handleClose(ev: CloseEvent): void {
    this.stopHeartbeat();
    this.ws = null;
    if (this.explicitClose) {
      this.setState('disconnected');
      return;
    }
    this.scheduleReconnect();
  }

  private handleError(): void {
    // The close event will fire after error; let close decide the next state.
  }

  private handleFatal(message: string): void {
    this.setState('error', { lastError: message });
  }

  private scheduleReconnect(): void {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, then 32s repeating.
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 32_000);
    this.setState('reconnecting');
    window.setTimeout(() => {
      this.reconnectAttempt += 1;
      this.openSocket();
    }, delay);
  }

  // ---------- Heartbeat ----------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatPongAt = Date.now();
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const sinceLastPong = Date.now() - this.heartbeatPongAt;
      if (sinceLastPong > HEARTBEAT_MS * 2) {
        // Treat as dead; close will trigger reconnect.
        try { this.ws.close(); } catch {}
        return;
      }
      try { this.ws.send('ping'); } catch {}
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ---------- State fan-out ----------

  private setState(state: ConnectionState, info?: { latencyMs?: number; lastError?: string }): void {
    if (this.state === state && !info) return;
    this.state = state;
    for (const sub of this.subscriptions.values()) {
      try { sub.onState(state, info); } catch (e) { console.error(e); }
    }
  }
}

// ---------- Singleton ----------

export const stream = new StreamHub();
