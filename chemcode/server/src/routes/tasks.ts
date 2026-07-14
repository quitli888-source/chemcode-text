// ====== Tasks Routes ======

import { Router } from 'express';
import { ah, requireAuth, sendOk, sendErr } from '../middleware.js';
import { store } from '../store.js';
import type { Task } from '../types.js';

function rid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function tasksRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const status = req.query.status as string | undefined;
    const tasks = status ? data.tasks.filter((t) => t.status === status) : data.tasks;
    return sendOk(res, { tasks, total: tasks.length });
  }));

  r.get('/:id', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const t = data.tasks.find((x) => x.id === req.params.id);
    if (!t) return sendErr(res, 'NOT_FOUND', 'Task not found', 404);
    return sendOk(res, t);
  }));

  r.post('/', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const { name, calcType, description, parameters } = req.body || {};
    if (!name || !calcType) return sendErr(res, 'INVALID_INPUT', 'name and calcType required', 400);
    const t: Task = {
      id: rid('T'),
      name,
      calcType,
      status: 'waiting',
      description: description || '',
      createdAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      parameters,
    };
    data.tasks.unshift(t);
    store.commit(req.userId!);
    return sendOk(res, t, 201);
  }));

  r.post('/:id/cancel', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const t = data.tasks.find((x) => x.id === req.params.id);
    if (!t) return sendErr(res, 'NOT_FOUND', 'Task not found', 404);
    t.status = 'completed';
    store.commit(req.userId!);
    return sendOk(res, undefined);
  }));

  r.delete('/:id', ah(async (req, res) => {
    const data = store.data(req.userId!);
    data.tasks = data.tasks.filter((x) => x.id !== req.params.id);
    store.commit(req.userId!);
    return sendOk(res, undefined);
  }));

  return r;
}
