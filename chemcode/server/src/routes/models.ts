// ====== Models Routes ======
// API keys are stored in a DEDICATED config file (data/apikeys.json),
// never in the user data JSON. The user data stores only a masked
// placeholder. This keeps sensitive keys in one auditable location.

import { Router } from 'express';
import { ah, requireAuth, sendOk, sendErr } from '../middleware.js';
import { store } from '../store.js';
import { apiKeyStorage, MASKED_KEY } from '../apikeys.js';
import { getModelDefaults } from '../models/catalog.js';
import type { ConfiguredModel } from '../types.js';

function rid(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function maskKey(k: string): string {
  if (!k) return '';
  if (k.length < 8) return '***';
  return `${k.slice(0, 3)}***${k.slice(-3)}`;
}

/** Resolve the real API key from the dedicated key store. */
function resolveKey(userId: string, modelId: string): string | undefined {
  return apiKeyStorage.get(userId, modelId);
}

export function modelsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', ah(async (req, res) => {
    const data = store.data(req.userId!);
    // Return models with masked keys (real keys are in apikeys.json).
    return sendOk(res, data.configuredModels.map((m) =>
      ({ ...m, apiKey: maskKey(resolveKey(req.userId!, m.id) || '') })));
  }));

  r.post('/', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const { name, apiUrl, apiKey, supportsContext, provider, isDefault, contextWindow, maxTokens } = req.body || {};
    if (!name || !apiUrl || !apiKey || !provider) {
      return sendErr(res, 'INVALID_INPUT', 'name, apiUrl, apiKey, provider required', 400);
    }
    // Dedupe by name.
    data.configuredModels = data.configuredModels.filter((m) => m.name !== name);
    if (isDefault) data.configuredModels.forEach((m) => (m.isDefault = false));

    // Auto-fill from model catalog if not provided.
    const defaults = getModelDefaults(name);

    const m: ConfiguredModel = {
      id: rid(),
      name, apiUrl,
      apiKey: maskKey(apiKey),
      supportsContext: !!supportsContext,
      provider,
      isDefault: !!isDefault,
      contextWindow: contextWindow ?? defaults.contextWindow,
      maxTokens: maxTokens ?? defaults.maxTokens,
      reasoning: defaults.reasoning,
    };
    // Save real key to dedicated config file.
    apiKeyStorage.set(req.userId!, m.id, apiKey);
    data.configuredModels.push(m);
    store.commit(req.userId!);
    return sendOk(res, { ...m, apiKey: maskKey(apiKey) }, 201);
  }));

  r.patch('/:id', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const m = data.configuredModels.find((x) => x.id === req.params.id);
    if (!m) return sendErr(res, 'NOT_FOUND', 'Model not found', 404);
    const { name, apiUrl, apiKey, supportsContext, provider, isDefault, contextWindow, maxTokens } = req.body || {};
    if (name !== undefined) m.name = name;
    if (apiUrl !== undefined) m.apiUrl = apiUrl;
    if (apiKey !== undefined && apiKey.trim() !== '' && !apiKey.startsWith(MASKED_KEY)) {
      apiKeyStorage.set(req.userId!, m.id, apiKey.trim());
    }
    if (supportsContext !== undefined) m.supportsContext = !!supportsContext;
    if (provider !== undefined) m.provider = provider;
    if (contextWindow !== undefined) m.contextWindow = Number(contextWindow);
    if (maxTokens !== undefined) m.maxTokens = Number(maxTokens);
    if (isDefault) data.configuredModels.forEach((x) => (x.isDefault = x.id === m.id));
    store.commit(req.userId!);
    return sendOk(res, { ...m, apiKey: maskKey(resolveKey(req.userId!, m.id) || '') });
  }));

  r.delete('/:id', ah(async (req, res) => {
    const data = store.data(req.userId!);
    data.configuredModels = data.configuredModels.filter((x) => x.id !== req.params.id);
    // Remove the key from the dedicated store.
    apiKeyStorage.delete(req.userId!, req.params.id);
    store.commit(req.userId!);
    return sendOk(res, undefined);
  }));

  r.post('/:id/test', ah(async (req, res) => {
    const data = store.data(req.userId!);
    const m = data.configuredModels.find((x) => x.id === req.params.id);
    if (!m) return sendErr(res, 'NOT_FOUND', 'Model not found', 404);
    // Read real key from dedicated config file.
    const realKey = resolveKey(req.userId!, m.id);
    if (!realKey) {
      return sendErr(res, 'NO_API_KEY', 'Model has no API key configured', 400);
    }
    const start = Date.now();
    try {
      const url = `${m.apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/models`;
      const r = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${realKey}`,
          'api-key': realKey,  // Support Azure/MiMo-style api-key header.
        },
      });
      const latencyMs = Date.now() - start;
      if (r.ok) {
        const body = await r.json().catch(() => ({})) as { data?: { id: string }[] };
        const models = body.data?.map((x) => x.id) || [m.name];
        return sendOk(res, { success: true, latencyMs, models });
      } else {
        const errText = await r.text().catch(() => '');
        return sendOk(res, { success: false, latencyMs, error: `HTTP ${r.status}: ${errText.slice(0, 100)}` });
      }
    } catch (e) {
      const latencyMs = Date.now() - start;
      const msg = e instanceof Error ? e.message : String(e);
      return sendOk(res, { success: false, latencyMs, error: msg });
    }
  }));

  r.post('/:id/default', ah(async (req, res) => {
    const data = store.data(req.userId!);
    data.configuredModels.forEach((x) => (x.isDefault = x.id === req.params.id));
    store.commit(req.userId!);
    return sendOk(res, undefined);
  }));

  return r;
}
