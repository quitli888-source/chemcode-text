// ====== Top Navbar ======
// Mirrors the original navbar but adds the connection status pill and
// a live avatar derived from the current user.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { toggleSidebar, getState, subscribe } from '../state';
import './connection-status';

@customElement('chemycode-navbar')
export class Navbar extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: var(--navbar-height);
      background: var(--color-background-primary);
      border-bottom: 0.5px solid var(--color-border-tertiary);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .navbar-inner {
      display: flex;
      align-items: center;
      height: 100%;
      padding: 0 var(--spacing-md);
      gap: var(--spacing-sm);
    }
    .menu-btn {
      background: none;
      border: none;
      padding: 6px;
      color: var(--color-text-secondary);
      cursor: pointer;
      border-radius: var(--border-radius-sm);
      font-size: 18px;
    }
    .menu-btn:hover { background: var(--color-background-tertiary); }
    .logo {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-bold);
      color: var(--color-accent);
    }
    .logo-icon {
      width: 28px;
      height: 28px;
      background: var(--color-accent);
      border-radius: var(--border-radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 14px;
      font-weight: bold;
    }
    .spacer { flex: 1; }
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      border-radius: var(--border-radius-md);
      cursor: pointer;
    }
    .user-info:hover { background: var(--color-background-tertiary); }
    .user-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--color-accent-light);
      color: var(--color-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: var(--font-weight-bold);
    }
    .user-name { font-size: var(--font-size-sm); color: var(--color-text-primary); }
    chemycode-connection-status { margin-right: 8px; }
  `;

  @state() private collapsed = false;
  @state() private username = 'Justinian';

  private _unsub: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._unsub?.();
    this._unsub = subscribe(() => {
      const s = getState();
      this.collapsed = s.sidebarCollapsed;
      this.username = s.currentUser?.username || 'Justinian';
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsub = null;
  }

  private goSettings() {
    import('../state').then(({ setView, setSettingsTab }) => {
      setView('settings');
      setSettingsTab('account');
    });
  }

  render() {
    const initial = (this.username || '?').charAt(0).toUpperCase();
    return html`
      <div class="navbar-inner">
        <button class="menu-btn" @click=${toggleSidebar} title="切换侧边栏">☰</button>
        <div class="logo">
          <div class="logo-icon">C</div>
          Chemycode
        </div>
        <div class="spacer"></div>
        <chemycode-connection-status></chemycode-connection-status>
        <div class="user-info" @click=${() => this.goSettings()}>
          <div class="user-avatar">${initial}</div>
          <span class="user-name">${this.username}</span>
        </div>
      </div>
    `;
  }
}
