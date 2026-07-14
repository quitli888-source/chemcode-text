// ====== Mock Agent (Fallback) ======
// Minimal fallback when no LLM model is configured.
// Sends a simple echo response with the same StreamEvent protocol.
// NOT used when a real model is configured — the agent loop handles that.

import { sendToClient, type Client } from './ws.js';
import { store } from './store.js';
import { appendMessage, getMessageCount } from './session-store.js';
import type { ChatMessage, StreamEvent } from './types.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function runMockAgent(
  client: Client,
  sessionId: string,
  prompt: string,
  _model?: string,
  _attachments?: string[],
): () => void {
  let cancelled = false;
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const T = 'chat' as const;

  // Persist user message to session JSONL.
  const userData = store.data(client.userId);
  const session = userData.sessions[sessionId];
  if (session) {
    appendMessage(sessionId, {
      id: `msg-${Date.now()}-u`,
      type: 'user',
      content: prompt,
      timestamp: timeLabel(new Date()),
      createdAt: Date.now(),
    });
    session.info.lastInteractionAt = new Date().toISOString();
    session.info.messageCount = getMessageCount(sessionId);
    store.commit(client.userId);
  }

  (async () => {
    try {
      // 1. thinking
      sendToClient(client, {
        type: 'thinking', messageId,
        content: '正在分析请求...',
        topic: T,
      } satisfies StreamEvent);
      await sleep(300);
      if (cancelled) return;

      // 2. text: inform user no model is configured
      const text = `⚠️ 当前未配置 LLM 模型，无法执行 AI 对话。\n\n请前往 **设置 → 模型管理** 添加模型（支持 OpenAI / DeepSeek / Anthropic 等兼容 API）。\n\n配置后即可使用完整的 AI Agent 功能，包括工具调用、文件读写、代码执行等。`;

      const chars = Array.from(text);
      for (let i = 0; i < chars.length; i += 3) {
        if (cancelled) return;
        sendToClient(client, {
          type: 'text_delta', messageId,
          delta: chars.slice(i, i + 3).join(''),
          index: i,
          topic: T,
        } satisfies StreamEvent);
        await sleep(15 + Math.random() * 25);
      }

      // 3. done
      sendToClient(client, {
        type: 'done', messageId,
        finishReason: 'stop',
        topic: T,
        generatedFiles: [],
      } satisfies StreamEvent);

      // 4. persist agent message to session JSONL
      if (session) {
        appendMessage(sessionId, {
          id: messageId, type: 'agent', content: text,
          timestamp: timeLabel(new Date()),
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        session.info.lastInteractionAt = new Date().toISOString();
        session.info.messageCount = getMessageCount(sessionId);
        store.commit(client.userId);
      }
    } catch (e) {
      console.error('[mock-agent] error', e);
      sendToClient(client, {
        type: 'error', code: 'AGENT_ERROR',
        message: String(e), retryable: false, topic: T,
      } satisfies StreamEvent);
    }
  })();

  return () => { cancelled = true; };
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
