// ====== Knowledge Routes ======

import { Router } from 'express';
import { ah, requireAuth, sendOk, sendErr } from '../middleware.js';
import { store } from '../store.js';

export function knowledgeRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', ah(async (req, res) => {
    const data = store.data(req.userId!);
    return sendOk(res, data.knowledge);
  }));

  r.get('/search', ah(async (req, res) => {
    const q = ((req.query.q as string) || '').toLowerCase().trim();
    const data = store.data(req.userId!);
    if (!q) return sendOk(res, data.knowledge);
    return sendOk(res, data.knowledge.filter((e) =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q))
    ));
  }));

  r.get('/:id', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const e = data.knowledge.find((x) => x.id === req.params.id);
    if (!e) return sendErr(res, 'NOT_FOUND', 'Knowledge entry not found', 404);
    return sendOk(res, e);
  }));

  return r;
}
