// ====== 数据库检索视图 ======
// 语义检索/关键词检索，结果卡片展示文档中全部字段。

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { api } from '../api/client';
import '../components/markdown-renderer';

interface SearchResult {
  id: string;
  score?: number;
  payload: {
    paper_id: string;
    display_title: string;
    doi: string | null;
    year: string | null;
    source_path: string;
    section: string;
    chunk_index: number;
    chunk_text: string;
  };
}

interface SearchResponse {
  query: string;
  top_k: number;
  search_type: string;
  translated_keywords?: string[];
  total_matching?: number;
  results: SearchResult[];
}

interface DbStatus {
  collection_name: string;
  status: string;
  points_count: number;
  vector_size: number;
  distance: string;
  connected: boolean;
  embedding_provider: string;
  embedding_available: boolean;
}

@customElement('database-view')
export class DatabaseView extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: var(--spacing-lg);
      max-width: 960px;
      margin: 0 auto;
      width: 100%;
      box-sizing: border-box;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-lg);
      flex-wrap: wrap;
      gap: var(--spacing-sm);
    }
    .page-title {
      font-size: var(--font-size-2xl);
      font-weight: var(--font-weight-bold);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .status-bar {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: 8px 14px;
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; }
    .status-dot.green { background: #22c55e; }
    .status-dot.red { background: #ef4444; }

    .search-section { margin-bottom: var(--spacing-lg); }
    .search-box { display: flex; gap: var(--spacing-sm); }
    .search-input {
      flex: 1; padding: 10px 14px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      font-size: var(--font-size-base); outline: none;
      background: var(--color-background-primary);
      color: var(--color-text-primary);
      transition: border-color var(--transition-fast);
    }
    .search-input:focus {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 2px var(--color-accent-light);
    }
    .search-btn {
      padding: 10px 20px;
      background: var(--color-accent); color: white;
      border: none; border-radius: var(--border-radius-md);
      font-size: var(--font-size-base); cursor: pointer;
      font-weight: var(--font-weight-medium); white-space: nowrap;
    }
    .search-btn:hover { opacity: 0.9; }
    .search-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .search-options {
      display: flex; gap: var(--spacing-sm);
      margin-top: var(--spacing-xs); align-items: center; flex-wrap: wrap;
    }
    .mode-label { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .mode-btn {
      padding: 3px 10px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: 100px; font-size: var(--font-size-xs);
      background: var(--color-background-primary);
      color: var(--color-text-secondary); cursor: pointer;
    }
    .mode-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
    .mode-btn.active {
      background: var(--color-accent-light);
      border-color: var(--color-accent);
      color: var(--color-accent); font-weight: var(--font-weight-medium);
    }

    .search-meta {
      margin-bottom: var(--spacing-md);
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
      display: flex; gap: var(--spacing-md); flex-wrap: wrap;
    }
    .search-meta .tag {
      display: inline-block; padding: 2px 8px;
      border-radius: 100px;
      background: var(--color-accent-light);
      color: var(--color-accent);
      font-size: var(--font-size-xs);
    }

    .results-list { display: flex; flex-direction: column; gap: var(--spacing-sm); }

    /* ====== 结果卡片 ====== */
    .result-card {
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-lg);
      overflow: hidden;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .result-card:hover {
      border-color: var(--color-border-info);
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .result-card.expanded { border-color: var(--color-accent); }

    .result-top {
      display: flex;
      gap: var(--spacing-sm);
      padding: var(--spacing-md);
    }

    /* 左侧：排名 + 相似度 */
    .result-rank {
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      min-width: 52px;
    }
    .rank-num {
      width: 36px; height: 36px;
      border-radius: 50%;
      background: var(--color-accent);
      color: white;
      display: flex; align-items: center; justify-content: center;
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-bold);
    }
    .rank-score {
      font-size: 11px;
      font-weight: var(--font-weight-bold);
      color: var(--color-accent);
      text-align: center;
      line-height: 1.2;
    }
    .rank-score .label {
      font-size: 9px;
      font-weight: normal;
      color: var(--color-text-tertiary);
      display: block;
    }

    /* 右侧：内容 */
    .result-body { flex: 1; min-width: 0; }

    .result-title {
      font-size: var(--font-size-base);
      font-weight: var(--font-weight-medium);
      line-height: 1.4;
      margin-bottom: 6px;
      color: var(--color-text-primary);
    }

    /* 元数据行 */
    .result-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 6px;
    }
    .meta-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 8px;
      border-radius: var(--border-radius-sm);
      font-size: 11px;
      background: var(--color-background-secondary);
      color: var(--color-text-secondary);
      white-space: nowrap;
    }
    .meta-chip.doi {
      background: #eff6ff;
      color: #2563eb;
    }
    .meta-chip.section {
      background: #f0fdf4;
      color: #16a34a;
    }
    .meta-chip.year {
      background: #fefce8;
      color: #a16207;
    }

    /* 摘要预览 */
    .result-preview {
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      line-height: 1.6;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    /* 展开详情 */
    .result-detail {
      border-top: 0.5px solid var(--color-border-tertiary);
      padding: var(--spacing-md);
      background: var(--color-background-secondary);
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 90px 1fr;
      gap: 4px 12px;
      font-size: var(--font-size-xs);
      margin-bottom: var(--spacing-sm);
    }
    .detail-label {
      color: var(--color-text-tertiary);
      white-space: nowrap;
    }
    .detail-value {
      color: var(--color-text-primary);
      word-break: break-all;
    }
    .detail-value a {
      color: var(--color-accent);
      text-decoration: none;
    }
    .detail-value a:hover { text-decoration: underline; }

    .detail-text {
      font-size: var(--font-size-sm);
      color: var(--color-text-primary);
      line-height: 1.7;
      white-space: pre-wrap;
      word-break: break-word;
      padding: var(--spacing-sm);
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      max-height: 400px;
      overflow-y: auto;
    }

    .detail-actions {
      display: flex; gap: var(--spacing-xs);
      margin-top: var(--spacing-sm);
    }
    .action-chip {
      padding: 4px 12px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: 100px;
      font-size: var(--font-size-xs);
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
      text-decoration: none;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .action-chip:hover {
      background: var(--color-background-tertiary);
      border-color: var(--color-accent);
      color: var(--color-accent);
    }

    .empty-state {
      text-align: center;
      padding: var(--spacing-xl);
      color: var(--color-text-tertiary);
    }
    .empty-state .icon { font-size: 48px; margin-bottom: var(--spacing-sm); }
    .empty-state .text { font-size: var(--font-size-sm); }

    .loading {
      text-align: center;
      padding: var(--spacing-lg);
      color: var(--color-text-tertiary);
    }
    .loading .spinner {
      display: inline-block;
      width: 20px; height: 20px;
      border: 2px solid var(--color-border-tertiary);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px; vertical-align: middle;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .settings-panel {
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-md);
      margin-bottom: var(--spacing-lg);
    }
    .settings-title {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      margin-bottom: var(--spacing-sm);
      display: flex; align-items: center; justify-content: space-between;
    }
    .settings-toggle {
      background: transparent; border: none; cursor: pointer;
      font-size: var(--font-size-xs); color: var(--color-accent);
    }
    .settings-row {
      display: flex; gap: var(--spacing-sm);
      align-items: center; margin-bottom: var(--spacing-xs); flex-wrap: wrap;
    }
    .settings-row label {
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary); min-width: 80px;
    }
    .settings-row select, .settings-row input {
      padding: 4px 8px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-sm);
      font-size: var(--font-size-xs);
      background: var(--color-background-secondary);
      color: var(--color-text-primary); outline: none;
    }
    .settings-row select:focus, .settings-row input:focus { border-color: var(--color-accent); }
    .settings-save {
      padding: 4px 12px;
      background: var(--color-accent); color: white;
      border: none; border-radius: var(--border-radius-sm);
      font-size: var(--font-size-xs); cursor: pointer;
    }
    .settings-save:hover { opacity: 0.9; }
    .info-box {
      padding: 8px 12px;
      background: var(--color-background-secondary);
      border-radius: var(--border-radius-md);
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary); line-height: 1.6;
    }
  `;

  @state() private query = '';
  @state() private results: SearchResult[] = [];
  @state() private searchType = '';
  @state() private translatedKeywords: string[] = [];
  @state() private totalMatching = 0;
  @state() private loading = false;
  @state() private searched = false;
  @state() private expandedId: string | null = null;
  @state() private status: DbStatus | null = null;
  @state() private topK = 10;

  @state() private showSettings = false;
  @state() private embedProvider = 'siliconflow';
  @state() private embedApiKey = '';
  @state() private embedModel = '';
  @state() private settingsSaving = false;
  @state() private connectionError: string | null = null;

  override async connectedCallback() {
    super.connectedCallback();
    await this.loadStatus();
    await this.loadConfig();
  }

  private async loadStatus() {
    this.connectionError = null;
    try {
      const r = await api.get<DbStatus>('/database/status');
      if (r.ok) {
        this.status = r.value;
        if (!r.value.connected) this.connectionError = '数据库未连接，请检查服务器是否运行';
      } else {
        this.connectionError = `API 错误: ${r.error.message}`;
        this.status = { collection_name: 'chemchat_papers', status: 'disconnected', points_count: 0, vector_size: 0, distance: 'unknown', connected: false, embedding_provider: 'none', embedding_available: false };
      }
    } catch (e: any) {
      this.connectionError = `连接失败: ${e.message || '未知错误'}`;
      this.status = { collection_name: 'chemchat_papers', status: 'disconnected', points_count: 0, vector_size: 0, distance: 'unknown', connected: false, embedding_provider: 'none', embedding_available: false };
    }
  }

  private async loadConfig() {
    const r = await api.get<any>('/database/config');
    if (r.ok) {
      this.embedProvider = r.value.embedding_provider || 'siliconflow';
      this.embedModel = r.value.embedding_model || 'BAAI/bge-m3';
      if (r.value.has_embedding_key) this.embedApiKey = '••••••••（已配置）';
    }
  }

  private async doSearch() {
    if (!this.query.trim() || this.loading) return;
    this.loading = true;
    this.searched = true;
    this.expandedId = null;
    try {
      const r = await api.post<SearchResponse>('/database/search', { query: this.query.trim(), top_k: this.topK });
      if (r.ok) {
        this.results = r.value.results;
        this.searchType = r.value.search_type;
        this.translatedKeywords = r.value.translated_keywords || [];
        this.totalMatching = r.value.total_matching ?? r.value.results.length;
        this.connectionError = null;
      } else {
        this.results = [];
        this.connectionError = `检索失败: ${r.error.message}`;
      }
    } catch (e: any) {
      this.results = [];
      this.connectionError = `检索请求失败: ${e.message || '网络错误'}`;
    } finally {
      this.loading = false;
    }
  }

  private onKeydown(e: KeyboardEvent) { if (e.key === 'Enter') this.doSearch(); }
  private toggleExpand(id: string) { this.expandedId = this.expandedId === id ? null : id; }

  private async saveSettings() {
    this.settingsSaving = true;
    try {
      await api.post('/database/config', { provider: this.embedProvider, api_key: this.embedApiKey || undefined, model: this.embedModel || undefined });
      await this.loadStatus(); await this.loadConfig();
    } finally { this.settingsSaving = false; }
  }

  private async reconnect() {
    this.settingsSaving = true;
    try { await api.post('/database/reconnect'); await this.loadStatus(); } finally { this.settingsSaving = false; }
  }

  private truncate(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max) + '…';
  }

  /** 将 source_path 转为可读的短路径 */
  private shortPath(p: string): string {
    if (!p) return '';
    const parts = p.split('/');
    if (parts.length <= 2) return p;
    return parts[0] + '/…/' + parts[parts.length - 1];
  }

  render() {
    return html`
      <div>
        <div class="page-header">
          <div class="page-title">🔬 论文数据库检索</div>
          ${this.status ? html`
            <div class="status-bar">
              <span class="status-dot ${this.status.connected ? 'green' : 'red'}"></span>
              <span>${this.status.collection_name}</span>
              <span>·</span>
              <span>${this.status.points_count} 篇论文</span>
              <span>·</span>
              <span>${this.status.embedding_available ? '🧠 语义检索' : '🔤 关键词检索'}</span>
              ${!this.status.connected ? html`<button class="mode-btn" @click=${() => this.loadStatus()} style="margin-left:4px;">🔄 重试</button>` : ''}
            </div>
          ` : html`<div class="status-bar"><span class="status-dot red"></span><span>连接中…</span></div>`}
          ${this.connectionError ? html`
            <div style="margin-top:4px;padding:6px 10px;background:#fef2f2;border:0.5px solid #fecaca;border-radius:var(--border-radius-md);font-size:var(--font-size-xs);color:#dc2626;">
              ⚠️ ${this.connectionError}
            </div>
          ` : ''}
        </div>

        <div class="settings-panel">
          <div class="settings-title">
            <span>⚙️ 数据库连接</span>
            <button class="settings-toggle" @click=${() => this.showSettings = !this.showSettings}>
              ${this.showSettings ? '收起' : '展开'}
            </button>
          </div>
          ${this.showSettings ? html`
            <div class="settings-row">
              <label>Embedding</label>
              <select .value=${this.embedProvider} @change=${(e: Event) => this.embedProvider = (e.target as HTMLSelectElement).value}>
                <option value="none">不需要（纯关键词检索）</option>
                <option value="siliconflow">SiliconFlow（BAAI/bge-m3）</option>
              </select>
            </div>
            ${this.embedProvider !== 'none' ? html`
              <div class="settings-row">
                <label>API Key</label>
                <input type="password" placeholder="输入 Embedding API Key"
                  .value=${this.embedApiKey}
                  @input=${(e: InputEvent) => this.embedApiKey = (e.target as HTMLInputElement).value} />
              </div>
            ` : ''}
            <div class="settings-row" style="margin-top: 8px;">
              <button class="settings-save" @click=${() => this.saveSettings()} ?disabled=${this.settingsSaving}>
                ${this.settingsSaving ? '保存中…' : '保存配置'}
              </button>
              <button class="settings-save" style="background: var(--color-text-secondary);" @click=${() => this.reconnect()}>🔄 测试连接</button>
            </div>
            <div class="info-box" style="margin-top: 8px;">
              💡 数据库通过 SSH 直连阿里云服务器（1.95.65.154:22 → Qdrant 127.0.0.1:6333）。<br>
              默认使用 SiliconFlow（BAAI/bge-m3）语义检索。API Key 已在后端配置。
            </div>
          ` : html`
            <div style="font-size: var(--font-size-xs); color: var(--color-text-tertiary);">
              服务器: SSH → 1.95.65.154 ·
              模式: ${this.embedProvider === 'none' ? '关键词检索' : '语义检索'} —
              <button class="settings-toggle" @click=${() => this.showSettings = true}>修改</button>
            </div>
          `}
        </div>

        <div class="search-section">
          <div class="search-box">
            <input class="search-input" type="text" placeholder="输入问题或关键词，支持中英文…"
              .value=${this.query}
              @input=${(e: InputEvent) => this.query = (e.target as HTMLInputElement).value}
              @keydown=${this.onKeydown} />
            <button class="search-btn" @click=${() => this.doSearch()} ?disabled=${this.loading || !this.query.trim()}>
              ${this.loading ? '检索中…' : '🔍 检索'}
            </button>
          </div>
          <div class="search-options">
            <span class="mode-label">返回数量:</span>
            ${[5, 10, 20].map((n) => html`
              <button class="mode-btn ${this.topK === n ? 'active' : ''}" @click=${() => this.topK = n}>${n}</button>
            `)}
          </div>
        </div>

        ${this.searched && !this.loading ? html`
          <div class="search-meta">
            <span>查询: <strong>${this.query}</strong></span>
            <span>方式: <span class="tag">${this.searchType === 'semantic' ? '🧠 语义检索' : '🔤 关键词检索'}</span></span>
            <span>结果: ${this.results.length} 条${this.totalMatching > this.results.length ? `（共 ${this.totalMatching} 条匹配）` : ''}</span>
            ${this.translatedKeywords.length > 0 ? html`<span>翻译: ${this.translatedKeywords.join(', ')}</span>` : ''}
          </div>
        ` : ''}

        ${this.loading ? html`
          <div class="loading"><span class="spinner"></span>正在检索 ${this.status?.points_count || ''} 篇论文…</div>
        ` : this.searched && this.results.length === 0 ? html`
          <div class="empty-state"><div class="icon">📭</div><div class="text">未找到相关论文，请尝试其他关键词</div></div>
        ` : !this.searched ? html`
          <div class="empty-state">
            <div class="icon">🔬</div>
            <div class="text">
              输入化学相关问题开始检索<br>
              <span style="font-size: var(--font-size-xs); color: var(--color-text-tertiary);">
                支持中英文，如 "DNA过度拉伸"、"polymer self-assembly"、"聚合物分子量分布"
              </span>
            </div>
          </div>
        ` : html`
          <div class="results-list">
            ${this.results.map((r, idx) => {
              const isExpanded = this.expandedId === r.id;
              const scorePercent = r.score != null ? (r.score * 100).toFixed(1) : null;
              return html`
                <div class="result-card ${isExpanded ? 'expanded' : ''}" @click=${() => this.toggleExpand(r.id)}>

                  <!-- 卡片主体 -->
                  <div class="result-top">
                    <!-- 左：排名 + 相似度 -->
                    <div class="result-rank">
                      <div class="rank-num">${idx + 1}</div>
                      ${scorePercent != null ? html`
                        <div class="rank-score">
                          ${scorePercent}%
                          <span class="label">相似度</span>
                        </div>
                      ` : ''}
                    </div>

                    <!-- 右：标题 + 元数据 + 预览 -->
                    <div class="result-body">
                      <div class="result-title">${r.payload.display_title || 'Untitled'}</div>

                      <div class="result-meta">
                        ${r.payload.year ? html`<span class="meta-chip year">📅 ${r.payload.year}</span>` : ''}
                        ${r.payload.section ? html`<span class="meta-chip section">📑 ${r.payload.section}</span>` : ''}
                        ${r.payload.doi ? html`<span class="meta-chip doi">🔗 ${r.payload.doi}</span>` : ''}
                        <span class="meta-chip">Chunk #${r.payload.chunk_index}</span>
                      </div>

                      ${!isExpanded ? html`
                        <div class="result-preview">${this.truncate(r.payload.chunk_text, 250)}</div>
                      ` : ''}
                    </div>
                  </div>

                  <!-- 展开详情 -->
                  ${isExpanded ? html`
                    <div class="result-detail">
                      <div class="detail-grid">
                        <span class="detail-label">论文 ID</span>
                        <span class="detail-value" style="font-family:var(--font-mono);font-size:10px;">${r.payload.paper_id}</span>

                        <span class="detail-label">年份</span>
                        <span class="detail-value">${r.payload.year || '—'}</span>

                        <span class="detail-label">章节</span>
                        <span class="detail-value">${r.payload.section || '—'}</span>

                        <span class="detail-label">Chunk 序号</span>
                        <span class="detail-value">#${r.payload.chunk_index}</span>

                        <span class="detail-label">DOI</span>
                        <span class="detail-value">
                          ${r.payload.doi
                            ? html`<a href="https://doi.org/${r.payload.doi}" target="_blank" @click=${(e: Event) => e.stopPropagation()}>${r.payload.doi}</a>`
                            : '—'}
                        </span>

                        <span class="detail-label">源文件路径</span>
                        <span class="detail-value" style="font-family:var(--font-mono);font-size:10px;" title="${r.payload.source_path}">${this.shortPath(r.payload.source_path)}</span>

                        <span class="detail-label">相似度</span>
                        <span class="detail-value" style="font-weight:var(--font-weight-bold);color:var(--color-accent);">
                          ${scorePercent != null ? `${scorePercent}%` : '—'}
                        </span>
                      </div>

                      <div style="font-size:var(--font-size-xs);color:var(--color-text-tertiary);margin-bottom:4px;">📄 论文片段正文</div>
                      <div class="detail-text">${r.payload.chunk_text}</div>

                      <div class="detail-actions">
                        ${r.payload.doi ? html`
                          <a class="action-chip" href="https://doi.org/${r.payload.doi}" target="_blank" @click=${(e: Event) => e.stopPropagation()}>
                            📎 查看原文
                          </a>
                        ` : ''}
                        <button class="action-chip" @click=${(e: Event) => { e.stopPropagation(); navigator.clipboard?.writeText(r.payload.chunk_text); }}>
                          📋 复制片段
                        </button>
                        <button class="action-chip" @click=${(e: Event) => {
                          e.stopPropagation();
                          const full = JSON.stringify(r.payload, null, 2);
                          navigator.clipboard?.writeText(full);
                        }}>
                          📋 复制全部字段
                        </button>
                      </div>
                    </div>
                  ` : ''}
                </div>
              `;
            })}
          </div>
        `}
      </div>
    `;
  }
}
