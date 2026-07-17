// ====== update_plan Tool ======
// Allows the LLM to maintain a structured working plan.
// Follows OpenClaw's update_plan pattern.
//
// Reference: openclaw-tools-src/agents/tools/update-plan-tool.ts

import { toolRegistry } from './registry.js';
import { store } from '../store.js';

const VALID_STATUSES = ['pending', 'in_progress', 'completed'] as const;

toolRegistry.register(
  {
    name: 'update_plan',
    title: 'Update Plan',
    description: 'Update your working plan. Use this to track progress on multi-step tasks. The plan is displayed to the user. Each step has a status: pending, in_progress, or completed. At most one step can be in_progress at a time.',
    parameters: {
      type: 'object',
      properties: {
        explanation: {
          type: 'string',
          description: 'Short note explaining what changed.',
        },
        plan: {
          type: 'array',
          description: 'Ordered list of plan steps. Each item is an object with "step" (string, required) and "status" (string: pending/in_progress/completed). Example: [{"step": "分析问题", "status": "in_progress"}]',
          items: {
            type: 'object',
            properties: {
              step: { type: 'string', description: 'The step description.' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Current status.' },
            },
            required: ['step'],
          },
        } as any,
      },
      required: ['plan'],
    },
  },
  async (params, ctx) => {
    let plan = params.plan;
    // If plan is a string (LLM passed JSON string), try to parse it.
    if (typeof plan === 'string') {
      try { plan = JSON.parse(plan); } catch {
        return { content: 'Error: plan must be a JSON array, not a string. Pass it as an array of objects.', success: false };
      }
    }
    if (!Array.isArray(plan) || plan.length === 0) {
      return { content: 'Error: plan must be a non-empty array', success: false };
    }

    const steps: Array<{ step: string; status: string }> = [];
    let inProgressCount = 0;

    for (let i = 0; i < plan.length; i++) {
      const entry = plan[i] as Record<string, unknown>;
      // Accept both 'step' and 'description' as the step text (LLMs often use either).
      const step = typeof entry.step === 'string' ? entry.step
        : typeof entry.description === 'string' ? entry.description
        : typeof entry.text === 'string' ? entry.text
        : '';
      const status = typeof entry.status === 'string' ? entry.status : 'pending';

      if (!step) {
        return { content: `Error: plan[${i}] must have a "step" property (string). Got keys: ${Object.keys(entry).join(', ')}. Example: {"step": "Do something", "status": "pending"}`, success: false };
      }
      if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
        return { content: `Error: plan[${i}].status must be one of: ${VALID_STATUSES.join(', ')}`, success: false };
      }
      if (status === 'in_progress') inProgressCount++;
      steps.push({ step, status });
    }

    if (inProgressCount > 1) {
      return { content: 'Error: at most one step can be in_progress', success: false };
    }

    // Store plan in session state.
    const data = store.data(ctx.userId);
    const session = data.sessions[ctx.sessionId || ''];
    if (session) {
      session.plan = steps;
      session.planExplanation = typeof params.explanation === 'string' ? params.explanation : undefined;
      store.commit(ctx.userId);
    }

    const explanation = typeof params.explanation === 'string' ? ` (${params.explanation})` : '';
    return {
      content: `Plan updated${explanation}: ${steps.length} steps, ${steps.filter((s) => s.status === 'completed').length} completed`,
      success: true,
      details: { plan: steps },
    };
  },
);
