// ====== Task Detail View ======
// Real-time task details. Auto-refreshes when running, polls for live updates.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getState, subscribe, setView } from '../state';
import type { Task } from '../types';
import { CALC_TYPE_LABELS, STATUS_LABELS } from '../types';
import { getActiveClient } from '../api/mock';
import { showError, showSuccess } from '../components/toast';
import { showConfirm } from '../components/confirm-dialog';

type DetailTab = 'parameters' | 'info' | 'files' | 'visualization';

@customElement('task-detail-view')
export class TaskDetailView extends LitElement {
  static styles = css`
    :host { display: flex; height: 100%; }

    .tab-sidebar {
      width: 160px;
      flex-shrink: 0;
      background: var(--color-background-primary);
      border-right: 0.5px solid var(--color-border-tertiary);
      padding: var(--spacing-sm) 0;
    }
    .tab-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px var(--spacing-md);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
      border-left: 3px solid transparent;
    }
    .tab-item:hover { background: var(--color-background-secondary); color: var(--color-text-primary); }
    .tab-item.active {
      background: var(--color-accent-light);
      color: var(--color-accent);
      border-left-color: var(--color-accent);
      font-weight: var(--font-weight-medium);
    }
    .back-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px var(--spacing-md);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      cursor: pointer;
      border-bottom: 0.5px solid var(--color-border-tertiary);
      margin-bottom: var(--spacing-xs);
    }
    .back-btn:hover { color: var(--color-accent); }

    .content-area {
      flex: 1;
      padding: var(--spacing-lg);
      overflow-y: auto;
    }

    .card {
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-md);
      margin-bottom: var(--spacing-md);
    }
    .card-title {
      font-size: var(--font-size-lg);
      font-weight: var(--font-weight-medium);
      margin-bottom: var(--spacing-sm);
      padding-bottom: var(--spacing-xs);
      border-bottom: 0.5px solid var(--color-border-tertiary);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 6px 0;
      font-size: var(--font-size-base);
      border-bottom: 0.5px solid var(--color-border-tertiary);
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: var(--color-text-secondary); }
    .info-value { font-weight: var(--font-weight-medium); text-align: right; max-width: 60%; word-break: break-all; }

    .job-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 0.5px solid var(--color-border-tertiary);
    }
    .job-item:last-child { border-bottom: none; }
    .job-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .job-dot.completed { background: var(--color-status-completed); }
    .job-dot.waiting { background: var(--color-status-queued); }
    .job-dot.error { background: var(--color-status-failed); }
    .job-spinner {
      width: 10px; height: 10px;
      border: 2px solid var(--color-border-tertiary);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .job-name { flex: 1; font-size: var(--font-size-sm); }
    .job-detail { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }

    .file-item {
      display: flex; align-items: center; gap: var(--spacing-xs);
      padding: 6px 0;
      cursor: pointer;
      font-size: var(--font-size-sm);
      color: var(--color-accent);
    }
    .file-item:hover { text-decoration: underline; }

    .placeholder {
      height: 200px;
      background: var(--color-background-secondary);
      border-radius: var(--border-radius-md);
      display: flex; align-items: center; justify-content: center;
      color: var(--color-text-tertiary);
      font-size: var(--font-size-sm);
    }

    .not-found { padding: var(--spacing-xl); text-align: center; color: var(--color-text-tertiary); }

    .actions { display: flex; gap: 8px; }
    .actions button {
      padding: 4px 12px; border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-sm); background: transparent;
      cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-secondary);
    }
    .actions button:hover { border-color: var(--color-accent); color: var(--color-accent); }
    .actions button.danger:hover { border-color: var(--color-text-danger); color: var(--color-text-danger); }
  `;

  @state() private task: Task | null = null;
  @state() private activeTab: DetailTab = 'info';
  @state() private loading = false;

  private pollTimer: number | null = null;

  connectedCallback() {
    super.connectedCallback();
    subscribe(() => {
      const s = getState();
      this.task = s.tasks.find((t) => t.id === s.selectedTaskId) || null;
      if (this.task?.status === 'running' || this.task?.status === 'waiting') {
        this.ensurePolling();
      } else {
        this.stopPolling();
      }
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopPolling();
  }

  private ensurePolling() {
    if (this.pollTimer !== null) return;
    this.pollTimer = window.setInterval(() => this.refresh(), 5000);
  }

  private stopPolling() {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async refresh() {
    if (!this.task) return;
    this.loading = true;
    const client = getActiveClient();
    const r = await client.tasks.get(this.task.id);
    this.loading = false;
    if (r.ok) {
      // Update tasks array with the fresh task.
      const fresh = r.value as Task;
      const s = getState();
      const tasks: Task[] = s.tasks.map((t) => (t.id === fresh.id ? fresh : t));
      // Use updateState to keep the rest of the UI in sync.
      import('../state').then(({ updateState }) => updateState({ tasks }));
      this.task = fresh;
    }
  }

  private async cancelTask() {
    if (!this.task) return;
    const ok = await showConfirm({
      title: '取消任务',
      message: `确定取消任务「${this.task.name}」吗？`,
      confirmText: '取消任务',
      destructive: true,
    });
    if (!ok) return;
    const client = getActiveClient();
    const r = await client.tasks.cancel(this.task.id);
    if (r.ok) {
      showSuccess('任务已取消');
      await this.refresh();
    } else {
      showError(r.error.message);
    }
  }

  private async deleteTask() {
    if (!this.task) return;
    const ok = await showConfirm({
      title: '删除任务',
      message: `确定删除任务「${this.task.name}」吗？`,
      confirmText: '删除',
      destructive: true,
    });
    if (!ok) return;
    const { deleteTask } = await import('../state');
    await deleteTask(this.task.id);
    setView('chat');
  }

  render() {
    if (!this.task) {
      return html`<div class="not-found"><p>任务未找到</p></div>`;
    }
    const t = this.task;

    const tabs: { id: DetailTab; label: string; icon: string }[] = [
      { id: 'info', label: '任务基本信息', icon: '📋' },
      { id: 'parameters', label: '计算参数', icon: '⚙️' },
      { id: 'files', label: '输出文件列表', icon: '📄' },
      { id: 'visualization', label: '可视化', icon: '📊' },
    ];

    return html`
      <div class="tab-sidebar">
        <div class="back-btn" @click=${() => setView('chat')}>← 退出</div>
        ${tabs.map((tab) => html`
          <div class="tab-item ${this.activeTab === tab.id ? 'active' : ''}"
            @click=${() => this.activeTab = tab.id}>
            ${tab.icon} ${tab.label}
          </div>
        `)}
      </div>

      <div class="content-area">
        ${this.activeTab === 'info' ? html`
          <div class="card">
            <div class="card-title">
              <span>${t.name}</span>
              <div class="actions">
                ${t.status === 'running' || t.status === 'waiting'
                  ? html`<button @click=${() => this.cancelTask()}>⏸ 取消</button>`
                  : ''}
                <button class="danger" @click=${() => this.deleteTask()}>🗑 删除</button>
              </div>
            </div>
            <div class="info-row"><span class="info-label">任务ID</span><span class="info-value">${t.id}</span></div>
            <div class="info-row"><span class="info-label">计算类型</span><span class="info-value">${CALC_TYPE_LABELS[t.calcType]}</span></div>
            <div class="info-row">
              <span class="info-label">状态</span>
              <span class="info-value" style="color:${t.status === 'running' ? 'var(--color-status-running)' : t.status === 'error' ? 'var(--color-status-failed)' : t.status === 'waiting' ? 'var(--color-status-queued)' : 'var(--color-status-completed)'}">
                ${STATUS_LABELS[t.status]}${t.progress !== undefined ? ` · ${t.progress}%` : ''}
              </span>
            </div>
            <div class="info-row"><span class="info-label">描述</span><span class="info-value">${t.description || '-'}</span></div>
            <div class="info-row"><span class="info-label">创建时间</span><span class="info-value">${t.createdAt}</span></div>
            ${t.completedAt ? html`<div class="info-row"><span class="info-label">完成时间</span><span class="info-value">${t.completedAt}</span></div>` : ''}
          </div>

          ${t.jobs ? html`
            <div class="card">
              <div class="card-title">作业步骤</div>
              ${t.jobs.map((j) => html`
                <div class="job-item">
                  ${j.status === 'running'
                    ? html`<div class="job-spinner"></div>`
                    : html`<div class="job-dot ${j.status}"></div>`}
                  <span class="job-name">${j.name}</span>
                  ${j.detail ? html`<span class="job-detail">${j.detail}</span>` : ''}
                </div>
              `)}
            </div>
          ` : ''}
        ` : ''}

        ${this.activeTab === 'parameters' ? html`
          <div class="card">
            <div class="card-title">计算参数</div>
            <div class="info-row"><span class="info-label">力场</span><span class="info-value">${t.forceField || '-'}</span></div>
            <div class="info-row"><span class="info-label">温度</span><span class="info-value">${t.temperature ? t.temperature + ' K' : '-'}</span></div>
            <div class="info-row"><span class="info-label">压力</span><span class="info-value">${t.pressure ? t.pressure + ' bar' : '-'}</span></div>
            <div class="info-row"><span class="info-label">时间步长</span><span class="info-value">${t.timeStep ? t.timeStep + ' fs' : '-'}</span></div>
            <div class="info-row"><span class="info-label">总步数</span><span class="info-value">${t.totalSteps ? t.totalSteps.toLocaleString() : '-'}</span></div>
            ${t.parameters
              ? Object.entries(t.parameters).map(([k, v]) => html`
                  <div class="info-row"><span class="info-label">${k}</span><span class="info-value">${v}</span></div>
                `)
              : ''}
          </div>
        ` : ''}

        ${this.activeTab === 'files' ? html`
          <div class="card">
            <div class="card-title">输出文件</div>
            ${t.outputFiles && t.outputFiles.length > 0
              ? t.outputFiles.map((f) => html`<div class="file-item">📄 ${f}</div>`)
              : html`<div class="text-muted" style="font-size:var(--font-size-sm)">暂无输出文件</div>`}
          </div>
        ` : ''}

        ${this.activeTab === 'visualization' ? html`
          <div class="card">
            <div class="card-title">可视化</div>
            <div class="placeholder">🔬 可视化区域（待实现）</div>
          </div>
        ` : ''}
      </div>
    `;
  }
}
