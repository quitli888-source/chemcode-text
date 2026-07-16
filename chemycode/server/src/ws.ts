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
import { logError } from './errorlog.js';
import { appendMessage, appendMessages, getMessages, getMessageCount } from './session-store.js';
import { retrieveRelevant } from './knowledge-store.js';
import { buildExtraBody } from './models/provider-config.js';
import fs from 'node:fs';
import path from 'node:path';
import {
  addRunCancelHook,
  bindTaskToRun,
  cancelSessionRuns,
  registerRun,
  unbindTaskFromRun,
  unregisterRun,
} from './run-registry.js';

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

  // Rebind a disconnected Client object so in-flight runs emit to the new
  // socket. A second Client would leave the run attached to a closed socket.
  let client = [...clients].find((c) => c.userId === payload.sub && c.socket.readyState !== c.socket.OPEN);
  if (client) {
    client.socket = socket;
  } else {
    client = {
      socket,
      userId: payload.sub,
      subscriptions: new Set(['chat', 'tasks', 'system']),
      activeRuns: new Map(),
      confirmManagers: new Map(),
    };
    clients.add(client);
  }

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
    // DON'T immediately abort active runs. The WebSocket may have dropped
    // due to a transient network issue, browser tab switch, or page reload.
    // Give a 60-second grace period: if the client reconnects within that
    // time, the agent continues uninterrupted. If not, then abort.
    //
    // During the grace period, the agent loop continues running and writes
    // results to JSONL via persistAgentMessage. When the client reconnects
    // and loads session history, they'll see the results.
    // sendToClient() silently drops events when socket is closed, so no
    // errors are thrown.
    setTimeout(() => {
      if (client.socket !== socket || client.socket.readyState === client.socket.OPEN) {
        return;
      }
      if (clients.has(client)) {
        console.log(`[ws] grace period expired, aborting runs for userId=${client.userId}`);
        for (const ctrl of client.activeRuns.values()) {
          try { ctrl.abort(); } catch {}
        }
        for (const cm of client.confirmManagers.values()) cm.cancelAll();
        clients.delete(client);
      }
    }, 60_000); // 60 second grace period
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
): Array<{ role: 'user' | 'assistant'; content: string; reasoning_content?: string }> {
  const filtered = messages
    .filter((m) => m.type === 'user' || m.type === 'agent')
    .slice(0, -1); // Exclude last message (current user message).

  // Pass all history without any truncation or token budget limits.
  // The agent loop will handle compaction if the context exceeds the window.
  // CRITICAL: include reasoning_content (thinking) for assistant messages.
  // Thinking-capable providers (ModelArts, DeepSeek-R1, Qwen-QwQ) reject
  // requests where a prior assistant message is missing reasoning_content.
  // We ALWAYS set it (even to empty string) because ModelArts validates
  // field PRESENCE, not value — a missing field triggers 400 even if
  // the model didn't produce thinking content for that message.
  return filtered.map((m) => {
    const entry: { role: 'user' | 'assistant'; content: string; reasoning_content?: string } = {
      role: m.type === 'user' ? 'user' as const : 'assistant' as const,
      content: m.content || '',
    };
    if (m.type === 'agent') {
      // Always set reasoning_content for assistant messages.
      // Use the stored thinking if available, otherwise empty string.
      // This prevents "Missing reasoning_content" 400 errors from
      // older session messages that were persisted without thinking.
      entry.reasoning_content = m.thinking || '';
    }
    return entry;
  });
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

      // Abort any previous run for THIS session before starting a new one.
      // Previously activeRuns was keyed by sessionId, so a new message would
      // overwrite the previous AbortController — making the first run
      // uncancellable. Now we abort the previous run explicitly, then key
      // by messageId so each run can be cancelled independently.
      for (const [key, ctrl] of client.activeRuns) {
        if (key.startsWith(cmd.sessionId + ':')) {
          console.log(`[ws] aborting previous run ${key} for session ${cmd.sessionId}`);
          try { ctrl.abort(); } catch {}
          client.activeRuns.delete(key);
        }
      }

      // Key by sessionId:messageId so cancel can target a specific turn.
      const messageId = cmd.messageId || `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const runKey = registerRun(client.userId, cmd.sessionId, messageId, abortCtrl);
      client.activeRuns.set(runKey, abortCtrl);

      const thinkingLevel = cmd.thinking || 'off';
      const resolved = resolveLLMConfig(client.userId, cmd.model, thinkingLevel);
      recordUsage({
        ts: new Date().toISOString(),
        userId: client.userId,
        sessionId: cmd.sessionId,
        messageId: `${messageId}:user`,
        role: 'user',
        model: resolved?.config.model || cmd.model,
        provider: resolved?.config.provider,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        toolCalls: [],
        isError: false,
      });

      if (resolved) {
        const { config: llmConfig, contextWindow } = resolved;
        // Real agent loop with LLM + tools.
        console.log(`[ws] running agent loop: model=${llmConfig.model} provider=${llmConfig.provider} ctx=${contextWindow}`);
        // messageId was already resolved above (from cmd.messageId or generated)
        // and is used as the runKey for activeRuns and as the confirm key.

        // Persist user message.
        persistUserMessage(client.userId, cmd.sessionId, cmd.content);

        // Get or create ConfirmManager for this session.
        let confirmManager = client.confirmManagers.get(cmd.sessionId);
        if (!confirmManager) {
          confirmManager = new ConfirmManager();
          client.confirmManagers.set(cmd.sessionId, confirmManager);
        }
        addRunCancelHook(runKey, () => confirmManager!.cancelAll());

        // Emit turn_state: thinking + thinking event.
        sendToClient(client, {
          type: 'turn_state',
          state: 'thinking',
          messageId,
          topic: 'chat',
        } as StreamEvent);
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
        if (session && (session.workdir || session.info.workdir)) {
          workdir = session.workdir || session.info.workdir!;
        } else {
          workdir = cmd.workspace || process.cwd();
          if (session) {
            session.workdir = workdir;
            // Also sync to session.info so it's returned by sessions.list API.
            session.info.workdir = workdir;
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

        // Auto-create a task for this agent run so that progress/completion
        // status updates work even if the LLM never calls create_task.
        // If the LLM does call create_task, that tool's result will update
        // activeTaskId to the LLM-created task, and we'll update THAT one.
        const autoTaskId = `T-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 4)}`;
        const autoTaskName = cmd.content.slice(0, 40) || 'Agent 任务';
        const taskData0 = store.data(client.userId);
        taskData0.tasks.unshift({
          id: autoTaskId,
          name: autoTaskName,
          calcType: 'machine_learning' as const,
          status: 'running' as const,
          description: cmd.content.slice(0, 200),
          progress: 0,
          createdAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          parameters: workdir ? { workspace: workdir } : undefined,
          jobs: [{ name: 'Agent 执行中', status: 'running' as const, detail: '正在分析请求...' }],
          outputFiles: [],
          sessionId: cmd.sessionId,
          messageId,
        });
        bindTaskToRun(client.userId, runKey, autoTaskId);
        store.commit(client.userId);

        // Track the active task ID. If the LLM calls create_task, this will be
        // updated to the LLM-created task ID (via the tool_call_end handler below).
        // The auto-created task will be cleaned up if superseded.
        let activeTaskId = autoTaskId;

        // Track tool calls to persist them in the session history (even on error).
        const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown>; result: string; success: boolean }> = [];

        try {

          // Load session history for context (excluding the current user message
          // which was just persisted and will be added separately by runAgentLoop).
          // Pass ALL history without any token truncation.
          const sessionData = store.data(client.userId);
          const session = sessionData.sessions[cmd.sessionId];
          const history = session
            ? buildHistory(getMessages(cmd.sessionId))
            : [];

          // Retrieve knowledge context if user enabled it.
          let knowledgeContext: string | undefined;
          if (cmd.useKnowledge) {
            try {
              const entries = retrieveRelevant(client.userId, cmd.content, 5);
              if (entries.length > 0) {
                knowledgeContext = `## User Knowledge Base (Long-term Memory)
The following are relevant entries from the user's personal knowledge base. Use them as reference context for your response. If the knowledge is not relevant to the current question, ignore it.

${entries.map((e, i) => `### [${i + 1}] ${e.title}
Category: ${e.category} | Tags: ${e.tags.join(', ')}

${e.content}`).join('\n\n---\n\n')}`;
                console.log(`[ws] knowledge context: ${entries.length} entries retrieved`);
              }
            } catch (e) {
              console.warn('[ws] knowledge retrieval failed:', e);
            }
          }

          const { content: finalContent, usage, generatedFiles, thinking: finalThinking } = await runAgentLoop({
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
            useKnowledge: cmd.useKnowledge,
            knowledgeContext,
          }, (ev) => {
            // Track tool call results for history persistence.
            if (ev.type === 'tool_call_start') {
              const tev = ev as { toolCallId: string; toolName: string; args: Record<string, unknown> };
              toolCalls.push({ id: tev.toolCallId, name: tev.toolName, args: tev.args || {}, result: '', success: true });
            }
            if (ev.type === 'tool_call_end') {
              const tev = ev as { toolCallId: string; result?: string; error?: string };
              const tc = toolCalls.find((t) => t.id === tev.toolCallId);
              if (tc) {
                tc.result = tev.result || tev.error || '';
                tc.success = !tev.error;
              }
              // Capture taskId from create_task result so we can track progress.
              // If the LLM created its own task, remove the auto-created one
              // and switch to tracking the LLM-created task instead.
              if (tc && tc.name === 'create_task' && tc.success && tev.result) {
                const m = tev.result.match(/ID:\s*(T-[\w-]+)/);
                if (m && m[1] !== activeTaskId) {
                  // Remove the auto-created task to avoid duplicates.
                  const td = store.data(client.userId);
                  const autoIdx = td.tasks.findIndex((t) => t.id === activeTaskId);
                  if (autoIdx >= 0 && td.tasks[autoIdx].name === autoTaskName) {
                    td.tasks.splice(autoIdx, 1);
                    unbindTaskFromRun(client.userId, activeTaskId);
                    store.commit(client.userId);
                  }
                  activeTaskId = m[1];
                  const llmTask = td.tasks.find((t) => t.id === activeTaskId);
                  if (llmTask) {
                    llmTask.sessionId = cmd.sessionId;
                    llmTask.messageId = messageId;
                  }
                  bindTaskToRun(client.userId, runKey, activeTaskId);
                }
              }
              // Update task progress.
              if (activeTaskId) {
                const taskForProgress = store.data(client.userId).tasks.find((t) => t.id === activeTaskId);
                if (taskForProgress && taskForProgress.jobs) {
                  const completedTools = toolCalls.filter((t) => t.success).length;
                  taskForProgress.jobs[0].detail = `已完成 ${completedTools} 个工具调用`;
                  store.commit(client.userId);
                }
              }
            }
            sendToClient(client, { ...ev, messageId });
          });

          // Persist agent response WITH tool calls + usage metadata + thinking.
          persistAgentMessage(client.userId, cmd.sessionId, messageId, finalContent, toolCalls, {
            usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens, reasoningTokens: usage.reasoningTokens },
            model: llmConfig.model,
            contextWindow,
            thinking: finalThinking,
          });

          const wasCancelled = abortCtrl.signal.aborted;

          // Update task with generated files and mark as completed/cancelled.
          const taskForUpdate = store.data(client.userId).tasks.find((t) => t.id === activeTaskId);
          if (taskForUpdate) {
            taskForUpdate.status = wasCancelled ? 'cancelled' : 'completed';
            taskForUpdate.completedAt = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            if (!wasCancelled) taskForUpdate.progress = 100;
            taskForUpdate.outputFiles = generatedFiles.map((f) => f.name);
            if (taskForUpdate.jobs && taskForUpdate.jobs[0]) {
              taskForUpdate.jobs[0].status = wasCancelled ? 'cancelled' : 'completed';
              taskForUpdate.jobs[0].detail = wasCancelled
                ? '任务已由用户取消'
                : `完成 · ${generatedFiles.length} 个产出物 · ${workdir}`;
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

          // Emit turn_state: done + done event.
          sendToClient(client, {
            type: 'turn_state',
            state: wasCancelled ? 'idle' : 'done',
            messageId,
            topic: 'chat',
          } as StreamEvent);
          sendToClient(client, {
            type: 'done',
            messageId,
            finishReason: wasCancelled ? 'cancelled' : 'stop',
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

          // Emit turn_state: error.
          sendToClient(client, {
            type: 'turn_state',
            state: 'error',
            messageId,
            topic: 'chat',
          } as StreamEvent);

          // Persist error to data/errors.log for post-mortem debugging.
          logError({
            userId: client.userId,
            sessionId: cmd.sessionId,
            messageId,
            source: 'ws.agentLoop',
            message: msg,
            stack: e instanceof Error ? e.stack : undefined,
          });

          // Persist whatever agent message we have so far (even if empty)
          // so the user can see tool calls in history. Use a descriptive
          // message instead of the generic placeholder.
          const isAbort = /aborted|AbortError/i.test(msg);
          const isThrottle = /429|TooManyRequests|rate limit/i.test(msg);
          const errorContent = isAbort
            ? '⚠️ 操作被中断（连接断开或超时）。已完成的工具调用结果已保留在上方，请重新发送消息继续。'
            : isThrottle
            ? '⚠️ 模型接口被限流。已完成的工具调用结果已保留在上方，请稍候重新发送消息继续。'
            : `⚠️ 发生错误：${msg.slice(0, 200)}。已完成的工具调用结果已保留在上方。`;

          persistAgentMessage(client.userId, cmd.sessionId, messageId, errorContent, toolCalls, {
            model: llmConfig.model,
            contextWindow,
            thinking: undefined,
          });

          const wasCancelled = abortCtrl.signal.aborted;

          // Update task status to error/cancelled.
          const taskForError = store.data(client.userId).tasks.find((t) => t.id === activeTaskId);
          if (taskForError) {
            taskForError.status = wasCancelled ? 'cancelled' : 'error';
            if (taskForError.jobs && taskForError.jobs[0]) {
              taskForError.jobs[0].status = wasCancelled ? 'cancelled' : 'error';
              taskForError.jobs[0].detail = wasCancelled ? '任务已由用户取消' : msg.slice(0, 100);
            }
            store.commit(client.userId);
          }

          sendToClient(client, wasCancelled ? {
            type: 'done',
            messageId,
            finishReason: 'cancelled',
            topic: 'chat',
          } as StreamEvent : {
            type: 'error',
            code: 'AGENT_ERROR',
            message: msg,
            retryable: false,
            messageId,
            topic: 'chat',
          } as StreamEvent);
        }
      } else {
        // No model configured — fall back to mock agent.
        console.log('[ws] no model configured, using mock agent');
        const mockRun = runMockAgent(client, cmd.sessionId, cmd.content, cmd.model, cmd.attachments, messageId);
        addRunCancelHook(runKey, mockRun.cancel);
        abortCtrl.signal.addEventListener('abort', mockRun.cancel, { once: true });
        await mockRun.done;
        recordUsage({
          ts: new Date().toISOString(),
          userId: client.userId,
          sessionId: cmd.sessionId,
          messageId,
          role: 'assistant',
          model: cmd.model,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          reasoningTokens: 0,
          costUsd: 0,
          toolCalls: [],
          isError: false,
        });
      }

      client.activeRuns.delete(runKey);
      unregisterRun(runKey);
      break;
    }
    case 'cancel': {
      // P0 FIX: Also cancel all pending confirmations for this session.
      // Without this, the agent loop hangs on an unresolved Promise.
      // Abort ALL runs for this session (keyed by sessionId:messageId).
      for (const [key, ctrl] of client.activeRuns) {
        if (key.startsWith(cmd.sessionId + ':')) {
          try { ctrl.abort(); } catch {}
          client.activeRuns.delete(key);
        }
      }
      const cm = client.confirmManagers.get(cmd.sessionId);
      if (cm) cm.cancelAll();
      cancelSessionRuns(client.userId, cmd.sessionId);
      break;
    }
    case 'confirm_response': {
      // Route to the ConfirmManager for the relevant session.
      // confirmId is stored in the confirm_request event's prompt/options;
      // the confirm_response contains the confirmId from the frontend.
      const { confirmId, optionId, allowTool } = cmd as { type: 'confirm_response'; confirmId: string; optionId: string; allowTool?: boolean };
      // If user chose "always allow", find which tool this confirm was for
      // and add it to the whitelist.
      if (allowTool) {
        for (const cm of client.confirmManagers.values()) {
          const toolName = cm.getPendingToolName(confirmId);
          if (toolName) {
            cm.addAllowedTool(toolName);
            break;
          }
        }
      }
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
    case 'set_access': {
      // Set access mode for the session's ConfirmManager.
      const { sessionId, mode, tools } = cmd as { type: 'set_access'; sessionId: string; mode: 'full' | 'confirm'; tools?: string[] };
      const cm = client.confirmManagers.get(sessionId);
      if (cm) {
        if (mode === 'full') {
          cm.setFullAccess(true);
        } else {
          cm.setFullAccess(false);
          // Optionally also clear specific tools from whitelist.
          if (tools && tools.length > 0) {
            cm.clearAllowedTools(tools);
          } else {
            cm.clearAllowedTools();
          }
        }
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
// Messages are stored in data/sessions/{sessionId}.jsonl via session-store.
// Only session metadata (info, workdir, plan) goes in user.json.

function persistUserMessage(userId: string, sessionId: string, content: string) {
  const data = store.data(userId);
  const session = data.sessions[sessionId];
  if (session) {
    appendMessage(sessionId, {
      id: `msg-${Date.now()}-u`,
      type: 'user',
      content,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      createdAt: Date.now(),
    });
    session.info.lastInteractionAt = new Date().toISOString();
    session.info.messageCount = getMessageCount(sessionId);
    store.commit(userId);
  }
}

function persistAgentMessage(
  userId: string,
  sessionId: string,
  messageId: string,
  content: string,
  toolCalls: Array<{ id: string; name: string; args?: Record<string, unknown>; result: string; success: boolean }> = [],
  meta?: {
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number };
    model?: string;
    contextWindow?: number;
    thinking?: string;
  },
) {
  const data = store.data(userId);
  const session = data.sessions[sessionId];
  if (session) {
    // Build all messages to append in one batch.
    const msgs: ChatMessage[] = [];

    // Tool call messages (rendered as <chemycode-tool-call-card>).
    for (const tc of toolCalls) {
      msgs.push({
        id: tc.id,
        type: 'tool',
        content: tc.result || `Called ${tc.name}`,
        timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        createdAt: Date.now(),
        toolCallId: tc.id,
        toolName: tc.name,
        toolStatus: tc.success ? 'completed' : 'failed',
        toolArgs: tc.args ? JSON.stringify(tc.args) : undefined,
      } as ChatMessage);
    }

    // Agent's final response message.
    // If content is empty, provide a friendly placeholder so the UI doesn't
    // show a blank agent bubble (which the user perceives as "task cut off").
    // NOTE: if text_delta events were already sent during streaming, the
    // frontend already has the real content. The placeholder is ONLY for
    // the JSONL persistence — it does NOT override what the frontend showed.
    // The frontend's handleStreamEvent 'done' handler updates the message
    // with metadata (usage, model) but does NOT overwrite content.
    const displayContent = content && content.trim().length > 0
      ? content
      : '（助手本轮未返回文字内容。可能由于模型接口限流或错误，请重新发送消息重试。）';

    msgs.push({
      id: messageId,
      type: 'agent',
      content: displayContent,
      timestamp: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      createdAt: Date.now(),
      completedAt: Date.now(),
      usage: meta?.usage,
      model: meta?.model,
      contextWindow: meta?.contextWindow,
      thinking: meta?.thinking,
    } as ChatMessage);

    // Append all messages to the session JSONL file in one batch.
    appendMessages(sessionId, msgs);

    session.info.lastInteractionAt = new Date().toISOString();
    session.info.messageCount = getMessageCount(sessionId);
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
