// ====== Toast Notification Component ======
// Lightweight singleton-style notifications.
//
// Usage:
//   import { showError, showSuccess, showInfo, showWarning } from './components/toast';
//   showError('Something went wrong');
//
// The component auto-dismisses after a per-type timeout and supports manual
// dismissal via the close button. Multiple toasts stack from the top-right.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

type ToastKind = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
  durationMs: number;
}

const DEFAULT_DURATIONS: Record<ToastKind, number> = {
  info: 4000,
  success: 3000,
  warning: 5000,
  error: 8000,
};

let toastHost: ToastContainer | null = null;

function ensureHost(): ToastContainer {
  if (toastHost) return toastHost;
  toastHost = document.createElement('chemycode-toast-container') as ToastContainer;
  document.body.appendChild(toastHost);
  return toastHost;
}

export function showToast(message: string, opts: { kind?: ToastKind; title?: string; durationMs?: number } = {}): void {
  ensureHost().push({
    id: Date.now() + Math.random(),
    kind: opts.kind || 'info',
    message,
    title: opts.title,
    durationMs: opts.durationMs ?? DEFAULT_DURATIONS[opts.kind || 'info'],
  });
}

export const showInfo = (msg: string, title?: string) => showToast(msg, { kind: 'info', title });
export const showSuccess = (msg: string, title?: string) => showToast(msg, { kind: 'success', title });
export const showWarning = (msg: string, title?: string) => showToast(msg, { kind: 'warning', title });
export const showError = (msg: string, title?: string) => showToast(msg, { kind: 'error', title });

@customElement('chemycode-toast-container')
export class ToastContainer extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
      max-width: 360px;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px 10px 14px;
      border-radius: 8px;
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      animation: slideIn 0.2s ease;
      font-size: var(--font-size-sm);
    }
    @keyframes slideIn {
      from { transform: translateX(20px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes fadeOut {
      to { transform: translateX(20px); opacity: 0; }
    }
    .toast.dismissing { animation: fadeOut 0.2s ease forwards; }

    .icon { font-size: 16px; line-height: 1.2; flex-shrink: 0; margin-top: 1px; }
    .toast.info { border-left: 3px solid var(--color-accent); }
    .toast.info .icon { color: var(--color-accent); }
    .toast.success { border-left: 3px solid var(--color-status-running); }
    .toast.success .icon { color: var(--color-status-running); }
    .toast.warning { border-left: 3px solid var(--color-status-queued); }
    .toast.warning .icon { color: var(--color-status-queued); }
    .toast.error { border-left: 3px solid var(--color-status-failed); }
    .toast.error .icon { color: var(--color-status-failed); }

    .body { flex: 1; min-width: 0; }
    .title { font-weight: 600; color: var(--color-text-primary); margin-bottom: 2px; }
    .msg { color: var(--color-text-secondary); word-break: break-word; line-height: 1.5; }
    .close {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 16px;
      color: var(--color-text-tertiary);
      padding: 0 4px;
      flex-shrink: 0;
    }
    .close:hover { color: var(--color-text-primary); }
  `;

  @state() private toasts: Toast[] = [];

  push(t: Toast): void {
    this.toasts = [...this.toasts, t];
    if (t.durationMs > 0) {
      window.setTimeout(() => this.dismiss(t.id), t.durationMs);
    }
  }

  dismiss(id: number): void {
    this.toasts = this.toasts.map((t) => (t.id === id ? { ...t, _dismissing: true as unknown as never } : t));
    // Force re-render with dismissing class
    this.toasts = [...this.toasts];
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    }, 200);
  }

  private iconFor(kind: ToastKind): string {
    switch (kind) {
      case 'success': return '✅';
      case 'warning': return '⚠️';
      case 'error': return '❌';
      default: return 'ℹ️';
    }
  }

  render() {
    return html`
      ${this.toasts.map((t) => html`
        <div class="toast ${t.kind}">
          <div class="icon">${this.iconFor(t.kind)}</div>
          <div class="body">
            ${t.title ? html`<div class="title">${t.title}</div>` : ''}
            <div class="msg">${t.message}</div>
          </div>
          <button class="close" @click=${() => this.dismiss(t.id)} aria-label="Close">×</button>
        </div>
      `)}
    `;
  }
}
