// ====== Token (JWT-lite) ======
// We use HMAC-SHA256 to sign a tiny payload. Replace with jose/jsonwebtoken
// in production. This implementation is self-contained and has no deps.

import crypto from 'node:crypto';

const SECRET = process.env.AUTH_TOKEN_SECRET || (() => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[auth] AUTH_TOKEN_SECRET must be set in production. Exiting.');
  }
  console.warn('[auth] ⚠️  AUTH_TOKEN_SECRET not set, using insecure fallback. Set this env var in production!');
  return 'chemcode-dev-secret';
})();
const TTL_SEC = Number(process.env.AUTH_TOKEN_TTL) || 86400;

export interface TokenPayload {
  sub: string;     // userId
  username: string;
  exp: number;     // epoch seconds
  iat: number;
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

export function signToken(payload: Omit<TokenPayload, 'exp' | 'iat'>): { token: string; expiresAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const full: TokenPayload = { ...payload, iat: now, exp: now + TTL_SEC };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(full));
  const sig = b64url(
    crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest(),
  );
  return { token: `${head}.${body}.${sig}`, expiresAt: full.exp * 1000 };
}

export function verifyToken(token: string): TokenPayload | null {
  if (!token || token.split('.').length !== 3) return null;
  const [head, body, sig] = token.split('.');
  const expectedSig = b64url(
    crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest(),
  );
  if (expectedSig !== sig) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf-8'));
  } catch {
    return null;
  }
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}
