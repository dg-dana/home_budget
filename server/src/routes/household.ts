import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { currentUser, newToken, nowIso, requireAuth, requireOwner } from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, notFound, parseBody } from '../http.js';
import type { HouseholdRow, InviteRow, UserRow } from '../types.js';

export const householdRouter = Router();

householdRouter.use(requireAuth);

const settingsSchema = z.object({
  name: z.string().trim().min(1, 'Household name is required').max(80),
  currency: z.string().trim().length(3).toUpperCase(),
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
