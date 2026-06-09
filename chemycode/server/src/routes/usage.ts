// ====== Usage Routes ======
// GET /api/usage — aggregated usage statistics with time range filtering.

import { Router } from 'express';
import { ah, requireAuth, sendOk } from '../middleware.js';
import { aggregateUsage } from '../usage.js';

export function usageRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', ah(async (req, res) => {
    const range = String(req.query.range || '7d');
    const now = new Date();
    let from: string | undefined;

    switch (range) {
      case '1d':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        break;
      case '7d':
        from = new Date(now.getTime() - 7 * 86400_000).toISOString();
        break;
      case '30d':
        from = new Date(now.getTime() - 30 * 86400_000).toISOString();
        break;
      default:
        from = undefined; // all time
    }

    const query = {
      userId: req.userId!,
      from,
      to: now.toISOString(),
      model: req.query.model ? String(req.query.model) : undefined,
      provider: req.query.provider ? String(req.query.provider) : undefined,
      sessionId: req.query.sessionId ? String(req.query.sessionId) : undefined,
    };

    const summary = aggregateUsage(query);
    return sendOk(res, summary);
  }));

  return r;
}
