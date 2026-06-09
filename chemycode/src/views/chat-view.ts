// ====== Chat View ======
// Real-time conversation interface. Replaces the mock setTimeout loop in the
// original implementation with:
//
//   - sendMessage() in state.ts pushes the user msg + opens the stream
//   - stream.ts delivers tagged events: text_delta, tool_call_*, file,
//     confirm_request, error, done
//   - The agent message is rendered as a single ChatMessage whose `content`
//     grows as text_delta events arrive (typing cursor + animation)
//   - Tool invocations get their own <chemycode-tool-call-card> in the timeline
//   - Files become <chemycode-code-block> cards in the agent message
//   - confirm_request becomes a sticky bar at the bottom of the message list

import { LitElement, html, css, type PropertyValues } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import {
  getState,
  subscribe,
  sendMessage,
  respondToConfirm,
  dismissConfirm,
  refreshTasks,
  stopGeneration,
} from '../state';
import type { ChatMessage, ConfiguredModel, GeneratedFile } from '../types';
import '../components/markdown-renderer';
import '../components/tool-call-card';
import '../components/thinking-block';
import '../components/code-block';

@customElement('chat-view')
export class ChatView extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      max-width: 960px;
      margin: 0 auto;
      width: 100%;
    }

    .messages-area {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-md) var(--spacing-lg);
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm);
    }

    .message { display: flex; gap: var(--spacing-xs); max-width: 85%; animation: fadeIn 0.2s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .message.user { align-self: flex-end; flex-direction: row-reverse; }
    .message.agent { align-self: flex-start; }
    .message.system { align-self: center; max-width: 100%; }
    .message.tool { align-self: flex-start; max-width: 95%; }

    .msg-avatar {
      width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px;
    }
    .message.user .msg-avatar { background: var(--color-accent); color: white; }
    .message.agent .msg-avatar { background: var(--color-background-tertiary); color: var(--color-text-secondary); }

    .msg-content { min-width: 0; max-width: 100%; }
    .msg-bubble {
      padding: 10px 14px;
      border-radius: var(--border-radius-md);
      font-size: var(--font-size-base);
      line-height: 1.6;
      word-break: break-word;
    }
    .message.user .msg-bubble { background: var(--color-accent); color: white; border-bottom-right-radius: 4px; }
    .message.agent .msg-bubble { background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-bottom-left-radius: 4px; color: var(--color-text-primary); }
    .message.system .msg-bubble { background: var(--color-background-warning); color: var(--color-text-warning); font-size: var(--font-size-sm); text-align: center; border-radius: 100px; padding: 6px 16px; border: 0.5px solid var(--color-border-warning); }
    .message.tool .msg-bubble { padding: 0; background: transparent; border: none; }
    .msg-time { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-top: 4px; padding: 0 4px; }

    .msg-meta {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      margin-top: 4px; padding: 2px 4px;
      font-size: 11px; color: var(--color-text-tertiary);
      font-family: var(--font-mono);
    }
    .meta-item {
      padding: 1px 5px;
      background: var(--color-background-tertiary);
      border-radius: 4px;
      white-space: nowrap;
    }
    .meta-model {
      padding: 1px 5px;
      background: var(--color-accent-light);
      color: var(--color-accent);
      border-radius: 4px;
      font-weight: 500;
      white-space: nowrap;
    }

    .typing-cursor {
      display: inline-block;
      width: 6px; height: 14px;
      background: var(--color-text-tertiary);
      margin-left: 2px;
      vertical-align: text-bottom;
      animation: blink 1s steps(1) infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }

    .file-block {
      margin-top: var(--spacing-xs);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      overflow: hidden;
    }
    .file-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 12px;
      background: #1e1e2e;
      font-size: var(--font-size-xs);
      color: #a0a0b0;
    }
    .file-actions { display: flex; gap: 6px; }
    .file-action-btn {
      background: transparent; border: none; color: #a0a0b0;
      cursor: pointer; padding: 2px 8px;
      border-radius: var(--border-radius-sm); font-size: var(--font-size-xs);
    }
    .file-action-btn:hover { background: rgba(255,255,255,0.1); color: white; }
    .file-preview {
      padding: 8px 12px;
      background: #282a36;
      max-height: 180px;
      overflow: auto;
      font-family: var(--font-mono);
      font-size: var(--font-size-xs);
      color: #f8f8f2;
      line-height: 1.5;
      white-space: pre;
    }

    .confirm-overlay {
      position: sticky;
      bottom: 0;
      padding: var(--spacing-sm) var(--spacing-lg);
      background: linear-gradient(transparent, var(--color-background-secondary) 20%);
      z-index: 10;
    }
    .confirm-box {
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-info);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-md);
      box-shadow: var(--shadow-md);
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }
    .confirm-text { flex: 1; font-size: var(--font-size-sm); color: var(--color-text-primary); }
    .confirm-actions { display: flex; gap: var(--spacing-xs); flex-shrink: 0; }
    .confirm-btn {
      padding: 6px 16px; border: none; border-radius: var(--border-radius-md);
      font-size: var(--font-size-sm); cursor: pointer; font-weight: var(--font-weight-medium);
    }
    .confirm-btn.accept { background: var(--color-accent); color: white; }
    .confirm-btn.accept:hover { background: var(--color-accent-hover); }
    .confirm-btn.reject { background: transparent; border: 0.5px solid var(--color-border-secondary); color: var(--color-text-secondary); }
    .confirm-btn.reject:hover { background: var(--color-background-tertiary); }

    .input-area {
      padding: var(--spacing-sm) var(--spacing-lg);
      border-top: 0.5px solid var(--color-border-tertiary);
      background: var(--color-background-primary);
    }
    .input-row { display: flex; gap: var(--spacing-xs); align-items: flex-end; }
    .input-row textarea {
      flex: 1; padding: 10px 12px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      resize: none;
      font-size: var(--font-size-base);
      font-family: inherit;
      outline: none;
      min-height: 42px; max-height: 120px;
      line-height: 1.5;
      background: var(--color-background-secondary);
      color: var(--color-text-primary);
    }
    .input-row textarea:focus { border-color: var(--color-accent); background: var(--color-background-primary); }
    .input-row textarea::placeholder { color: var(--color-text-tertiary); }
    .input-row textarea:disabled { opacity: 0.6; }

    .input-tools {
      display: flex; gap: var(--spacing-xxs);
      margin-top: var(--spacing-xs);
      align-items: center;
      position: relative;
    }

    .skill-panel {
      position: absolute;
      bottom: 100%;
      left: 0;
      margin-bottom: 8px;
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-lg);
      padding: 12px;
      box-shadow: var(--shadow-lg);
      z-index: 100;
      min-width: 320px;
    }
    .skill-panel h4 {
      margin: 0 0 8px 0;
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
    }
    .skill-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .skill-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-md);
      background: transparent;
      cursor: pointer;
      width: 100%;
      text-align: left;
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      transition: all 0.15s ease;
    }
    .skill-item:hover {
      border-color: var(--color-accent);
      background: var(--color-accent-light);
    }
    .skill-item .skill-icon { font-size: 18px; flex-shrink: 0; }
    .skill-item .skill-label { font-weight: 500; }
    .skill-item .skill-script { font-size: var(--font-size-xs); color: var(--color-text-tertiary); margin-top: 2px; }
    .skill-btn-active { background: var(--color-accent-light) !important; color: var(--color-accent) !important; border-color: var(--color-accent) !important; }
    .tool-btn {
      padding: 4px 10px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-sm);
      background: transparent;
      color: var(--color-text-tertiary);
      cursor: pointer;
      font-size: var(--font-size-xs);
    }
    .tool-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
    .tool-btn.active { background: var(--color-accent-light); color: var(--color-accent); border-color: var(--color-accent); }

    .model-selector {
      margin-left: auto; display: flex; align-items: center; gap: 6px;
      font-size: var(--font-size-sm); color: var(--color-text-secondary);
    }
    .model-selector select {
      padding: 4px 8px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-sm);
      background: var(--color-background-primary);
      color: var(--color-text-primary);
      font-size: var(--font-size-sm);
      outline: none;
      cursor: pointer;
    }

    .send-btn {
      width: 42px; height: 42px;
      border: none; border-radius: var(--border-radius-md);
      background: var(--color-accent); color: white;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .send-btn:hover:not(:disabled) { background: var(--color-accent-hover); }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .stop-btn {
      width: 42px; height: 42px;
      border: none; border-radius: var(--border-radius-md);
      background: var(--color-text-danger); color: white;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      font-size: 16px;
    }
    .stop-btn:hover { background: #e53935; }

    .typing-indicator { display: flex; gap: 4px; padding: 10px 14px; background: var(--color-background-primary); border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); border-bottom-left-radius: 4px; align-self: flex-start; }
    @keyframes bounce { 0%, 80%, 100% { transform: scale(0.6); } 40% { transform: scale(1); } }
    .typing-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--color-text-tertiary);
      animation: bounce 1.4s ease-in-out infinite;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }

    .attach-strip {
      display: flex; flex-wrap: wrap; gap: 6px;
      margin-bottom: 6px;
    }
    .attach-chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 8px;
      background: var(--color-background-tertiary);
      border-radius: 100px;
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }
    .attach-chip button {
      background: transparent; border: none; cursor: pointer;
      color: var(--color-text-tertiary); padding: 0;
    }
    .attach-chip button:hover { color: var(--color-text-danger); }

    .empty-hint {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
      color: var(--color-text-tertiary);
    }
    .empty-hint h2 { font-size: 18px; color: var(--color-text-secondary); margin-bottom: 8px; }
    .empty-hint p { font-size: 13px; line-height: 1.6; }
    .empty-hint .examples { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 600px; }
    .empty-hint .example {
      padding: 6px 12px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: 100px;
      font-size: 12px;
      cursor: pointer;
      background: var(--color-background-primary);
      transition: all 0.15s;
    }
    .empty-hint .example:hover { border-color: var(--color-accent); color: var(--color-accent); }
  `;

  @state() private messages: ChatMessage[] = [];
  @state() private showConfirm = false;
  @state() private confirmPrompt = '';
  @state() private confirmOptions: { id: string; label: string; destructive?: boolean }[] = [];
  @state() private models: ConfiguredModel[] = [];
  @state() private selectedModel: string = '';
  @state() private thinkingMode: 'off' | 'low' | 'medium' | 'high' = 'off';
  @state() private workspacePath: string = '';
  @state() private workspaceLocked: boolean = false;
  @state() private showWorkspaceBrowser = false;
  @state() private browsePath: string = '';
  @state() private browseDirs: Array<{ name: string; path: string }> = [];
  @state() private browseParent: string | null = null;
  @state() private browseLoading = false;
  @state() private pendingAttachments: { id: string; filename: string; size: number }[] = [];
  @state() private typingMessageId: string | null = null;

  @query('textarea') private inputEl!: HTMLTextAreaElement;
  @query('.messages-area') private messagesArea?: HTMLElement;

  private _unsub: (() => void) | null = null;
  private _scrollObserver: MutationObserver | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._unsub?.();
    this._unsub = subscribe(() => {
      const s = getState();
      this.messages = s.chatMessages;
      this.models = s.configuredModels;
      // Auto-select default model if none selected.
      if (!this.selectedModel && s.configuredModels.length > 0) {
        const def = s.configuredModels.find((m) => m.isDefault);
        this.selectedModel = def ? def.name : s.configuredModels[0].name;
      }
      this.showConfirm = !!s.pendingConfirm;
      if (s.pendingConfirm) {
        this.confirmPrompt = s.pendingConfirm.prompt;
        this.confirmOptions = s.pendingConfirm.options;
      }
      this.typingMessageId = s.typingMessageId;
    });
    // If models haven't loaded yet, trigger a refresh (but not during bootstrap).
    if (getState().configuredModels.length === 0 && !getState().isLoading) {
      void this.ensureModelsLoaded();
    }
  }

  private async ensureModelsLoaded() {
    try {
      const { getClient } = await import('../state');
      const client = await getClient();
      const r = await client.models.list();
      if (r.ok && r.value.length > 0) {
        const { updateState } = await import('../state');
        updateState({ configuredModels: r.value });
      }
    } catch (e) {
      console.warn('[chat-view] Failed to load models:', e);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsub = null;
    this._scrollObserver?.disconnect();
    this._scrollObserver = null;
  }

  protected firstUpdated(_: PropertyValues) {
    this.scrollToBottom();
    // Watch for DOM mutations in the messages area for reliable auto-scroll
    // during streaming (text_delta updates content without changing the array reference).
    if (this.messagesArea) {
      this._scrollObserver = new MutationObserver(() => this.scrollToBottom());
      this._scrollObserver.observe(this.messagesArea, { childList: true, subtree: true, characterData: true });
    }
  }

  protected updated(changed: PropertyValues) {
    // Always auto-scroll to bottom when messages or typing state changes.
    // Use scrollIntoView on the last element for reliable positioning.
    if (changed.has('messages') || changed.has('typingMessageId')) {
      this.scrollToBottom();
    }
  }

  private scrollToBottom() {
    if (!this.messagesArea) return;
    requestAnimationFrame(() => {
      if (!this.messagesArea) return;
      // Try scrollIntoView on the last message element first (most reliable).
      const lastMsg = this.messagesArea.querySelector('.message:last-child, .typing-indicator:last-child');
      if (lastMsg) {
        lastMsg.scrollIntoView({ behavior: 'instant', block: 'end' });
      } else {
        this.messagesArea.scrollTop = this.messagesArea.scrollHeight;
      }
    });
  }

  // ---------- Send message ----------

  private async handleSend() {
    if (!this.inputEl) return;
    const text = this.inputEl.value.trim();
    if (!text) return;
    const attachIds = this.pendingAttachments.map((a) => a.id);
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    const atts = this.pendingAttachments;
    this.pendingAttachments = [];
    // Lock workspace on first send (once set, it doesn't change for this session).
    if (this.workspacePath && !this.workspaceLocked) {
      this.workspaceLocked = true;
    }
    await sendMessage(text, { model: this.selectedModel, attachments: attachIds, thinking: this.thinkingMode !== 'off' ? this.thinkingMode : undefined, workspace: this.workspacePath || undefined, activeSkill: this.activeSkill || undefined });
    // Refresh tasks in the sidebar in case a new task was created.
    void refreshTasks();
    if (atts.length) {
      // Optimistically clear attachments in case backend is slow.
    }
  }

  private onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.handleSend();
    }
  }

  private autoResize(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  // ---------- File attachments ----------

  private async toggleWorkspaceBrowser() {
    if (this.showWorkspaceBrowser) {
      this.showWorkspaceBrowser = false;
      return;
    }
    this.showWorkspaceBrowser = true;
    this.browsePath = this.workspacePath || '';
    await this.browseTo(this.browsePath);
  }

  private async browseTo(dirPath: string) {
    this.browseLoading = true;
    try {
      const { api } = await import('../api/client');
      const r = await api.get<any>('/system/browse', { query: { path: dirPath || undefined } });
      if (r.ok) {
        this.browsePath = r.value.current;
        this.browseDirs = r.value.directories || [];
        this.browseParent = r.value.parent;
      }
    } finally {
      this.browseLoading = false;
    }
  }

  private selectWorkspace(dirPath: string) {
    this.workspacePath = dirPath;
    this.showWorkspaceBrowser = false;
  }

  private renderWorkspaceBrowser() {
    return html`
      <div style="position:absolute;bottom:100%;left:0;right:0;margin-bottom:4px;background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);box-shadow:var(--shadow-md);max-height:280px;display:flex;flex-direction:column;z-index:100;">
        <div style="padding:6px 10px;border-bottom:0.5px solid var(--color-border-tertiary);display:flex;align-items:center;gap:6px;font-size:var(--font-size-xs);color:var(--color-text-secondary);">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.browsePath || '/'}</span>
          <button class="tool-btn" @click=${() => this.selectWorkspace(this.browsePath)} title="选择当前目录">✅ 选择</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:4px;">
          ${this.browseParent ? html`
            <div class="session-item" style="padding:4px 8px;font-size:var(--font-size-xs);cursor:pointer;"
              @click=${() => this.browseTo(this.browseParent!)}>
              📁 ..
            </div>
          ` : ''}
          ${this.browseLoading ? html`<div style="padding:8px;text-align:center;color:var(--color-text-tertiary);font-size:var(--font-size-xs);">加载中...</div>` :
            this.browseDirs.length === 0 ? html`<div style="padding:8px;text-align:center;color:var(--color-text-tertiary);font-size:var(--font-size-xs);">无子目录</div>` :
            this.browseDirs.map((d) => html`
              <div class="session-item" style="padding:4px 8px;font-size:var(--font-size-xs);cursor:pointer;"
                @click=${() => this.browseTo(d.path)}>
                📁 ${d.name}
              </div>
            `)
          }
        </div>
      </div>
    `;
  }

  private async onAttachClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.pdb,.xyz,.mol2,.gro,.mdp,.py,.sh,.txt,.csv,.json,.cif,.in,.log';
    input.addEventListener('change', async () => {
      const files = Array.from(input.files || []);
      for (const f of files) {
        const { getActiveClient } = await import('../api/mock');
        const client = getActiveClient();
        const r = await client.uploads.file(f);
        if (r.ok) {
          this.pendingAttachments = [...this.pendingAttachments, { id: r.value.fileId, filename: r.value.filename, size: r.value.size }];
        }
      }
    });
    input.click();
  }

  private removeAttachment(id: string) {
    this.pendingAttachments = this.pendingAttachments.filter((a) => a.id !== id);
  }

  // ---------- Confirm dialog actions ----------

  private onConfirm(optionId: string) {
    respondToConfirm(optionId);
  }

  private onConfirmDismiss() {
    dismissConfirm();
  }

  // ---------- Render ----------

  private renderMessage(m: ChatMessage) {
    if (m.type === 'system') {
      return html`
        <div class="message system">
          <div class="msg-bubble">⚠️ ${m.content}</div>
        </div>
      `;
    }
    if (m.type === 'tool') {
      return html`
        <div class="message tool">
          <div class="msg-content">
            <chemycode-tool-call-card
              .toolName=${m.toolName || 'tool'}
              .toolStatus=${m.toolStatus || 'running'}
              .result=${m.content || ''}
              .args=${m.code || ''}>
            </chemycode-tool-call-card>
            <div class="msg-time">${m.timestamp}</div>
          </div>
        </div>
      `;
    }
    const isUser = m.type === 'user';
    const isAgent = m.type === 'agent';
    const isStreaming = this.typingMessageId === m.id;
    const usage = m.usage;
    return html`
      <div class="message ${m.type}">
        <div class="msg-avatar">${isUser ? 'U' : 'AI'}</div>
        <div class="msg-content">
          ${isUser
            ? html`<div class="msg-bubble">${m.content}</div>`
            : html`
                ${m.thinking
                  ? html`<chemycode-thinking-block .content=${m.thinking} .live=${isStreaming}></chemycode-thinking-block>`
                  : ''}
                <div class="msg-bubble">
                  ${m.content
                    ? html`<chemycode-markdown-renderer .source=${m.content}></chemycode-markdown-renderer>${isStreaming ? html`<span class="typing-cursor"></span>` : ''}`
                    : isStreaming
                      ? html`<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`
                      : ''}
                </div>
                ${m.files ? m.files.map((f) => this.renderFile(f)) : ''}
                ${usage && !isStreaming ? this.renderUsageMeta(usage, m.model, m.contextWindow) : ''}
                ${!isStreaming && m.generatedFiles && m.generatedFiles.length > 0 ? this.renderOutputSummary(m.generatedFiles) : ''}
              `}
          <div class="msg-time">${m.timestamp}</div>
        </div>
      </div>
    `;
  }

  private renderFile(f: GeneratedFile) {
    return html`
      <div class="file-block">
        <div class="file-header">
          <span>${f.name}${f.size ? ` · ${f.size}` : ''}</span>
          <div class="file-actions">
            <button class="file-action-btn" @click=${() => navigator.clipboard.writeText(f.content || '').catch(() => {})}>📋 复制</button>
            <button class="file-action-btn" @click=${() => this.downloadFile(f)}>⬇️ 下载</button>
          </div>
        </div>
        <div class="file-preview">${f.content || '(无内容预览)'}</div>
      </div>
    `;
  }

  private downloadFile(f: GeneratedFile) {
    const blob = new Blob([f.content || ''], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  private formatTokens(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return `${n}`;
  }

  private renderUsageMeta(usage: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number }, model?: string, contextWindow?: number) {
    // Use the model's configured contextWindow, fallback to 128k.
    const ctxWindow = contextWindow || 128_000;
    const ctxPct = Math.min(100, Math.round((usage.promptTokens / ctxWindow) * 100));
    return html`
      <div class="msg-meta">
        <span class="meta-item" title="输入 tokens">↑${this.formatTokens(usage.promptTokens)}</span>
        <span class="meta-item" title="输出 tokens">↓${this.formatTokens(usage.completionTokens)}</span>
        ${usage.reasoningTokens ? html`<span class="meta-item" title="推理 tokens">R${this.formatTokens(usage.reasoningTokens)}</span>` : ''}
        <span class="meta-item" title="上下文使用">${ctxPct}% ctx</span>
        ${model ? html`<span class="meta-model">${model}</span>` : ''}
      </div>
    `;
  }

  private renderOutputSummary(files: Array<{ name: string; path: string; type: string }>) {
    const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);
    const imageFiles = files.filter((f) => imageExts.has(f.type));
    const otherFiles = files.filter((f) => !imageExts.has(f.type));
    return html`
      <div style="margin-top:8px;padding:8px 12px;background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);">
        <div style="font-size:var(--font-size-sm);font-weight:var(--font-weight-medium);color:var(--color-text-primary);margin-bottom:6px;">📦 产出物 (${files.length})</div>
        ${otherFiles.length > 0 ? html`
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:${imageFiles.length > 0 ? '8px' : '0'};">
            ${otherFiles.map((f) => html`
              <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:var(--color-background-tertiary);border-radius:var(--border-radius-sm);font-size:var(--font-size-xs);color:var(--color-text-secondary);">
                📄 ${f.name}
              </span>
            `)}
          </div>
        ` : ''}
        ${imageFiles.length > 0 ? html`
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${imageFiles.map((f) => html`
              <div style="cursor:pointer;border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-sm);overflow:hidden;" @click=${() => window.open(`/api/uploads/${f.name}`, '_blank')}>
                <div style="padding:4px 8px;font-size:var(--font-size-xs);color:var(--color-text-secondary);background:var(--color-background-tertiary);">🖼️ ${f.name}</div>
              </div>
            `)}
          </div>
        ` : ''}
      </div>
    `;
  }

  private examples = [
    '帮我做一个蛋白质A的50ns分子动力学模拟',
    '计算CO₂在ZIF-8中的吸附能',
    '分析GROMACS轨迹的RMSD',
    '生成VASP的NEB计算输入文件',
  ];

  // Skill list — dynamically loaded from /api/skills.
  @state() private installedSkills: Array<{ name: string; description: string; icon: string }> = [];
  @state() private showSkillPanel = false;
  @state() private activeSkill: string | null = null;
  private skillListLoaded = false;

  private async loadSkills() {
    if (this.skillListLoaded) return;
    try {
      const resp = await fetch('/api/skills', { headers: { 'Authorization': `Bearer ${localStorage.getItem('chemycode.token') || ''}` } });
      if (!resp.ok) return;
      const json = await resp.json();
      const skills = json.data || json || [];
      if (!Array.isArray(skills) || skills.length === 0) return;

      const iconFor = (desc: string): string => {
        const t = desc.toLowerCase();
        if (t.includes('dpd') || t.includes('phase') || t.includes('相分离')) return '🧬';
        if (t.includes('traj') || t.includes('rdf') || t.includes('轨迹')) return '📊';
        if (t.includes('check') || t.includes('consistency') || t.includes('检验')) return '🔬';
        if (t.includes('quantum') || t.includes('dft') || t.includes('量子')) return '⚛️';
        return '🧪';
      };

      this.installedSkills = skills.map((s: any) => ({
        name: s.name,
        description: s.description || '',
        icon: iconFor(s.description || ''),
      }));
      this.skillListLoaded = true;
    } catch (e) {
      console.warn('[skill-panel] load failed:', e);
    }
  }

  private async toggleSkillPanel() {
    this.showSkillPanel = !this.showSkillPanel;
    if (this.showSkillPanel && this.installedSkills.length === 0) {
      await this.loadSkills();
    }
  }

  private activateSkill(skillName: string) {
    this.activeSkill = skillName;
    this.showSkillPanel = false;
    // Silent activation — SKILL.md will be injected on next user message.
  }

  private deactivateSkill() {
    this.activeSkill = null;
  }

  private sendExample(text: string) {
    if (!this.inputEl) return;
    this.inputEl.value = text;
    this.inputEl.focus();
    this.autoResize({ target: this.inputEl } as unknown as Event);
  }

  render() {
    const hasMessages = this.messages.length > 0;
    const isStreaming = !!this.typingMessageId;
    return html`
      <div class="messages-area">
        ${!hasMessages
          ? html`
              <div class="empty-hint">
                <h2>👋 欢迎使用 Chemycode</h2>
                <p>我可以帮你完成计算化学任务 — 分子动力学、量子化学、力场选择、参数化、结果分析等。</p>
                <div class="examples">
                  ${this.examples.map((ex) => html`
                    <button class="example" @click=${() => this.sendExample(ex)}>${ex}</button>
                  `)}
                </div>
              </div>
            `
          : this.messages.map((m) => this.renderMessage(m))}

        ${this.showConfirm ? html`
          <div class="confirm-overlay">
            <div class="confirm-box">
              <div class="confirm-text">${this.confirmPrompt}</div>
              <div class="confirm-actions">
                ${this.confirmOptions.map((opt) => html`
                  <button
                    class="confirm-btn ${opt.destructive ? 'reject' : 'accept'}"
                    @click=${() => this.onConfirm(opt.id)}>
                    ${opt.label}
                  </button>
                `)}
                <button class="confirm-btn reject" @click=${() => this.onConfirmDismiss()}>忽略</button>
              </div>
            </div>
          </div>
        ` : ''}
      </div>

      <div class="input-area">
        ${this.pendingAttachments.length > 0 ? html`
          <div class="attach-strip">
            ${this.pendingAttachments.map((a) => html`
              <div class="attach-chip">
                📎 ${a.filename} (${this.formatBytes(a.size)})
                <button @click=${() => this.removeAttachment(a.id)} title="移除">×</button>
              </div>
            `)}
          </div>
        ` : ''}
        <div class="input-row">
          <textarea placeholder="输入消息..."
            ?disabled=${isStreaming}
            @input=${this.autoResize}
            @keydown=${this.onKeydown}
            rows="1"></textarea>
          ${isStreaming
            ? html`<button class="stop-btn" @click=${() => stopGeneration()} title="停止生成">■</button>`
            : html`<button class="send-btn" @click=${() => this.handleSend()}>➤</button>`}
        </div>
        <div class="input-tools">
          <button class="tool-btn ${this.showSkillPanel ? 'skill-btn-active' : ''}" @click=${() => this.toggleSkillPanel()} title="Skill 工具">⚡ Skill</button>
          ${this.activeSkill ? html`
            <button class="tool-btn skill-btn-active" @click=${() => this.deactivateSkill()} title="停用 Skill">
              ✓ ${this.activeSkill} ✕
            </button>
          ` : ''}
          ${this.showSkillPanel ? html`
            <div class="skill-panel">
              <h4>选择 Skill（注入完整文档到上下文）</h4>
              <div class="skill-grid">
                ${this.installedSkills.map((s) => html`
                  <button class="skill-item ${this.activeSkill === s.name ? 'skill-btn-active' : ''}" @click=${() => this.activateSkill(s.name)}>
                    <span class="skill-icon">${s.icon}</span>
                    <div>
                      <div class="skill-label">${s.name}</div>
                      <div class="skill-script">${s.description.slice(0, 60)}...</div>
                    </div>
                  </button>
                `)}
                ${this.installedSkills.length === 0 ? html`
                  <div style="padding:12px;color:var(--color-text-tertiary);font-size:var(--font-size-sm);">暂无已安装的 Skill</div>
                ` : ''}
              </div>
            </div>
          ` : ''}
          <button class="tool-btn" @click=${() => this.onAttachClick()} title="附件">📎</button>
          <div class="model-selector">
            <span>🧠</span>
            <select
              .value=${this.thinkingMode}
              @change=${(e: Event) => this.thinkingMode = (e.target as HTMLSelectElement).value as typeof this.thinkingMode}>
              <option value="off">关闭</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </div>
          <div class="model-selector">
            <span>📂</span>
            <input type="text" placeholder="工作空间路径（可选）"
              .value=${this.workspacePath}
              ?disabled=${this.workspaceLocked}
              @input=${(e: Event) => this.workspacePath = (e.target as HTMLInputElement).value}
              style="width:140px;padding:3px 6px;border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-sm);background:var(--color-background-primary);color:var(--color-text-primary);font-size:var(--font-size-sm);outline:none;${this.workspaceLocked ? 'opacity:0.7;cursor:not-allowed;' : ''}" />
            <button class="tool-btn" @click=${() => this.toggleWorkspaceBrowser()} title="浏览目录">📁</button>
            ${this.workspaceLocked && this.workspacePath ? html`<span style="font-size:11px;color:var(--color-accent);margin-left:2px;" title="工作空间已锁定（首次发送后不可更改）">🔒</span>` : ''}
            ${this.workspacePath && !this.workspaceLocked ? html`<button class="tool-btn" @click=${() => { this.workspacePath = ''; }} title="清除">✕</button>` : ''}
          </div>
          ${this.showWorkspaceBrowser ? this.renderWorkspaceBrowser() : ''}
          <div class="model-selector">
            <span>模型</span>
            <select
              .value=${this.selectedModel}
              @change=${(e: Event) => this.selectedModel = (e.target as HTMLSelectElement).value}>
              ${this.models.length === 0
                ? html`<option value="">未配置模型</option>`
                : html`
                    ${this.models.map((m) => html`<option value=${m.name} ?selected=${this.selectedModel === m.name || (!this.selectedModel && m.isDefault)}>${m.name}${m.isDefault ? ' (默认)' : ''}</option>`)}
                  `}
            </select>
          </div>
        </div>
      </div>
    `;
  }
}
