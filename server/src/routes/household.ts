import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import {
  assertPassword,
  currentUser,
  householdAddresses,
  issuePasswordReset,
  issueSession,
  newToken,
  nowIso,
  requireAuth,
  requireHousehold,
  requireOwner,
} from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound, parseBody } from '../http.js';
import {
  householdChangedNotice,
  householdDeletedNotice,
  inviteNotice,
  memberRemovedNotice,
  notifyAll,
  passwordResetNotice,
  roleChangedNotice,
} from '../notifications.js';
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
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(settingsSchema, req.body);
    const before = db
      .prepare('SELECT name, currency FROM households WHERE id = ?')
      .get(user.householdId) as Pick<HouseholdRow, 'name' | 'currency'>;

    db.prepare('UPDATE households SET name = ?, currency = ? WHERE id = ?').run(
      input.name,
      input.currency,
      user.householdId,
    );

    // Only when something actually moved, and only to the people who did not
    // do it. Saving a form unchanged is not news, and the currency changes
    // what every figure on screen means.
    const changes: string[] = [];
    if (before.name !== input.name) changes.push(`the name from "${before.name}" to "${input.name}"`);
    if (before.currency !== input.currency) {
      changes.push(`the currency from ${before.currency} to ${input.currency}`);
    }
    if (changes.length > 0) {
      await notifyAll(householdAddresses(user.householdId, { except: user.id }), (to) =>
        householdChangedNotice(to, before.name, changes.join(' and ')),
      );
    }

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

    // Gathered before the delete, or there would be nobody left to look up.
    // The name too: the row is about to stop existing.
    const household = db
      .prepare('SELECT name FROM households WHERE id = ?')
      .get(user.householdId) as Pick<HouseholdRow, 'name'>;
    const affected = householdAddresses(user.householdId);

    db.prepare('DELETE FROM households WHERE id = ?').run(user.householdId);

    // After the delete, not before: nobody should be told about something that
    // then failed to happen. Everyone is told, the owner who did it included —
    // it is the kind of thing you want a record of in your own inbox.
    await notifyAll(affected, (to) => householdDeletedNotice(to, household.name));

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
 * Leaving under your own steam — the way out that did not exist, and the
 * reason a member who simply wanted out had to ask an owner to remove them.
 *
 * Registered **before** `/members/:id` deliberately. Express takes the first
 * route that matches, so with the order reversed `me` would be read as an id
 * and the handler behind `requireOwner` would answer — turning this into an
 * owners-only route, for the one group of people it is not for.
 *
 * Two cases are refused, both because going would strand something:
 *
 * - **The only owner while anyone else is still here.** The same rule that
 *   stops the only owner deleting their account (§3): nobody would be left
 *   able to invite, rename or remove, and promoting somebody on their way out
 *   is not this app's decision to make. "Make owner" first.
 * - **The last person in it.** Nobody would ever reach those rows again.
 *   Deleting an account takes an empty household with it; leaving must not,
 *   because leaving is not password-confirmed and this is the one reading of
 *   the button that destroys data. "Delete this household" sits beside it and
 *   does ask for a password.
 *
 * Otherwise it is precisely the removal an owner could already perform, so it
 * does the same thing: the membership goes, the account and the expenses stay
 * (§3), and any recovery link an owner minted for this account is retired on
 * the way out — an owner's reach has to stop at the door whichever side
 * opens it.
 */
householdRouter.delete(
  '/members/me',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const others = db
      .prepare(
        `SELECT COUNT(*) AS total, COUNT(CASE WHEN role = 'owner' THEN 1 END) AS owners
         FROM memberships WHERE household_id = ? AND user_id != ?`,
      )
      .get(user.householdId, user.id) as { total: number; owners: number };

    const household = db
      .prepare('SELECT name FROM households WHERE id = ?')
      .get(user.householdId) as Pick<HouseholdRow, 'name'>;

    if (others.total === 0) {
      throw badRequest(
        `You are the only person in "${household.name}", so there would be nobody left to reach it. ` +
          'Delete the household instead, from the Danger zone below.',
      );
    }
    if (user.role === 'owner' && others.owners === 0) {
      throw badRequest(
        `You are the only owner of "${household.name}". Make someone else an owner first.`,
      );
    }

    const membership = db
      .prepare('SELECT * FROM memberships WHERE user_id = ? AND household_id = ?')
      .get(user.id, user.householdId) as MembershipRow;
    // Gathered while the membership still exists, sent once it does not.
    const owners = householdAddresses(user.householdId, { ownersOnly: true, except: user.id });

    db.transaction(() => {
      db.prepare('DELETE FROM memberships WHERE id = ?').run(membership.id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(
        nowIso(),
        user.id,
      );
    })();

    // The owners hear it; the person who left does not need telling. It is the
    // same notice as a removal, because the household hears the same fact.
    await notifyAll(owners, (to) =>
      memberRemovedNotice(to, household.name, membership.display_name),
    );

    // Their cookie still names the household they have just left. It would be
    // ignored anyway — the membership behind it is re-read on every request —
    // but re-issuing it pointing at nothing is what lands an account holding
    // others on the picker rather than on a household it did not choose.
    issueSession(res, db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as UserRow, null);
    res.status(204).end();
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
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if (req.params.id === user.id) {
      throw badRequest('You cannot remove yourself from the household');
    }
    const membership = db
      .prepare('SELECT * FROM memberships WHERE user_id = ? AND household_id = ?')
      .get(req.params.id, user.householdId) as MembershipRow | undefined;
    if (!membership) throw notFound('That member does not exist');

    const removed = db
      .prepare('SELECT email FROM users WHERE id = ?')
      .get(membership.user_id) as Pick<UserRow, 'email'>;
    const household = db
      .prepare('SELECT name FROM households WHERE id = ?')
      .get(user.householdId) as Pick<HouseholdRow, 'name'>;
    // The other owners, gathered while the membership still exists.
    const owners = householdAddresses(user.householdId, { ownersOnly: true, except: user.id });

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

    // The person who lost their access hears it first-hand, and the other
    // owners hear that the household changed shape. The owner who did it does
    // not need telling.
    await Promise.all([
      memberRemovedNotice(removed.email, household.name, 'you'),
      notifyAll(owners, (to) =>
        memberRemovedNotice(to, household.name, membership.display_name),
      ),
    ]);

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
  asyncHandler(async (req, res) => {
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

    if (membership.role !== input.role) {
      const member = db
        .prepare('SELECT email FROM users WHERE id = ?')
        .get(membership.user_id) as Pick<UserRow, 'email'>;
      const household = db
        .prepare('SELECT name FROM households WHERE id = ?')
        .get(user.householdId) as Pick<HouseholdRow, 'name'>;
      await roleChangedNotice(member.email, household.name, input.role);
    }

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
 * Issues a recovery link for a member who is locked out — **only where the app
 * cannot send email**.
 *
 * This was the only recovery there was, and it granted rather a lot: an owner
 * could reset the password of an account that may belong to households they
 * have never heard of, which was contained when an account *was* a household
 * and stopped being so when one account could hold several. `POST /auth/forgot`
 * removed the need for it, so on any deployment that can send mail the owner is
 * refused and pointed at the sign-in page (`ARCHITECTURE.md` §4).
 *
 * It survives for the deployment with no provider, where refusing here as well
 * would leave a locked-out member with no way back in at all. There the link is
 * returned to the owner to hand over, which is the only way it travels.
 */
householdRouter.post(
  '/members/:id/reset-password',
  requireOwner,
  asyncHandler(async (req, res) => {
    if (config.emailConfigured) {
      throw forbidden(
        'Anyone locked out can reset their own password from the sign-in page — "Forgotten your password?". Owner-issued links are only used where this site cannot send email.',
      );
    }

    const user = currentUser(req);
    const member = db
      .prepare(
        `SELECT users.id AS id, users.email AS email
         FROM memberships JOIN users ON users.id = memberships.user_id
         WHERE memberships.user_id = ? AND memberships.household_id = ?`,
      )
      .get(req.params.id, user.householdId) as { id: string; email: string } | undefined;
    if (!member) throw notFound('That member does not exist');

    // Shared with self-service recovery (`POST /auth/forgot`), so both kinds of
    // link expire and retire each other by the same rule; `created_by` is what
    // separates them.
    const { token, expiresAt } = issuePasswordReset(member.id, user.id);

    res.status(201).json({
      token,
      expires_at: expiresAt,
      notice: await passwordResetNotice(member.email, `/reset/${token}`),
    });
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

/**
 * Creates a single-use link that lets a family member join the household.
 *
 * An address is optional, and that is what decides whether anything can be
 * sent: with one, the invite is emailed; without, there is nobody to email and
 * the owner passes the link on. The link is in the response regardless.
 *
 * An address already in the household is refused. Redemption would refuse it
 * anyway — nobody holds two memberships in one household — so minting the link
 * only sends somebody an email that leads to a dead end. Only checked when
 * there **is** an address: an open invite is a link to hand to whoever turns
 * up, and there is no way to know yet who that will be.
 */
householdRouter.post(
  '/invites',
  requireOwner,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = parseBody(inviteSchema, req.body);

    if (input.email) {
      const existing = db
        .prepare(
          `SELECT m.display_name AS name
           FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.household_id = ? AND u.email = ?`,
        )
        .get(user.householdId, input.email) as { name: string } | undefined;
      if (existing) {
        throw conflict(`${existing.name} is already in this household — no invite needed.`);
      }
    }

    const token = newToken();
    const expiresAt = new Date(Date.now() + config.inviteMaxAgeMs).toISOString();

    db.prepare(
      `INSERT INTO invites (token, household_id, email, role, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(token, user.householdId, input.email || null, input.role, user.id, expiresAt, nowIso());

    const household = db
      .prepare('SELECT name FROM households WHERE id = ?')
      .get(user.householdId) as Pick<HouseholdRow, 'name'>;

    res.status(201).json({
      token,
      email: input.email || null,
      role: input.role,
      expires_at: expiresAt,
      notice: await inviteNotice(input.email || '', household.name, `/join/${token}`),
    });
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
