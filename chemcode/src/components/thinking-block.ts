// ====== Thinking Block ======
// A collapsible area for the agent's reasoning/thinking trace.

import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('chemcode-thinking-block')
export class ThinkingBlock extends LitElement {
  static styles = css`
    :host { display: block; margin: 4px 0; }
    .block {
      background: var(--color-background-secondary);
      border: 0.5px dashed var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      font-size: var(--font-size-sm);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      cursor: pointer;
      color: var(--color-text-secondary);
      user-select: none;
    }
    .header:hover { background: var(--color-background-tertiary); }
    .body {
      padding: 6px 12px 10px;
      color: var(--color-text-secondary);
      white-space: pre-wrap;
      line-height: 1.5;
      max-height: 240px;
      overflow: auto;
    }
    .caret { font-size: 10px; }
    .dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--color-text-tertiary);
      margin-left: auto;
    }
    .dot.live {
      background: var(--color-status-running);
      animation: blink 1s ease-in-out infinite;
    }
    @keyframes blink {
      0%, 100% { opacity: 0.3; }
      50% { opacity: 1; }
    }
  `;

  @property({ type: String }) content = '';
  @property({ type: Boolean }) live = false;
  @state() private expanded = false;

  private toggle() { this.expanded = !this.expanded; this.requestUpdate(); }

  render() {
    return html`
      <div class="block">
        <div class="header" @click=${() => this.toggle()}>
          <span>💭</span>
          <span>思考过程</span>
          ${this.live ? html`<span class="dot live"></span>` : ''}
          <span class="caret">${this.expanded ? '▼' : '▶'}</span>
        </div>
        ${this.expanded ? html`<div class="body">${this.content}</div>` : ''}
      </div>
    `;
  }
}
