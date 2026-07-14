// ====== In-memory Store ======
// Single-process, single-tenant store. Persists to disk on every mutation
// and reloads on boot. Good enough for the demo and a development backend.
//
// Each user has their own slice of data. The store keeps an in-memory index
// keyed by userId. The mock data seeded here mirrors the original frontend
// mock so the UI looks the same in mock mode.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  ConfiguredModel,
  KnowledgeEntry,
  SessionInfo,
  SkillEntry,
  Task,
  UserProfile,
  ChatMessage,
} from './types.js';
import { dataDir } from './storage.js';
import { migrateFromUserData } from './session-store.js';

interface UserData {
  tasks: Task[];
  knowledge: KnowledgeEntry[];
  skills: SkillEntry[];
  configuredModels: ConfiguredModel[];
  sessions: Record<string, {
    info: SessionInfo;
    // Messages are now stored in data/sessions/{sessionId}.jsonl
    // This field is kept for backward-compat migration only (empty after migration).
    messages?: ChatMessage[];
    plan?: Array<{ step: string; status: string }>;
    planExplanation?: string;
    workdir?: string; // Locked workspace for this session — set on first use.
  }>;
}

class Store {
  private users = new Map<string, UserData>();
  private profiles = new Map<string, UserProfile & { passwordHash: string }>();
  private loaded = false;
  /** Per-user write lock. Serializes commits to prevent data loss from interleaved writes. */
  private locks = new Map<string, Promise<void>>();

  private ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    // Seed demo user PROFILES only (not user data).
    // User data is loaded lazily by data() from disk.
    const demoId = 'usr_chemcode_001';
    this.profiles.set(demoId, {
      id: demoId,
      username: 'Justinian',
      email: 'justinian@example.com',
      createdAt: '2026-01-01T00:00:00Z',
      passwordHash: hash('demo'),
    });
    this.profiles.set('usr_demo', {
      id: 'usr_demo',
      username: 'demo',
      email: 'demo@chemcode.dev',
      createdAt: '2026-01-01T00:00:00Z',
      passwordHash: hash('demo'),
    });
    // NOTE: Do NOT set this.users here. User data is loaded from disk
    // by data() on first access. Setting it here would overwrite persisted data.
  }

  private fileFor(userId: string): string {
    return path.join(dataDir(), 'users', `${userId}.json`);
  }

  private persist(userId: string) {
    try {
      const data = this.users.get(userId);
      if (!data) return;
      const target = this.fileFor(userId);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Atomic write: write to temp file, then rename.
      // Prevents corruption if the process crashes mid-write.
      const tmp = target + '.tmp.' + Date.now().toString(36);
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, target);
    } catch (e) {
      console.warn('[store] persist failed', e);
    }
  }

  // ---------- Profile / auth ----------

  findProfileByUsername(username: string) {
    this.ensureLoaded();
    for (const p of this.profiles.values()) {
      if (p.username === username) return p;
    }
    return null;
  }
  getProfile(userId: string) {
    this.ensureLoaded();
    return this.profiles.get(userId) || null;
  }
  setProfile(userId: string, patch: Partial<UserProfile>) {
    this.ensureLoaded();
    const p = this.profiles.get(userId);
    if (!p) return null;
    Object.assign(p, patch);
    return p;
  }

  // ---------- User data ----------

  data(userId: string): UserData {
    this.ensureLoaded();
    const existing = this.users.get(userId);
    if (existing) return existing;
    // Try to load from disk.
    let loaded: UserData | null = null;
    try {
      const raw = fs.readFileSync(this.fileFor(userId), 'utf-8');
      loaded = JSON.parse(raw) as UserData;
    } catch {
      loaded = null;
    }
    const d: UserData = loaded ?? this.seedData();
    // Migrate: if old format has messages inside sessions, move them to JSONL files.
    if (loaded && d.sessions) {
      const migrated = migrateFromUserData(userId, d.sessions);
      if (migrated) this.persist(userId);
    }
    this.users.set(userId, d);
    if (!loaded) this.persist(userId);
    return d;
  }

  commit(userId: string) {
    // Serialize writes per user to avoid interleaved mutations
    // (e.g. two concurrent WebSocket messages both updating sessions).
    const prev = this.locks.get(userId) || Promise.resolve();
    const next = prev.then(() => {
      this.persist(userId);
    });
    this.locks.set(userId, next);
    // Don't await here — let the write happen in the background.
    // Errors are logged inside persist().
  }

  // ---------- Seed ----------

  private seedData(): UserData {
    return {
      tasks: [],
      knowledge: [],
      skills: [],
      configuredModels: [],
      sessions: {},
    };
  }
}

function hash(s: string): string {
  // NOT a real password hash; demo only.
  return 'sha256$' + crypto.createHash('sha256').update(s).digest('hex');
}

export const store = new Store();
