// ====== sessions_spawn Tool ======
// Spawn a sub-agent to work on a specific task in an isolated session.
// Follows OpenClaw's sessions_spawn pattern.
//
// Key design decisions:
//   1. Sub-agent events are NOT forwarded to the parent by default (isolation).
//      Set `emitToParent: true` to stream sub-agent events through to the client.
//   2. No timeout — runs until complete or parent abort signal fires.
//
// Reference: openclaw-tools-src/agents/tools/sessions-spawn-tool.ts

import { toolRegistry } from './registry.js';
import { store } from '../store.js';
import { apiKeyStorage, MASKED_KEY } from '../apikeys.js';
import { buildExtraBody } from '../models/provider-config.js';
import type { StreamEvent } from '../types.js';

toolRegistry.register(
  {
    name: 'sessions_spawn',
    title: 'Spawn Sub-Agent',
    description: 'Spawn a sub-agent to work on a specific task in an isolated session. The sub-agent runs independently and returns its result when complete. Use for parallel work on independent subtasks.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task for the sub-agent to perform.',
        },
        label: {
          type: 'string',
          description: 'Human-readable label for this sub-agent (e.g. "calc-benzene-energy").',
        },
        emitToParent: {
          type: 'boolean',
          description: 'If true, forward sub-agent streaming events (text_delta, tool_call_*, thinking, etc.) to the parent session. Default: false (events are silently dropped).',
        },
      },
      required: ['task'],
    },
  },
  async (params, ctx) => {
    const task = typeof params.task === 'string' ? params.task : '';
    if (!task) {
      return { content: 'Error: task is required', success: false };
    }

    const label = typeof params.label === 'string' ? params.label : '';
    const emitToParent = params.emitToParent === true;

    // Import agent loop lazily to avoid circular deps.
    const { runAgentLoop } = await import('../agent/loop.js');

    // Resolve LLM config from store.
    const data = store.data(ctx.userId);
    const models = data.configuredModels;
    let model = models.find((m) => m.isDefault) || models[0];

    if (!model) {
      return { content: 'Error: No LLM model configured. Cannot spawn sub-agent.', success: false };
    }

    const realKey = apiKeyStorage.get(ctx.userId, model.id);
    if (!realKey || realKey === MASKED_KEY) {
      return {
        content: 'Error: No API key found for the configured model. Cannot spawn sub-agent.',
        success: false,
      };
    }

    // Create child session.
    const childSessionId = `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    data.sessions[childSessionId] = {
      info: {
        id: childSessionId,
        title: label || `Sub: ${task.slice(0, 40)}`,
        agentId: 'sub-agent',
        model: model.name,
        createdAt: new Date().toISOString(),
        lastInteractionAt: new Date().toISOString(),
        messageCount: 0,
        status: 'active',
      },
      messages: [],
    };
    store.commit(ctx.userId);

    const extraBody = buildExtraBody(model.provider || '', false);
    const llmConfig = {
      apiUrl: model.apiUrl,
      apiKey: realKey,
      model: model.name,
      provider: model.provider,
      temperature: 0.7,
      ...(extraBody ? { extraBody } : {}),
    };

    // ── Streaming passthrough ──
    const parentSendEvent = ctx.sendEvent;
    const childSendEvent = emitToParent && parentSendEvent
      ? (ev: StreamEvent) => {
          parentSendEvent({
            ...ev,
            ...(ev.type === 'tool_call_start' || ev.type === 'tool_call_update' || ev.type === 'tool_call_end'
              ? { toolCallId: `[sub:${childSessionId}] ${(ev as { toolCallId: string }).toolCallId}` }
              : {}),
            topic: 'sub-agent',
            subAgentSessionId: childSessionId,
            subAgentLabel: label || task.slice(0, 40),
          } as StreamEvent & { subAgentSessionId: string; subAgentLabel: string });
        }
      : (_ev: StreamEvent) => { /* silent drop — default isolation */ };

    try {
      // AbortController for parent signal forwarding (no timeout).
      const controller = new AbortController();

      // Reject if parent signal is already aborted.
      const parentSignal = ctx.signal;
      if (parentSignal?.aborted) {
        controller.abort(parentSignal.reason);
        return { content: 'Parent agent was cancelled', success: false, details: { sessionId: childSessionId } };
      }

      // Forward parent abort to child.
      parentSignal?.addEventListener('abort', () => {
        controller.abort(parentSignal.reason);
      }, { once: true });

      // Run the agent loop.
      const result = await runAgentLoop({
        llm: llmConfig,
        userMessage: task,
        sessionId: childSessionId,
        messageId: `sub-msg-${Date.now()}`,
        workdir: ctx.workdir,
        userId: ctx.userId,
        signal: controller.signal,
      }, childSendEvent);

      // Store result in child session.
      const childData = store.data(ctx.userId);
      const childSession = childData.sessions[childSessionId];
      if (childSession) {
        childSession.info.status = 'idle';
        childSession.info.lastInteractionAt = new Date().toISOString();
        store.commit(ctx.userId);
      }

      return {
        content: result.content || '(sub-agent completed with no output)',
        success: true,
        details: {
          sessionId: childSessionId,
          label: label || task.slice(0, 40),
        },
      };
    } catch (e) {
      // Ensure child session reflects the error.
      const childData = store.data(ctx.userId);
      const childSession = childData.sessions[childSessionId];
      if (childSession) {
        childSession.info.status = 'idle';
        store.commit(ctx.userId);
      }

      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: `Sub-agent error: ${msg}`,
        success: false,
        details: { sessionId: childSessionId },
      };
    }
  },
);
