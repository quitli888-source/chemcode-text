// ====== Generic Confirm Dialog ======
// Promise-based modal. Resolves to true (confirmed) or false (cancelled).

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

let modalHost: ConfirmDialog | null = null;

function ensureHost(): ConfirmDialog {
  if (modalHost) return modalHost;
  modalHost = document.createElement('chemcode-confirm-dialog') as ConfirmDialog;
  document.body.appendChild(modalHost);
  return modalHost;
}

export function showConfirm(opts: ConfirmOptions): Promise<boolean> {
  return ensureHost().ask(opts);
}

@customElement('chemcode-confirm-dialog')
export class ConfirmDialog extends LitElement {
  static styles = css`
    :host { display: contents; }
    .overlay {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
      animation: fadeIn 0.15s ease;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    .box {
      background: var(--color-background-primary);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-lg);
      width: 420px; max-width: 90vw;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
      animation: pop 0.15s ease;
    }
    @keyframes pop { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    .title { font-size: var(--font-size-lg); font-weight: var(--font-weight-medium); margin-bottom: var(--spacing-sm); color: var(--color-text-primary); }
    .msg { font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.6; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: var(--spacing-md); }
    button {
      padding: 6px 16px; border: none; border-radius: var(--border-radius-md);
      font-size: var(--font-size-sm); cursor: pointer; font-weight: var(--font-weight-medium);
    }
    button.cancel { background: transparent; border: 0.5px solid var(--color-border-secondary); color: var(--color-text-secondary); }
    button.cancel:hover { background: var(--color-background-tertiary); }
    button.confirm { background: var(--color-accent); color: white; }
    button.confirm:hover { background: var(--color-accent-hover); }
    button.destructive { background: var(--color-text-danger); }
    button.destructive:hover { background: #c62828; }
  `;

  @state() private opts: ConfirmOptions | null = null;
  private resolver: ((v: boolean) => void) | null = null;

  ask(opts: ConfirmOptions): Promise<boolean> {
    this.opts = opts;
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }

  private close(v: boolean) {
    if (this.resolver) this.resolver(v);
    this.resolver = null;
    this.opts = null;
  }

  private onKeydown = (e: KeyboardEvent) => {
    if (!this.opts) return;
    if (e.key === 'Escape') this.close(false);
    if (e.key === 'Enter') this.close(true);
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKeydown);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.onKeydown);
  }

  render() {
    if (!this.opts) return html``;
    const o = this.opts;
    return html`
      <div class="overlay" @click=${() => this.close(false)}>
        <div class="box" @click=${(e: Event) => e.stopPropagation()}>
          <div class="title">${o.title}</div>
          <div class="msg">${o.message}</div>
          <div class="actions">
            <button class="cancel" @click=${() => this.close(false)}>${o.cancelText || '取消'}</button>
            <button class="confirm ${o.destructive ? 'destructive' : ''}" @click=${() => this.close(true)}>${o.confirmText || '确认'}</button>
          </div>
        </div>
      </div>
    `;
  }
}
