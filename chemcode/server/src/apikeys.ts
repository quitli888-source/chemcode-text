// ====== API Key Store ======
// Dedicated, separate storage for API keys.
// Keys are NEVER stored in the user data JSON — only here.
//
// File: data/apikeys.json
// Format: { "<userId>": { "<modelId>": "<apiKey>" } }
//
// Benefits:
//   - Single source of truth for sensitive keys
//   - Easy to back up / rotate / audit
//   - Not mixed with general user data
//   - Can be gitignored independently

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './storage.js';

interface ApiKeyStore {
  [userId: string]: {
    [modelId: string]: string;
  };
}

const KEY_FILE = path.join(dataDir(), 'apikeys.json');

class ApiKeyStorage {
  private cache: ApiKeyStore | null = null;

  private load(): ApiKeyStore {
    if (this.cache) return this.cache;
    try {
      fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
      const raw = fs.readFileSync(KEY_FILE, 'utf-8');
      this.cache = JSON.parse(raw) as ApiKeyStore;
    } catch {
      this.cache = {};
      this.save();
    }
    return this.cache!;
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
      const tmp = KEY_FILE + '.tmp.' + Date.now().toString(36);
      fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf-8');
      fs.renameSync(tmp, KEY_FILE);
    } catch (e) {
      console.warn('[apikeys] save failed', e);
    }
  }

  /** Set an API key for a model. */
  set(userId: string, modelId: string, apiKey: string): void {
    const store = this.load();
    if (!store[userId]) store[userId] = {};
    store[userId][modelId] = apiKey;
    this.save();
  }

  /** Get an API key for a model. Returns undefined if not set. */
  get(userId: string, modelId: string): string | undefined {
    const store = this.load();
    return store[userId]?.[modelId];
  }

  /** Remove an API key for a model. */
  delete(userId: string, modelId: string): void {
    const store = this.load();
    if (store[userId]) {
      delete store[userId][modelId];
      if (Object.keys(store[userId]).length === 0) delete store[userId];
      this.save();
    }
  }

  /** Check if a key exists for the model. */
  has(userId: string, modelId: string): boolean {
    return !!this.get(userId, modelId);
  }

  /** Reload from disk (for hot-reload scenarios). */
  reload(): void {
    this.cache = null;
    this.load();
  }
}

export const apiKeyStorage = new ApiKeyStorage();

/** Masked key placeholder used when displaying keys in the UI. */
export const MASKED_KEY = 'sk-***';
