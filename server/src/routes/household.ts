import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import {
  assertPassword,
  currentUser,
  issueSession,
  newToken,
  nowIso,
  requireAuth,
  requireHousehold,
  requireOwner,
} from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, notFound, parseBody } from '../http.js';
import type { HouseholdRow, InviteRow, MembershipRow, UserRow } from '../types.js';

export const householdRouter = Router();

// Everything here is about the household currently open, so a request that is
// not about one has no meaning. `requireHousehold` is what lets every handler
// below keep using `currentUser().householdId` exactly as it did when an
// account could only ever belong to one.
householdRouter.use(requireAuth, requireHousehold);

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
 * Closes the household down: all of the money, categories, rules, lists and
 * share links underneath it, and everyone's place in it. **Not** their
 * accounts — those are no longer owned by a household, and the people in this
 * one may belong to others.
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

    // Everyone stays signed in — deleting a household is not deleting anybody's
    // account, and the others may well belong to more households than this one.
    // Their memberships are gone, so the next request resolves to no household
    // and they land on the picker. The caller's own cookie still names the
    // household that no longer exists, so re-issue it pointing at nothing.
    issueSession(res, db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow, null);
    res.status(204).end();
  }),
);

/**
 * Everyone in the household can see who else is in it.
 *
 * `id` is still the **user** id, because that is what expenses point at. The
 * name is the one they go by here, which may not be what they are called in
 * another household they belong to.
 */
householdRouter.get(
  '/members',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const members = db
      .prepare(
        `SELECT u.id, m.display_name AS name, u.email, m.role, m.created_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.household_id = ?
         ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.display_name COLLATE NOCASE`,
      )
      .all(user.householdId);
    res.json(members);
  }),
);

/**
 * Removes someone from this household. Their account survives — they may be in
 * other households, and it was never this household's to delete. Their
 * expenses stay too: `paid_by` / `created_by` are ON DELETE SET NULL, and
 * nothing here deletes the user row that would trigger them.
 */
householdRouter.delete(
  '/members/:id',
  requireOwner,
  asyncHandler((req, res) => {
    const user = currentUser(req);
    if (req.params.id === user.id) {
      throw badRequest('You cannot remove yourself from the household');
    }
    const membership = db
      .prepare('SELECT * FROM memberships WHERE user_id = ? AND household_id = ?')
      .get(req.params.id, user.householdId) as MembershipRow | undefined;
    if (!membership) throw notFound('That member does not exist');

    db.transaction(() => {
      db.prepare('DELETE FROM memberships WHERE id = ?').run(membership.id);
      // Retire any recovery link outstanding for them.
      //
      // This used to happen for free: removing a member deleted their account,
      // and `password_resets` cascaded with it. Now the account survives, so
      // without this an owner could issue a link, remove the person, and then
      // redeem it themselves — taking over an account that may belong to other
      // households entirely. An owner's reach has to stop at their own door.
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(
        nowIso(),
        membership.user_id,
      );
    })();
    res.status(204).end();
  }),
);

/**
 * Changes what someone may do here. Owner-only, and never your own role.
 *
 * The self-exclusion is what guarantees a household always keeps an owner:
 * the caller is an owner by `requireOwner` and cannot demote themselves, so
 * one is always left standing — no counting, and no way to reason about it
 * wrongly. Stepping down means asking another owner to do it, which is the
 * same shape as `DELETE /members/:id` refusing to remove yourself.
 *
 * Demoting a co-owner is allowed because removing them outright already is,
 * and this is strictly the gentler of the two.
 */
householdRouter.put(
  '/members/:id/role',
  requireOwner,
  asyncHandler((req, res) => {
    const user = currentUser(req);
    if (req.params.id === user.id) {
      throw badRequest('You cannot change your own role — ask another owner');
    }
    const input = parseBody(z.object({ role: z.enum(['owner', 'member']) }), req.body);
    const membership = db
      .prepare('SELECT * FROM memberships WHERE user_id = ? AND household_id = ?')
      .get(req.params.id, user.householdId) as MembershipRow | undefined;
    if (!membership) throw notFound('That member does not exist');

    db.prepare('UPDATE memberships SET role = ? WHERE id = ?').run(input.role, membership.id);
    // Their next request picks this up: the membership is re-read every time
    // (§4), so a promotion or demotion lands without them signing in again.
    res.json({ id: membership.user_id, role: input.role });
  }),
);

/** Renames yourself in this household, without touching any other. */
householdRouter.put(
  '/me',
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const input = parseBody(
      z.object({ displayName: z.string().trim().min(1, 'Name is required').max(80) }),
      req.body,
    );
    db.prepare('UPDATE memberships SET display_name = ? WHERE user_id = ? AND household_id = ?').run(
      input.displayName,
      user.id,
      user.householdId,
    );
    res.json({ displayName: input.displayName });
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
      .prepare('SELECT user_id AS id FROM memberships WHERE user_id = ? AND household_id = ?')
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
