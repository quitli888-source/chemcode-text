// ====== API Methods (business layer) ======
// Thin wrappers around `api.get/post/...` for every domain operation the UI needs.
// Every method returns a `Result<T, ApiError>` so the caller must handle errors.
//
// Pattern:
//   const r = await apiClient.sessions.list();
//   if (!r.ok) { showToast(r.error.message); return; }
//   state.tasks = r.value.tasks;
//
// The mock layer (./mock.ts) provides identical shapes so the rest of the
// codebase never branches on "real or mock".

import { api, getToken, setToken, setStoredUser } from './client';
import type {
  AddModelRequest,
  ChatMessage,
  ConfiguredModel,
  CreateSessionRequest,
  CreateTaskRequest,
  KnowledgeEntry,
  ListTasksResponse,
  LoginRequest,
  LoginResponse,
  SessionHistoryResponse,
  SessionInfo,
  SkillEntry,
  SystemStatus,
  Task,
  TestModelResponse,
  UploadResponse,
  UserProfile,
  UsageSummary,
} from './types';

// ---------- Auth ----------

export const auth = {
  async login(req: LoginRequest) {
    const r = await api.post<LoginResponse>('/auth/login', req, { noAuth: true });
    if (r.ok) {
      setToken(r.value.token);
      setStoredUser(r.value.user);
    }
    return r;
  },

  async logout() {
    // Fire-and-forget server-side logout; ignore errors.
    await api.post('/auth/logout', undefined, { noRetry: true });
    setToken(null);
    setStoredUser(null);
    return { ok: true as const, value: undefined };
  },

  async me() {
    return api.get<UserProfile>('/auth/me');
  },

  async updateProfile(patch: Partial<UserProfile>) {
    return api.patch<UserProfile>('/auth/me', patch);
  },
};

// ---------- Sessions ----------

export const sessions = {
  async list() {
    return api.get<SessionInfo[]>('/sessions');
  },

  async create(req: CreateSessionRequest = {}) {
    return api.post<SessionInfo>('/sessions', req);
  },

  async get(id: string) {
    return api.get<SessionInfo>(`/sessions/${encodeURIComponent(id)}`);
  },

  async history(id: string, opts: { cursor?: string; limit?: number } = {}) {
    return api.get<SessionHistoryResponse>(`/sessions/${encodeURIComponent(id)}/history`, {
      query: { cursor: opts.cursor, limit: opts.limit },
    });
  },

  async rename(id: string, title: string) {
    return api.patch<SessionInfo>(`/sessions/${encodeURIComponent(id)}`, { title });
  },

  async delete(id: string) {
    return api.delete<void>(`/sessions/${encodeURIComponent(id)}`);
  },

  async send(id: string, body: { content: string; model?: string; attachments?: string[] }) {
    return api.post<void>(`/sessions/${encodeURIComponent(id)}/messages`, body);
  },

  async cancel(id: string) {
    return api.post<void>(`/sessions/${encodeURIComponent(id)}/cancel`);
  },
};

// ---------- Tasks ----------

export const tasks = {
  async list(opts: { status?: string; limit?: number; offset?: number } = {}) {
    return api.get<ListTasksResponse>('/tasks', { query: opts });
  },

  async get(id: string) {
    return api.get<Task>(`/tasks/${encodeURIComponent(id)}`);
  },

  async create(req: CreateTaskRequest) {
    return api.post<Task>('/tasks', req);
  },

  async cancel(id: string) {
    return api.post<void>(`/tasks/${encodeURIComponent(id)}/cancel`);
  },

  async delete(id: string) {
    return api.delete<void>(`/tasks/${encodeURIComponent(id)}`);
  },
};

// ---------- Skills ----------

export const skills = {
  async list() {
    return api.get<SkillEntry[]>('/skills');
  },

  async install(id: string) {
    return api.post<SkillEntry>(`/skills/${encodeURIComponent(id)}/install`);
  },

  async uninstall(id: string) {
    return api.post<void>(`/skills/${encodeURIComponent(id)}/uninstall`);
  },

  async import(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return api.upload<SkillEntry>('/skills/import', fd);
  },

  async remove(id: string) {
    return api.delete<void>(`/skills/${encodeURIComponent(id)}`);
  },
};

// ---------- Knowledge ----------

export const knowledge = {
  async list() {
    return api.get<KnowledgeEntry[]>('/knowledge');
  },

  async search(query: string) {
    return api.get<KnowledgeEntry[]>('/knowledge/search', { query: { q: query } });
  },

  async get(id: string) {
    return api.get<KnowledgeEntry>(`/knowledge/${encodeURIComponent(id)}`);
  },
};

// ---------- Models ----------

export const models = {
  async list() {
    return api.get<ConfiguredModel[]>('/models');
  },

  async add(req: AddModelRequest) {
    return api.post<ConfiguredModel>('/models', req);
  },

  async update(id: string, patch: Partial<AddModelRequest>) {
    return api.patch<ConfiguredModel>(`/models/${encodeURIComponent(id)}`, patch);
  },

  async remove(id: string) {
    return api.delete<void>(`/models/${encodeURIComponent(id)}`);
  },

  async test(id: string) {
    return api.post<TestModelResponse>(`/models/${encodeURIComponent(id)}/test`);
  },

  async setDefault(id: string) {
    return api.post<void>(`/models/${encodeURIComponent(id)}/default`);
  },
};

// ---------- Uploads ----------

export const uploads = {
  async file(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return api.upload<UploadResponse>('/uploads', fd);
  },
};

// ---------- System ----------

export const system = {
  async status() {
    return api.get<SystemStatus>('/system/status');
  },

  async health() {
    return api.get<{ ok: true; ts: number }>('/system/health', { noAuth: true });
  },
};

// ---------- Usage ----------

export const usage = {
  async get(range: '1d' | '7d' | '30d' = '7d', filters?: { model?: string; provider?: string; sessionId?: string }) {
    const params = new URLSearchParams({ range });
    if (filters?.model) params.set('model', filters.model);
    if (filters?.provider) params.set('provider', filters.provider);
    if (filters?.sessionId) params.set('sessionId', filters.sessionId);
    return api.get<UsageSummary>(`/usage?${params.toString()}`);
  },
};

// ---------- Aggregated export ----------

export const apiClient = {
  auth,
  sessions,
  tasks,
  skills,
  knowledge,
  models,
  uploads,
  system,
  usage,
};

export { getToken };
export type { ChatMessage };
