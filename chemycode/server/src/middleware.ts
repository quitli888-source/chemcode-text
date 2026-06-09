// ====== Server Middleware ======
// Auth, error handling, request validation, async wrappers.

import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from './auth.js';
import type { ApiOk, ApiErr } from './types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      sessionId?: string;
    }
  }
}

/** Wrap an async handler so thrown errors flow to the error middleware. */
export const ah = <T>(fn: (req: Request, res: Response, next: NextFunction) => Promise<T>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/** Enforce a valid Authorization: Bearer <token> header. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const hdr = req.header('Authorization') || req.header('authorization');
  if (!hdr || !hdr.startsWith('Bearer ')) {
    return res.status(401).json(err('AUTH_REQUIRED', 'Authentication required'));
  }
  const token = hdr.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json(err('AUTH_INVALID', 'Invalid or expired token'));
  }
  req.userId = payload.sub;
  next();
}

/** Send a typed error envelope. */
export function err(code: string, message: string, status = 400, details?: unknown): ApiErr {
  return { ok: false, error: { code, message, details } };
}

export function sendOk<T>(res: Response, data: T, status = 200) {
  const body: ApiOk<T> = { ok: true, data };
  res.status(status).json(body);
}

export function sendErr(res: Response, code: string, message: string, status = 400, details?: unknown) {
  res.status(status).json(err(code, message, status, details));
}

export function notFound(_req: Request, res: Response) {
  sendErr(res, 'NOT_FOUND', 'Endpoint not found', 404);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  console.error('[gateway] error', err);
  if (res.headersSent) return;
  const status = err.status || 500;
  const code = err.code || (status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  const message = err.message || 'Internal server error';
  sendErr(res, code, message, status);
}
