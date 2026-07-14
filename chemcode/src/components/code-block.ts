// ====== Code Block ======
// Replaces the original hand-rolled Python/shell highlighter with highlight.js
// for a more accurate and richer result. The public surface stays the same:
//   <chemcode-code-block .code=${...} language="python"></chemcode-code-block>

import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import cssLang from 'highlight.js/lib/languages/css';
import 'highlight.js/styles/atom-one-dark.css';

hljs.registerLanguage('python', python);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', cssLang);

@customElement('chemcode-code-block')
export class CodeBlock extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      margin: var(--spacing-xs) 0;
    }
    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 12px;
      background: #1e1e2e;
      border-radius: var(--border-radius-md) var(--border-radius-md) 0 0;
      font-size: var(--font-size-xs);
      color: #a0a0b0;
    }
    .copy-btn {
      background: transparent;
      border: none;
      color: #a0a0b0;
      cursor: pointer;
      font-size: var(--font-size-xs);
      padding: 2px 8px;
      border-radius: var(--border-radius-sm);
    }
    .copy-btn:hover { background: rgba(255, 255, 255, 0.1); color: white; }
    pre {
      margin: 0;
      padding: var(--spacing-sm);
      background: #282a36;
      border-radius: 0 0 var(--border-radius-md) var(--border-radius-md);
      overflow-x: auto;
      font-size: var(--font-size-sm);
      line-height: 1.6;
      color: #f8f8f2;
    }
    code {
      font-family: var(--font-mono);
    }
  `;

  @property({ type: String }) code = '';
  @property({ type: String }) language = 'python';
  @state() private copied = false;

  private get highlighted(): string {
    const lang = (this.language || '').toLowerCase();
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(this.code, { language: lang, ignoreIllegals: true }).value; }
      catch { /* fall through */ }
    }
    try { return hljs.highlightAuto(this.code).value; } catch { return escapeHtml(this.code); }
  }

  private async onCopy() {
    try {
      await navigator.clipboard.writeText(this.code);
      this.copied = true;
      window.setTimeout(() => { this.copied = false; this.requestUpdate(); }, 2000);
      this.requestUpdate();
    } catch {
      // Fallback: select text in a temporary textarea.
      const ta = document.createElement('textarea');
      ta.value = this.code;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
  }

  render() {
    return html`
      <div class="code-header">
        <span>${this.language || 'text'}</span>
        <button class="copy-btn" @click=${this.onCopy}>
          ${this.copied ? '✅ 已复制' : '📋 复制'}
        </button>
      </div>
      <pre><code class="hljs">${unsafeCSS(this.highlighted)}</code></pre>
    `;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
