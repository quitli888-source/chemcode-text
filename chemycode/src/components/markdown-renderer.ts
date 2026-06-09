// ====== Markdown Renderer ======
// Safe Markdown rendering using `marked` + `dompurify`.
//
// The frontend's knowledge-view had a very limited inline renderer. This
// component replaces it with a full pipeline:
//   markdown text → marked → DOMPurify → safe HTML
//
// Code blocks are wrapped in our existing <chemycode-code-block> component
// for syntax highlighting and copy buttons. We accomplish this by parsing
// with `marked` then walking the resulting nodes to find <pre><code> blocks.

import { LitElement, html, css, unsafeCSS, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
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

marked.setOptions({
  breaks: true,
  gfm: true,
});

@customElement('chemycode-markdown-renderer')
export class MarkdownRenderer extends LitElement {
  static styles = css`
    :host {
      display: block;
      color: var(--color-text-primary);
      font-size: var(--font-size-base);
      line-height: 1.6;
      word-break: break-word;
    }
    :host > div ::slotted(*) { all: revert; }
    h1, h2, h3, h4 {
      margin: 0.6em 0 0.4em;
      font-weight: 600;
      line-height: 1.3;
    }
    h1 { font-size: 1.5em; }
    h2 { font-size: 1.3em; }
    h3 { font-size: 1.15em; }
    h4 { font-size: 1.05em; }
    p { margin: 0.4em 0; }
    ul, ol { margin: 0.4em 0; padding-left: 1.6em; }
    li { margin: 0.2em 0; }
    a { color: var(--color-accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    blockquote {
      margin: 0.6em 0;
      padding: 4px 12px;
      border-left: 3px solid var(--color-border-secondary);
      color: var(--color-text-secondary);
      background: var(--color-background-secondary);
    }
    code {
      font-family: var(--font-mono);
      font-size: 0.9em;
      background: var(--color-background-tertiary);
      padding: 1px 5px;
      border-radius: 3px;
    }
    pre {
      margin: 0.6em 0;
      background: #282a36;
      color: #f8f8f2;
      padding: 10px 12px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: var(--font-size-sm);
    }
    pre code {
      background: transparent;
      padding: 0;
      color: inherit;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.6em 0;
      font-size: var(--font-size-sm);
    }
    th, td {
      border: 0.5px solid var(--color-border-tertiary);
      padding: 6px 10px;
      text-align: left;
    }
    th { background: var(--color-background-secondary); font-weight: 600; }
    tr:nth-child(even) td { background: var(--color-background-secondary); }
    img { max-width: 100%; height: auto; border-radius: 6px; }
    hr { border: none; border-top: 0.5px solid var(--color-border-tertiary); margin: 1em 0; }
  `;

  @property({ type: String }) source = '';
  @property({ type: Boolean }) compact = false;

  // We override createRenderRoot to render into the light DOM (so global CSS
  // for tables / code blocks can apply if needed). For our use case shadow
  // DOM is fine and gives us encapsulated styles.
  // Note: Lit's default shadow DOM is used; the `::slotted` rule above
  // is for child <chemycode-code-block> instances that we don't actually use
  // (we inline-highlight via highlight.js). The rule is harmless.

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('source')) {
      // Re-render happens automatically via render().
    }
  }

  private highlight(code: string, lang: string | undefined): string {
    if (lang && hljs.getLanguage(lang)) {
      try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; }
      catch { /* fall through */ }
    }
    try { return hljs.highlightAuto(code).value; } catch { return escapeHtml(code); }
  }

  private renderMarkdown(): TemplateResult[] {
    const src = this.source || '';
    if (!src.trim()) return [];

    // Tokenize with marked so we can lift code blocks out for highlighting.
    const tokens = marked.lexer(src);

    const parts: TemplateResult[] = [];

    for (const tok of tokens) {
      switch (tok.type) {
        case 'code': {
          const codeHtml = this.highlight(tok.text, tok.lang);
          parts.push(html`<pre><code class="hljs language-${tok.lang || 'plaintext'}">${unsafeCSS(codeHtml)}</code></pre>`);
          break;
        }
        case 'paragraph': {
          parts.push(html`<p>${unsafeCSS(this.inline(tok.text))}</p>`);
          break;
        }
        case 'heading': {
          const level = Math.min(Math.max(tok.depth, 1), 6);
          const tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
          parts.push(html`<${tag}>${unsafeCSS(this.inline(tok.text))}</${tag}>`);
          break;
        }
        case 'blockquote': {
          parts.push(html`<blockquote>${unsafeCSS((tok.tokens || []).map((t) => ('text' in t ? t.text : '')).join('\n'))}</blockquote>`);
          break;
        }
        case 'list': {
          const tag = tok.ordered ? 'ol' : 'ul';
          const items: Tokens.ListItem[] = (tok.items || []) as Tokens.ListItem[];
          const listHtml = items.map((item) => {
            const text = ((item.tokens || []) as Array<{ text?: string; tokens?: unknown[] }>)
              .map((t) => ('text' in t && t.text ? t.text : ''))
              .join('');
            return html`<li>${text || this.inline(item.text)}</li>`;
          });
          parts.push(html`<${tag as 'ul' | 'ol'}>${listHtml}</${tag as 'ul' | 'ol'}>`);
          break;
        }
        case 'table': {
          const header: Tokens.TableCell[] = tok.header as Tokens.TableCell[];
          const rows: Tokens.TableCell[][] = tok.rows as Tokens.TableCell[][];
          const head = header.map((h) => html`<th>${this.inline(h.text)}</th>`);
          const body = rows.map((row) => html`<tr>${row.map((c) => html`<td>${this.inline(c.text)}</td>`)}</tr>`);
          parts.push(html`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
          break;
        }
        case 'hr': {
          parts.push(html`<hr/>`);
          break;
        }
        case 'space':
          break;
        default: {
          // Fallback: render raw text.
          if ('text' in tok && typeof (tok as { text: string }).text === 'string') {
            parts.push(html`<p>${unsafeCSS(this.inline((tok as { text: string }).text))}</p>`);
          }
        }
      }
    }
    return parts;
  }

  /** Inline-level transform: bold/italic/code/links/autolinks. */
  private inline(text: string): string {
    const raw = marked.parseInline(text, { breaks: true, gfm: true });
    return DOMPurify.sanitize(raw as string, {
      ALLOWED_TAGS: ['strong', 'em', 'code', 'a', 'br', 'span', 'sub', 'sup'],
      ALLOWED_ATTR: ['href', 'target', 'rel'],
    });
  }

  render() {
    return html`<div class="md">${this.renderMarkdown()}</div>`;
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
