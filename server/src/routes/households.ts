import { Router } from 'express';
import { z } from 'zod';
import {
  currentAccount,
  householdAddresses,
  issueSession,
  membershipIn,
  membershipsOf,
  newId,
  nowIso,
  requireAuth,
  requireVerifiedEmail,
  recipient,
} from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, conflict, notFound, parseBody } from '../http.js';
import { householdCreatedNotice, memberJoinedNotice, notifyAll } from '../notifications.js';
import type { HouseholdRow, InviteRow, UserRow } from '../types.js';

/**
 * Households in the plural: the ones an account belongs to, creating another,
 * joining one by invite, and choosing which is on screen.
 *
 * Deliberately separate from `householdRouter` (`/api/household`, singular),
 * which is about administering the one currently open. This router is the only
 * place that may talk about a household the caller is *not* currently in.
 */
export const householdsRouter = Router();

householdsRouter.use(requireAuth);

const DEFAULT_CATEGORIES: Array<{ name: string; color: string }> = [
  { name: 'Groceries', color: '#16a34a' },
  { name: 'Rent & Bills', color: '#2563eb' },
  { name: 'Transport', color: '#f59e0b' },
  { name: 'Health', color: '#ef4444' },
  { name: 'Home', color: '#8b5cf6' },
  { name: 'Leisure', color: '#ec4899' },
  { name: 'Other', color: '#64748b' },
];

/** What you are called in this household — not your login, and not global. */
const displayName = z.string().trim().min(1, 'Enter the name to show in this household').max(80);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Household name is required').max(80),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  displayName,
});

const joinSchema = z.object({ token: z.string().min(1), displayName });

const getUser = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;

function seedCategories(householdId: string) {
  const insert = db.prepare(
    `INSERT INTO categories (id, household_id, name, color, monthly_budget_cents, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  );
  for (const category of DEFAULT_CATEGORIES) {
    insert.run(newId(), householdId, category.name, category.color, nowIso());
  }
}

const describe = (householdId: string, role: string, name: string) => {
  const household = db
    .prepare('SELECT id, name, currency FROM households WHERE id = ?')
    .get(householdId) as Pick<HouseholdRow, 'id' | 'name' | 'currency'>;
  return { ...household, role, displayName: name };
};

/** Every household this account belongs to, and which one is open. */
householdsRouter.get(
  '/',
  asyncHandler((req, res) => {
    const account = currentAccount(req);
    res.json({
      households: membershipsOf(account.id).map((m) =>
        describe(m.household_id, m.role, m.display_name),
      ),
      currentId: account.householdId,
    });
  }),
);

/**
 * Creates a household with this account as its owner, and switches to it.
 *
 * Requires a confirmed address: a household is the thing invites and share
 * links hang off, so it is the point at which an unreachable address stops
 * being only its owner's problem.
 */
householdsRouter.post(
  '/',
  requireVerifiedEmail,
  asyncHandler(async (req, res) => {
    const account = currentAccount(req);
    const input = parseBody(createSchema, req.body);
    const householdId = newId();

    db.transaction(() => {
      db.prepare('INSERT INTO households (id, name, currency, created_at) VALUES (?, ?, ?, ?)').run(
        householdId,
        input.name,
        input.currency,
        nowIso(),
      );
      db.prepare(
        `INSERT INTO memberships (id, user_id, household_id, role, display_name, created_at)
         VALUES (?, ?, ?, 'owner', ?, ?)`,
      ).run(newId(), account.id, householdId, input.displayName, nowIso());
      seedCategories(householdId);
    })();

    // The new household is the one you want to be looking at.
    issueSession(res, getUser(account.id), householdId);
    res.status(201).json({
      household: describe(householdId, 'owner', input.displayName),
      notice: await householdCreatedNotice(recipient(getUser(account.id)), input.name),
    });
  }),
);

/**
 * Invites waiting for this account's address.
 *
 * An invite link travels by email, and an email is easy to lose: before this,
 * somebody who registered from the invite — rather than opening the link again
 * afterwards — landed on the picker with no sign the invite existed, and no
 * way to reach it except finding that message again.
 *
 * Only invites **pinned to this address** appear. An open invite (no email on
 * it) is a link to be handed over, not something to advertise to anybody who
 * happens to be signed in.
 */
householdsRouter.get(
  '/invitations',
  asyncHandler((req, res) => {
    const account = currentAccount(req);
    const invites = db
      .prepare(
        `SELECT i.token, i.role, i.expires_at, h.name AS household_name
         FROM invites i
         JOIN households h ON h.id = i.household_id
         WHERE i.email = ?
           AND i.used_at IS NULL
           AND i.expires_at > ?
           AND NOT EXISTS (
             SELECT 1 FROM memberships m
             WHERE m.household_id = i.household_id AND m.user_id = ?
           )
         ORDER BY i.created_at DESC`,
      )
      .all(account.email, nowIso(), account.id) as Array<
      Pick<InviteRow, 'token' | 'role' | 'expires_at'> & { household_name: string }
    >;

    res.json(
      invites.map((invite) => ({
        token: invite.token,
        role: invite.role,
        expiresAt: invite.expires_at,
        householdName: invite.household_name,
      })),
    );
  }),
);

/**
 * Redeems an invite, adding this account to an existing household.
 *
 * Joining is now something an **account** does, not a way to create one: the
 * invited person registers first, like everyone else, and arrives here signed
 * in. That is what makes it possible to be in more than one household without
 * needing a second email address.
 */
householdsRouter.post(
  '/join',
  requireVerifiedEmail,
  asyncHandler(async (req, res) => {
    const account = currentAccount(req);
    const input = parseBody(joinSchema, req.body);
    const invite = db
      .prepare('SELECT * FROM invites WHERE token = ?')
      .get(input.token) as InviteRow | undefined;

    if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) {
      throw badRequest('This invite link is invalid or has expired');
    }
    if (invite.email && invite.email !== account.email) {
      throw badRequest(`This invite was issued for ${invite.email}`);
    }
    if (membershipIn(account.id, invite.household_id)) {
      throw conflict('You are already in that household');
    }

    db.transaction(() => {
      db.prepare(
        `INSERT INTO memberships (id, user_id, household_id, role, display_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(newId(), account.id, invite.household_id, invite.role, input.displayName, nowIso());
      db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE token = ?').run(
        nowIso(),
        account.id,
        invite.token,
      );
    })();

    // The owners are told somebody is now in their household — an invite link
    // travels through WhatsApp and could have been forwarded, so this is the
    // moment anyone would want to notice. The joiner is not told; they are
    // looking at the household they just joined.
    const household = db
      .prepare('SELECT name FROM households WHERE id = ?')
      .get(invite.household_id) as Pick<HouseholdRow, 'name'>;
    await notifyAll(
      householdAddresses(invite.household_id, { ownersOnly: true, except: account.id }),
      (to) => memberJoinedNotice(to, household.name, input.displayName),
    );

    issueSession(res, getUser(account.id), invite.household_id);
    res.status(201).json({
      household: describe(invite.household_id, invite.role, input.displayName),
    });
  }),
);

/**
 * Switches which household the browser is looking at, by re-issuing the
 * session cookie. A household the caller is not in is "not found", never
 * "forbidden" — the same rule the rest of the app follows about ids belonging
 * to somebody else.
 */
householdsRouter.post(
  '/:id/switch',
  asyncHandler((req, res) => {
    const account = currentAccount(req);
    const membership = membershipIn(account.id, req.params.id);
    if (!membership) throw notFound('That household does not exist');

    issueSession(res, getUser(account.id), membership.household_id);
    res.json({ household: describe(membership.household_id, membership.role, membership.display_name) });
  }),
);
