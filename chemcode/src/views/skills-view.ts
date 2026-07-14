// ====== Skills View ======
// Lists, installs, uninstalls, and imports skill packs.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getState, subscribe, toggleSkill, updateState } from '../state';
import type { SkillEntry } from '../types';
import { getActiveClient } from '../api/mock';
import { showError, showSuccess } from '../components/toast';
import { showConfirm } from '../components/confirm-dialog';

@customElement('chemcode-skills-view')
export class SkillsView extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 32px 40px;
      max-width: 960px;
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
      background: linear-gradient(135deg, #10b981, #34d399);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
    }
    .header .subtitle {
      font-size: 0.85rem;
      color: var(--color-text-secondary, #888);
      margin-top: 2px;
    }
    .header-actions {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .btn {
      padding: 8px 18px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary {
      background: var(--color-accent, #7c5cfc);
      color: white;
    }
    .btn-primary:hover:not(:disabled) { background: #6a4fe0; }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--color-border-secondary, #555);
      color: var(--color-text-secondary, #888);
    }
    .btn-outline:hover:not(:disabled) {
      border-color: var(--color-accent, #7c5cfc);
      color: var(--color-accent, #7c5cfc);
      background: rgba(124, 92, 252, 0.06);
    }
    .btn-danger {
      background: transparent;
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
    }
    .btn-danger:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.1);
      border-color: #f87171;
    }
    .btn-sm { padding: 5px 12px; font-size: 0.78rem; }

    /* ── Skill Card ── */
    .skill-card {
      background: var(--color-background-primary, #1a1a2e);
      border: 1px solid var(--color-border-tertiary, #333);
      border-radius: 14px;
      padding: 20px 24px;
      margin-bottom: 12px;
      transition: border-color 0.15s;
    }
    .skill-card:hover { border-color: var(--color-border-secondary, #555); }
    .skill-card.installed { border-left: 3px solid #10b981; }
    .skill-card.not-installed { border-left: 3px solid var(--color-border-tertiary, #333); }

    .skill-top {
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }
    .skill-avatar {
      width: 48px; height: 48px;
      border-radius: 12px;
      background: linear-gradient(135deg, #7c5cfc, #5c8cfc);
      color: white;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .skill-card.not-installed .skill-avatar {
      background: linear-gradient(135deg, #475569, #64748b);
    }
    .skill-main { flex: 1; min-width: 0; }
    .skill-name {
      font-size: 1.05rem;
      font-weight: 700;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .skill-badge {
      font-size: 0.65rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 100px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .badge-installed { background: rgba(16, 185, 129, 0.15); color: #10b981; }
    .badge-available { background: rgba(100, 116, 139, 0.15); color: #94a3b8; }
    .skill-desc {
      font-size: 0.88rem;
      color: var(--color-text-secondary, #888);
      line-height: 1.5;
      margin-bottom: 10px;
    }
    .skill-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 0.78rem;
      color: var(--color-text-tertiary, #666);
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .meta-item .dot {
      width: 4px; height: 4px;
      border-radius: 50%;
      background: var(--color-border-secondary, #555);
    }

    /* ── Tool List ── */
    .tool-list {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--color-border-tertiary, #282840);
    }
    .tool-list-title {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--color-text-tertiary, #666);
      margin-bottom: 8px;
    }
    .tool-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .tool-chip {
      padding: 4px 10px;
      background: var(--color-background-secondary, #16162a);
      border: 1px solid var(--color-border-tertiary, #282840);
      border-radius: 6px;
      font-size: 0.75rem;
      font-family: 'SF Mono', 'Fira Code', monospace;
      color: var(--color-accent, #a78bfa);
    }
    .tool-chip .count {
      color: var(--color-text-tertiary, #666);
      margin-left: 4px;
    }

    .skill-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
      align-items: flex-start;
    }

    /* ── Section ── */
    .section-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 24px 0 14px;
    }
    .section-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--color-text-primary, #e0e0e0);
    }
    .section-count {
      font-size: 0.7rem;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 100px;
      background: var(--color-accent-light, rgba(124,92,252,0.15));
      color: var(--color-accent, #7c5cfc);
    }

    /* ── Empty / Import ── */
    .empty {
      padding: 40px 20px;
      text-align: center;
      color: var(--color-text-tertiary, #666);
      font-size: 0.9rem;
    }
    .empty .icon { font-size: 2.5rem; margin-bottom: 12px; opacity: 0.5; }
    .import-pulse {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: 12px;
      font-size: 0.78rem;
      color: #10b981;
    }
    .import-pulse .spinner {
      width: 14px; height: 14px;
      border: 2px solid rgba(16, 185, 129, 0.3);
      border-top-color: #10b981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 768px) {
      :host { padding: 20px 16px; }
      .skill-top { flex-direction: column; }
      .skill-actions { align-self: flex-end; }
    }
  `;

  @state() private skills: SkillEntry[] = [];
  @state() private pendingId: string | null = null;
  @state() private importing = false;

  connectedCallback() {
    super.connectedCallback();
    subscribe(() => {
      this.skills = getState().skills;
    });
    // Refresh skills from server on mount — handles the case where
    // an import completed while the user was on a different view.
    void this.refreshSkillsFromServer();
  }

  private async refreshSkillsFromServer() {
    try {
      const client = getActiveClient();
      const r = await client.skills.list();
      if (r.ok) {
        updateState({ skills: r.value });
      }
    } catch { /* best effort */ }
  }

  private async onToggle(s: SkillEntry) {
    if (this.pendingId) return;
    this.pendingId = s.id;
    try {
      await toggleSkill(s.id);
    } finally {
      this.pendingId = null;
    }
  }

  private async onDelete(s: SkillEntry) {
    const ok = await showConfirm({
      title: '删除技能',
      message: `确定删除技能「${s.name}」？此操作不可撤销。`,
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!ok) return;
    this.pendingId = s.id;
    try {
      const client = getActiveClient();
      const r = await client.skills.remove(s.id);
      if (r.ok) {
        updateState({ skills: getState().skills.filter((sk) => sk.id !== s.id) });
        showSuccess(`已删除: ${s.name}`);
      } else {
        showError(r.error.message);
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : '删除失败');
    } finally {
      this.pendingId = null;
    }
  }

  private async onImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.tar,.tar.gz,.tgz,.skill';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.importing = true;
      try {
        const client = getActiveClient();
        const r = await client.skills.import(file);
        if (r.ok) {
          // Response can be a single SkillEntry or an array (multi-skill zip).
          const result = r.value;
          const isArray = Array.isArray(result);
          const skills = isArray ? result : [result];
          const totalTools = skills.reduce((sum: number, s: SkillEntry) => sum + (s.toolCount ?? 0), 0);
          const names = skills.map((s: SkillEntry) => s.name).join(', ');
          const toolInfo = totalTools > 0 ? ` (${totalTools} 个工具已注册)` : ' (无工具)';
          showSuccess(`已导入: ${names}${toolInfo}`);
          // Refresh from server.
          const listR = await client.skills.list();
          if (listR.ok) {
            updateState({ skills: listR.value });
          }
        } else {
          showError(r.error.message);
        }
      } catch (e) {
        showError(e instanceof Error ? e.message : '导入失败');
      } finally {
        this.importing = false;
      }
    });
    input.click();
  }

  private renderSkill(s: SkillEntry) {
    const isPending = this.pendingId === s.id;
    const isInstalled = s.installed;
    const toolNames = s.toolNames || [];
    const toolCount = s.toolCount ?? toolNames.length;

    return html`
      <div class="skill-card ${isInstalled ? 'installed' : 'not-installed'}">
        <div class="skill-top">
          <div class="skill-avatar">${(s.name || '?').charAt(0).toUpperCase()}</div>
          <div class="skill-main">
            <div class="skill-name">
              ${s.name}
              <span class="skill-badge ${isInstalled ? 'badge-installed' : 'badge-available'}">
                ${isInstalled ? '已安装' : '可用'}
              </span>
            </div>
            <div class="skill-desc">${s.description || '暂无描述'}</div>
            <div class="skill-meta">
              <span class="meta-item">v${s.version}</span>
              ${s.author ? html`<span class="meta-item"><span class="dot"></span>${s.author}</span>` : ''}
              ${toolCount > 0 ? html`<span class="meta-item"><span class="dot"></span>${toolCount} 个工具</span>` : ''}
              ${s.downloads !== undefined ? html`<span class="meta-item"><span class="dot"></span>${s.downloads} 下载</span>` : ''}
            </div>
            ${toolNames.length > 0 ? html`
              <div class="tool-list">
                <div class="tool-list-title">提供的工具</div>
                <div class="tool-chips">
                  ${toolNames.map((t) => html`<span class="tool-chip">${t}</span>`)}
                </div>
              </div>
            ` : ''}
          </div>
          <div class="skill-actions">
            <button
              class="btn btn-sm ${isInstalled ? 'btn-danger' : 'btn-primary'}"
              ?disabled=${isPending}
              @click=${() => this.onToggle(s)}>
              ${isPending ? '…' : isInstalled ? '卸载' : '安装'}
            </button>
            ${isInstalled ? html`
              <button
                class="btn btn-sm btn-danger"
                ?disabled=${isPending}
                @click=${() => this.onDelete(s)}>
                删除
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    const installed = this.skills.filter((s) => s.installed);
    const notInstalled = this.skills.filter((s) => !s.installed);

    return html`
      <div class="header">
        <div>
          <h1><span class="icon">🧩</span> Skills</h1>
          <div class="subtitle">
            技能总数 ${this.skills.length} · 已安装 ${installed.length}
            ${this.importing ? html`<span class="import-pulse"><div class="spinner"></div>导入中…</span>` : ''}
          </div>
        </div>
        <div class="header-actions">
          <button class="btn btn-outline" @click=${() => this.onImport()} ?disabled=${this.importing}>
            📥 导入技能包
          </button>
        </div>
      </div>

      ${this.skills.length === 0
        ? html`<div class="empty"><div class="icon">🧩</div><div>暂无可用技能</div><div style="margin-top:8px;font-size:0.8rem">点击「导入技能包」添加 .zip 或 .skill 文件</div></div>`
        : html`
            ${installed.length > 0 ? html`
              <div class="section-header">
                <span class="section-title">已安装</span>
                <span class="section-count">${installed.length}</span>
              </div>
              ${installed.map((s) => this.renderSkill(s))}
            ` : ''}

            ${notInstalled.length > 0 ? html`
              <div class="section-header">
                <span class="section-title">可安装</span>
                <span class="section-count">${notInstalled.length}</span>
              </div>
              ${notInstalled.map((s) => this.renderSkill(s))}
            ` : ''}

            ${installed.length === 0 && notInstalled.length === 0 ? html`
              <div class="empty"><div class="icon">📦</div><div>所有技能均已安装</div></div>
            ` : ''}
          `}
    `;
  }
}
