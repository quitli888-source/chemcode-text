// ====== Tool Call Card ======
// Inline representation of a tool invocation in the chat stream.
// Shows: tool name, status (spinner / done / failed), execution time, and a
// collapsible details panel with the result.

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('chemycode-tool-call-card')
export class ToolCallCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      margin: var(--spacing-xs) 0;
    }
    .card {
      background: var(--color-background-secondary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      overflow: hidden;
      font-size: var(--font-size-sm);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      cursor: pointer;
      user-select: none;
    }
    .header:hover { background: var(--color-background-tertiary); }
    .icon { font-size: 14px; }
    .name { font-weight: 500; font-family: var(--font-mono); }
    .status { margin-left: auto; font-size: var(--font-size-xs); color: var(--color-text-tertiary); display: flex; align-items: center; gap: 6px; }
    .spinner {
      width: 12px; height: 12px;
      border: 2px solid var(--color-border-tertiary);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .caret { color: var(--color-text-tertiary); font-size: 10px; }
    .body {
      border-top: 0.5px solid var(--color-border-tertiary);
      padding: 8px 12px;
      background: var(--color-background-primary);
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      max-height: 240px;
      overflow: auto;
      white-space: pre-wrap;
      color: var(--color-text-secondary);
    }
    .body pre { margin: 0; }
  `;

  @property({ type: String }) toolName = 'tool';
  @property({ type: String }) toolStatus: 'pending' | 'running' | 'completed' | 'failed' = 'running';
  @property({ type: String }) detail = '';
  @property({ type: String }) result = '';
  @property({ type: String }) args = '';

  // Collapsed by default — user clicks to expand.
  @state() private expanded = false;

  override updated(_changed: Map<string, unknown>) {
    // Stay collapsed by default. User can click header to view details.
  }

  private toggle() { this.expanded = !this.expanded; this.requestUpdate(); }

  private statusIcon(): string {
    switch (this.toolStatus) {
      case 'completed': return '✅';
      case 'failed': return '❌';
      default: return '🔧';
    }
  }

  private statusText(): string {
    switch (this.toolStatus) {
      case 'pending': return '排队中';
      case 'running': return '执行中';
      case 'completed': return '完成';
      case 'failed': return '失败';
    }
  }

  render() {
    return html`
      <div class="card">
        <div class="header" @click=${() => this.toggle()}>
          <span class="icon">${this.toolStatus === 'running' ? html`<div class="spinner"></div>` : this.statusIcon()}</span>
          <span class="name">${this.toolName}</span>
          <span class="status">
            ${this.statusText()}${this.detail ? ` · ${this.detail}` : ''}
            ${this.expanded ? html`<span class="caret">▼</span>` : html`<span class="caret">▶</span>`}
          </span>
        </div>
        ${this.expanded ? html`
          <div class="body">
            ${this.args ? html`<div><strong>参数:</strong> ${this.args}</div>` : ''}
            ${this.result ? html`<div style="margin-top:6px"><strong>结果:</strong><br/>${this.result}</div>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }
}

// Patch: import `state` decorator at the bottom so the file is self-contained.
import { state } from 'lit/decorators.js';
