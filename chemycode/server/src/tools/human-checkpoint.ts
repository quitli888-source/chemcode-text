// ====== human_checkpoint Tool ======
// A mandatory human-in-the-loop gate for scientific workflows.

import { toolRegistry } from './registry.js';

toolRegistry.register(
  {
    name: 'human_checkpoint',
    title: 'Human Workflow Checkpoint',
    description:
      'Pause the current scientific workflow and require an explicit human decision before continuing. ' +
      'Use at every mandatory checkpoint declared by an active skill. Include the observed evidence, ' +
      'the proposed next action, and any warnings. This confirmation cannot be bypassed by full-access mode.',
    parameters: {
      type: 'object',
      properties: {
        checkpointId: {
          type: 'string',
          description: 'Stable checkpoint identifier from the skill workflow, for example pygamd-H1-environment.',
        },
        title: {
          type: 'string',
          description: 'Short human-readable checkpoint title.',
        },
        evidence: {
          type: 'string',
          description: 'Concrete verified observations and values that justify reaching this checkpoint.',
        },
        nextAction: {
          type: 'string',
          description: 'Exact action that will be performed only if the user approves.',
        },
        warnings: {
          type: 'string',
          description: 'Known risks, failed checks, deviations, or an empty string when none exist.',
        },
      },
      required: ['checkpointId', 'title', 'evidence', 'nextAction'],
    },
    dangerous: true,
    confirmationMode: 'required',
  },
  async (params) => {
    const checkpointId = String(params.checkpointId || '').trim();
    const title = String(params.title || '').trim();
    const evidence = String(params.evidence || '').trim();
    const nextAction = String(params.nextAction || '').trim();
    if (!checkpointId || !title || !evidence || !nextAction) {
      return {
        success: false,
        content: 'A human checkpoint requires a checkpointId, title, concrete evidence, and nextAction.',
      };
    }
    return {
      success: true,
      content:
        `Human checkpoint approved: ${checkpointId}\n` +
        `Next action authorized: ${nextAction}`,
      details: {
        checkpointId,
        title,
        approved: true,
      },
    };
  },
);
