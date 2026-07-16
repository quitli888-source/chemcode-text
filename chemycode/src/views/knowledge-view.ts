// ====== Knowledge View ======
// Personal knowledge base: upload materials, LLM-powered learning,
// full-text search, CRUD, and "learn from chat" integration.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getState, subscribe, searchKnowledge } from '../state';
import { apiClient as api } from '../api';
import type { KnowledgeEntry } from '../types';
import '../components/markdown-renderer';

@customElement('knowledge-view')
export class KnowledgeView extends LitElement {
  static styles = css`
    :host { display: block; padding: var(--spacing-lg); max-width: 960px; margin: 0 auto; }
    .page-title { font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); margin-bottom: var(--spacing-xs); }
    .page-subtitle { color: var(--color-text-secondary); margin-bottom: var(--spacing-lg); line-height: 1.6; }
    .toolbar { display: flex; gap: var(--spacing-sm); margin-bottom: var(--spacing-md); flex-wrap: wrap; align-items: center; }
    .search-bar { flex: 1; min-width: 200px; }
    .search-bar input {
      width: 100%; padding: 8px 12px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      font-size: var(--font-size-base); outline: none; box-sizing: border-box;
      background: var(--color-background-primary); color: var(--color-text-primary);
    }
    .search-bar input:focus { border-color: var(--color-accent); }
    .btn {
      padding: 8px 16px; border: none; border-radius: var(--border-radius-md);
      font-size: var(--font-size-sm); cursor: pointer; white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .btn-primary { background: var(--color-accent); color: white; }
    .btn-primary:hover { opacity: 0.9; }
    .btn-secondary { background: var(--color-background-tertiary); color: var(--color-text-primary); }
    .btn-secondary:hover { background: var(--color-border-tertiary); }
    .btn-danger { background: var(--color-status-failed); color: white; }
    .btn-danger:hover { opacity: 0.9; }

    .entry-list { display: flex; flex-direction: column; gap: var(--spacing-sm); }
    .entry-card {
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-md); cursor: pointer;
      transition: all var(--transition-fast);
    }
    .entry-card:hover { border-color: var(--color-border-info); }
    .entry-header { display: flex; justify-content: space-between; align-items: start; gap: var(--spacing-sm); }
    .entry-title { font-size: var(--font-size-base); font-weight: var(--font-weight-medium); margin-bottom: 4px; }
    .entry-meta { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-bottom: var(--spacing-xs); }
    .entry-preview { font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.6; }
    .entry-actions { display: flex; gap: 4px; flex-shrink: 0; }
    .entry-actions .btn { padding: 4px 8px; font-size: var(--font-size-xs); }
    .tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: var(--spacing-xs); }
    .tag {
      display: inline-block; padding: 2px 8px; border-radius: 100px;
      background: var(--color-accent-light); color: var(--color-accent);
      font-size: var(--font-size-xs);
    }
    .source-badge {
      display: inline-block; padding: 1px 6px; border-radius: 4px;
      font-size: 10px; font-weight: 600; text-transform: uppercase;
    }
    .source-manual { background: var(--color-accent-light); color: var(--color-accent); }
    .source-chat { background: rgba(100, 200, 100, 0.15); color: #4a9; }
    .source-upload { background: rgba(200, 150, 50, 0.15); color: #c93; }
    .source-unprocessed { background: rgba(200, 50, 50, 0.15); color: #c55; }

    .empty { text-align: center; padding: var(--spacing-xl); color: var(--color-text-tertiary); }
    .loading { padding: var(--spacing-lg); text-align: center; color: var(--color-text-tertiary); }

    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center; z-index: 1000;
    }
    .modal {
      background: var(--color-background-primary); border-radius: var(--border-radius-lg);
      padding: var(--spacing-lg); width: 90%; max-width: 600px; max-height: 80vh; overflow-y: auto;
    }
    .modal-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); margin-bottom: var(--spacing-md); }
    .modal-field { margin-bottom: var(--spacing-md); }
    .modal-field label { display: block; font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: 4px; }
    .modal-field input, .modal-field textarea {
      width: 100%; padding: 8px 12px; box-sizing: border-box;
      border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md);
      font-size: var(--font-size-sm); background: var(--color-background-primary); color: var(--color-text-primary);
    }
    .modal-field textarea { min-height: 120px; resize: vertical; font-family: inherit; }
    .modal-actions { display: flex; gap: var(--spacing-sm); justify-content: flex-end; }
    .learn-status { padding: var(--spacing-sm); border-radius: var(--border-radius-md); margin-top: var(--spacing-sm); font-size: var(--font-size-sm); }
    .learn-status.success { background: rgba(100, 200, 100, 0.1); color: #4a9; }
    .learn-status.error { background: rgba(200, 50, 50, 0.1); color: #c55; }
    .learn-status.loading { background: var(--color-background-tertiary); color: var(--color-text-secondary); }
    .file-drop-zone {
      border: 2px dashed var(--color-border-tertiary); border-radius: var(--border-radius-md);
      padding: var(--spacing-lg); text-align: center; cursor: pointer;
      transition: all var(--transition-fast); min-height: 120px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
    }
    .file-drop-zone:hover { border-color: var(--color-accent); background: var(--color-accent-light); }
    .file-drop-zone.dragover { border-color: var(--color-accent); background: var(--color-accent-light); }
    .file-drop-zone .drop-icon { font-size: 32px; }
    .file-drop-zone .drop-text { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .file-drop-zone .drop-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .file-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 100px;
      background: var(--color-accent-light); color: var(--color-accent);
      font-size: var(--font-size-sm); margin-top: 8px;
    }
    .file-chip .remove-btn { cursor: pointer; opacity: 0.6; }
    .file-chip .remove-btn:hover { opacity: 1; }
    .learn-tabs { display: flex; gap: 4px; margin-bottom: var(--spacing-md); }
    .learn-tab {
      padding: 6px 16px; border: none; border-radius: var(--border-radius-md);
      font-size: var(--font-size-sm); cursor: pointer; background: var(--color-background-tertiary);
      color: var(--color-text-secondary); transition: all var(--transition-fast);
    }
    .learn-tab.active { background: var(--color-accent); color: white; }

    /* Tree sidebar */
    .layout { display: flex; gap: var(--spacing-lg); align-items: flex-start; }
    .tree-panel {
      width: 220px; flex-shrink: 0; background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-lg);
      padding: var(--spacing-md); position: sticky; top: var(--spacing-md);
    }
    .tree-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-bold); margin-bottom: var(--spacing-sm); color: var(--color-text-secondary); }
    .tree-node { padding: 4px 8px; border-radius: var(--border-radius-sm); cursor: pointer; font-size: var(--font-size-sm); display: flex; justify-content: space-between; align-items: center; }
    .tree-node:hover { background: var(--color-background-tertiary); }
    .tree-node.active { background: var(--color-accent-light); color: var(--color-accent); font-weight: var(--font-weight-medium); }
    .tree-count { font-size: 10px; color: var(--color-text-tertiary); }
    .tree-root { margin-top: 4px; }

    .importance-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 6px; }
    .importance-0 { background: var(--color-background-tertiary); color: var(--color-text-tertiary); }
    .importance-1 { background: rgba(200, 150, 50, 0.15); color: #c93; }
    .importance-2 { background: rgba(200, 50, 50, 0.15); color: #c55; }
    .path-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; background: var(--color-accent-light); color: var(--color-accent); margin-left: 6px; }
    .field-hint { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-top: 2px; }
    .importance-select { display: flex; gap: 4px; }
    .importance-opt {
      flex: 1; padding: 6px; border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-sm);
      font-size: var(--font-size-xs); cursor: pointer; text-align: center; background: var(--color-background-primary); color: var(--color-text-secondary);
    }
    .importance-opt.active { border-color: var(--color-accent); background: var(--color-accent-light); color: var(--color-accent); font-weight: var(--font-weight-medium); }
  `;

  @state() private entries: KnowledgeEntry[] = [];
  @state() private tree: Array<{ path: string; count: number; children: string[] }> = [];
  @state() private search = '';
  @state() private expanded: string | null = null;
  @state() private loading = false;
  @state() private debounceTimer: number | null = null;
  @state() private activePath = ''; // Currently filtered parentPath

  // Modals
  @state() private showAddModal = false;
  @state() private showLearnModal = false;
  @state() private learnText = '';
  @state() private learnTitle = '';
  @state() private learnStatus: { type: 'loading' | 'success' | 'error'; msg: string } | null = null;
  @state() private learnTab: 'text' | 'file' = 'file';
  @state() private selectedFile: File | null = null;
  @state() private dragOver = false;
  // Hierarchy / importance for learn modal
  @state() private learnParentPath = '';
  @state() private learnImportance = 0;

  // Add modal hierarchy
  @state() private addParentPath = '';
  @state() private addImportance = 0;

  // Edit
  @state() private editingEntry: KnowledgeEntry | null = null;

  // Unsubscribe handle for state store
  private _unsub: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    this._unsub = subscribe(() => {
      // Sync from global state (e.g., after initAppData) only when not filtered.
      // loadEntries() is the authoritative source for entries — subscribe just
      // ensures we pick up the initial global load if it happens after mount.
    });
    this.loadEntries();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._unsub) this._unsub();
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
  }

  private async loadEntries() {
    this.loading = true;
    try {
      const r = await api.knowledge.list({ parentPath: this.activePath || undefined });
      if (r.ok) {
        this.entries = r.value.records;
        this.tree = r.value.tree;
      }
    } finally {
      this.loading = false;
    }
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
      const t = await api.knowledge.tree();
      if (t.ok) this.tree = t.value;
    } finally {
      this.loading = false;
    }
  }

  private selectPath(path: string) {
    this.activePath = path;
    this.search = '';
    this.loadEntries();
  }

  private toggle(e: KnowledgeEntry) {
    this.expanded = this.expanded === e.id ? null : e.id;
  }

  private sourceBadge(e: KnowledgeEntry) {
    const src = e.source || 'manual';
    const labels: Record<string, string> = { manual: 'Manual', chat: 'Chat', upload: 'Upload' };
    const cls = e.learned === false ? 'source-unprocessed' : `source-${src}`;
    return html`<span class="source-badge ${cls}">${e.learned === false ? 'Unprocessed' : labels[src] || src}</span>`;
  }

  private async handleLearn() {
    if (this.learnTab === 'file' && this.selectedFile) {
      return this.handleFileLearn();
    }
    if (!this.learnText.trim() || this.learnText.trim().length < 10) return;
    this.learnStatus = { type: 'loading', msg: 'AI is learning from the material...' };
    try {
      const r = await api.knowledge.learn({
        content: this.learnText,
        source: 'upload',
        title: this.learnTitle || undefined,
        parentPath: this.learnParentPath || undefined,
        importance: this.learnImportance || undefined,
      });
      if (r.ok) {
        const { record, learned, message } = r.value;
        this.learnStatus = { type: learned ? 'success' : 'error', msg: message };
        if (record) { this.entries = [record, ...this.entries]; }
        this.learnText = '';
        this.learnTitle = '';
        this.learnParentPath = '';
        this.learnImportance = 0;
        this.loadEntries();
      } else {
        this.learnStatus = { type: 'error', msg: r.error.message };
      }
    } catch (e: any) {
      this.learnStatus = { type: 'error', msg: e.message || 'Learning failed' };
    }
  }

  private async handleFileLearn() {
    if (!this.selectedFile) return;
    this.learnStatus = { type: 'loading', msg: `AI is learning from ${this.selectedFile.name}...` };
    try {
      const r = await api.knowledge.learnFile(this.selectedFile, {
        title: this.learnTitle || undefined,
        parentPath: this.learnParentPath || undefined,
        importance: this.learnImportance || undefined,
      });
      if (r.ok) {
        const { record, learned, message } = r.value;
        this.learnStatus = { type: learned ? 'success' : 'error', msg: message };
        if (record) { this.entries = [record, ...this.entries]; }
        this.selectedFile = null;
        this.learnTitle = '';
        this.learnParentPath = '';
        this.learnImportance = 0;
        this.loadEntries();
      } else {
        this.learnStatus = { type: 'error', msg: r.error.message };
      }
    } catch (e: any) {
      this.learnStatus = { type: 'error', msg: e.message || 'File learning failed' };
    }
  }

  private handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
    }
  }

  private handleDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver = false;
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      this.selectedFile = e.dataTransfer.files[0];
    }
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    this.dragOver = true;
  }

  private handleDragLeave(e: DragEvent) {
    e.preventDefault();
    this.dragOver = false;
  }

  private async handleDelete(id: string, e: Event) {
    e.stopPropagation();
    if (!confirm('Delete this knowledge entry?')) return;
    const r = await api.knowledge.remove(id);
    if (r.ok) {
      this.entries = this.entries.filter((x) => x.id !== id);
      this.loadEntries();
    }
  }

  private importanceLabel(v?: number): string {
    return v === 2 ? '🔴 重要' : v === 1 ? '🟡 一般重要' : '⚪ 普通';
  }

  private async handleSaveEdit() {
    if (!this.editingEntry) return;
    const r = await api.knowledge.update(this.editingEntry.id, {
      title: this.editingEntry.title,
      category: this.editingEntry.category,
      content: this.editingEntry.content,
      tags: this.editingEntry.tags,
      parentPath: this.editingEntry.parentPath || '',
      importance: this.editingEntry.importance || 0,
    });
    if (r.ok) {
      this.entries = this.entries.map((x) => x.id === r.value.id ? r.value : x);
      this.editingEntry = null;
      this.loadEntries();
    }
  }

  private preview(text: string): string {
    return text.replace(/```[\s\S]*?```/g, '[Code]').replace(/[#*`>|]/g, '').slice(0, 200);
  }

  render() {
    return html`
      <div>
        <div class="page-title">📚 Wiki 知识库</div>
        <div class="page-subtitle">
          个人长期记忆框架。上传资料让 AI 学习，对话时引用已有知识，对话后一键保存学习。
          知识库独立存储于 data/knowledge/，支持分级存储与重要性标记。
        </div>

        <div class="layout">
          <div class="tree-panel">
            <div class="tree-title">📂 知识分类</div>
            <div class="tree-node ${this.activePath === '' ? 'active' : ''}" @click=${() => this.selectPath('')}>
              <span>全部</span>
              <span class="tree-count">${this.tree.reduce((s, t) => s + t.count, 0)}</span>
            </div>
            <div class="tree-root">
              ${this.tree.map((t) => html`
                <div class="tree-node ${this.activePath === t.path ? 'active' : ''}" @click=${() => this.selectPath(t.path)}>
                  <span>${t.path || '（根）'}</span>
                  <span class="tree-count">${t.count}</span>
                </div>
              `)}
            </div>
          </div>

          <div style="flex: 1; min-width: 0;">
            <div class="toolbar">
              <div class="search-bar">
                <input type="text" placeholder="搜索知识条目..."
                  .value=${this.search}
                  @input=${(e: InputEvent) => this.onSearchInput((e.target as HTMLInputElement).value)} />
              </div>
              ${this.activePath ? html`<button class="btn btn-secondary" @click=${() => this.selectPath('')}>← 全部</button>` : ''}
              <button class="btn btn-secondary" @click=${() => this.showAddModal = true}>+ 手动添加</button>
              <button class="btn btn-primary" @click=${() => { this.showLearnModal = true; this.learnStatus = null; }}>
                🧠 AI 学习资料
              </button>
            </div>

            <div class="entry-list">
              ${this.loading
                ? html`<div class="loading">加载中...</div>`
                : this.entries.length === 0
                  ? html`<div class="empty">
                      ${this.search ? '暂无匹配条目' : this.activePath ? `「${this.activePath}」分类下暂无条目` : '知识库为空。点击"AI 学习资料"上传内容让 AI 学习，或"手动添加"创建条目。'}
                    </div>`
                  : this.entries.map((e) => html`
                      <div class="entry-card" @click=${() => this.toggle(e)}>
                        <div class="entry-header">
                          <div>
                            <div class="entry-title">
                              ${this.expanded === e.id ? '📖' : '📄'} ${e.title}
                              ${this.sourceBadge(e)}
                              ${e.importance ? html`<span class="importance-badge importance-${e.importance}">${this.importanceLabel(e.importance)}</span>` : ''}
                              ${e.parentPath ? html`<span class="path-badge">📁 ${e.parentPath}</span>` : ''}
                            </div>
                            <div class="entry-meta">${e.category} · ${e.updatedAt.slice(0, 10)}</div>
                          </div>
                          <div class="entry-actions">
                            <button class="btn btn-secondary" @click=${(ev: Event) => { ev.stopPropagation(); this.editingEntry = { ...e }; }}>编辑</button>
                            <button class="btn btn-danger" @click=${(ev: Event) => this.handleDelete(e.id, ev)}>删除</button>
                          </div>
                        </div>
                        ${this.expanded === e.id
                          ? html`<chemycode-markdown-renderer .source=${e.content}></chemycode-markdown-renderer>`
                          : html`<div class="entry-preview">${this.preview(e.content)}</div>`}
                        <div class="tags">${e.tags.map((t) => html`<span class="tag">${t}</span>`)}</div>
                      </div>
                    `)}
            </div>
          </div>
        </div>
      </div>

      ${this.showAddModal ? html`
        <div class="modal-overlay" @click=${() => this.showAddModal = false}>
          <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
            <div class="modal-title">添加知识条目</div>
            <div class="modal-field">
              <label>标题</label>
              <input type="text" id="add-title" placeholder="知识标题" />
            </div>
            <div class="modal-field">
              <label>分类</label>
              <input type="text" id="add-category" placeholder="如: Chemistry, Methodology" value="General" />
            </div>
            <div class="modal-field">
              <label>内容 (Markdown)</label>
              <textarea id="add-content" placeholder="输入知识内容..."></textarea>
            </div>
            <div class="modal-field">
              <label>标签 (逗号分隔)</label>
              <input type="text" id="add-tags" placeholder="tag1, tag2" />
            </div>
            <div class="modal-field">
              <label>所属分类路径 (可选，如: 项目A/子主题)</label>
              <input type="text" .value=${this.addParentPath}
                @input=${(e: InputEvent) => this.addParentPath = (e.target as HTMLInputElement).value}
                placeholder="留空为根级" />
              <div class="field-hint">用于知识分级，例如 "分子动力学/参数设置"</div>
            </div>
            <div class="modal-field">
              <label>重要性</label>
              <div class="importance-select">
                ${[0, 1, 2].map((v) => html`
                  <div class="importance-opt ${this.addImportance === v ? 'active' : ''}"
                    @click=${() => this.addImportance = v}>
                    ${v === 2 ? '🔴 重要' : v === 1 ? '🟡 一般' : '⚪ 普通'}
                  </div>
                `)}
              </div>
            </div>
            <div class="modal-actions">
              <button class="btn btn-secondary" @click=${() => this.showAddModal = false}>取消</button>
              <button class="btn btn-primary" @click=${async () => {
                const title = (this.shadowRoot!.querySelector('#add-title') as HTMLInputElement).value;
                const category = (this.shadowRoot!.querySelector('#add-category') as HTMLInputElement).value;
                const content = (this.shadowRoot!.querySelector('#add-content') as HTMLTextAreaElement).value;
                const tagsStr = (this.shadowRoot!.querySelector('#add-tags') as HTMLInputElement).value;
                if (!title || !content) return;
                const r = await api.knowledge.create({
                  title, category, content,
                  tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
                  parentPath: this.addParentPath || undefined,
                  importance: this.addImportance || undefined,
                });
                if (r.ok) { this.entries = [r.value, ...this.entries]; this.showAddModal = false; this.addParentPath = ''; this.addImportance = 0; this.loadEntries(); }
              }}>保存</button>
            </div>
          </div>
        </div>
      ` : ''}

      ${this.showLearnModal ? html`
        <div class="modal-overlay" @click=${() => this.showLearnModal = false}>
          <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
            <div class="modal-title">🧠 AI 学习资料</div>
            <div class="page-subtitle" style="margin-bottom: 12px;">
              上传文件或粘贴文本，AI 会分析并生成结构化知识条目存入知识库。
              支持格式: PDF, Word(docx), Markdown, HTML, TXT, CSV, JSON, LaTeX, 代码文件等。
              使用已配置的默认模型进行学习。
            </div>
            <div class="learn-tabs">
              <button class="learn-tab ${this.learnTab === 'file' ? 'active' : ''}"
                @click=${() => { this.learnTab = 'file'; this.learnStatus = null; }}>📁 上传文件</button>
              <button class="learn-tab ${this.learnTab === 'text' ? 'active' : ''}"
                @click=${() => { this.learnTab = 'text'; this.learnStatus = null; }}>✏️ 粘贴文本</button>
            </div>
            <div class="modal-field">
              <label>标题 (可选，留空则自动生成)</label>
              <input type="text" .value=${this.learnTitle}
                @input=${(e: InputEvent) => this.learnTitle = (e.target as HTMLInputElement).value}
                placeholder="自动从内容提取标题" />
            </div>
            <div class="modal-field">
              <label>所属分类路径 (可选)</label>
              <input type="text" .value=${this.learnParentPath}
                @input=${(e: InputEvent) => this.learnParentPath = (e.target as HTMLInputElement).value}
                placeholder="如: 项目A/子主题，留空为根级" />
              <div class="field-hint">将学习成果归入指定分类层级</div>
            </div>
            <div class="modal-field">
              <label>重要性</label>
              <div class="importance-select">
                ${[0, 1, 2].map((v) => html`
                  <div class="importance-opt ${this.learnImportance === v ? 'active' : ''}"
                    @click=${() => this.learnImportance = v}>
                    ${v === 2 ? '🔴 重要' : v === 1 ? '🟡 一般' : '⚪ 普通'}
                  </div>
                `)}
              </div>
            </div>
            ${this.learnTab === 'file' ? html`
              <div class="modal-field">
                <div class="file-drop-zone ${this.dragOver ? 'dragover' : ''}"
                  @click=${() => (this.shadowRoot!.querySelector('#file-input') as HTMLInputElement).click()}
                  @dragover=${(e: DragEvent) => this.handleDragOver(e)}
                  @dragleave=${(e: DragEvent) => this.handleDragLeave(e)}
                  @drop=${(e: DragEvent) => this.handleDrop(e)}>
                  <div class="drop-icon">📄</div>
                  ${this.selectedFile
                    ? html`<div class="file-chip">
                        📎 ${this.selectedFile.name} (${(this.selectedFile.size / 1024).toFixed(1)} KB)
                        <span class="remove-btn" @click=${(e: Event) => { e.stopPropagation(); this.selectedFile = null; }}>✕</span>
                      </div>`
                    : html`<div class="drop-text">点击选择文件或拖拽文件到此处</div>
                        <div class="drop-hint">支持 PDF / DOCX / MD / HTML / TXT / CSV / JSON / LaTeX / 代码等 (最大 50MB)</div>`}
                </div>
                <input id="file-input" type="file" style="display:none;"
                  accept=".pdf,.docx,.doc,.pptx,.xlsx,.txt,.md,.markdown,.html,.htm,.csv,.tsv,.json,.jsonl,.xml,.yaml,.yml,.toml,.tex,.bib,.rtf,.log,.py,.js,.ts,.jsx,.tsx,.java,.c,.cpp,.h,.go,.rs,.rb,.php,.sh,.sql,.css,.f,.f90"
                  @change=${(e: Event) => this.handleFileSelect(e)} />
              </div>
            ` : html`
              <div class="modal-field">
                <label>资料内容</label>
                <textarea .value=${this.learnText}
                  @input=${(e: InputEvent) => this.learnText = (e.target as HTMLTextAreaElement).value}
                  placeholder="粘贴要学习的资料..." style="min-height: 200px;"></textarea>
              </div>
            `}
            ${this.learnStatus ? html`<div class="learn-status ${this.learnStatus.type}">${this.learnStatus.msg}</div>` : ''}
            <div class="modal-actions">
              <button class="btn btn-secondary" @click=${() => this.showLearnModal = false}>关闭</button>
              <button class="btn btn-primary" @click=${() => this.handleLearn()}
                ?disabled=${this.learnStatus?.type === 'loading' ||
                  (this.learnTab === 'file' ? !this.selectedFile : this.learnText.trim().length < 10)}>
                ${this.learnStatus?.type === 'loading' ? '学习中...' : '开始学习'}
              </button>
            </div>
          </div>
        </div>
      ` : ''}

      ${this.editingEntry ? html`
        <div class="modal-overlay" @click=${() => this.editingEntry = null}>
          <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
            <div class="modal-title">编辑知识条目</div>
            <div class="modal-field">
              <label>标题</label>
              <input type="text" .value=${this.editingEntry.title}
                @input=${(e: InputEvent) => this.editingEntry = { ...this.editingEntry!, title: (e.target as HTMLInputElement).value }} />
            </div>
            <div class="modal-field">
              <label>分类</label>
              <input type="text" .value=${this.editingEntry.category}
                @input=${(e: InputEvent) => this.editingEntry = { ...this.editingEntry!, category: (e.target as HTMLInputElement).value }} />
            </div>
            <div class="modal-field">
              <label>内容 (Markdown)</label>
              <textarea .value=${this.editingEntry.content}
                @input=${(e: InputEvent) => this.editingEntry = { ...this.editingEntry!, content: (e.target as HTMLTextAreaElement).value }}></textarea>
            </div>
            <div class="modal-field">
              <label>标签 (逗号分隔)</label>
              <input type="text" .value=${this.editingEntry.tags.join(', ')}
                @input=${(e: InputEvent) => this.editingEntry = { ...this.editingEntry!, tags: (e.target as HTMLInputElement).value.split(',').map(t => t.trim()).filter(Boolean) }} />
            </div>
            <div class="modal-field">
              <label>所属分类路径</label>
              <input type="text" .value=${this.editingEntry.parentPath || ''}
                @input=${(e: InputEvent) => this.editingEntry = { ...this.editingEntry!, parentPath: (e.target as HTMLInputElement).value }} />
              <div class="field-hint">如: 项目A/子主题，留空为根级</div>
            </div>
            <div class="modal-field">
              <label>重要性</label>
              <div class="importance-select">
                ${[0, 1, 2].map((v) => html`
                  <div class="importance-opt ${this.editingEntry!.importance === v ? 'active' : ''}"
                    @click=${() => this.editingEntry = { ...this.editingEntry!, importance: v }}>
                    ${v === 2 ? '🔴 重要' : v === 1 ? '🟡 一般' : '⚪ 普通'}
                  </div>
                `)}
              </div>
            </div>
            <div class="modal-actions">
              <button class="btn btn-secondary" @click=${() => this.editingEntry = null}>取消</button>
              <button class="btn btn-primary" @click=${() => this.handleSaveEdit()}>保存</button>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }
}
