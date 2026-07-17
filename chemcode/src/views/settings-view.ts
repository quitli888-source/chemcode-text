// ====== Settings View ======
// Account / System / Models / Help. Talks to the API for everything that
// needs persistence, and to localStorage for theme/lang/fontSize.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  getState,
  subscribe,
  setSettingsTab,
  setThemeMode,
  setFontSize,
  addModel,
  removeModel,
  editModel,
  setView,
  logout,
} from '../state';
import type { SettingsTab, ThemeMode, Lang, ConfiguredModel } from '../types';
import { getActiveClient } from '../api/mock';
import { showError, showSuccess, showInfo } from '../components/toast';
import { showConfirm } from '../components/confirm-dialog';

@customElement('settings-view')
export class SettingsView extends LitElement {
  static styles = css`
    :host { display: flex; height: 100%; }
    .settings-sidebar {
      width: 180px;
      flex-shrink: 0;
      background: var(--color-background-primary);
      border-right: 0.5px solid var(--color-border-tertiary);
      padding: var(--spacing-sm) 0;
    }
    .settings-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px var(--spacing-md);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      cursor: pointer;
      border-left: 3px solid transparent;
    }
    .settings-item:hover { background: var(--color-background-secondary); color: var(--color-text-primary); }
    .settings-item.active {
      background: var(--color-accent-light);
      color: var(--color-accent);
      border-left-color: var(--color-accent);
      font-weight: var(--font-weight-medium);
    }
    .back-btn {
      display: flex; align-items: center; gap: 6px;
      padding: 10px var(--spacing-md);
      font-size: var(--font-size-sm);
      color: var(--color-text-secondary);
      cursor: pointer;
      border-bottom: 0.5px solid var(--color-border-tertiary);
      margin-bottom: var(--spacing-xs);
    }
    .back-btn:hover { color: var(--color-accent); }

    .settings-content { flex: 1; padding: var(--spacing-lg); overflow-y: auto; max-width: 720px; }
    .page-title { font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); margin-bottom: var(--spacing-lg); }
    .card {
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-md);
      margin-bottom: var(--spacing-md);
    }
    .card-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-medium); margin-bottom: var(--spacing-sm); }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 0.5px solid var(--color-border-tertiary);
    }
    .info-row:last-child { border-bottom: none; }
    .info-label { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
    .info-value { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }

    .setting-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 0.5px solid var(--color-border-tertiary);
    }
    .setting-row:last-child { border-bottom: none; }
    .setting-label { font-size: var(--font-size-sm); }
    .setting-control select, .setting-control input {
      padding: 4px 8px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-sm);
      font-size: var(--font-size-sm);
      background: var(--color-background-primary);
      color: var(--color-text-primary);
      outline: none;
    }

    .model-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 0.5px solid var(--color-border-tertiary);
    }
    .model-item:last-child { border-bottom: none; }
    .model-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); display: flex; align-items: center; gap: 6px; }
    .default-badge {
      background: var(--color-accent-light);
      color: var(--color-accent);
      padding: 1px 6px;
      border-radius: 100px;
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-medium);
    }
    .model-url { font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .edit-btn, .test-btn {
      padding: 4px 10px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-sm);
      background: transparent;
      cursor: pointer;
      font-size: var(--font-size-xs);
      color: var(--color-text-secondary);
    }
    .edit-btn:hover, .test-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
    .edit-btn.danger:hover { border-color: var(--color-text-danger); color: var(--color-text-danger); }
    .model-actions { display: flex; gap: 4px; }

    .add-btn {
      width: 100%;
      padding: 8px;
      border: 1px dashed var(--color-border-secondary);
      border-radius: var(--border-radius-md);
      background: transparent;
      cursor: pointer;
      font-size: var(--font-size-sm);
      color: var(--color-text-tertiary);
      margin-top: var(--spacing-xs);
    }
    .add-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }

    .auth-btn {
      padding: 6px 16px;
      border: none;
      border-radius: var(--border-radius-md);
      background: var(--color-accent);
      color: white;
      cursor: pointer;
      font-size: var(--font-size-sm);
    }
    .auth-btn:hover { background: var(--color-accent-hover); }
    .auth-btn.outline {
      background: transparent;
      border: 0.5px solid var(--color-border-secondary);
      color: var(--color-text-secondary);
    }
    .auth-btn.outline:hover { background: var(--color-background-tertiary); }

    .modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      z-index: 200;
    }
    .modal-box {
      background: var(--color-background-primary);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-lg);
      width: 440px; max-width: 90vw;
      box-shadow: var(--shadow-md);
    }
    .modal-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-medium); margin-bottom: var(--spacing-md); }
    .form-group { margin-bottom: var(--spacing-sm); }
    .form-label { display: block; font-size: var(--font-size-sm); margin-bottom: 4px; }
    .form-group input, .form-group select {
      width: 100%;
      padding: 8px 10px;
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-sm);
      font-size: var(--font-size-sm);
      outline: none;
      box-sizing: border-box;
      background: var(--color-background-primary);
      color: var(--color-text-primary);
    }
    .form-group input:focus, .form-group select:focus { border-color: var(--color-accent); }
    .modal-actions { display: flex; gap: var(--spacing-xs); justify-content: flex-end; margin-top: var(--spacing-md); }
  `;

  @state() private activeTab: SettingsTab = 'account';
  @state() private theme: ThemeMode = 'light';
  @state() private language: Lang = 'zh';
  @state() private fontSize = 14;
  @state() private models: ConfiguredModel[] = [];
  @state() private showAddModel = false;
  @state() private editingModel: ConfiguredModel | null = null;
  @state() private editingModelNewKey: string = '';
  @state() private testingId: string | null = null;
  @state() private testResults: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  // Add model form
  @state() private formName = '';
  @state() private formUrl = '';
  @state() private formKey = '';
  @state() private formContext = true;
  @state() private formProvider = 'deepseek';
  @state() private formContextWindow = 1000000;
  @state() private formMaxTokens = 384000;

  private _unsub: (() => void) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this._unsub?.();
    this._unsub = subscribe(() => {
      const s = getState();
      this.activeTab = s.settingsTab;
      this.theme = s.theme;
      this.language = s.language || 'zh';
      this.fontSize = s.fontSize;
      this.models = s.configuredModels;
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsub = null;
  }

  private async onSaveModel() {
    if (!this.formName.trim() || !this.formUrl.trim() || !this.formKey.trim()) {
      showError('请填写完整的模型信息');
      return;
    }
    await addModel({
      name: this.formName.trim(),
      apiUrl: this.formUrl.trim(),
      apiKey: this.formKey,
      supportsContext: this.formContext,
      provider: this.formProvider,
      contextWindow: this.formContextWindow,
      maxTokens: this.formMaxTokens,
    });
    showSuccess(`已添加模型: ${this.formName}`);
    this.showAddModel = false;
    this.formName = '';
    this.formUrl = '';
    this.formKey = '';
  }

  private async onRemoveModel(m: ConfiguredModel) {
    const ok = await showConfirm({
      title: '删除模型',
      message: `确定删除模型「${m.name}」吗？`,
      confirmText: '删除',
      destructive: true,
    });
    if (!ok) return;
    await removeModel(m.id || m.name);
    showSuccess('模型已删除');
  }

  private startEditModel(m: ConfiguredModel) {
    this.editingModel = { ...m };
    this.editingModelNewKey = '';
  }

  private async onSaveEditModel() {
    if (!this.editingModel) return;
    const m = this.editingModel;
    if (!m.name.trim() || !m.apiUrl.trim()) {
      showError('模型名称和 API URL 不能为空');
      return;
    }
    const patch: Record<string, unknown> = {
      name: m.name.trim(),
      apiUrl: m.apiUrl.trim(),
      provider: m.provider,
      supportsContext: m.supportsContext,
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 8192,
    };
    // Only include apiKey if the user actually typed a new one.
    if (this.editingModelNewKey.trim()) {
      patch.apiKey = this.editingModelNewKey.trim();
    }
    const ok = await editModel(m.id || m.name, patch);
    if (ok) {
      showSuccess(`已更新模型: ${m.name}`);
      this.editingModel = null;
      this.editingModelNewKey = '';
    }
  }

  private async onTestModel(m: ConfiguredModel) {
    if (!m.id) return;
    this.testingId = m.id;
    this.testResults = { ...this.testResults, [m.id]: undefined as unknown as { ok: boolean; latencyMs?: number; error?: string } };
    const { testModel } = await import('../state');
    const r = await testModel(m.id);
    this.testResults = { ...this.testResults, [m.id]: r };
    this.testingId = null;
    if (r.ok) showSuccess(`连接成功 (${r.latencyMs?.toFixed(0)}ms)`);
    else showError(r.error || '连接失败');
  }

  private async onLogout() {
    const ok = await showConfirm({
      title: '登出',
      message: '确定要登出当前账户吗？',
      confirmText: '登出',
      destructive: true,
    });
    if (!ok) return;
    await logout();
  }

  private t(key: string): string {
    const map: Record<string, Record<'zh' | 'en', string>> = {
      back: { zh: '← 退出', en: '← Back' },
      tabsAccount: { zh: '账户管理', en: 'Account' },
      tabsSystem: { zh: '系统设置', en: 'System' },
      tabsModels: { zh: '模型管理', en: 'Models' },
      tabsHelp: { zh: '帮助与反馈', en: 'Help & Feedback' },
      titlesAccount: { zh: '👤 账户管理', en: '👤 Account' },
      titlesSystem: { zh: '⚙️ 系统设置', en: '⚙️ System Settings' },
      titlesModels: { zh: '🤖 模型管理', en: '🤖 Model Management' },
      titlesHelp: { zh: '❓ 帮助与反馈', en: '❓ Help & Feedback' },
      userInfo: { zh: '用户信息', en: 'User Info' },
      username: { zh: '用户名', en: 'Username' },
      userId: { zh: '用户ID', en: 'User ID' },
      email: { zh: '邮箱', en: 'Email' },
      editProfile: { zh: '编辑资料', en: 'Edit profile' },
      logout: { zh: '登出', en: 'Log out' },
      language: { zh: '语言', en: 'Language' },
      fontSize: { zh: '字体大小', en: 'Font Size' },
      theme: { zh: '主题', en: 'Theme' },
      light: { zh: '浅色模式', en: 'Light' },
      dark: { zh: '深色模式', en: 'Dark' },
      preview: { zh: '当前预览', en: 'Preview' },
      previewText: { zh: '当前设置已实时应用到界面。你可以直接切换主题、字号和语言，查看效果。', en: 'Your current preferences are applied instantly. Switch theme, font size, and language to preview the experience.' },
      zh: { zh: '中文', en: 'Chinese' },
      modelHint: { zh: '提示：支持 OpenAI 兼容协议', en: 'Tip: Supports the OpenAI-compatible protocol' },
      noModels: { zh: '尚未配置任何模型', en: 'No models configured yet' },
      addModel: { zh: '+ 配置新模型', en: '+ Add model' },
      helpIntro: { zh: 'Chemcode 是一个计算化学 AI Agent 平台。\n在对话中描述你的任务（分子动力学、DFT、力场、参数化等），Agent 会自动规划步骤并执行。', en: 'Chemcode is a computational chemistry AI agent platform. Describe your task in chat (molecular dynamics, DFT, force fields, parameterization, etc.) and the agent will plan and execute the steps.' },
      shortcuts: { zh: '键盘快捷键', en: 'Keyboard shortcuts' },
      feedback: { zh: '反馈方式', en: 'Feedback' },
      versionInfo: { zh: '版本信息', en: 'Version info' },
      version: { zh: '版本', en: 'Version' },
      buildTime: { zh: '构建时间', en: 'Build time' },
    };
    return map[key]?.[this.language] || map[key]?.zh || key;
  }

  render() {
    const tabs: { id: SettingsTab; label: string; icon: string }[] = [
      { id: 'account', label: this.t('tabsAccount'), icon: '👤' },
      { id: 'system', label: this.t('tabsSystem'), icon: '⚙️' },
      { id: 'models', label: this.t('tabsModels'), icon: '🤖' },
      { id: 'help', label: this.t('tabsHelp'), icon: '❓' },
    ];

    return html`
      <div class="settings-sidebar">
        <div class="back-btn" @click=${() => setView('chat')}>${this.t('back')}</div>
        ${tabs.map((tab) => html`
          <div class="settings-item ${this.activeTab === tab.id ? 'active' : ''}"
            @click=${() => setSettingsTab(tab.id)}>
            ${tab.icon} ${tab.label}
          </div>
        `)}
      </div>

      <div class="settings-content">
        ${this.activeTab === 'account' ? html`
          <div class="page-title">${this.t('titlesAccount')}</div>
          <div class="card">
            <div class="card-title">${this.t('userInfo')}</div>
            <div class="info-row"><span class="info-label">${this.t('username')}</span><span class="info-value">${getState().currentUser?.username || '-'}</span></div>
            <div class="info-row"><span class="info-label">${this.t('userId')}</span><span class="info-value" style="font-family:var(--font-mono);font-size:var(--font-size-xs)">${getState().currentUser?.id || '-'}</span></div>
            <div class="info-row"><span class="info-label">${this.t('email')}</span><span class="info-value">${getState().currentUser?.email || '-'}</span></div>
          </div>
          <div style="display:flex;gap:var(--spacing-xs)">
            <button class="auth-btn" @click=${() => showInfo(this.language === 'en' ? 'Profile editing is coming soon' : '资料编辑开发中')}>${this.t('editProfile')}</button>
            <button class="auth-btn outline" @click=${() => this.onLogout()}>${this.t('logout')}</button>
          </div>
        ` : ''}

        ${this.activeTab === 'system' ? html`
          <div class="page-title">${this.t('titlesSystem')}</div>
          <div class="card">
            <div class="setting-row">
              <span class="setting-label">${this.t('language')}</span>
              <div class="setting-control">
                <span style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">中文</span>
              </div>
            </div>
            <div class="setting-row">
              <span class="setting-label">${this.t('fontSize')}</span>
              <div class="setting-control">
                <select .value=${String(this.fontSize)} @change=${(e: Event) => setFontSize(Number((e.target as HTMLSelectElement).value))}>
                  <option value="12">12px</option>
                  <option value="13">13px</option>
                  <option value="14">14px</option>
                  <option value="15">15px</option>
                  <option value="16">16px</option>
                </select>
              </div>
            </div>
            <div class="setting-row">
              <span class="setting-label">${this.t('theme')}</span>
              <div class="setting-control">
                <select .value=${this.theme} @change=${(e: Event) => setThemeMode((e.target as HTMLSelectElement).value as ThemeMode)}>
                  <option value="light">${this.t('light')}</option>
                  <option value="dark">${this.t('dark')}</option>
                </select>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-title">${this.t('preview')}</div>
            <p style="font-size:var(--font-size-sm);line-height:1.7;color:var(--color-text-secondary)">${this.t('previewText')}</p>
          </div>
        ` : ''}

        ${this.activeTab === 'models' ? html`
          <div class="page-title">${this.t('titlesModels')}</div>
          <div class="card">
            <div class="info-row" style="border-bottom:0.5px solid var(--color-border-tertiary);padding-bottom:var(--spacing-sm)">
              <span style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">${this.t('modelHint')}</span>
            </div>
            ${this.models.length === 0
              ? html`<div class="text-muted" style="padding:16px 0;font-size:var(--font-size-sm)">${this.t('noModels')}</div>`
              : this.models.map((m) => {
                  const r = m.id ? this.testResults[m.id] : undefined;
                  return html`
                    <div class="model-item">
                      <div>
                        <div class="model-name">
                          ${m.name}
                          ${m.isDefault ? html`<span class="default-badge">默认</span>` : ''}
                        </div>
                        <div class="model-url">${m.apiUrl} · ${m.provider}${m.contextWindow ? ` · ${m.contextWindow >= 1000000 ? (m.contextWindow / 1000000).toFixed(0) + 'M' : (m.contextWindow / 1000).toFixed(0) + 'K'} ctx` : ''}${m.maxTokens ? ` · max ${m.maxTokens >= 1000000 ? (m.maxTokens / 1000000).toFixed(0) + 'M' : (m.maxTokens / 1000).toFixed(0) + 'K'}` : ''}</div>
                        ${r ? html`<div class="model-url" style="color: ${r.ok ? 'var(--color-text-success)' : 'var(--color-text-danger)'}">
                          ${r.ok ? `✓ ${r.latencyMs?.toFixed(0)}ms` : `✗ ${r.error || '失败'}`}
                        </div>` : ''}
                      </div>
                      <div class="model-actions">
                        <button class="test-btn" @click=${() => this.onTestModel(m)} ?disabled=${this.testingId === m.id}>
                          ${this.testingId === m.id ? '测试中…' : '测试'}
                        </button>
                        <button class="edit-btn" @click=${() => this.startEditModel(m)}>编辑</button>
                        <button class="edit-btn danger" @click=${() => this.onRemoveModel(m)}>删除</button>
                      </div>
                    </div>
                  `;
                })}
            <button class="add-btn" @click=${() => this.showAddModel = true}>${this.t('addModel')}</button>
          </div>

          ${this.showAddModel ? html`
            <div class="modal-overlay" @click=${() => this.showAddModel = false}>
              <div class="modal-box" @click=${(e: Event) => e.stopPropagation()}>
                <div class="modal-title">配置新模型</div>
                <div class="form-group">
                  <label class="form-label">快速选择预设</label>
                  <select @change=${(e: Event) => {
                    const v = (e.target as HTMLSelectElement).value;
                    if (!v) return;
                    const [provider, name, url, ctx, maxT] = v.split('|');
                    this.formProvider = provider;
                    this.formName = name;
                    this.formUrl = url;
                    this.formContextWindow = Number(ctx);
                    this.formMaxTokens = Number(maxT);
                  }}>
                    <option value="">手动配置</option>
                    <optgroup label="DeepSeek">
                      <option value="deepseek|deepseek-v4-pro|https://api.deepseek.com|1000000|384000">V4 Pro (1M ctx)</option>
                      <option value="deepseek|deepseek-v4-flash|https://api.deepseek.com|1000000|384000">V4 Flash (1M ctx)</option>
                      <option value="deepseek|deepseek-chat|https://api.deepseek.com|131072|8192">Chat (128K ctx)</option>
                      <option value="deepseek|deepseek-reasoner|https://api.deepseek.com|131072|65536">Reasoner (128K ctx)</option>
                    </optgroup>
                    <optgroup label="OpenAI">
                      <option value="openai|gpt-4o|https://api.openai.com|128000|16384">GPT-4o (128K ctx)</option>
                      <option value="openai|gpt-4o-mini|https://api.openai.com|128000|16384">GPT-4o Mini (128K ctx)</option>
                    </optgroup>
                    <optgroup label="Anthropic">
                      <option value="anthropic|claude-sonnet-4-20250514|https://api.anthropic.com|200000|64000">Claude Sonnet 4 (200K ctx)</option>
                    </optgroup>
                    <optgroup label="Google">
                      <option value="google|gemini-2.5-pro|https://generativelanguage.googleapis.com|1048576|65536">Gemini 2.5 Pro (1M ctx)</option>
                    </optgroup>
                    <optgroup label="MiniMax">
                      <option value="minimax|MiniMax-M3|https://api.minimaxi.com|1000000|65536">MiniMax-M3 (1M ctx, 多模态)</option>
                      <option value="minimax|MiniMax-M2.7|https://api.minimaxi.com|204800|65536">MiniMax-M2.7 (204K ctx)</option>
                      <option value="minimax|MiniMax-M2.5|https://api.minimaxi.com|204800|65536">MiniMax-M2.5 (204K ctx)</option>
                    </optgroup>
                    <optgroup label="Xiaomi (MiMo)">
                      <option value="xiaomi|mimo-v2.5-pro||1048576|32000">MiMo V2.5 Pro (1M ctx)</option>
                    </optgroup>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">模型名称</label>
                  <input type="text" placeholder="例如: deepseek-v4-pro"
                    .value=${this.formName}
                    @input=${(e: InputEvent) => this.formName = (e.target as HTMLInputElement).value} />
                </div>
                <div class="form-group">
                  <label class="form-label">API URL</label>
                  <input type="text" placeholder="https://api.deepseek.com"
                    .value=${this.formUrl}
                    @input=${(e: InputEvent) => this.formUrl = (e.target as HTMLInputElement).value} />
                </div>
                <div class="form-group">
                  <label class="form-label">API Key</label>
                  <input type="password" placeholder="sk-..."
                    .value=${this.formKey}
                    @input=${(e: InputEvent) => this.formKey = (e.target as HTMLInputElement).value} />
                </div>
                <div class="form-group">
                  <label class="form-label">Provider</label>
                  <select .value=${this.formProvider}
                    @change=${(e: Event) => this.formProvider = (e.target as HTMLSelectElement).value}>
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="minimax">MiniMax</option>
                    <option value="xiaomi">Xiaomi (MiMo)</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div style="display:flex;gap:var(--spacing-sm)">
                  <div class="form-group" style="flex:1">
                    <label class="form-label">上下文窗口 (tokens)</label>
                    <input type="number" .value=${String(this.formContextWindow)}
                      @input=${(e: InputEvent) => this.formContextWindow = Number((e.target as HTMLInputElement).value) || 128000} />
                  </div>
                  <div class="form-group" style="flex:1">
                    <label class="form-label">最大输出 (tokens)</label>
                    <input type="number" .value=${String(this.formMaxTokens)}
                      @input=${(e: InputEvent) => this.formMaxTokens = Number((e.target as HTMLInputElement).value) || 8192} />
                  </div>
                </div>
                <div class="modal-actions">
                  <button class="edit-btn" @click=${() => this.showAddModel = false}>取消</button>
                  <button class="auth-btn" @click=${() => this.onSaveModel()}>保存</button>
                </div>
              </div>
            </div>
          ` : ''}

          ${this.editingModel ? html`
            <div class="modal-overlay" @click=${() => this.editingModel = null}>
              <div class="modal-box" @click=${(e: Event) => e.stopPropagation()}>
                <div class="modal-title">编辑模型</div>
                <div class="form-group">
                  <label class="form-label">模型名称</label>
                  <input type="text" .value=${this.editingModel.name}
                    @input=${(e: InputEvent) => this.editingModel = { ...this.editingModel!, name: (e.target as HTMLInputElement).value }} />
                </div>
                <div class="form-group">
                  <label class="form-label">API URL</label>
                  <input type="text" .value=${this.editingModel.apiUrl}
                    @input=${(e: InputEvent) => this.editingModel = { ...this.editingModel!, apiUrl: (e.target as HTMLInputElement).value }} />
                </div>
                <div class="form-group">
                  <label class="form-label">API Key（留空则不更新）</label>
                  <input type="password" placeholder="输入新 key，留空则保留原值"
                    .value=${this.editingModelNewKey}
                    @input=${(e: InputEvent) => this.editingModelNewKey = (e.target as HTMLInputElement).value} />
                </div>
                <div class="form-group">
                  <label class="form-label">Provider</label>
                  <select .value=${this.editingModel.provider}
                    @change=${(e: Event) => this.editingModel = { ...this.editingModel!, provider: (e.target as HTMLSelectElement).value }}>
                    <option value="deepseek">DeepSeek</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="minimax">MiniMax</option>
                    <option value="xiaomi">Xiaomi (MiMo)</option>
                    <option value="other">其他</option>
                  </select>
                </div>
                <div style="display:flex;gap:var(--spacing-sm)">
                  <div class="form-group" style="flex:1">
                    <label class="form-label">上下文窗口 (tokens)</label>
                    <input type="number" .value=${String(this.editingModel.contextWindow ?? 128000)}
                      @input=${(e: InputEvent) => this.editingModel = { ...this.editingModel!, contextWindow: Number((e.target as HTMLInputElement).value) || 128000 }} />
                  </div>
                  <div class="form-group" style="flex:1">
                    <label class="form-label">最大输出 (tokens)</label>
                    <input type="number" .value=${String(this.editingModel.maxTokens ?? 8192)}
                      @input=${(e: InputEvent) => this.editingModel = { ...this.editingModel!, maxTokens: Number((e.target as HTMLInputElement).value) || 8192 }} />
                  </div>
                </div>
                <div class="modal-actions">
                  <button class="edit-btn" @click=${() => this.editingModel = null}>取消</button>
                  <button class="auth-btn" @click=${() => this.onSaveEditModel()}>保存</button>
                </div>
              </div>
            </div>
          ` : ''}
        ` : ''}

        ${this.activeTab === 'help' ? html`
          <div class="page-title">${this.t('titlesHelp')}</div>
          <div class="card">
            <div class="card-title">${this.t('tabsHelp')}</div>
            <p style="font-size:var(--font-size-sm);line-height:1.8;color:var(--color-text-secondary)">${this.t('helpIntro').replace(/\\n/g, '<br/>')}</p>
          </div>
          <div class="card">
            <div class="card-title">${this.t('shortcuts')}</div>
            <div class="info-row"><span class="info-label">Enter</span><span class="info-value">发送消息</span></div>
            <div class="info-row"><span class="info-label">Shift+Enter</span><span class="info-value">换行</span></div>
            <div class="info-row"><span class="info-label">Esc</span><span class="info-value">关闭弹窗</span></div>
          </div>
          <div class="card">
            <div class="card-title">${this.t('feedback')}</div>
            <p style="font-size:var(--font-size-sm);color:var(--color-text-secondary)">📧 support@chemcode.dev</p>
          </div>
          <div class="card">
            <div class="card-title">${this.t('versionInfo')}</div>
            <div class="info-row"><span class="info-label">${this.t('version')}</span><span class="info-value">v2.0.0</span></div>
            <div class="info-row"><span class="info-label">${this.t('buildTime')}</span><span class="info-value">2026-07-17</span></div>
          </div>
        ` : ''}
      </div>
    `;
  }
}
