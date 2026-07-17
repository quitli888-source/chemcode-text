// ====== Built-in Workflow View ======
// A lightweight workflow launcher that starts common chemistry tasks directly in chat.

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { sendMessage, setView } from '../state';

interface WorkflowTemplate {
  id: string;
  title: string;
  summary: string;
  category: string;
  estimatedTime: string;
  prompt: string;
  highlights: string[];
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'md-sim',
    title: '蛋白质分子动力学模拟',
    summary: '从体系准备、力场选择到模拟参数建议，一键生成执行计划。',
    category: 'Molecular dynamics',
    estimatedTime: '5-10 分钟',
    prompt: '请帮我规划一个蛋白质分子动力学模拟方案，重点说明力场、溶剂、温度和模拟时长。',
    highlights: ['体系准备', '力场选择', '初始参数'],
  },
  {
    id: 'dft-ads',
    title: 'MOF 吸附 DFT 计算',
    summary: '为吸附体系生成 DFT 计算参数与后处理建议。',
    category: 'DFT',
    estimatedTime: '3-7 分钟',
    prompt: '请帮我设计一个 MOF 吸附体系的 DFT 计算流程，并给出推荐的泛函、基组和收敛条件。',
    highlights: ['吸附位点', '泛函选择', '收敛检查'],
  },
  {
    id: 'reaction-path',
    title: '反应路径与过渡态分析',
    summary: '自动拆解反应步骤、推荐方法与分析指标。',
    category: 'Quantum chemistry',
    estimatedTime: '4-8 分钟',
    prompt: '请帮我设计一个 SN2 反应的过渡态搜索与反应路径分析流程，并说明需要哪些计算步骤。',
    highlights: ['反应坐标', 'TS 搜索', '结果验证'],
  },
];

@customElement('workflow-view')
export class WorkflowView extends LitElement {
  static styles = css`
    :host { display: block; padding: var(--spacing-lg); max-width: 960px; margin: 0 auto; }
    .hero {
      background: linear-gradient(135deg, var(--color-accent-light), var(--color-background-primary));
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-xl);
      padding: var(--spacing-lg);
      margin-bottom: var(--spacing-lg);
    }
    .hero h1 { margin: 0 0 8px; font-size: var(--font-size-2xl); }
    .hero p { margin: 0; color: var(--color-text-secondary); line-height: 1.6; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--spacing-md); }
    .card {
      background: var(--color-background-primary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: var(--border-radius-lg);
      padding: var(--spacing-md);
      display: flex; flex-direction: column; gap: var(--spacing-sm);
    }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
    .chip {
      background: var(--color-background-secondary);
      border: 0.5px solid var(--color-border-tertiary);
      border-radius: 100px;
      padding: 2px 8px;
    }
    .highlights { display: flex; flex-wrap: wrap; gap: 6px; }
    .highlight {
      padding: 3px 8px; border-radius: 100px; font-size: var(--font-size-xs);
      background: var(--color-accent-light); color: var(--color-accent);
    }
    .start-btn {
      margin-top: auto; padding: 8px 12px; border: none; border-radius: var(--border-radius-md);
      background: var(--color-accent); color: white; cursor: pointer; font-weight: var(--font-weight-medium);
    }
    .start-btn:hover { background: var(--color-accent-hover); }
  `;

  @state() private runningId: string | null = null;

  private async startWorkflow(template: WorkflowTemplate) {
    this.runningId = template.id;
    setView('chat');
    await sendMessage(template.prompt, { thinking: true });
    this.runningId = null;
  }

  render() {
    return html`
      <div>
        <section class="hero">
          <h1>⚙️ 内置工作流</h1>
          <p>从常见的计算化学任务模板出发，直接把任务发到聊天界面里继续细化与执行。</p>
        </section>

        <div class="grid">
          ${WORKFLOW_TEMPLATES.map((template) => html`
            <div class="card">
              <div class="meta">
                <span class="chip">${template.category}</span>
                <span class="chip">${template.estimatedTime}</span>
              </div>
              <h3>${template.title}</h3>
              <p>${template.summary}</p>
              <div class="highlights">
                ${template.highlights.map((item) => html`<span class="highlight">${item}</span>`)}
              </div>
              <button class="start-btn" @click=${() => this.startWorkflow(template)}>
                ${this.runningId === template.id ? '启动中…' : '开始工作流'}
              </button>
            </div>
          `)}
        </div>
      </div>
    `;
  }
}
