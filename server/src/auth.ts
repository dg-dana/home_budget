import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { badRequest, forbidden, unauthorized } from './http.js';
import type { MembershipRow, SessionAccount, SessionUser, UserRow } from './types.js';

const COOKIE_NAME = 'hb_session';
const BCRYPT_ROUNDS = 12;

export const newId = () => crypto.randomUUID();
/** URL-safe random token used for invite and share links. */
export const newToken = () => crypto.randomBytes(24).toString('base64url');
export const nowIso = () => new Date().toISOString();

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/**
 * Issues the session cookie. `householdId` is the household the browser is
 * currently looking at — switching household re-issues the cookie rather than
 * keeping the choice anywhere else, so there is still exactly one thing to
 * forge and it is still signed.
 */
export function issueSession(
  res: Parameters<RequestHandler>[1],
  user: UserRow,
  householdId?: string | null,
) {
  // Remembered so the *next* sign-in, which has no cookie to read, can land
  // where this one left off. Recorded here rather than at each call site
  // because there is no case where the choice should be issued and not
  // remembered, and one forgotten call would be an invisible bug.
  db.prepare('UPDATE users SET last_household_id = ? WHERE id = ?').run(householdId ?? null, user.id);

  const token = jwt.sign(
    { sub: user.id, gen: user.session_generation, hh: householdId ?? null },
    config.jwtSecret,
    { expiresIn: Math.floor(config.sessionMaxAgeMs / 1000) },
  );
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

/** All of one account's households, best-known first. */
export const membershipsOf = (userId: string) =>
  db
    .prepare(
      `SELECT m.* FROM memberships m
       JOIN households h ON h.id = m.household_id
       WHERE m.user_id = ?
       ORDER BY h.name COLLATE NOCASE`,
    )
    .all(userId) as MembershipRow[];

/**
 * Who to tell about something that happened in a household.
 *
 * Gathered by query rather than by the caller so that "everyone here" and
 * "the owners" mean the same thing at every call site — and so a notice can
 * be collected **before** the rows it describes are deleted, which is the only
 * order that works for closing a household or an account.
 */
export function householdAddresses(
  householdId: string,
  { ownersOnly = false, except }: { ownersOnly?: boolean; except?: string } = {},
): string[] {
  const rows = db
    .prepare(
      `SELECT u.email FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.household_id = ?
         AND (? = 0 OR m.role = 'owner')
         AND (? IS NULL OR m.user_id != ?)
       ORDER BY u.email`,
    )
    .all(householdId, ownersOnly ? 1 : 0, except ?? null, except ?? null) as Array<{ email: string }>;
  return rows.map((row) => row.email);
}

export const membershipIn = (userId: string, householdId: string) =>
  db
    .prepare('SELECT * FROM memberships WHERE user_id = ? AND household_id = ?')
    .get(userId, householdId) as MembershipRow | undefined;

/**
 * Works out which household a request is about.
 *
 * The cookie's choice only counts while the membership behind it still exists,
 * so being removed from a household — or having it deleted underneath you —
 * takes effect on the very next request rather than when the token expires.
 * With the choice invalid or absent, a single-household account falls into it
 * automatically; anyone with a real choice to make is left with none set, and
 * the UI asks.
 */
function resolveMembership(userId: string, claimed: unknown): MembershipRow | null {
  if (typeof claimed === 'string' && claimed) {
    const chosen = membershipIn(userId, claimed);
    if (chosen) return chosen;
  }
  const all = membershipsOf(userId);
  return all.length === 1 ? all[0]! : null;
}

export const toSessionAccount = (row: UserRow, membership: MembershipRow | null): SessionAccount => ({
  id: row.id,
  email: row.email,
  emailVerified: row.email_verified_at !== null,
  householdId: membership?.household_id ?? null,
  name: membership?.display_name ?? null,
  role: membership?.role ?? null,
});

function readSessionUser(cookieValue: unknown): SessionAccount | null {
  if (typeof cookieValue !== 'string' || !cookieValue) return null;
  let userId: string;
  let generation: unknown;
  let claimedHousehold: unknown;
  try {
    const payload = jwt.verify(cookieValue, config.jwtSecret) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string') return null;
    userId = payload.sub;
    generation = payload.gen;
    claimedHousehold = payload.hh;
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

  return toSessionAccount(row, resolveMembership(row.id, claimedHousehold));
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

/**
 * Must run after `requireAuth`. Refuses a request that is not about any
 * household — a brand new account before it has created or joined one.
 *
 * This is the guard that keeps the rest of the app simple: behind it,
 * `currentUser()` is guaranteed a household id, so every household-scoped
 * query still filters on `user.householdId` exactly as it did when an account
 * could only ever have one.
 */
export const requireHousehold: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  if (!req.user.householdId) {
    next(forbidden('Choose a household first'));
    return;
  }
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

/**
 * Must run after `requireAuth`. Blocks the things an unconfirmed address
 * should not be able to do — creating a household, or joining someone else's.
 * Signing in and looking around stays allowed, so the person can see why.
 */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(unauthorized());
    return;
  }
  if (!req.user.emailVerified) {
    next(forbidden('Confirm your email address first'));
    return;
  }
  next();
};

/** Narrows `req.user` for handlers mounted behind `requireAuth`. */
export function currentAccount(req: { user?: SessionAccount }): SessionAccount {
  if (!req.user) throw unauthorized();
  return req.user;
}

/**
 * Narrows `req.user` for handlers behind `requireAuth` + `requireHousehold`.
 * Throws rather than returning a nullable, because a handler that reached here
 * without a household is a routing mistake, not a user error.
 */
export function currentUser(req: { user?: SessionAccount }): SessionUser {
  const account = currentAccount(req);
  if (!account.householdId || !account.name || !account.role) {
    throw forbidden('Choose a household first');
  }
  return {
    id: account.id,
    householdId: account.householdId,
    email: account.email,
    emailVerified: account.emailVerified,
    name: account.name,
    role: account.role,
  };
}
