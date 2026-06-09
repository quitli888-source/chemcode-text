// ====== Connection Status Indicator ======
// Small pill that lives in the navbar. Reflects the WebSocket state and
// exposes a "Reconnect" button when disconnected.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { stream } from '../api/stream';
import { getState } from '../state';
import type { ConnectionState } from '../api/types';

@customElement('chemycode-connection-status')
export class ConnectionStatus extends LitElement {
  static styles = css`
    :host { display: inline-flex; }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 100px;
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
      border: 0.5px solid var(--color-border-tertiary);
      background: var(--color-background-secondary);
      cursor: default;
    }
    .pill.clickable { cursor: pointer; }
    .pill.clickable:hover { background: var(--color-background-tertiary); }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .dot.connected { background: var(--color-status-running); }
    .dot.connecting, .dot.reconnecting { background: var(--color-status-queued); animation: pulse 1.2s ease-in-out infinite; }
    .dot.disconnected, .dot.error { background: var(--color-status-failed); }
    .dot.idle { background: var(--color-text-tertiary); }
    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    .label { white-space: nowrap; }
    .latency { color: var(--color-text-tertiary); margin-left: 4px; }
  `;

  @state() private state: ConnectionState = 'idle';
  @state() private latency: number | undefined;

  connectedCallback() {
    super.connectedCallback();
    stream.subscribe({
      onEvent: () => {},
      onState: (s) => {
        this.state = s;
        this.latency = stream.getLatency();
      },
    });
  }

  private label(): string {
    switch (this.state) {
      case 'connected': return '已连接';
      case 'connecting': return '连接中…';
      case 'reconnecting': return '重连中…';
      case 'disconnected': return '已断线';
      case 'error': return '连接错误';
      default: return '未连接';
    }
  }

  private onClick() {
    if (this.state === 'disconnected' || this.state === 'error') {
      stream.reconnect();
    }
  }

  render() {
    const clickable = this.state === 'disconnected' || this.state === 'error';
    return html`
      <div class="pill ${clickable ? 'clickable' : ''}" @click=${this.onClick} title=${this.label()}>
        <span class="dot ${this.state}"></span>
        <span class="label">${this.label()}</span>
        ${this.state === 'connected' && this.latency !== undefined
          ? html`<span class="latency">${this.latency}ms</span>`
          : ''}
      </div>
    `;
  }
}
