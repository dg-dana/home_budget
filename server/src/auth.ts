import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { forbidden, unauthorized } from './http.js';
import type { SessionUser, UserRow } from './types.js';

const COOKIE_NAME = 'hb_session';
const BCRYPT_ROUNDS = 12;

export const newId = () => crypto.randomUUID();
/** URL-safe random token used for invite and share links. */
export const newToken = () => crypto.randomBytes(24).toString('base64url');
export const nowIso = () => new Date().toISOString();

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export function issueSession(res: Parameters<RequestHandler>[1], user: UserRow) {
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, {
    expiresIn: Math.floor(config.sessionMaxAgeMs / 1000),
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: config.sessionMaxAgeMs,
    path: '/',
  });
}

export function clearSession(res: Parameters<RequestHandler>[1]) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export const toSessionUser = (row: UserRow): SessionUser => ({
  id: row.id,
  householdId: row.household_id,
  email: row.email,
  name: row.name,
  role: row.role,
});

function readSessionUser(cookieValue: unknown): SessionUser | null {
  if (typeof cookieValue !== 'string' || !cookieValue) return null;
  let userId: string;
  try {
    const payload = jwt.verify(cookieValue, config.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string') return null;
    userId = payload.sub;
  } catch {
    return null;
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  return row ? toSessionUser(row) : null;
}

/** Attaches `req.user` when a valid session cookie is present, otherwise 401s. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const user = readSessionUser(req.cookies?.[COOKIE_NAME]);
  if (!user) {
    next(unauthorized());
    return;
  }
  req.user = user;
  next();
};

/** Attaches `req.user` when signed in, but never rejects the request. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const user = readSessionUser(req.cookies?.[COOKIE_NAME]);
  if (user) req.user = user;
  next();
};

/** Must run after `requireAuth`. Restricts a route to the household owner. */
export const requireOwner: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'owner') {
    next(forbidden('Only the household owner can do this'));
    return;
  }
  next();
};

/** Narrows `req.user` for handlers mounted behind `requireAuth`. */
export function currentUser(req: { user?: SessionUser }): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
