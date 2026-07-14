// ====== Sessions Routes ======

import { Router } from 'express';
import { ah, requireAuth, sendOk, sendErr } from '../middleware.js';
import { store } from '../store.js';
import { appendMessage, getMessages, getMessageCount, deleteMessages } from '../session-store.js';
import type { ChatMessage, SessionInfo } from '../types.js';

function rid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function sessionsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const list = Object.values(data.sessions).map((s) => s.info);
    list.sort((a, b) => b.lastInteractionAt.localeCompare(a.lastInteractionAt));
    return sendOk(res, list);
  }));

  r.post('/', ah(async (req, res) => {
    const { model, title, agentId } = req.body || {};
    const data = store.data(req.userId!);
    const id = rid('S');
    const info: SessionInfo = {
      id,
      title: title || '新对话',
      agentId: agentId || 'default',
      model,
      createdAt: new Date().toISOString(),
      lastInteractionAt: new Date().toISOString(),
      messageCount: 0,
      status: 'active',
    };
    data.sessions[id] = {
      info,
    };
    // Persist the welcome system message to the session JSONL file.
    const sysMsg: ChatMessage = {
      id: rid('sys'),
      type: 'system',
      content: '欢迎使用 Chemcode！我可以帮你完成计算化学任务，随时开始对话。',
      timestamp: timeLabel(new Date()),
      createdAt: Date.now(),
    };
    appendMessage(id, sysMsg);
    info.messageCount = 1;
    store.commit(req.userId!);
    return sendOk(res, info, 201);
  }));

  r.get('/:id', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const s = data.sessions[req.params.id];
    if (!s) return sendErr(res, 'NOT_FOUND', 'Session not found', 404);
    return sendOk(res, s.info);
  }));

  r.patch('/:id', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const s = data.sessions[req.params.id];
    if (!s) return sendErr(res, 'NOT_FOUND', 'Session not found', 404);
    const { title } = req.body || {};
    if (title !== undefined) {
      s.info.title = String(title).trim() || '新对话';
      store.commit(req.userId!);
    }
    return sendOk(res, s.info);
  }));

  r.get('/:id/history', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const s = data.sessions[req.params.id];
    if (!s) return sendErr(res, 'NOT_FOUND', 'Session not found', 404);
    // Load messages from the JSONL file (not from user.json).
    return sendOk(res, {
      session: s.info,
      messages: getMessages(req.params.id),
      hasMore: false,
      plan: s.plan || [],
      planExplanation: s.planExplanation || null,
    });
  }));

  r.delete('/:id', ah(async (req, res) => {
    const data = store.data(req.userId!);
    delete data.sessions[req.params.id];
    // Also delete the session message JSONL file.
    deleteMessages(req.params.id);
    store.commit(req.userId!);
    return sendOk(res, undefined);
  }));

  r.post('/:id/messages', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const s = data.sessions[req.params.id];
    if (!s) return sendErr(res, 'NOT_FOUND', 'Session not found', 404);
    const { content } = req.body || {};
    if (!content) return sendErr(res, 'INVALID_INPUT', 'content required', 400);
    const msg: ChatMessage = {
      id: rid('msg'),
      type: 'user',
      content,
      timestamp: timeLabel(new Date()),
      createdAt: Date.now(),
    };
    // Append to the session JSONL file.
    appendMessage(req.params.id, msg);
    s.info.lastInteractionAt = new Date().toISOString();
    s.info.messageCount = getMessageCount(req.params.id);
    store.commit(req.userId!);
    return sendOk(res, undefined, 202);
  }));

  r.post('/:id/cancel', ah(async (req, res) => {
    // The cancel command normally goes over WebSocket; this HTTP endpoint is
    // a fallback for clients that only have REST.
    return sendOk(res, undefined);
  }));

  return r;
}
