// ====== Sidebar ======
// Side navigation with task list, live status updates, and search.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  getState, subscribe, setView, selectTask, deleteTask,
  createNewSession, switchSession, deleteSession, renameSession,
  setSessionWorkspace, renameWorkspace,
} from '../state';
import type { PageView, Task } from '../types';
import { CALC_TYPE_LABELS } from '../types';
import { showConfirm } from './confirm-dialog';

interface SessionEntry {
  id: string;
  title: string;
  lastInteractionAt: string;
  messageCount: number;
  model?: string;
  workspace?: string;
  workdir?: string;
}

interface NavItem {
  view: PageView;
  label: string;
  icon: string;
}

function getNavLabels(lang: 'zh' | 'en'): NavItem[] {
  return [
    { view: 'chat', label: lang === 'en' ? 'New task' : '新建任务', icon: '💬' },
    { view: 'database', label: lang === 'en' ? 'Paper search' : '论文检索', icon: '🔬' },
    { view: 'skills', label: 'Skills', icon: '🧩' },
    { view: 'workflow', label: lang === 'en' ? 'Built-in workflows' : '内置工作流', icon: '⚙️' },
    { view: 'knowledge', label: lang === 'en' ? 'Wiki' : 'Wiki', icon: '📚' },
    { view: 'usage', label: lang === 'en' ? 'Usage' : '使用情况', icon: '📊' },
    { view: 'settings', label: lang === 'en' ? 'Settings' : '设置', icon: '⚙️' },
  ];
}

@customElement('chemycode-sidebar')
export class Sidebar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: var(--sidebar-width);
      background: var(--color-background-primary);
      border-right: 0.5px solid var(--color-border-tertiary);
      height: calc(100vh - var(--navbar-height));
      flex-shrink: 0;
      transition: width var(--transition-normal);
      overflow: hidden;
    }
    :host(.collapsed) { width: var(--sidebar-collapsed-width); }

    .nav-section { padding: var(--spacing-sm); flex-shrink: 0; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border-radius: var(--border-radius-md);
      cursor: pointer;
      color: var(--color-text-secondary);
      font-size: var(--font-size-base);
      transition: all var(--transition-fast);
      white-space: nowrap;
    }
    .nav-item:hover { background: var(--color-background-tertiary); color: var(--color-text-primary); }
    .nav-item.active { background: var(--color-accent-light); color: var(--color-accent); font-weight: var(--font-weight-medium); }

    .divider { height: 0.5px; background: var(--color-border-tertiary); margin: var(--spacing-xs) var(--spacing-sm); flex-shrink: 0; }
    .search-area { padding: var(--spacing-xxs) var(--spacing-sm) 0; flex-shrink: 0; }
    .search-input {
      width: 100%;
      padding: 6px 10px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: 6px;
      background: var(--color-background-secondary);
      font-size: var(--font-size-sm);
      outline: none;
      box-sizing: border-box;
    }
    .search-input:focus { border-color: var(--color-border-info); }
    .task-label {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--spacing-xs) var(--spacing-sm);
      font-size: var(--font-size-xs);
      color: var(--color-text-tertiary);
      font-weight: var(--font-weight-medium);
      flex-shrink: 0;
    }
    .refresh-btn {
      background: transparent; border: none; cursor: pointer;
      color: var(--color-text-tertiary); padding: 0 4px;
    }
    .refresh-btn:hover { color: var(--color-accent); }
    .refresh-btn.spinning svg { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .task-list { flex: 1; overflow-y: auto; padding: 0 var(--spacing-sm) var(--spacing-sm); }
    .session-list { flex-shrink: 0; max-height: 200px; overflow-y: auto; padding: 0 var(--spacing-sm) var(--spacing-xs); }
    .task-item {
      display: flex; gap: 10px; padding: 8px 10px; border-radius: var(--border-radius-md);
      cursor: pointer; transition: background var(--transition-fast); align-items: flex-start;
    }
    .task-item:hover { background: var(--color-background-tertiary); }
    .task-item.active { background: var(--color-accent-light); }

    .status-icon { flex-shrink: 0; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
    .status-dot { width: 10px; height: 10px; border-radius: 50%; }
    .status-dot.completed { background: var(--color-status-completed); }
    .status-dot.waiting { background: var(--color-status-queued); }
    .status-dot.error { background: var(--color-status-failed); }
    .status-dot.cancelled { background: var(--color-text-tertiary); }
    .spinner {
      width: 12px; height: 12px; border: 2px solid var(--color-border-tertiary);
      border-top-color: var(--color-accent); border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .task-info { flex: 1; min-width: 0; }
    .task-name {
      font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .task-meta { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-top: 2px; }
    .task-actions { display: flex; gap: 2px; flex-shrink: 0; opacity: 0; transition: opacity var(--transition-fast); }
    .task-item:hover .task-actions { opacity: 1; }
    .action-btn {
      width: 22px; height: 22px; border: none; background: transparent;
      border-radius: var(--border-radius-sm); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; color: var(--color-text-tertiary);
    }
    .action-btn:hover { background: var(--color-background-tertiary); color: var(--color-text-primary); }
    .action-btn.danger:hover { color: var(--color-text-danger); }

    .no-tasks { padding: var(--spacing-lg); text-align: center; color: var(--color-text-tertiary); font-size: var(--font-size-sm); }

    .session-item {
      display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: var(--border-radius-md);
      cursor: pointer; transition: background var(--transition-fast); font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
    .session-item:hover { background: var(--color-background-tertiary); }
    .session-item.active { background: var(--color-accent-light); color: var(--color-accent); }
    .session-title {
      flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .session-delete {
      opacity: 0; border: none; background: transparent; cursor: pointer;
      font-size: 10px; color: var(--color-text-tertiary); padding: 2px;
    }
    .session-item:hover .session-delete { opacity: 1; }
    .session-delete:hover { color: var(--color-text-danger); }
    .session-rename-input {
      flex: 1; min-width: 0;
      padding: 2px 6px;
      border: 0.5px solid var(--color-accent);
      border-radius: 4px;
      font-size: var(--font-size-sm);
      background: var(--color-background-primary);
      color: var(--color-text-primary);
      outline: none;
    }
    .session-rename-btn {
      opacity: 0; border: none; background: transparent; cursor: pointer;
      font-size: 10px; color: var(--color-text-tertiary); padding: 2px;
    }
    .session-item:hover .session-rename-btn { opacity: 1; }
    .session-rename-btn:hover { color: var(--color-accent); }
    .new-session-btn {
      display: flex; align-items: center; gap: 6px; padding: 6px 10px; margin: 0 var(--spacing-sm) var(--spacing-xxs);
      border-radius: var(--border-radius-md); cursor: pointer; font-size: var(--font-size-sm);
      color: var(--color-accent); border: 0.5px dashed var(--color-border-secondary);
      background: transparent; transition: all var(--transition-fast);
    }
    .new-session-btn:hover { background: var(--color-accent-light); border-color: var(--color-accent); }

    :host(.collapsed) .nav-label,
    :host(.collapsed) .nav-item span:last-child,
    :host(.collapsed) .search-area,
    :host(.collapsed) .task-label,
    :host(.collapsed) .task-info,
    :host(.collapsed) .task-actions,
    :host(.collapsed) .no-tasks { display: none; }
    :host(.collapsed) .nav-item { justify-content: center; padding: 8px; }
    :host(.collapsed) .task-item { justify-content: center; }

    /* Workspace tree styles */
    .ws-group { margin-bottom: 2px; }
    .ws-header {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 8px; cursor: pointer; border-radius: var(--border-radius-sm);
      font-size: var(--font-size-xs); font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary); user-select: none;
      transition: background var(--transition-fast);
    }
    .ws-header:hover { background: var(--color-background-tertiary); }
    .ws-header .ws-arrow { font-size: 8px; transition: transform 0.15s; width: 10px; text-align: center; }
    .ws-header.collapsed .ws-arrow { transform: rotate(-90deg); }
    .ws-header .ws-icon { font-size: 11px; }
    .ws-header .ws-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ws-header .ws-count { color: var(--color-text-tertiary); font-size: 10px; }
    .ws-header .ws-actions { display: flex; gap: 2px; opacity: 0; transition: opacity var(--transition-fast); }
    .ws-header:hover .ws-actions { opacity: 1; }
    .ws-children { padding-left: 14px; }
    .ws-children.collapsed { display: none; }
    .ws-add-btn {
      width: 100%; text-align: left; padding: 3px 8px 3px 24px;
      border: none; background: transparent; cursor: pointer;
      font-size: var(--font-size-xs); color: var(--color-text-tertiary);
      border-radius: var(--border-radius-sm);
    }
    .ws-add-btn:hover { background: var(--color-background-tertiary); color: var(--color-accent); }
    .ws-rename-input {
      flex: 1; min-width: 0; padding: 1px 4px;
      border: 0.5px solid var(--color-accent); border-radius: 3px;
      font-size: var(--font-size-xs); background: var(--color-background-primary);
      color: var(--color-text-primary); outline: none;
    }
    .ws-move-select {
      font-size: 10px; padding: 1px 3px; border: 0.5px solid var(--color-border-tertiary);
      border-radius: 3px; background: var(--color-background-primary);
      color: var(--color-text-primary);
    }
  `;

  @state() private currentView: PageView = 'chat';
  @state() private collapsed = false;
  @state() private tasks: Task[] = [];
  @state() private selectedTaskId: string | null = null;
  @state() private searchQuery = '';
  @state() private refreshing = false;
  @state() private sessions: Array<{ id: string; title: string; lastInteractionAt: string; messageCount: number; model?: string; workspace?: string; workdir?: string }> = [];
  @state() private activeSessionId: string | null = null;
  @state() private renamingId: string | null = null;
  @state() private renamingValue: string = '';
  @state() private language: 'zh' | 'en' = 'zh';
  @state() private collapsedWorkspaces: Set<string> = new Set();
  @state() private renamingWs: string | null = null;
  @state() private renamingWsValue: string = '';
  @state() private movingSessionId: string | null = null;
  @state() private showMoveMenu: string | null = null;

  private _unsub: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._unsub?.();
    this._unsub = subscribe(() => {
      const s = getState();
      this.currentView = s.currentView;
      this.collapsed = s.sidebarCollapsed;
      this.tasks = s.tasks;
      this.selectedTaskId = s.selectedTaskId;
      this.sessions = s.sessions || [];
      this.activeSessionId = s.activeSessionId;
      this.language = s.language;
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsub = null;
  }

  private get filteredTasks(): Task[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.tasks;
    return this.tasks.filter(
      (t) => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
    );
  }

  private async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const { refreshTasks } = await import('../state');
      await refreshTasks();
    } finally {
      this.refreshing = false;
    }
  }

  private async confirmDelete(t: Task, e: Event) {
    e.stopPropagation();
    const ok = await showConfirm({
      title: this.language === 'en' ? 'Delete task' : '删除任务',
      message: this.language === 'en' ? `Delete task "${t.name}"? This action cannot be undone.` : `确定删除任务「${t.name}」吗？此操作无法撤销。`,
      confirmText: this.language === 'en' ? 'Delete' : '删除',
      destructive: true,
    });
    if (ok) await deleteTask(t.id);
  }

  /** Toggle workspace collapse state. */
  private toggleWsCollapse(wsName: string, e: Event) {
    e.stopPropagation();
    const next = new Set(this.collapsedWorkspaces);
    if (next.has(wsName)) next.delete(wsName);
    else next.add(wsName);
    this.collapsedWorkspaces = next;
  }

  /** Start renaming a workspace. */
  private startRenameWs(wsName: string, e: Event) {
    e.stopPropagation();
    this.renamingWs = wsName;
    this.renamingWsValue = wsName;
  }

  /** Commit workspace rename. */
  private commitRenameWs(oldName: string) {
    const newName = this.renamingWsValue.trim();
    if (newName && newName !== oldName) {
      renameWorkspace(oldName, newName);
    }
    this.renamingWs = null;
  }

  /** Move session to a different workspace (or remove from workspace). */
  private moveSessionToWorkspace(sessionId: string, wsName: string | null) {
    setSessionWorkspace(sessionId, wsName);
    this.showMoveMenu = null;
  }

  /** Get sessions grouped by workspace. Returns { workspaceName: sessions[], null: sessions[] }. */
  private get groupedSessions(): { workspaces: Array<{ name: string; sessions: SessionEntry[] }>; ungrouped: SessionEntry[] } {
    const wsMap = new Map<string, SessionEntry[]>();
    const ungrouped: SessionEntry[] = [];
    for (const s of this.sessions) {
      if (s.workspace) {
        if (!wsMap.has(s.workspace)) wsMap.set(s.workspace, []);
        wsMap.get(s.workspace)!.push(s);
      } else {
        ungrouped.push(s);
      }
    }
    return {
      workspaces: Array.from(wsMap.entries()).map(([name, sessions]) => ({ name, sessions })),
      ungrouped,
    };
  }

  /** Render a single session item with optional move-to-workspace dropdown. */
  private renderSessionItem(s: SessionEntry) {
    const isActive = this.activeSessionId === s.id;
    const isRenaming = this.renamingId === s.id;
    const isMoving = this.showMoveMenu === s.id;
    const wsNames = this.groupedSessions.workspaces.map((w) => w.name);
    return html`
      <div class="session-item ${isActive ? 'active' : ''}" @click=${() => !isRenaming && !isMoving && switchSession(s.id)}>
        <span>💬</span>
        ${isRenaming
          ? html`
              <input class="session-rename-input"
                .value=${this.renamingValue}
                @input=${(e: InputEvent) => this.renamingValue = (e.target as HTMLInputElement).value}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === 'Enter') { renameSession(s.id, this.renamingValue); this.renamingId = null; }
                  if (e.key === 'Escape') this.renamingId = null;
                }}
                @blur=${() => { renameSession(s.id, this.renamingValue); this.renamingId = null; }}
                />
            `
          : html`
              <span class="session-title">${s.title || (this.language === 'en' ? 'New chat' : '新对话')}</span>
              <button class="session-rename-btn" title=${this.language === 'en' ? 'Rename' : '重命名'} @click=${(e: Event) => { e.stopPropagation(); this.renamingId = s.id; this.renamingValue = s.title || (this.language === 'en' ? 'New chat' : '新对话'); }}>✏️</button>
              <button class="session-rename-btn" title=${this.language === 'en' ? 'Move to workspace' : '移动到工作空间'} @click=${(e: Event) => { e.stopPropagation(); this.showMoveMenu = isMoving ? null : s.id; }}>📁</button>
              <button class="session-delete" title=${this.language === 'en' ? 'Delete' : '删除'} @click=${(e: Event) => { e.stopPropagation(); deleteSession(s.id); }}>✕</button>
            `}
      </div>
      ${isMoving ? html`
        <div style="padding: 2px 10px 4px 32px; display: flex; flex-direction: column; gap: 2px; background: var(--color-background-secondary); border-radius: var(--border-radius-sm); margin: 2px 8px;">
          <button class="ws-add-btn" @click=${() => this.moveSessionToWorkspace(s.id, null)} style="padding-left: 6px;">
            ${s.workspace ? '📤 ' + (this.language === 'en' ? 'Remove from workspace' : '移出工作空间') : '✓ ' + (this.language === 'en' ? 'No workspace' : '无工作空间')}
          </button>
          ${wsNames.map((wn) => html`
            <button class="ws-add-btn" @click=${() => this.moveSessionToWorkspace(s.id, wn)} style="padding-left: 6px; ${s.workspace === wn ? 'color: var(--color-accent); font-weight: var(--font-weight-medium);' : ''}">
              ${s.workspace === wn ? '✓ ' : '📁 '}${wn}
            </button>
          `)}
          <input class="ws-rename-input" style="margin: 2px 0 4px 0; padding: 3px 6px;"
            placeholder=${this.language === 'en' ? 'New workspace name...' : '新工作空间名称...'}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                const val = (e.target as HTMLInputElement).value.trim();
                if (val) this.moveSessionToWorkspace(s.id, val);
              }
              if (e.key === 'Escape') this.showMoveMenu = null;
            }}
            @blur=${(e: Event) => { const val = (e.target as HTMLInputElement).value.trim(); if (val) this.moveSessionToWorkspace(s.id, val); this.showMoveMenu = null; }}
          />
        </div>
      ` : ''}
    `;
  }

  render() {
    const navItems = getNavLabels(this.language);
    const { workspaces, ungrouped } = this.groupedSessions;
    return html`
      <div class="nav-section">
        ${navItems.map((item) => html`
          <div class="nav-item ${this.currentView === item.view ? 'active' : ''}"
               @click=${() => item.view === 'chat' ? setView('chat') : setView(item.view)}>
            <span>${item.icon}</span>
            <span>${item.label}</span>
          </div>
        `)}
      </div>

      <div class="divider"></div>

      <button class="new-session-btn" @click=${() => createNewSession()}>
        ＋ ${this.language === 'en' ? 'New chat' : '新建对话'}
      </button>

      <div class="task-label">
        <span>${this.language === 'en' ? 'Chat list' : '对话列表'}</span>
      </div>

      <div class="session-list" style="max-height: 350px;">
        ${this.sessions.length === 0
          ? html`<div class="no-tasks">${this.language === 'en' ? 'No chats yet' : '暂无对话'}</div>`
          : html`
            <!-- Workspace groups -->
            ${workspaces.map((ws) => {
              const isCollapsed = this.collapsedWorkspaces.has(ws.name);
              const isRenamingWs = this.renamingWs === ws.name;
              return html`
                <div class="ws-group">
                  <div class="ws-header ${isCollapsed ? 'collapsed' : ''}" @click=${(e: Event) => this.toggleWsCollapse(ws.name, e)}>
                    <span class="ws-arrow">▼</span>
                    <span class="ws-icon">📂</span>
                    ${isRenamingWs
                      ? html`<input class="ws-rename-input"
                          .value=${this.renamingWsValue}
                          @click=${(e: Event) => e.stopPropagation()}
                          @input=${(e: InputEvent) => this.renamingWsValue = (e.target as HTMLInputElement).value}
                          @keydown=${(e: KeyboardEvent) => {
                            if (e.key === 'Enter') this.commitRenameWs(ws.name);
                            if (e.key === 'Escape') this.renamingWs = null;
                          }}
                          @blur=${() => this.commitRenameWs(ws.name)}
                        />`
                      : html`<span class="ws-name">${ws.name}</span>`
                    }
                    <span class="ws-count">${ws.sessions.length}</span>
                    ${!isRenamingWs ? html`
                      <div class="ws-actions">
                        <button class="action-btn" title=${this.language === 'en' ? 'Rename workspace' : '重命名工作空间'} @click=${(e: Event) => this.startRenameWs(ws.name, e)}>✏️</button>
                      </div>
                    ` : ''}
                  </div>
                  <div class="ws-children ${isCollapsed ? 'collapsed' : ''}">
                    ${ws.sessions.map((s) => this.renderSessionItem(s))}
                  </div>
                </div>
              `;
            })}

            <!-- Ungrouped sessions (no workspace) -->
            ${ungrouped.length > 0 || workspaces.length === 0
              ? html`
                ${workspaces.length > 0
                  ? html`<div class="ws-header" style="padding-left: 4px;">
                      <span class="ws-arrow" style="visibility:hidden;">▼</span>
                      <span class="ws-icon">💬</span>
                      <span class="ws-name">${this.language === 'en' ? 'Tasks' : '任务'}</span>
                      <span class="ws-count">${ungrouped.length}</span>
                    </div>
                    <div class="ws-children" style="padding-left: 14px;">`
                  : ''
                }
                ${ungrouped.map((s) => this.renderSessionItem(s))}
                ${workspaces.length > 0 ? html`</div>` : ''}
              `
              : ''
            }
          `}
      </div>

      <div class="divider"></div>

      <div class="search-area">
        <input class="search-input" type="text" placeholder=${this.language === 'en' ? 'Search tasks…' : '搜索任务…'}
          .value=${this.searchQuery}
          @input=${(e: InputEvent) => this.searchQuery = (e.target as HTMLInputElement).value} />
      </div>

      <div class="task-label">
        <span>${this.language === 'en' ? 'Recent tasks' : '最近任务'}</span>
        <button class="refresh-btn ${this.refreshing ? 'spinning' : ''}" @click=${() => this.refresh()} title=${this.language === 'en' ? 'Refresh' : '刷新'}>
          ↻
        </button>
      </div>

      <div class="task-list">
        ${this.filteredTasks.length === 0
          ? html`<div class="no-tasks">${this.searchQuery ? (this.language === 'en' ? 'No matching tasks' : '无匹配任务') : (this.language === 'en' ? 'No tasks yet' : '暂无任务')}</div>`
          : this.filteredTasks.map((t) => {
              const statusIcon = t.status === 'running'
                ? html`<div class="spinner"></div>`
                : html`<div class="status-dot ${t.status}"></div>`;
              const isActive = this.currentView === 'task-detail' && this.selectedTaskId === t.id;
              return html`
                <div class="task-item ${isActive ? 'active' : ''}" @click=${() => selectTask(t.id)}>
                  <div class="status-icon">${statusIcon}</div>
                  <div class="task-info">
                    <div class="task-name">${t.name}</div>
                    <div class="task-meta">${CALC_TYPE_LABELS[t.calcType]} · ${t.createdAt}</div>
                  </div>
                  <div class="task-actions">
                    <button class="action-btn" title=${this.language === 'en' ? 'View' : '查看'} @click=${(e: Event) => { e.stopPropagation(); selectTask(t.id); }}>👁</button>
                    <button class="action-btn danger" title=${this.language === 'en' ? 'Delete' : '删除'} @click=${(e: Event) => this.confirmDelete(t, e)}>🗑</button>
                  </div>
                </div>
              `;
            })}
      </div>
    `;
  }
}
