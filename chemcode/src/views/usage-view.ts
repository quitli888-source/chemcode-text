// ====== Usage View ======
// Displays token usage, cost, and statistics with time range filtering.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { apiClient } from '../api/index';
import type { UsageSummary } from '../api/types';

@customElement('chemcode-usage-view')
export class UsageView extends LitElement {
  @state() private range: '1d' | '7d' | '30d' = '7d';
  @state() private data: UsageSummary | null = null;
  @state() private loading = true;
  @state() private error = '';
  @state() private filterModel = '';
  @state() private filterProvider = '';

  connectedCallback() {
    super.connectedCallback();
    this.loadData();
  }

  private async loadData() {
    this.loading = true;
    this.error = '';
    const filters: Record<string, string> = {};
    if (this.filterModel) filters.model = this.filterModel;
    if (this.filterProvider) filters.provider = this.filterProvider;
    const r = await apiClient.usage.get(this.range, filters);
    if (r.ok) {
      this.data = r.value;
    } else {
      this.error = r.error.message;
    }
    this.loading = false;
  }

  private onRangeChange(e: Event) {
    this.range = (e.target as HTMLSelectElement).value as '1d' | '7d' | '30d';
    this.loadData();
  }

  private fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  private fmtCost(n: number): string {
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
  }

  private pct(a: number, b: number): string {
    return b > 0 ? ((a / b) * 100).toFixed(1) : '0.0';
  }

  static styles = css`
    :host {
      display: block;
      padding: 32px 40px;
      max-width: 1200px;
      margin: 0 auto;
      color: var(--color-text-primary, #e0e0e0);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 28px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header h1 .icon {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, #7c5cfc, #5c8cfc);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
    }
    .header .subtitle {
      font-size: 0.85rem;
      color: var(--color-text-secondary, #888);
      margin-top: 2px;
    }

    /* ── Controls ── */
    .controls {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .range-tabs {
      display: flex;
      background: var(--color-background-primary, #1a1a2e);
      border: 1px solid var(--color-border-tertiary, #333);
      border-radius: 8px;
      overflow: hidden;
    }
    .range-tab {
      padding: 7px 16px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      border: none;
      background: transparent;
      color: var(--color-text-secondary, #888);
      transition: all 0.15s;
    }
    .range-tab:hover { color: var(--color-text-primary, #e0e0e0); }
    .range-tab.active {
      background: var(--color-accent, #7c5cfc);
      color: white;
    }
    .filter-input {
      padding: 7px 12px;
      border: 1px solid var(--color-border-tertiary, #333);
      border-radius: 8px;
      background: var(--color-background-primary, #1a1a2e);
      color: var(--color-text-primary, #e0e0e0);
      font-size: 0.82rem;
      width: 160px;
      outline: none;
      transition: border-color 0.15s;
    }
    .filter-input:focus { border-color: var(--color-accent, #7c5cfc); }
    .filter-input::placeholder { color: var(--color-text-tertiary, #555); }

    /* ── Metric Cards ── */
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-bottom: 32px;
    }
    .metric {
      background: var(--color-background-primary, #1a1a2e);
      border: 1px solid var(--color-border-tertiary, #333);
      border-radius: 12px;
      padding: 18px 20px;
      position: relative;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .metric:hover { border-color: var(--color-border-secondary, #555); }
    .metric .label {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--color-text-tertiary, #666);
      margin-bottom: 8px;
    }
    .metric .value {
      font-size: 1.8rem;
      font-weight: 700;
      line-height: 1.1;
      color: var(--color-text-primary, #e0e0e0);
    }
    .metric .detail {
      font-size: 0.75rem;
      color: var(--color-text-secondary, #888);
      margin-top: 6px;
      line-height: 1.4;
    }
    .metric::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      border-radius: 12px 12px 0 0;
    }
    .metric.msgs::after { background: linear-gradient(90deg, #7c5cfc, #a78bfa); }
    .metric.tokens::after { background: linear-gradient(90deg, #06b6d4, #67e8f9); }
    .metric.tools::after { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
    .metric.avg::after { background: linear-gradient(90deg, #10b981, #34d399); }
    .metric.cost::after { background: linear-gradient(90deg, #ef4444, #f87171); }
    .metric.sessions::after { background: linear-gradient(90deg, #8b5cf6, #c084fc); }
    .metric.errors::after { background: linear-gradient(90deg, #64748b, #94a3b8); }
    .metric.reasoning::after { background: linear-gradient(90deg, #ec4899, #f472b6); }

    /* ── Section ── */
    .section {
      margin-bottom: 28px;
    }
    .section-title {
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title .badge {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 100px;
      background: var(--color-accent-light, rgba(124,92,252,0.15));
      color: var(--color-accent, #7c5cfc);
    }

    /* ── Tables ── */
    .data-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      background: var(--color-background-primary, #1a1a2e);
      border: 1px solid var(--color-border-tertiary, #333);
      border-radius: 12px;
      overflow: hidden;
    }
    .data-table th {
      text-align: left;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--color-text-tertiary, #666);
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-border-tertiary, #333);
      background: var(--color-background-secondary, #16162a);
    }
    .data-table td {
      padding: 12px 16px;
      font-size: 0.85rem;
      border-bottom: 1px solid var(--color-border-tertiary, #282840);
      color: var(--color-text-primary, #e0e0e0);
    }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table tr:hover td { background: rgba(124, 92, 252, 0.04); }

    /* ── Bar chart ── */
    .bar-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .bar-track {
      flex: 1;
      height: 8px;
      background: var(--color-border-tertiary, #282840);
      border-radius: 4px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 4px;
      background: linear-gradient(90deg, #7c5cfc, #a78bfa);
      transition: width 0.4s ease;
    }
    .bar-value {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--color-text-secondary, #888);
      min-width: 40px;
      text-align: right;
    }

    /* ── Empty / Loading ── */
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 80px 20px;
      color: var(--color-text-tertiary, #666);
      gap: 10px;
    }
    .loading .spinner {
      width: 20px; height: 20px;
      border: 2px solid var(--color-border-tertiary, #333);
      border-top-color: var(--color-accent, #7c5cfc);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .error-box {
      padding: 16px 20px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 10px;
      color: #f87171;
      font-size: 0.9rem;
    }
    .empty {
      padding: 60px 20px;
      text-align: center;
      color: var(--color-text-tertiary, #666);
      font-size: 0.9rem;
    }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      :host { padding: 20px 16px; }
      .metrics { grid-template-columns: repeat(2, 1fr); gap: 10px; }
      .metric .value { font-size: 1.4rem; }
      .header { flex-direction: column; align-items: flex-start; }
    }
  `;

  render() {
    if (this.loading) return html`<div class="loading"><div class="spinner"></div>加载中…</div>`;
    if (this.error) return html`<div class="error-box">❌ ${this.error}</div>`;
    if (!this.data) return html`<div class="empty">暂无使用数据</div>`;
    const d = this.data;

    return html`
      <!-- Header -->
      <div class="header">
        <div>
          <h1><span class="icon">📊</span> 使用情况</h1>
          <div class="subtitle">Token 用量 · 成本统计 · 工具调用</div>
        </div>
        <div class="controls">
          <div class="range-tabs">
            <button class="range-tab ${this.range === '1d' ? 'active' : ''}" @click=${() => { this.range = '1d'; this.loadData(); }}>今天</button>
            <button class="range-tab ${this.range === '7d' ? 'active' : ''}" @click=${() => { this.range = '7d'; this.loadData(); }}>7 天</button>
            <button class="range-tab ${this.range === '30d' ? 'active' : ''}" @click=${() => { this.range = '30d'; this.loadData(); }}>30 天</button>
          </div>
          <input class="filter-input" placeholder="筛选模型…" .value=${this.filterModel}
            @input=${(e: Event) => { this.filterModel = (e.target as HTMLInputElement).value; }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.loadData(); }} />
          <input class="filter-input" placeholder="筛选提供商…" .value=${this.filterProvider}
            @input=${(e: Event) => { this.filterProvider = (e.target as HTMLInputElement).value; }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this.loadData(); }} />
        </div>
      </div>

      <!-- Metric Cards -->
      <div class="metrics">
        <div class="metric msgs">
          <div class="label">消息</div>
          <div class="value">${d.totalMessages}</div>
          <div class="detail">${d.userMessages} 用户 · ${d.assistantMessages} 助手</div>
        </div>
        <div class="metric tokens">
          <div class="label">Token</div>
          <div class="value">${this.fmt(d.totalTokens)}</div>
          <div class="detail">↑${this.fmt(d.promptTokens)} 提示 · ↓${this.fmt(d.completionTokens)} 补全</div>
        </div>
        <div class="metric tools">
          <div class="label">工具调用</div>
          <div class="value">${d.totalToolCalls}</div>
          <div class="detail">${d.uniqueTools} 种工具</div>
        </div>
        <div class="metric avg">
          <div class="label">平均 Token / 消息</div>
          <div class="value">${this.fmt(d.avgTokensPerMessage)}</div>
          <div class="detail">共 ${d.totalMessages} 条消息</div>
        </div>
        <div class="metric cost">
          <div class="label">总成本</div>
          <div class="value">${this.fmtCost(d.totalCostUsd)}</div>
          <div class="detail">平均 ${this.fmtCost(d.avgCostPerMessage)} / 消息</div>
        </div>
        <div class="metric sessions">
          <div class="label">会话</div>
          <div class="value">${d.sessionCount}</div>
          <div class="detail">范围内共 ${d.sessionCount} 个</div>
        </div>
        <div class="metric errors">
          <div class="label">错误</div>
          <div class="value">${d.errorCount}</div>
          <div class="detail">错误率 ${this.pct(d.errorCount, d.totalMessages)}%</div>
        </div>
        ${d.reasoningTokens > 0 ? html`
        <div class="metric reasoning">
          <div class="label">推理 Token</div>
          <div class="value">${this.fmt(d.reasoningTokens)}</div>
          <div class="detail">思考模式消耗</div>
        </div>` : ''}
      </div>

      <!-- Top Models -->
      ${d.topModels.length > 0 ? html`
      <div class="section">
        <div class="section-title">🔥 热门模型 <span class="badge">${d.topModels.length}</span></div>
        <table class="data-table">
          <thead><tr><th>模型</th><th>成本</th><th>Token</th><th>消息</th><th></th></tr></thead>
          <tbody>
          ${d.topModels.map((m, i) => html`
            <tr>
              <td style="font-weight:600">${m.model}</td>
              <td>${this.fmtCost(m.cost)}</td>
              <td>${this.fmt(m.tokens)}</td>
              <td>${m.messages}</td>
              <td style="width:180px">
                <div class="bar-wrap">
                  <div class="bar-track"><div class="bar-fill" style="width:${d.topModels[0] ? (m.cost / d.topModels[0].cost * 100) : 0}%"></div></div>
                </div>
              </td>
            </tr>
          `)}
          </tbody>
        </table>
      </div>` : ''}

      <!-- Top Providers -->
      ${d.topProviders.length > 0 ? html`
      <div class="section">
        <div class="section-title">🏢 热门提供商 <span class="badge">${d.topProviders.length}</span></div>
        <table class="data-table">
          <thead><tr><th>提供商</th><th>成本</th><th>Token</th><th>消息</th></tr></thead>
          <tbody>
          ${d.topProviders.map(p => html`
            <tr>
              <td style="font-weight:600">${p.provider}</td>
              <td>${this.fmtCost(p.cost)}</td>
              <td>${this.fmt(p.tokens)}</td>
              <td>${p.messages}</td>
            </tr>
          `)}
          </tbody>
        </table>
      </div>` : ''}

      <!-- Top Tools -->
      ${d.topTools.length > 0 ? html`
      <div class="section">
        <div class="section-title">🛠️ 热门工具 <span class="badge">${d.topTools.length}</span></div>
        <table class="data-table">
          <thead><tr><th>工具</th><th>调用次数</th><th></th></tr></thead>
          <tbody>
          ${d.topTools.map(t => html`
            <tr>
              <td style="font-weight:600">${t.tool}</td>
              <td>${t.count}</td>
              <td style="width:220px">
                <div class="bar-wrap">
                  <div class="bar-track"><div class="bar-fill" style="width:${d.topTools[0] ? (t.count / d.topTools[0].count * 100) : 0}%"></div></div>
                  <div class="bar-value">${d.topTools[0] ? Math.round(t.count / d.topTools[0].count * 100) : 0}%</div>
                </div>
              </td>
            </tr>
          `)}
          </tbody>
        </table>
      </div>` : ''}

      <!-- Daily Breakdown -->
      ${d.dailyBreakdown.length > 0 ? html`
      <div class="section">
        <div class="section-title">📅 每日明细 <span class="badge">${d.dailyBreakdown.length} 天</span></div>
        <table class="data-table">
          <thead><tr><th>日期</th><th>消息</th><th>Token</th><th>成本</th></tr></thead>
          <tbody>
          ${d.dailyBreakdown.map(day => html`
            <tr>
              <td style="font-weight:600">${day.date}</td>
              <td>${day.messages}</td>
              <td>${this.fmt(day.tokens)}</td>
              <td>${this.fmtCost(day.cost)}</td>
            </tr>
          `)}
          </tbody>
        </table>
      </div>` : ''}
    `;
  }
}
