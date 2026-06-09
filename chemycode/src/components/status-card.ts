// ====== Status Card ======
// Reusable stat card used on the chat landing page and dashboard.

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('chemycode-status-card')
export class StatusCard extends LitElement {
  static styles = css`
    .card {
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-md);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs);
      transition: box-shadow var(--transition-fast);
    }
    .card:hover { box-shadow: var(--shadow-sm); }
    .header { display: flex; align-items: center; justify-content: space-between; }
    .icon {
      width: 36px; height: 36px;
      border-radius: var(--border-radius-md);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
    }
    .value { font-size: 28px; font-weight: var(--font-weight-bold); color: var(--color-text-primary); line-height: 1.1; }
    .label { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .footer {
      display: flex; align-items: center; gap: 4px;
      font-size: var(--font-size-xs); color: var(--color-text-tertiary);
      margin-top: var(--spacing-xs);
    }
  `;

  @property({ type: String }) icon = '';
  @property({ type: String }) value: string | number = '--';
  @property({ type: String }) label = '';
  @property({ type: String }) footer = '';
  @property({ type: String }) iconBg = 'var(--color-background-info)';

  render() {
    return html`
      <div class="card">
        <div class="header">
          <div class="icon" style="background: ${this.iconBg}">${this.icon}</div>
        </div>
        <div class="value">${this.value}</div>
        <div class="label">${this.label}</div>
        ${this.footer ? html`<div class="footer">${this.footer}</div>` : ''}
      </div>
    `;
  }
}
