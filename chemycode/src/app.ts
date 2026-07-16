// ====== Application Shell ======
// Root custom element. Owns the layout and routes the current view.
// Renders <login-view> when the user is not authenticated.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getState, subscribe } from './state';
import type { PageView } from './types';
import './components/navbar';
import './components/sidebar';
import './components/status-card';
import './views/index';
import './views/login-view';

@customElement('chemycode-app')
export class ChemycodeApp extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--color-background-secondary);
    }
    .layout {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .main-content {
      flex: 1;
      overflow-y: auto;
      min-width: 0;
      display: flex;
    }
    .login-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-background-secondary);
    }
  `;

  @state() private currentView: PageView = 'chat';
  @state() private sidebarCollapsed = false;
  @state() private isAuthenticated = false;

  private _unsub: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._unsub?.();
    this._unsub = subscribe(() => {
      const s = getState();
      this.currentView = s.currentView;
      this.sidebarCollapsed = s.sidebarCollapsed;
      this.isAuthenticated = s.isAuthenticated;
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsub = null;
  }

  private renderView() {
    // Only render the active view — switching destroys the old component
    // and creates the new one. State persistence is handled by the central
    // store (state.ts) + localStorage, NOT by keeping components alive.
    // Hidden components would all render simultaneously, causing layout issues
    // and unnecessary resource consumption.
    switch (this.currentView) {
      case 'chat': return html`<chat-view></chat-view>`;
      case 'task-detail': return html`<task-detail-view></task-detail-view>`;
      case 'knowledge': return html`<knowledge-view></knowledge-view>`;
      case 'database': return html`<database-view></database-view>`;
      case 'skills': return html`<chemycode-skills-view></chemycode-skills-view>`;
      case 'workflow': return html`<workflow-view></workflow-view>`;
      case 'settings': return html`<settings-view></settings-view>`;
      case 'usage': return html`<chemycode-usage-view></chemycode-usage-view>`;
      default: return html`<chat-view></chat-view>`;
    }
  }

  render() {
    if (!this.isAuthenticated) {
      return html`
        <div class="login-wrap">
          <login-view></login-view>
        </div>
      `;
    }
    return html`
      <chemycode-navbar></chemycode-navbar>
      <div class="layout">
        <chemycode-sidebar class="${this.sidebarCollapsed ? 'collapsed' : ''}"></chemycode-sidebar>
        <div class="main-content">
          ${this.renderView()}
        </div>
      </div>
    `;
  }
}
