import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { badRequest, forbidden, unauthorized } from './http.js';
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
  const token = jwt.sign({ sub: user.id, gen: user.session_generation }, config.jwtSecret, {
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
  let generation: unknown;
  try {
    const payload = jwt.verify(cookieValue, config.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string') return null;
    userId = payload.sub;
    generation = payload.gen;
  } catch {
    return null;
  }

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!row) return null;

  // A password change bumps the generation, so cookies handed out before it
  // stop working — otherwise resetting a compromised password would leave the
  // attacker's stolen session alive until it expired on its own. Tokens minted
  // before this field existed carry no `gen` and are refused.
  if (generation !== row.session_generation) return null;

  return toSessionUser(row);
}

/**
 * Sets a new password and invalidates every existing session for that user.
 *
 * Bumping the generation is exact — unlike a timestamp cutoff, it cannot be
 * defeated by two events landing in the same second. Re-read the user
 * afterwards before issuing a replacement cookie, so the new token carries the
 * new generation.
 */
export async function setPassword(userId: string, plainPassword: string): Promise<void> {
  const hash = await hashPassword(plainPassword);
  db.prepare(
    'UPDATE users SET password_hash = ?, session_generation = session_generation + 1 WHERE id = ?',
  ).run(hash, userId);
}

/**
 * Re-checks the caller's own password before something irreversible.
 *
 * The same guard as `POST /auth/password`, for the same reason: a session
 * cookie proves a browser was signed in once, not that the person at the
 * keyboard is its owner. Deleting an account — or a whole household — is not
 * something an unlocked laptop should be able to do on its way past.
 */
export async function assertPassword(userId: string, plain: string): Promise<void> {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    | Pick<UserRow, 'password_hash'>
    | undefined;
  if (!row || !(await verifyPassword(plain, row.password_hash))) {
    throw badRequest('That is not your password');
  }
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
