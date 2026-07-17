// ====== Login View ======
// Single-field login (username + password) for the demo. The demo accepts
// any non-empty credentials in mock mode and "demo"/"Justinian" in real mode.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getApiMode } from '../api/mock';
import { login, getState, subscribe } from '../state';

@customElement('login-view')
export class LoginView extends LitElement {
  static styles = css`
    :host { display: block; }
    .box {
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-lg);
      width: 380px;
      max-width: 90vw;
      box-shadow: var(--shadow-md);
    }
    .title {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-bold);
      color: var(--color-text-primary);
      margin-bottom: var(--spacing-xs);
      text-align: center;
    }
    .subtitle {
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      margin-bottom: var(--spacing-lg);
      text-align: center;
    }
    .field { margin-bottom: var(--spacing-sm); }
    label { display: block; font-size: var(--font-size-sm); margin-bottom: 4px; color: var(--color-text-secondary); }
    input {
      width: 100%;
      padding: 10px 12px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      background: var(--color-background-secondary);
      color: var(--color-text-primary);
      font-size: var(--font-size-base);
      outline: none;
      box-sizing: border-box;
    }
    input:focus { border-color: var(--color-accent); background: var(--color-background-primary); }
    .row { display: flex; align-items: center; justify-content: space-between; margin: 8px 0 var(--spacing-sm); }
    .row label { display: flex; align-items: center; gap: 6px; margin: 0; font-size: var(--font-size-sm); cursor: pointer; }
    .submit {
      width: 100%;
      padding: 10px;
      background: var(--color-accent);
      color: var(--color-text-inverse);
      border: none;
      border-radius: var(--border-radius-md);
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-medium);
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .submit:hover:not(:disabled) { background: var(--color-accent-hover); }
    .submit:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { color: var(--color-text-danger); font-size: var(--font-size-sm); margin-top: 8px; }
    .hint {
      margin-top: var(--spacing-md);
      padding-top: var(--spacing-sm);
      border-top: 0.5px solid var(--color-border-tertiary);
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      text-align: center;
      line-height: 1.6;
    }
  `;

  @state() private username = 'Justinian';
  @state() private password = 'demo';
  @state() private remember = true;
  @state() private submitting = false;
  @state() private error = '';
  @state() private apiMode: 'mock' | 'real' = 'mock';
  @state() private language: 'zh' | 'en' = 'zh';

  connectedCallback() {
    super.connectedCallback();
    subscribe(() => {
      const s = getState();
      this.error = s.error || '';
      this.language = s.language;
    });
    this.apiMode = getApiMode();
  }

  private async onSubmit(e: Event) {
    e.preventDefault();
    if (!this.username.trim() || !this.password) return;
    this.submitting = true;
    const ok = await login(this.username.trim(), this.password);
    this.submitting = false;
    if (!ok) this.error = getState().error || (this.language === 'en' ? 'Login failed' : '登录失败');
  }

  render() {
    return html`
      <form class="box" @submit=${(e: Event) => this.onSubmit(e)}>
        <div class="title">Chemcode</div>
        <div class="subtitle">${this.language === 'en' ? 'Computational Chemistry AI Agent Platform' : '计算化学 AI Agent 平台'}</div>
        <div class="field">
          <label>${this.language === 'en' ? 'Username' : '用户名'}</label>
          <input type="text" autocomplete="username" required
            .value=${this.username}
            @input=${(e: InputEvent) => this.username = (e.target as HTMLInputElement).value} />
        </div>
        <div class="field">
          <label>${this.language === 'en' ? 'Password' : '密码'}</label>
          <input type="password" autocomplete="current-password" required
            .value=${this.password}
            @input=${(e: InputEvent) => this.password = (e.target as HTMLInputElement).value} />
        </div>
        <div class="row">
          <label>
            <input type="checkbox" .checked=${this.remember}
              @change=${(e: Event) => this.remember = (e.target as HTMLInputElement).checked} />
            <span>${this.language === 'en' ? 'Remember me' : '记住我'}</span>
          </label>
        </div>
        <button class="submit" type="submit" ?disabled=${this.submitting}>
          ${this.submitting ? (this.language === 'en' ? 'Signing in…' : '登录中…') : (this.language === 'en' ? 'Sign in' : '登入')}
        </button>
        ${this.error ? html`<div class="error">${this.error}</div>` : ''}
        <div class="hint">
          ${this.language === 'en' ? 'Current mode' : '当前模式'}：<strong>${this.apiMode === 'mock' ? (this.language === 'en' ? 'Mock (no backend required)' : 'Mock (无需后端)') : (this.language === 'en' ? 'Real (backend required)' : 'Real (需后端)')}</strong><br/>
          ${this.language === 'en' ? 'In mock mode, any non-empty username and password will work.' : 'Mock 模式下任意非空账号密码均可登录。'}
        </div>
      </form>
    `;
  }
}
