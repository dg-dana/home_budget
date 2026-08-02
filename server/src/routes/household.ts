import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import {
  assertPassword,
  clearSession,
  currentUser,
  newToken,
  nowIso,
  requireAuth,
  requireOwner,
} from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, notFound, parseBody } from '../http.js';
import type { HouseholdRow, InviteRow, UserRow } from '../types.js';

export const householdRouter = Router();

householdRouter.use(requireAuth);

const settingsSchema = z.object({
  name: z.string().trim().min(1, 'Household name is required').max(80),
  currency: z.string().trim().length(3).toUpperCase(),
});

/** Typing your password is the confirmation for anything irreversible. */
const confirmSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm'),
});

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  role: z.enum(['owner', 'member']).default('member'),
});

householdRouter.get(
  '/',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const household = db
      .prepare('SELECT id, name, currency, created_at FROM households WHERE id = ?')
      .get(user.householdId) as HouseholdRow;
    res.json(household);
  }),
);

householdRouter.put(
  '/',
  requireOwner,
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(settingsSchema, req.body);
    db.prepare('UPDATE households SET name = ?, currency = ? WHERE id = ?').run(
      input.name,
      input.currency,
      user.householdId,
    );
    res.json({ id: user.householdId, name: input.name, currency: input.currency });
  }),
);

/**
 * Closes the household down: every member's account, and all of the money,
 * categories, rules, lists and share links underneath it.
 *
 * One statement does the whole thing, because the schema already says so —
 * every table hangs off `households` with `ON DELETE CASCADE` (§3), so there
 * is no delete order here to get wrong and no orphan to leave behind. Share
 * tokens die with their lists, which makes revocation part of the same
 * transaction rather than an afterthought.
 *
 * Owner-only, and it costs the owner their password. There is no undo and no
 * export.
 */
householdRouter.delete(
  '/',
  requireOwner,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(confirmSchema, req.body);
    await assertPassword(user.id, input.password);

    db.prepare('DELETE FROM households WHERE id = ?').run(user.householdId);

    // Every other member's cookie stops working on its next request anyway —
    // the user row is re-read every time (§4) — but the caller's own browser
    // should not be left holding one either.
    clearSession(res);
    res.status(204).end();
  }),
);

/** Everyone in the household can see who else is in it. */
householdRouter.get(
  '/members',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const members = db
      .prepare(
        `SELECT id, name, email, role, created_at
         FROM users WHERE household_id = ?
         ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, name COLLATE NOCASE`,
      )
      .all(user.householdId);
    res.json(members);
  }),
);

householdRouter.delete(
  '/members/:id',
  requireOwner,
  asyncHandler((req, res) => {
    const user = currentUser(req);
    if (req.params.id === user.id) {
      throw badRequest('You cannot remove yourself from the household');
    }
    const member = db
      .prepare('SELECT * FROM users WHERE id = ? AND household_id = ?')
      .get(req.params.id, user.householdId) as UserRow | undefined;
    if (!member) throw notFound('That member does not exist');

    // Expenses keep their history: `paid_by` / `created_by` are ON DELETE SET NULL.
    db.prepare('DELETE FROM users WHERE id = ?').run(member.id);
    res.status(204).end();
  }),
);

/**
 * Issues a recovery link for a member who is locked out. There is no email
 * provider wired up, so the owner passes the link on themselves — the same
 * shape as invites. The owner can do this for anyone in the household,
 * including themselves.
 */
householdRouter.post(
  '/members/:id/reset-password',
  requireOwner,
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const member = db
      .prepare('SELECT id FROM users WHERE id = ? AND household_id = ?')
      .get(req.params.id, user.householdId) as { id: string } | undefined;
    if (!member) throw notFound('That member does not exist');

    const token = newToken();
    const expiresAt = new Date(Date.now() + config.passwordResetMaxAgeMs).toISOString();

    db.transaction(() => {
      // Only the newest link should work, so retire any outstanding ones.
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(
        nowIso(),
        member.id,
      );
      db.prepare(
        `INSERT INTO password_resets (token, user_id, created_by, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(token, member.id, user.id, expiresAt, nowIso());
    })();

    res.status(201).json({ token, expires_at: expiresAt });
  }),
);

/** Pending (unused, unexpired) invites for the household. */
householdRouter.get(
  '/invites',
  requireOwner,
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const invites = db
      .prepare(
        `SELECT token, email, role, expires_at, created_at
         FROM invites
         WHERE household_id = ? AND used_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC`,
      )
      .all(user.householdId, nowIso()) as InviteRow[];
    res.json(invites);
  }),
);

/** Creates a single-use link that lets a family member create their account. */
householdRouter.post(
  '/invites',
  requireOwner,
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(inviteSchema, req.body);
    const token = newToken();
    const expiresAt = new Date(Date.now() + config.inviteMaxAgeMs).toISOString();

    db.prepare(
      `INSERT INTO invites (token, household_id, email, role, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(token, user.householdId, input.email || null, input.role, user.id, expiresAt, nowIso());

    res.status(201).json({ token, email: input.email || null, role: input.role, expires_at: expiresAt });
  }),
);

householdRouter.delete(
  '/invites/:token',
  requireOwner,
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const result = db
      .prepare('DELETE FROM invites WHERE token = ? AND household_id = ?')
      .run(req.params.token, user.householdId);
    if (result.changes === 0) throw notFound('That invite does not exist');
    res.status(204).end();
  }),
);
