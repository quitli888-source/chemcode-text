// ====== 数据库检索路由 ======

import { Router } from 'express';
import { ah, sendOk, sendErr } from '../middleware.js';
import {
  getCollectionStatus,
  search,
  scrollPoints,
  getConfig,
  updateEmbeddingConfig,
  testConnection,
  preloadCache,
} from '../db/qdrant.js';

export function databaseRouter(): Router {
  const r = Router();

  /** GET /api/database/status */
  r.get('/status', ah(async (_req, res) => {
    const status = await getCollectionStatus();
    return sendOk(res, status);
  }));

  /** POST /api/database/search */
  r.post('/search', ah(async (req, res) => {
    const { query, top_k } = req.body || {};
    if (!query || typeof query !== 'string' || !query.trim()) {
      return sendErr(res, 'MISSING_QUERY', '请提供检索关键词', 400);
    }
    const limit = Math.min(Math.max(Number(top_k) || 10, 1), 50);
    const result = await search(query.trim(), limit);
    return sendOk(res, { query: query.trim(), top_k: limit, ...result });
  }));

  /** POST /api/database/scroll */
  r.post('/scroll', ah(async (req, res) => {
    const { limit } = req.body || {};
    const result = await scrollPoints(Math.min(Math.max(Number(limit) || 10, 1), 100));
    return sendOk(res, { total: (await getCollectionStatus()).points_count, ...result });
  }));

  /** GET /api/database/config */
  r.get('/config', ah(async (_req, res) => {
    return sendOk(res, getConfig());
  }));

  /** POST /api/database/config */
  r.post('/config', ah(async (req, res) => {
    const { provider, api_key, model } = req.body || {};
    updateEmbeddingConfig({ provider: provider as string, apiKey: api_key as string, model: model as string });
    return sendOk(res, { message: 'Embedding 配置已更新', ...getConfig() });
  }));

  /** POST /api/database/reconnect — 测试连接 */
  r.post('/reconnect', ah(async (_req, res) => {
    const ok = await testConnection();
    const status = await getCollectionStatus();
    return sendOk(res, { reconnected: ok, ...status });
  }));

  /** POST /api/database/reindex — 刷新缓存 */
  r.post('/reindex', ah(async (_req, res) => {
    await preloadCache();
    const cfg = getConfig();
    return sendOk(res, { message: '缓存已刷新', cached_points: cfg.cached_points });
  }));

  return r;
}
