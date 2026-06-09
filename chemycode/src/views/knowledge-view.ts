// ====== Knowledge View ======
// Wiki-style knowledge base backed by the API, with debounced search.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getState, subscribe, searchKnowledge } from '../state';
import type { KnowledgeEntry } from '../types';
import '../components/markdown-renderer';

@customElement('knowledge-view')
export class KnowledgeView extends LitElement {
  static styles = css`
    :host { display: block; padding: var(--spacing-lg); max-width: 860px; margin: 0 auto; }
    .page-title { font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); margin-bottom: var(--spacing-lg); }
    .search-bar { margin-bottom: var(--spacing-md); }
    .search-bar input {
      width: 100%;
      padding: 8px 12px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      font-size: var(--font-size-base);
      outline: none;
      box-sizing: border-box;
      background: var(--color-background-primary);
      color: var(--color-text-primary);
    }
    .search-bar input:focus { border-color: var(--color-accent); }

    .entry-list { display: flex; flex-direction: column; gap: var(--spacing-sm); }
    .entry-card {
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-md);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .entry-card:hover { border-color: var(--color-border-info); }
    .entry-title { font-size: var(--font-size-base); font-weight: var(--font-weight-medium); margin-bottom: 4px; }
    .entry-meta { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-bottom: var(--spacing-xs); }
    .entry-preview { font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.6; }
    .tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: var(--spacing-xs); }
    .tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 100px;
      background: var(--color-accent-light);
      color: var(--color-accent);
      font-size: var(--font-size-xs);
    }
    .empty { text-align: center; padding: var(--spacing-xl); color: var(--color-text-tertiary); }
    .loading { padding: var(--spacing-lg); text-align: center; color: var(--color-text-tertiary); }
  `;

  @state() private entries: KnowledgeEntry[] = [];
  @state() private search = '';
  @state() private expanded: string | null = null;
  @state() private loading = false;
  @state() private debounceTimer: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    subscribe(() => {
      this.entries = getState().knowledge;
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
  }

  private onSearchInput(value: string) {
    this.search = value;
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => this.runSearch(), 300);
  }

  private async runSearch() {
    this.loading = true;
    try {
      const r = await searchKnowledge(this.search);
      this.entries = r;
    } finally {
      this.loading = false;
    }
  }

  private toggle(e: KnowledgeEntry) {
    this.expanded = this.expanded === e.id ? null : e.id;
  }

  render() {
    return html`
      <div>
        <div class="page-title">📚 个人知识库</div>
        <div class="search-bar">
          <input type="text" placeholder="搜索知识条目…"
            .value=${this.search}
            @input=${(e: InputEvent) => this.onSearchInput((e.target as HTMLInputElement).value)} />
        </div>
        <div class="entry-list">
          ${this.loading
            ? html`<div class="loading">搜索中…</div>`
            : this.entries.length === 0
              ? html`<div class="empty">${this.search ? '暂无匹配条目' : '暂无知识条目'}</div>`
              : this.entries.map((e) => html`
                  <div class="entry-card" @click=${() => this.toggle(e)}>
                    <div class="entry-title">${this.expanded === e.id ? '📖' : '📄'} ${e.title}</div>
                    <div class="entry-meta">${e.category} · ${e.updatedAt}</div>
                    ${this.expanded === e.id
                      ? html`<chemycode-markdown-renderer .source=${e.content}></chemycode-markdown-renderer>`
                      : html`<div class="entry-preview">${this.preview(e.content)}</div>`}
                    <div class="tags">${e.tags.map((t) => html`<span class="tag">${t}</span>`)}</div>
                  </div>
                `)}
        </div>
      </div>
    `;
  }

  private preview(text: string): string {
    return text.replace(/```[\s\S]*?```/g, '[代码]').replace(/[#*`>|]/g, '').slice(0, 200);
  }
}
