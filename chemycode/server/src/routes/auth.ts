// ====== Auth Routes ======

import { Router } from 'express';
import { ah, requireAuth, sendOk, sendErr } from '../middleware.js';
import { signToken } from '../auth.js';
import { store } from '../store.js';
import crypto from 'node:crypto';

function verifyPassword(stored: string, supplied: string): boolean {
  // stored is "sha256$<hex>"; we re-hash and compare.
  const [, hash] = stored.split('$');
  if (!hash) return false;
  const computed = crypto.createHash('sha256').update(supplied).digest('hex');
  return computed === hash;
}

export function authRouter(): Router {
  const r = Router();

  r.post('/login', ah(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return sendErr(res, 'AUTH_INVALID', '用户名和密码必填', 400);

    const profile = store.findProfileByUsername(username);
    if (!profile || !verifyPassword(profile.passwordHash, password)) {
      return sendErr(res, 'AUTH_INVALID', '用户名或密码错误', 401);
    }
    const { token, expiresAt } = signToken({ sub: profile.id, username: profile.username });
    const { passwordHash: _ph, ...publicProfile } = profile;
    return sendOk(res, { token, user: publicProfile, expiresAt });
  }));

  r.post('/logout', ah(async (_req, res) => {
    // Stateless: client just discards the token. Nothing to do server-side.
    return sendOk(res, undefined);
  }));

  r.get('/me', requireAuth, ah(async (req, res) => {
    const profile = store.getProfile(req.userId!);
    if (!profile) return sendErr(res, 'AUTH_INVALID', '用户不存在', 404);
    const { passwordHash: _ph, ...publicProfile } = profile;
    return sendOk(res, publicProfile);
  }));

  r.patch('/me', requireAuth, ah(async (req, res) => {
    const patch = req.body || {};
    const allowed = ['username', 'email', 'avatarUrl'];
    const safe: Record<string, unknown> = {};
    for (const k of allowed) if (k in patch) safe[k] = patch[k];
    const profile = store.setProfile(req.userId!, safe);
    if (!profile) return sendErr(res, 'NOT_FOUND', '用户不存在', 404);
    const { passwordHash: _ph, ...publicProfile } = profile;
    return sendOk(res, publicProfile);
  }));

  return r;
}
