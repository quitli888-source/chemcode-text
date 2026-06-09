// ====== WebSocket Gateway ======
// Auth-aware WebSocket connection that runs the agent loop.
//
// When a user sends a message:
//   1. Look up the configured model (API key, URL, model name)
//   2. If a model is configured, run the real agent loop (LLM + tools)
//   3. If no model is configured, fall back to the mock agent
//   4. Route confirm_response events to the ConfirmManager for dangerous tool approval
//
// The frontend doesn't need to know which mode is active — the
// StreamEvent protocol is identical in both cases.

import type { IncomingMessage } from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';
import { verifyToken } from './auth.js';
import { store } from './store.js';
import { apiKeyStorage, MASKED_KEY } from './apikeys.js';
import { runMockAgent } from './mock-agent.js';
import { runAgentLoop, ConfirmManager } from './agent/index.js';
import type { LLMClientConfig } from './llm/client.js';
import type { StreamCommand, StreamEvent, ChatMessage } from './types.js';
import { recordUsage, calculateCost } from './usage.js';
import { buildExtraBody } from './models/provider-config.js';
import fs from 'node:fs';
import path from 'node:path';

export interface Client {
  socket: WebSocket;
  userId: string;
  subscriptions: Set<string>;
  activeRuns: Map<string, AbortController>;
  /** Per-session confirm managers for dangerous tool approval. */
  confirmManagers: Map<string, ConfirmManager>;
}

const clients = new Set<Client>();

export function attachWebSocket(wss: WebSocketServer) {
  wss.on('connection', (socket, req) => handleConnection(socket, req));
}

function handleConnection(socket: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url || '/ws', `http://${req.headers.host || 'localhost'}`);
  const token = url.searchParams.get('token') || '';
  const payload = verifyToken(token);
  if (!payload) {
    socket.close(4001, 'Unauthorized');
    return;
  }

  const client: Client = {
    socket,
    userId: payload.sub,
    subscriptions: new Set(['chat', 'tasks', 'system']),
    activeRuns: new Map(),
    confirmManagers: new Map(),
  };
  clients.add(client);

  console.log(`[ws] client connected userId=${client.userId}`);

  socket.on('message', async (data) => {
    const str = typeof data === 'string' ? data : Buffer.from(data as Buffer).toString('utf-8');
    if (str === 'ping') {
      socket.send('pong');
      return;
    }
    let cmd: StreamCommand;
    try { cmd = JSON.parse(str); } catch { return; }
    try {
      await handleCommand(client, cmd);
    } catch (e) {
      console.error('[ws] handleCommand error:', e);
    }
  });

  socket.on('close', () => {
    console.log(`[ws] client disconnected userId=${client.userId}`);
    for (const ctrl of client.activeRuns.values()) ctrl.abort();
    for (const cm of client.confirmManagers.values()) cm.cancelAll();
    clients.delete(client);
  });

  socket.on('error', (e) => console.warn('[ws] error', e));
}

/**
 * Estimate token count for text. ~4 chars per token for mixed CJK/English.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build conversation history from session messages.
 * Passes ALL history messages without truncation.
 * Excludes the last user message (which is added separately by runAgentLoop).
 * Excludes tool messages (they're internal to the agent loop).
 */
function buildHistory(
  messages: ChatMessage[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const filtered = messages
    .filter((m) => m.type === 'user' || m.type === 'agent')
    .slice(0, -1); // Exclude last message (current user message).

  // Pass all history without any truncation or token budget limits.
  // The agent loop will handle compaction if the context exceeds the window.
  return filtered.map((m) => ({
    role: m.type === 'user' ? 'user' as const : 'assistant' as const,
    content: m.content || '',
  }));
}

/**
 * Resolve the LLM configuration from the user's configured models.
 * Returns undefined if no model is configured (triggers mock fallback).
 */
function resolveLLMConfig(userId: string, requestedModel?: string, thinking?: boolean | string): { config: LLMClientConfig; contextWindow: number } | undefined {
  const data = store.data(userId);
  const models = data.configuredModels;

  if (models.length === 0) return undefined;

  // Find the requested model, or use the default.
  let model = requestedModel
    ? models.find((m) => m.name === requestedModel || m.id === requestedModel)
    : models.find((m) => m.isDefault);

  if (!model) model = models[0];

  // API key is required.
  const realKey = apiKeyStorage.get(userId, model.id);
  if (!realKey || realKey === MASKED_KEY) return undefined;

  const config: LLMClientConfig = {
    apiUrl: model.apiUrl,
    apiKey: realKey,
    model: model.name,  // Preserve original casing (APIs may be case-sensitive).
    provider: model.provider,
    temperature: 0.7,
    ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
  };

  // Apply provider-specific thinking/reasoning configuration.
  // Pass the full thinking level (low/medium/high) so the provider config
  // can map it to specific parameters (e.g. DeepSeek thinking budget).
  const extraBody = buildExtraBody(model.provider || '', thinking || false);
  if (extraBody) {
    config.extraBody = extraBody;
  }

  return {
    config,
    contextWindow: model.contextWindow ?? 128_000,
  };
}

async function handleCommand(client: Client, cmd: StreamCommand) {
  switch (cmd.type) {
    case 'user_message': {
      const abortCtrl = new AbortController();
      client.activeRuns.set(cmd.sessionId, abortCtrl);

      const thinkingLevel = cmd.thinking || 'off';
      const resolved = resolveLLMConfig(client.userId, cmd.model, thinkingLevel);

      if (resolved) {
        const { config: llmConfig, contextWindow } = resolved;
        // Real agent loop with LLM + tools.
        console.log(`[ws] running agent loop: model=${llmConfig.model} provider=${llmConfig.provider} ctx=${contextWindow}`);
        const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        // Persist user message.
        persistUserMessage(client.userId, cmd.sessionId, cmd.content);

        // Get or create ConfirmManager for this session.
        let confirmManager = client.confirmManagers.get(cmd.sessionId);
        if (!confirmManager) {
          confirmManager = new ConfirmManager();
          client.confirmManagers.set(cmd.sessionId, confirmManager);
        }

        // Emit thinking event.
        sendToClient(client, {
          type: 'thinking',
          messageId,
          content: '正在分析请求...',
          topic: 'chat',
        } as StreamEvent);

        // Lock workspace per session: once set, it doesn't change.
        // First message with a workspace sets the lock; subsequent messages ignore cmd.workspace.
        const taskData = store.data(client.userId);
        const session = taskData.sessions[cmd.sessionId];
        let workdir: string;
        if (session && session.workdir) {
          workdir = session.workdir;
        } else {
          workdir = cmd.workspace || process.cwd();
          if (session) {
            session.workdir = workdir;
            // Create the memory folder in the workspace.
            try {
              const memoryDir = path.join(workdir, '.chemycode-memory');
              if (!fs.existsSync(memoryDir)) {
                fs.mkdirSync(memoryDir, { recursive: true });
                fs.writeFileSync(
                  path.join(memoryDir, 'README.md'),
                  `# Chemycode Memory\n\nThis folder stores test history and notes for the current conversation.\n\n- \`notes.md\` — LLM-recorded test notes and observations\n- \`tests/\` — test results and analysis files\n- \`history.log\` — chronological log of actions taken in this workspace\n\nWorkspace: ${workdir}\nLocked at: ${new Date().toISOString()}\n`
                );
                fs.writeFileSync(
                  path.join(memoryDir, 'history.log'),
                  `[${new Date().toISOString()}] Session started. Workspace locked: ${workdir}\n`
                );
              }
            } catch (e) {
              console.warn('[ws] failed to create memory folder:', e);
            }
            store.commit(client.userId);
          }
        }

        // Task creation is now done via the create_task tool (not auto-created).
        const taskId = ''; // placeholder — task updates handled by update_task tool

        try {

          // Load session history for context (excluding the current user message
          // which was just persisted and will be added separately by runAgentLoop).
          // Pass ALL history without any token truncation.
          const sessionData = store.data(client.userId);
          const session = sessionData.sessions[cmd.sessionId];
          const history = session
            ? buildHistory(session.messages)
            : [];

          // Track tool calls to persist them in the session history.
          const toolCalls: Array<{ id: string; name: string; result: string; success: boolean }> = [];

          const { content: finalContent, usage, generatedFiles } = await runAgentLoop({
            llm: llmConfig,
            userMessage: cmd.content,
            sessionId: cmd.sessionId,
            messageId,
            workdir,
            userId: client.userId,
            attachments: cmd.attachments,
            confirmManager,
            signal: abortCtrl.signal,
            history,
            contextWindow,
            activeSkill: cmd.activeSkill,
          }, (ev) => {
            // Track tool call results for history persistence.
            if (ev.type === 'tool_call_start') {
              const tev = ev as { toolCallId: string; toolName: string };
              toolCalls.push({ id: tev.toolCallId, name: tev.toolName, result: '', success: true });
            }
            if (ev.type === 'tool_call_end') {
              const tev = ev as { toolCallId: string; result?: string; error?: string };
              const tc = toolCalls.find((t) => t.id === tev.toolCallId);
              if (tc) {
                tc.result = tev.result || tev.error || '';
                tc.success = !tev.error;
              }
              // Update task progress.
              const taskForProgress = store.data(client.userId).tasks.find((t) => t.id === taskId);
              if (taskForProgress && taskForProgress.jobs) {
                const completedTools = toolCalls.filter((t) => t.success).length;
                taskForProgress.jobs[0].detail = `已完成 ${completedTools} 个工具调用`;
                store.commit(client.userId);
              }
            }
            sendToClient(client, ev);
          });

          // Persist agent response WITH tool calls.
          persistAgentMessage(client.userId, cmd.sessionId, messageId, finalContent, toolCalls);

          // Update task with generated files and mark as completed.
          const taskForUpdate = store.data(client.userId).tasks.find((t) => t.id === taskId);
          if (taskForUpdate) {
            taskForUpdate.status = 'completed';
            taskForUpdate.completedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            taskForUpdate.progress = 100;
            taskForUpdate.outputFiles = generatedFiles.map((f) => f.name);
            if (taskForUpdate.jobs && taskForUpdate.jobs[0]) {
              taskForUpdate.jobs[0].status = 'completed';
              taskForUpdate.jobs[0].detail = `完成 · ${generatedFiles.length} 个产出物 · ${workdir}`;
            }
            store.commit(client.userId);
          }

          // Record usage statistics.
          const costUsd = calculateCost(llmConfig.model, usage.promptTokens, usage.completionTokens);
          recordUsage({
            ts: new Date().toISOString(),
            userId: client.userId,
            sessionId: cmd.sessionId,
            messageId,
            role: 'assistant',
            model: llmConfig.model,
            provider: llmConfig.provider,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            reasoningTokens: usage.reasoningTokens,
            costUsd,
            toolCalls: toolCalls.map(tc => tc.name),
            isError: false,
          });

          // Emit done event.
          sendToClient(client, {
            type: 'done',
            messageId,
            finishReason: 'stop',
            topic: 'chat',
            usage: {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              reasoningTokens: usage.reasoningTokens,
            },
            model: llmConfig.model,
            contextWindow,
            generatedFiles,
          } as StreamEvent);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[ws] agent loop error:', msg);

          // Update task status to error.
          const taskForError = store.data(client.userId).tasks.find((t) => t.id === taskId);
          if (taskForError) {
            taskForError.status = 'error';
            if (taskForError.jobs && taskForError.jobs[0]) {
              taskForError.jobs[0].status = 'error';
              taskForError.jobs[0].detail = msg.slice(0, 100);
            }
            store.commit(client.userId);
          }

          sendToClient(client, {
            type: 'error',
            code: 'AGENT_ERROR',
            message: msg,
            retryable: false,
            topic: 'chat',
          } as StreamEvent);
        }
      } else {
        // No model configured — fall back to mock agent.
        console.log('[ws] no model configured, using mock agent');
        const abort = runMockAgent(client, cmd.sessionId, cmd.content, cmd.model, cmd.attachments);
        abortCtrl.signal.addEventListener('abort', abort);
      }

      client.activeRuns.delete(cmd.sessionId);
      break;
    }
    case 'cancel': {
      const ctrl = client.activeRuns.get(cmd.sessionId);
      if (ctrl) ctrl.abort();
      break;
    }
    case 'confirm_response': {
      // Route to the ConfirmManager for the relevant session.
      // confirmId is stored in the confirm_request event's prompt/options;
      // the confirm_response contains the confirmId from the frontend.
      const { confirmId, optionId } = cmd as { type: 'confirm_response'; confirmId: string; optionId: string };
      let resolved = false;
      for (const cm of client.confirmManagers.values()) {
        if (cm.handleResponse(confirmId, optionId)) {
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        console.warn(`[ws] confirm_response for unknown confirmId=${confirmId}`);
      }
      break;
    }
    case 'ping': {
      client.socket.send('pong');
      break;
    }
  }
}

// ---------- Session persistence helpers ----------

function persistUserMessage(userId: string, sessionId: string, content: string) {
  const data = store.data(userId);
  const session = data.sessions[sessionId];
  if (session) {
    session.messages.push({
      id: `msg-${Date.now()}-u`,
      type: 'user',
      content,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    });
    session.info.lastInteractionAt = new Date().toISOString();
    session.info.messageCount = session.messages.length;
    store.commit(userId);
  }
}

function persistAgentMessage(userId: string, sessionId: string, messageId: string, content: string, toolCalls: Array<{ id: string; name: string; result: string; success: boolean }> = []) {
  const data = store.data(userId);
  const session = data.sessions[sessionId];
  if (session) {
    // Tool call messages (rendered as <chemycode-tool-call-card>).
    for (const tc of toolCalls) {
      session.messages.push({
        id: tc.id,
        type: 'tool',
        content: tc.result || `Called ${tc.name}`,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        toolCallId: tc.id,
        toolName: tc.name,
        toolStatus: tc.success ? 'completed' : 'failed',
      });
    }

    session.messages.push({
      id: messageId,
      type: 'agent',
      content,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    });
    session.info.lastInteractionAt = new Date().toISOString();
    session.info.messageCount = session.messages.length;
    store.commit(userId);
  }
}

// ---------- Client communication ----------

export function sendToClient(client: Client, ev: object) {
  if (client.socket.readyState === client.socket.OPEN) {
    client.socket.send(JSON.stringify(ev));
  }
}

export function sendToSession(client: Client, _sessionId: string, ev: object) {
  sendToClient(client, ev);
}

export function sendToUser(userId: string, ev: object) {
  for (const c of clients) {
    if (c.userId === userId) sendToClient(c, ev);
  }
}

export { clients, store };
