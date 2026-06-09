// ====== HTTP API Client ======
// Lightweight fetch wrapper with:
//   - Automatic Authorization header injection
//   - Token persistence (localStorage)
//   - Unified envelope handling (ApiOk / ApiErr)
//   - 401 redirect-to-login
//   - Exponential-backoff retry on 429/5xx
//   - Request timeout with AbortController
//
// All callers go through this layer so the rest of the UI never touches fetch.

import type { ApiOk, ApiErr, Result } from './types';

// ---------- Config ----------

const API_BASE = (import.meta.env.VITE_API_BASE as string) || '/api';
const TOKEN_KEY = 'chemycode.token';
const USER_KEY = 'chemycode.user';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

// ---------- Token store ----------

let cachedToken: string | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

export function getToken(): string | null {
  if (cachedToken) return cachedToken;
  if (typeof localStorage === 'undefined') return null;
  cachedToken = localStorage.getItem(TOKEN_KEY);
  return cachedToken;
}

export function setToken(token: string | null): void {
  cachedToken = token;
  if (typeof localStorage !== 'undefined') {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }
  tokenListeners.forEach((fn) => fn(token));
}

export function onTokenChange(fn: (token: string | null) => void): () => void {
  tokenListeners.add(fn);
  return () => tokenListeners.delete(fn);
}

export function getStoredUser<T = unknown>(): T | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setStoredUser(user: unknown | null): void {
  if (typeof localStorage === 'undefined') return;
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

// ---------- Auth-event bus (for 401 redirects) ----------

type AuthEvent =
  | { kind: 'unauthorized'; reason: 'expired' | 'missing' | 'invalid' }
  | { kind: 'login'; userId: string };

const authListeners = new Set<(ev: AuthEvent) => void>();

export function onAuthEvent(fn: (ev: AuthEvent) => void): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

function emitAuthEvent(ev: AuthEvent): void {
  authListeners.forEach((fn) => fn(ev));
}

// ---------- Error classification ----------

export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(opts: { code: string; message: string; status: number; details?: unknown; retryable?: boolean }) {
    super(opts.message);
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
  }
}

// ---------- Retry policy ----------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function shouldRetry(status: number, attempt: number): boolean {
  if (attempt >= MAX_RETRIES) return false;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function retryDelay(attempt: number): number {
  // 500ms, 1000ms, 2000ms ...
  return RETRY_BASE_MS * Math.pow(2, attempt);
}

// ---------- Core request ----------

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** If true, the call will not be retried even on 5xx. */
  noRetry?: boolean;
  /** If true, skip auth (used for login). */
  noAuth?: boolean;
  /** FormData mode (multipart). When set, `body` must be a FormData instance. */
  formData?: FormData;
  /** AbortSignal from caller (e.g. component unmount). */
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${base}${cleanPath}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  return url;
}

async function rawRequest(path: string, opts: RequestOptions = {}): Promise<Response> {
  const url = buildUrl(path, opts.query);
  const headers: Record<string, string> = { ...(opts.headers || {}) };

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData;
    // Let the browser set the boundary.
  } else if (opts.body !== undefined && opts.method && opts.method !== 'GET') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }

  if (!opts.noAuth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const ctrl = new AbortController();

  // If caller provided a signal, forward its abort into our controller.
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', () => ctrl.abort(opts.signal!.reason));
  }

  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers,
      body,
      credentials: 'include',
      signal: ctrl.signal,
    });
    return res;
  } finally {
    // No cleanup needed.
  }
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<Result<T, ApiError>> {
  const method = opts.method || 'GET';
  let attempt = 0;
  let lastNetworkError: unknown = null;

  while (attempt <= MAX_RETRIES) {
    try {
      const res = await rawRequest(path, { ...opts, method });

      const extractErr = async (fallbackCode: string, fallbackMessage: string, status: number) => {
        const body = (await safeJson(res)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
        return new ApiError({
          code: body?.error?.code || fallbackCode,
          message: body?.error?.message || fallbackMessage,
          status,
          details: body?.error?.details,
          retryable: status === 429 || (status >= 500 && status < 600),
        });
      };

      // Handle 401 globally.
      if (res.status === 401) {
        const token = getToken();
        emitAuthEvent({ kind: 'unauthorized', reason: token ? 'expired' : 'missing' });
        setToken(null);
        const apiErr = await extractErr('AUTH_REQUIRED', 'Authentication required', 401);
        return err(apiErr);
      }

      if (!res.ok) {
        const apiErr = await extractErr(`HTTP_${res.status}`, res.statusText || 'Request failed', res.status);

        if (!opts.noRetry && shouldRetry(res.status, attempt)) {
          await sleep(retryDelay(attempt));
          attempt += 1;
          continue;
        }
        return err(apiErr);
      }

      // 2xx — parse body.
      const body = (await res.json()) as ApiOk<T> | unknown;
      if (body && typeof body === 'object' && 'ok' in (body as object)) {
        const env = body as ApiOk<T> | ApiErr;
        if (env.ok) return ok(env.data);
        // Server returned ok:false with 2xx (rare). Normalize.
        return err(
          new ApiError({
            code: env.error.code,
            message: env.error.message,
            status: res.status,
            details: env.error.details,
          }),
        );
      }
      // No envelope — treat the whole body as data.
      return ok(body as T);
    } catch (e) {
      lastNetworkError = e;
      // Don't retry aborts.
      if (e instanceof DOMException && e.name === 'AbortError') {
        return err(
          new ApiError({
            code: 'ABORTED',
            message: 'Request was cancelled',
            status: 0,
          }),
        );
      }
      if (opts.signal?.aborted) {
        return err(
          new ApiError({
            code: 'ABORTED',
            message: 'Request was cancelled',
            status: 0,
          }),
        );
      }
      if (opts.noRetry || attempt >= MAX_RETRIES) break;
      await sleep(retryDelay(attempt));
      attempt += 1;
    }
  }

  return err(
    new ApiError({
      code: 'NETWORK_ERROR',
      message: lastNetworkError instanceof Error ? lastNetworkError.message : 'Network error',
      status: 0,
      retryable: true,
    }),
  );
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function ok<T>(value: T): Result<T, ApiError> {
  return { ok: true, value };
}
function err<T>(error: ApiError): Result<T, ApiError> {
  return { ok: false, error };
}

// ---------- Convenience methods ----------

export const api = {
  get: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'GET' }),

  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method'> = {}) =>
    request<T>(path, { ...opts, method: 'POST', body }),

  put: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method'> = {}) =>
    request<T>(path, { ...opts, method: 'PUT', body }),

  patch: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method'> = {}) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),

  delete: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    request<T>(path, { ...opts, method: 'DELETE' }),

  upload: <T>(path: string, formData: FormData, opts: Omit<RequestOptions, 'method' | 'body' | 'formData'> = {}) =>
    request<T>(path, { ...opts, method: 'POST', formData }),
};
