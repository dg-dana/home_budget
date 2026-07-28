import { Router } from 'express';
import { z } from 'zod';
import {
  currentUser,
  clearSession,
  hashPassword,
  issueSession,
  newId,
  nowIso,
  requireAuth,
  toSessionUser,
  verifyPassword,
} from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, conflict, parseBody, unauthorized } from '../http.js';
import type { HouseholdRow, InviteRow, UserRow } from '../types.js';

export const authRouter = Router();

const DEFAULT_CATEGORIES: Array<{ name: string; color: string }> = [
  { name: 'Groceries', color: '#16a34a' },
  { name: 'Rent & Bills', color: '#2563eb' },
  { name: 'Transport', color: '#f59e0b' },
  { name: 'Health', color: '#ef4444' },
  { name: 'Home', color: '#8b5cf6' },
  { name: 'Leisure', color: '#ec4899' },
  { name: 'Other', color: '#64748b' },
];

const email = z.string().trim().toLowerCase().email('Enter a valid email address');
const password = z.string().min(8, 'Password must be at least 8 characters');
const personName = z.string().trim().min(1, 'Name is required').max(80);

const registerSchema = z.object({
  householdName: z.string().trim().min(1, 'Household name is required').max(80),
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  name: personName,
  email,
  password,
});

const joinSchema = z.object({
  token: z.string().min(1),
  name: personName,
  email,
  password,
});

const loginSchema = z.object({ email, password: z.string().min(1) });

const findUserByEmail = (value: string) =>
  db.prepare('SELECT * FROM users WHERE email = ?').get(value) as UserRow | undefined;

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

/** Creates a brand new household with the registering person as its owner. */
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = parseBody(registerSchema, req.body);
    if (findUserByEmail(input.email)) {
      throw conflict('An account with that email already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const householdId = newId();
    const userId = newId();

    db.transaction(() => {
      db.prepare(
        'INSERT INTO households (id, name, currency, created_at) VALUES (?, ?, ?, ?)',
      ).run(householdId, input.householdName, input.currency, nowIso());
      db.prepare(
        `INSERT INTO users (id, household_id, email, name, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?, 'owner', ?)`,
      ).run(userId, householdId, input.email, input.name, passwordHash, nowIso());
      seedCategories(householdId);
    })();

    const user = getUser(userId);
    issueSession(res, user);
    res.status(201).json({ user: toSessionUser(user) });
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

/** Redeems an invite: creates a member account inside an existing household. */
authRouter.post(
  '/join',
  asyncHandler(async (req, res) => {
    const input = parseBody(joinSchema, req.body);
    const invite = db
      .prepare('SELECT * FROM invites WHERE token = ?')
      .get(input.token) as InviteRow | undefined;

    if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) {
      throw badRequest('This invite link is invalid or has expired');
    }
    if (invite.email && invite.email !== input.email) {
      throw badRequest(`This invite was issued for ${invite.email}`);
    }
    if (findUserByEmail(input.email)) {
      throw conflict('An account with that email already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const userId = newId();

    db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, household_id, email, name, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(userId, invite.household_id, input.email, input.name, passwordHash, invite.role, nowIso());
      db.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE token = ?').run(
        nowIso(),
        userId,
        invite.token,
      );
    })();

    const user = getUser(userId);
    issueSession(res, user);
    res.status(201).json({ user: toSessionUser(user) });
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
    issueSession(res, user);
    res.json({ user: toSessionUser(user) });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

/** Current session plus the household context the frontend renders around. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler((req, res) => {
    const user = currentUser(req);
    const household = db
      .prepare('SELECT id, name, currency FROM households WHERE id = ?')
      .get(user.householdId) as Pick<HouseholdRow, 'id' | 'name' | 'currency'>;
    res.json({ user, household });
  }),
);
