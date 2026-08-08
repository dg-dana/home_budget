import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import {
  assertPassword,
  clearSession,
  currentAccount,
  hashPassword,
  householdAddresses,
  recipient,
  issuePasswordReset,
  issueSession,
  membershipIn,
  membershipsOf,
  newId,
  newToken,
  nowIso,
  optionalAuth,
  requireAuth,
  setPassword,
  toSessionAccount,
  verifyPassword,
} from '../auth.js';
import { db } from '../db.js';
import { asyncHandler, badRequest, conflict, parseBody, unauthorized, unavailable } from '../http.js';
import {
  accountDeletedNotice,
  memberRemovedNotice,
  notifyAll,
  passwordChangedNotice,
  passwordResetNotice,
  verifyEmailNotice,
} from '../notifications.js';
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
/**
 * The language is optional and defaults to English, because a client that
 * knows nothing about this — an old build, a script, a curl — must still be
 * able to register. It is what the account's post arrives in, not what the
 * browser renders in; the two are set together and then drift apart freely,
 * since reading is per device and post is per person.
 */
const language = z.enum(['en', 'de']);
const theme = z.enum(['light', 'dark', 'system']);

const registerSchema = z.object({
  email,
  password,
  language: language.default('en'),
  theme: theme.default('system'),
});

/** Both together: they are saved by one action and read back by one screen. */
const preferencesSchema = z.object({ language, theme });

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
    user: {
      ...toSessionAccount(user, membership),
      language: user.language,
      theme: user.theme,
      // Whether the account has ever saved a pair. False means the device it
      // is signing in on decides, and that choice is written up (§9.1b).
      preferencesSaved: user.preferences_saved_at !== null,
    },
    household: current,
    households,
    // Deployment-wide rather than per-account, but this is the channel the
    // frontend already reads for "what can be done here". It is the *effect*
    // (owners can still mint recovery links) rather than the cause (no mail
    // provider), because the effect is what the Household page renders on and
    // the cause is nobody's business out here.
    ownerRecovery: !config.emailConfigured,
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
        `INSERT INTO users (id, email, password_hash, language, theme, preferences_saved_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        input.email,
        passwordHash,
        input.language,
        input.theme,
        // Signing up is a save: whatever they were looking at while they typed
        // their address is what they get on the next device they sign in on.
        nowIso(),
        nowIso(),
      );
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
      verification: await verifyEmailNotice(recipient(user), `/verify/${token}`),
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

/**
 * The language and theme this account gets, wherever it signs in.
 *
 * Saved together rather than one route each, because they are one decision as
 * far as anybody using the app is concerned: "this is how I like it". They are
 * still applied separately — a guest and every signed-out screen read them off
 * the device, which is the only place they can (`ARCHITECTURE.md` §9.1b).
 *
 * Writing here is what stamps `preferences_saved_at`, and that stamp is the
 * whole migration story: until an account has saved once, the device it signs
 * in on decides and is written up, so nothing moves under anybody the day this
 * ships.
 */
authRouter.put(
  '/preferences',
  requireAuth,
  asyncHandler((req, res) => {
    const account = currentAccount(req);
    const input = parseBody(preferencesSchema, req.body);
    db.prepare(
      'UPDATE users SET language = ?, theme = ?, preferences_saved_at = ? WHERE id = ?',
    ).run(input.language, input.theme, nowIso(), account.id);
    res.status(204).end();
  }),
);

/** Issues a fresh confirmation link for the signed-in account. */
authRouter.post(
  '/verify/resend',
  requireAuth,
  asyncHandler(async (req, res) => {
    const account = currentAccount(req);
    const user = getUser(account.id);
    if (user.email_verified_at) throw badRequest('That address is already confirmed');

    const { token } = issueEmailVerification(user);
    res.status(201).json({
      verification: await verifyEmailNotice(recipient(user), `/verify/${token}`),
    });
  }),
);

/**
 * Public preview of an invite link, so the join page can name the household.
 *
 * `optionalAuth` rather than none: the page needs to know whether *this*
 * visitor is already in the household, or it shows somebody a form asking what
 * they want to be called and only refuses once they have filled it in. Signed
 * out the answer is simply false — nobody is anybody yet — and the household id
 * still never leaves the server.
 */
authRouter.get(
  '/invite/:token',
  optionalAuth,
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
    const account = req.user ?? null;
    const alreadyIn = account ? Boolean(membershipIn(account.id, invite.household_id)) : false;

    res.json({
      householdName: household.name,
      email: invite.email,
      role: invite.role,
      alreadyIn,
      // Only to somebody already in it, so this tells them nothing they could
      // not read off `/auth/me`. It is what lets the page offer to *open* the
      // household rather than just naming it — switching needs the id, and the
      // one they have open may be a different one entirely.
      householdId: alreadyIn ? invite.household_id : null,
    });
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
    // Told, not asked: a password changing without the owner's knowledge is
    // the one thing worth an unprompted message.
    await passwordChangedNotice(recipient(user), 'changed');
    // Every other device is signed out; this one gets a fresh cookie, keeping
    // whichever household it was looking at.
    issueSession(res, getUser(user.id), account.householdId);
    res.status(204).end();
  }),
);

const forgotSchema = z.object({ email });

/**
 * Asking for a recovery link yourself — the way out when the person locked out
 * is the owner, or the owner is unreachable.
 *
 * Three things hold this route together, and none of them is optional:
 *
 * - **It never says whether the address has an account.** Same 202, same
 *   wording, same shape, whatever was typed. An endpoint that answers that
 *   question is a way to enumerate who is a customer, and it cannot be
 *   un-shipped once anybody has relied on it.
 * - **The link is never in the response.** Everywhere else an unconfigured
 *   deployment falls back to putting the link on screen (§4.1); here that would
 *   hand anybody a way into any account by typing its address. So with no
 *   provider configured the route refuses outright and says to ask an owner,
 *   which is the recovery this app had before.
 * - **It is limited per address as well as per IP** (`app.ts`), because each
 *   request sends mail to somebody who did not ask for it.
 *
 * An unconfirmed address is served like any other: holding a link sent to that
 * inbox is the same proof confirming an address asks for, so refusing here
 * would strand exactly the people who most need a way back in.
 */
authRouter.post(
  '/forgot',
  asyncHandler(async (req, res) => {
    if (!config.emailConfigured) {
      throw unavailable(
        'This site cannot send email, so it cannot reset a password by itself. Ask a household owner to send you a reset link.',
      );
    }

    const input = parseBody(forgotSchema, req.body);
    const user = findUserByEmail(input.email);

    if (user) {
      // Retires any outstanding link, the same as an owner issuing one: only
      // the newest works, so a link asked for twice cannot leave two keys out.
      const { token } = issuePasswordReset(user.id, null);
      await passwordResetNotice(recipient(user), `/reset/${token}`);
    }

    // Accepted, not "sent": from out here the two cases have to look the same.
    res.status(202).json({ ok: true });
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

    // The account's own address hears about it even though the link may have
    // come from an owner: a recovery link is a way in, so the person it
    // belongs to should see it being used.
    await passwordChangedNotice(recipient(user), 'reset');
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

    // Everything the notices need, read while the rows still exist: the
    // address about to be deleted, and — for each household carrying on —
    // who is left to tell and what this person was called there.
    const deleted = recipient(getUser(account.id));
    const departures = memberships
      .filter((membership) => !householdsToDelete.includes(membership.household_id))
      .map((membership) => ({
        name: (
          db.prepare('SELECT name FROM households WHERE id = ?').get(membership.household_id) as {
            name: string;
          }
        ).name,
        displayName: membership.display_name,
        owners: householdAddresses(membership.household_id, {
          ownersOnly: true,
          except: account.id,
        }),
      }));

    db.transaction(() => {
      for (const householdId of householdsToDelete) {
        db.prepare('DELETE FROM households WHERE id = ?').run(householdId);
      }
      // Memberships cascade with the user; the empty households above had to go
      // first, while there was still a membership naming them.
      db.prepare('DELETE FROM users WHERE id = ?').run(account.id);
    })();

    // Leaving looks the same from the household's side whether an owner did the
    // removing or the person deleted their account, so it is the same notice.
    await Promise.all([
      accountDeletedNotice(deleted),
      ...departures.map((departure) =>
        notifyAll(departure.owners, (to) =>
          memberRemovedNotice(to, departure.name, departure.displayName),
        ),
      ),
    ]);

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
