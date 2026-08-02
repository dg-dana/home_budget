import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import {
  assertPassword,
  clearSession,
  currentAccount,
  hashPassword,
  issueSession,
  membershipsOf,
  newId,
  newToken,
  nowIso,
  requireAuth,
  setPassword,
  toSessionAccount,
  verifyPassword,
} from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, conflict, parseBody, unauthorized } from '../http.js';
import { verifyEmailNotice } from '../notifications.js';
import type {
  EmailVerificationRow,
  HouseholdRow,
  InviteRow,
  PasswordResetRow,
  UserRow,
} from '../types.js';

export const authRouter = Router();

const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const password = z.string().min(8, 'Password must be at least 8 characters');

/**
 * Registration is an **account**, nothing more — no household name, no display
 * name. Those belong to a household, and this person does not have one yet;
 * they may end up with several, called something different in each.
 */
const registerSchema = z.object({ email, password });

const loginSchema = z.object({ email, password: z.string().min(1) });

const findUserByEmail = (value: string) =>
  db.prepare('SELECT * FROM users WHERE email = ?').get(value) as UserRow | undefined;

const getUser = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;

/** better-sqlite3 reports constraint failures by code, not by class. */
const isUniqueViolation = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  String((err as { code: unknown }).code).startsWith('SQLITE_CONSTRAINT');

/**
 * Mints a confirmation link, retiring any outstanding one so only the newest
 * works — the same rule as password recovery.
 */
export function issueEmailVerification(user: UserRow) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.emailVerificationMaxAgeMs).toISOString();

  db.transaction(() => {
    db.prepare('UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(
      nowIso(),
      user.id,
    );
    db.prepare(
      `INSERT INTO email_verifications (token, user_id, expires_at, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(token, user.id, expiresAt, nowIso());
  })();

  return { token, expiresAt };
}

/**
 * Where a sign-in with no cookie should land.
 *
 * The household last open, if that membership still stands — being asked to
 * pick every time is a poor trade for someone who mostly uses one. Failing
 * that, the only household there is. With a real choice to make and nothing
 * remembered, nothing is opened and the picker asks.
 */
function landingHousehold(user: UserRow): string | null {
  const memberships = membershipsOf(user.id);
  const remembered = memberships.find((m) => m.household_id === user.last_household_id);
  if (remembered) return remembered.household_id;
  return memberships.length === 1 ? memberships[0]!.household_id : null;
}

/** The account, its households, and which one is being looked at. */
function sessionPayload(user: UserRow, currentHouseholdId: string | null) {
  const memberships = membershipsOf(user.id);
  const households = memberships.map((membership) => {
    const household = db
      .prepare('SELECT id, name, currency FROM households WHERE id = ?')
      .get(membership.household_id) as Pick<HouseholdRow, 'id' | 'name' | 'currency'>;
    return { ...household, role: membership.role, displayName: membership.display_name };
  });
  const current = households.find((h) => h.id === currentHouseholdId) ?? null;
  const membership = memberships.find((m) => m.household_id === current?.id) ?? null;

  return {
    user: toSessionAccount(user, membership),
    household: current,
    households,
  };
}

/** Creates an account. A household comes later, once the address is confirmed. */
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = parseBody(registerSchema, req.body);
    if (findUserByEmail(input.email)) {
      throw conflict('An account with that email already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const userId = newId();

    // The lookup above is a courtesy, not the guarantee: hashing is async, so
    // two sign-ups on the same address can both pass it and race to the insert.
    // The UNIQUE constraint is what actually decides, and losing that race is
    // still "that address is taken" — not a 500.
    try {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, created_at)
         VALUES (?, ?, ?, ?)`,
      ).run(userId, input.email, passwordHash, nowIso());
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('An account with that email already exists');
      throw err;
    }

    const user = getUser(userId);
    const { token } = issueEmailVerification(user);

    // Signed in straight away, but unverified: they can look around and see
    // exactly what is blocked, rather than being bounced to a dead end.
    issueSession(res, user, null);
    res.status(201).json({
      ...sessionPayload(user, null),
      verification: verifyEmailNotice(user.email, `/verify/${token}`),
    });
  }),
);

/** Public preview of a confirmation link, so the page can name the account. */
authRouter.get(
  '/verify/:token',
  asyncHandler((req, res) => {
    const row = db
      .prepare('SELECT * FROM email_verifications WHERE token = ?')
      .get(req.params.token) as EmailVerificationRow | undefined;

    if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
      throw badRequest('This confirmation link is invalid or has expired');
    }
    res.json({ email: getUser(row.user_id).email });
  }),
);

/** Redeems a confirmation link. Holding it is the proof the address is real. */
authRouter.post(
  '/verify',
  asyncHandler((req, res) => {
    const input = parseBody(z.object({ token: z.string().min(1) }), req.body);
    const row = db
      .prepare('SELECT * FROM email_verifications WHERE token = ?')
      .get(input.token) as EmailVerificationRow | undefined;

    if (!row || row.used_at || new Date(row.expires_at) < new Date()) {
      throw badRequest('This confirmation link is invalid or has expired');
    }

    db.transaction(() => {
      db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(nowIso(), row.user_id);
      db.prepare('UPDATE email_verifications SET used_at = ? WHERE token = ?').run(nowIso(), row.token);
    })();

    const user = getUser(row.user_id);
    // Whoever redeems the link is signed in as that account, the same as a
    // password reset: holding a single-use secret from their inbox is the proof.
    issueSession(res, user, null);
    res.json(sessionPayload(user, null));
  }),
);

/** Issues a fresh confirmation link for the signed-in account. */
authRouter.post(
  '/verify/resend',
  requireAuth,
  asyncHandler((req, res) => {
    const account = currentAccount(req);
    const user = getUser(account.id);
    if (user.email_verified_at) throw badRequest('That address is already confirmed');

    const { token } = issueEmailVerification(user);
    res.status(201).json({ verification: verifyEmailNotice(user.email, `/verify/${token}`) });
  }),
);

/** Public preview of an invite link, so the join page can name the household. */
authRouter.get(
  '/invite/:token',
  asyncHandler((req, res) => {
    const invite = db
      .prepare('SELECT * FROM invites WHERE token = ?')
      .get(req.params.token) as InviteRow | undefined;

    if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) {
      throw badRequest('This invite link is invalid or has expired');
    }
    const household = db
      .prepare('SELECT * FROM households WHERE id = ?')
      .get(invite.household_id) as HouseholdRow;

    res.json({ householdName: household.name, email: invite.email, role: invite.role });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = parseBody(loginSchema, req.body);
    const user = findUserByEmail(input.email);
    // Same message either way so the response cannot be used to probe for
    // which email addresses have accounts.
    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      throw unauthorized('Incorrect email or password');
    }

    const current = landingHousehold(user);
    issueSession(res, user, current);
    res.json(sessionPayload(user, current));
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: password,
});

const resetSchema = z.object({ token: z.string().min(1), password });

/**
 * Changing your own password. Requires the current one, so someone who walks
 * up to an unlocked browser cannot lock the owner out of their own household.
 */
authRouter.post(
  '/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const account = currentAccount(req);
    const input = parseBody(changePasswordSchema, req.body);
    const user = getUser(account.id);

    if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
      throw badRequest('That is not your current password');
    }

    await setPassword(user.id, input.newPassword);
    // Every other device is signed out; this one gets a fresh cookie, keeping
    // whichever household it was looking at.
    issueSession(res, getUser(user.id), account.householdId);
    res.status(204).end();
  }),
);

/** Public preview of a reset link, so the page can greet the right person. */
authRouter.get(
  '/reset/:token',
  asyncHandler((req, res) => {
    const reset = db
      .prepare('SELECT * FROM password_resets WHERE token = ?')
      .get(req.params.token) as PasswordResetRow | undefined;

    if (!reset || reset.used_at || new Date(reset.expires_at) < new Date()) {
      throw badRequest('This reset link is invalid or has expired');
    }
    const user = getUser(reset.user_id);
    // A name belongs to a household, and a reset link is about the account, so
    // the address is what identifies the person here.
    res.json({ email: user.email });
  }),
);

/**
 * Redeems a reset link. Holding the link is the proof, so the person is signed
 * in afterwards — and every session that existed beforehand is invalidated.
 */
authRouter.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const input = parseBody(resetSchema, req.body);
    const reset = db
      .prepare('SELECT * FROM password_resets WHERE token = ?')
      .get(input.token) as PasswordResetRow | undefined;

    if (!reset || reset.used_at || new Date(reset.expires_at) < new Date()) {
      throw badRequest('This reset link is invalid or has expired');
    }

    await setPassword(reset.user_id, input.password);
    db.prepare('UPDATE password_resets SET used_at = ? WHERE token = ?').run(nowIso(), reset.token);

    const user = getUser(reset.user_id);
    const current = landingHousehold(user);

    issueSession(res, user, current);
    res.status(201).json(sessionPayload(user, current));
  }),
);

const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm'),
});

/**
 * Deleting your own account, and with it every membership it holds.
 *
 * Each household is judged separately, because the account may be an owner in
 * one and an ordinary member in another:
 *
 * - **Sole owner with company** — refused, and named. A household must keep an
 *   owner: nobody would be left able to invite, rename or remove, and
 *   promoting somebody on their behalf is not a decision to make for them.
 * - **Last person in it** — the household goes too, since its rows would
 *   otherwise sit there forever with no account able to reach them.
 * - **Anything else** — the membership goes and the household carries on.
 *
 * The history is never yours to destroy: `paid_by` / `created_by` go NULL and
 * the expenses stay, so nobody else's totals move when you leave (§3).
 */
authRouter.delete(
  '/account',
  requireAuth,
  asyncHandler(async (req, res) => {
    const account = currentAccount(req);
    const input = parseBody(deleteAccountSchema, req.body);
    await assertPassword(account.id, input.password);

    const memberships = membershipsOf(account.id);
    const stranded: string[] = [];
    const householdsToDelete: string[] = [];

    for (const membership of memberships) {
      const others = db
        .prepare(
          `SELECT COUNT(*) AS total, COUNT(CASE WHEN role = 'owner' THEN 1 END) AS owners
           FROM memberships WHERE household_id = ? AND user_id != ?`,
        )
        .get(membership.household_id, account.id) as { total: number; owners: number };

      if (others.total === 0) {
        householdsToDelete.push(membership.household_id);
      } else if (membership.role === 'owner' && others.owners === 0) {
        const household = db
          .prepare('SELECT name FROM households WHERE id = ?')
          .get(membership.household_id) as { name: string };
        stranded.push(household.name);
      }
    }

    if (stranded.length > 0) {
      throw badRequest(
        `You are the only owner of ${stranded.map((name) => `"${name}"`).join(', ')}. ` +
          'Make someone else an owner there first, or delete the household itself.',
      );
    }

    db.transaction(() => {
      for (const householdId of householdsToDelete) {
        db.prepare('DELETE FROM households WHERE id = ?').run(householdId);
      }
      // Memberships cascade with the user; the empty households above had to go
      // first, while there was still a membership naming them.
      db.prepare('DELETE FROM users WHERE id = ?').run(account.id);
    })();

    clearSession(res);
    res.status(204).end();
  }),
);

/** Current session plus the household context the frontend renders around. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler((req, res) => {
    const account = currentAccount(req);
    res.json(sessionPayload(getUser(account.id), account.householdId));
  }),
);
