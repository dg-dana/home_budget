import crypto from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';

/**
 * Ordered, append-only list of schema migrations.
 *
 * Rules:
 * - Never edit or reorder a migration that has shipped. Add a new one.
 * - `id` is what gets recorded, so it must stay stable.
 * - Each migration runs inside a transaction; a throw rolls it back.
 *
 * Migration 001 is the original schema. Every statement in it is
 * `IF NOT EXISTS`, so it is a no-op against a database created before this
 * system existed — which is what lets those databases adopt it cleanly.
 */
export interface Migration {
  id: string;
  up: (db: BetterSqlite3.Database) => void;
}

const exec = (sql: string) => (db: BetterSqlite3.Database) => db.exec(sql);

export const migrations: Migration[] = [
  {
    id: '001-initial-schema',
    up: exec(`
CREATE TABLE IF NOT EXISTS households (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  household_id   TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  token         TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email         TEXT,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at    TEXT NOT NULL,
  used_at       TEXT,
  used_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invites_household ON invites(household_id);

CREATE TABLE IF NOT EXISTS categories (
  id                    TEXT PRIMARY KEY,
  household_id          TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  color                 TEXT NOT NULL DEFAULT '#64748b',
  monthly_budget_cents  INTEGER,
  created_at            TEXT NOT NULL,
  UNIQUE (household_id, name)
);

CREATE TABLE IF NOT EXISTS expenses (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  paid_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  description   TEXT NOT NULL DEFAULT '',
  spent_on      TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_household_date ON expenses(household_id, spent_on);

CREATE TABLE IF NOT EXISTS shopping_lists (
  id              TEXT PRIMARY KEY,
  household_id    TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  share_token     TEXT UNIQUE,
  share_can_edit  INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lists_household ON shopping_lists(household_id);

CREATE TABLE IF NOT EXISTS shopping_items (
  id               TEXT PRIMARY KEY,
  list_id          TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  quantity         TEXT NOT NULL DEFAULT '',
  note             TEXT NOT NULL DEFAULT '',
  is_checked       INTEGER NOT NULL DEFAULT 0,
  added_by_name    TEXT NOT NULL,
  checked_by_name  TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_list ON shopping_items(list_id);
`),
  },

  {
    id: '002-recurring-expenses',
    up: exec(`
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id                 TEXT PRIMARY KEY,
  household_id       TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  category_id        TEXT REFERENCES categories(id) ON DELETE SET NULL,
  paid_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  description        TEXT NOT NULL DEFAULT '',
  frequency          TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  starts_on          TEXT NOT NULL,
  ends_on            TEXT,
  -- Date of the most recent occurrence turned into a real expense. NULL means
  -- nothing has been generated yet.
  last_generated_on  TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recurring_household ON recurring_expenses(household_id);

-- Links a generated expense back to the rule that produced it, so the UI can
-- label it. ON DELETE SET NULL: deleting a rule keeps the history it created.
ALTER TABLE expenses ADD COLUMN recurring_id TEXT REFERENCES recurring_expenses(id) ON DELETE SET NULL;
`),
  },

  {
    id: '003-password-resets',
    up: exec(`
CREATE TABLE IF NOT EXISTS password_resets (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

-- Bumped on every password change. The value is baked into each session token,
-- and a token whose generation no longer matches is refused — which is what
-- makes a password change actually evict an attacker holding a stolen cookie.
-- A counter rather than a timestamp, because a JWT's iat claim has only
-- second resolution: a timestamp cutoff cannot distinguish the session being
-- issued by the password change from one stolen moments earlier.
ALTER TABLE users ADD COLUMN session_generation INTEGER NOT NULL DEFAULT 0;
`),
  },

  {
    id: '004-memberships-and-email-verification',
    up: (db) => {
      db.exec(`
-- An account's place in one household. Replaces users.household_id: the same
-- email may now own or join several households, and carries a different name
-- in each ("Dad" at home, "Dana" in the flat share).
CREATE TABLE IF NOT EXISTS memberships (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  display_name  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (user_id, household_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_household ON memberships(household_id);

-- Single-use links proving the address on an account is real. Same shape as
-- invites and password resets, and cascades with the user for the same reason.
CREATE TABLE IF NOT EXISTS email_verifications (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);

ALTER TABLE users ADD COLUMN email_verified_at TEXT;

-- The household this account last had open. Only a convenience: it decides
-- where a fresh sign-in lands, so someone who mostly uses one household is not
-- asked to pick it every time. Never trusted for access — the membership is
-- still checked — and ON DELETE SET NULL so a deleted household just means
-- "ask again".
ALTER TABLE users ADD COLUMN last_household_id TEXT REFERENCES households(id) ON DELETE SET NULL;
`);

      // Every existing account becomes a membership of the household it was
      // pinned to, keeping its role and the name it already went by.
      const existing = db
        .prepare('SELECT id, household_id, name, role, created_at FROM users')
        .all() as Array<{
        id: string;
        household_id: string;
        name: string;
        role: string;
        created_at: string;
      }>;
      const insert = db.prepare(
        `INSERT INTO memberships (id, user_id, household_id, role, display_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const row of existing) {
        insert.run(crypto.randomUUID(), row.id, row.household_id, row.role, row.name, row.created_at);
      }
      // Existing accounts carry on landing exactly where they always did.
      db.prepare('UPDATE users SET last_household_id = household_id').run();

      // Accounts that predate verification are verified by definition. A deploy
      // must not lock out the people already using the app.
      db.prepare('UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL').run();

      // The one-household-per-user assumption, finally gone. DROP COLUMN leaves
      // every other table's rows untouched; the usual rebuild-and-rename recipe
      // would have fired the ON DELETE SET NULL rules on the way through and
      // quietly erased who paid for what.
      db.exec(`
ALTER TABLE users DROP COLUMN household_id;
ALTER TABLE users DROP COLUMN role;
ALTER TABLE users DROP COLUMN name;
`);
    },
  },

  {
    id: '005-user-language',
    up: (db) => {
      // What language to *email* this account in.
      //
      // The interface language is a per-device choice and stays one — a guest
      // has no account to hang it on (`ARCHITECTURE.md` §9.1a). But the server
      // cannot ask a device anything: half the messages it sends go to people
      // who are not making the request, and some go to people who are asleep.
      // So an account carries the language its post arrives in, set from
      // whatever the browser was reading when it registered and updated
      // whenever a signed-in person flips the picker.
      //
      // Defaulting to 'en' is what every account that predates this gets, which
      // is exactly the English they have been receiving all along. A deploy must
      // not silently start writing to people in a language they did not pick.
      db.exec(`
ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'de'));
`);
    },
  },

  {
    id: '006-account-preferences',
    up: (db) => {
      // Language and theme now **follow the account**, not the device.
      //
      // Both started per device, on the reasoning that one person may want
      // different answers on a phone and a laptop (`ARCHITECTURE.md` §9.1).
      // That reasoning was wrong about the case that actually happens: a
      // browser drops its `localStorage` — iOS evicts it, a Home Screen
      // shortcut keeps its own, a reinstall wipes it — and the choice is gone
      // with no way to get it back except making it again. A setting you have
      // to keep re-making is not a setting.
      //
      // `preferences_saved_at` is what makes this deployable without changing
      // anything under anybody. NULL means this account has never explicitly
      // saved a pair, so the **device wins** on the next sign-in and is written
      // up — everyone keeps exactly what they are looking at today, and it
      // sticks from then on. Non-null means the account decides.
      db.exec(`
ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system'));
ALTER TABLE users ADD COLUMN preferences_saved_at TEXT;
`);
    },
  },

  {
    id: '007-todos',
    up: exec(`
-- The household's shared to-do list: jobs, not groceries.
--
-- A separate table rather than another kind of shopping list, because the two
-- differ in exactly the place that matters. A shopping item is a thing to buy,
-- carries a quantity, and — via a share link — may be ticked off by somebody
-- with no account at all, which is why \`shopping_items\` records names as plain
-- text (\`ARCHITECTURE.md\` §3). A to-do is a job somebody in the household took
-- on, so it points at the **account** that added it and the one that finished
-- it, and it is never guest-reachable. Sharing one table would have meant a
-- nullable half of each shape and a \`kind\` column deciding which half is real.
CREATE TABLE IF NOT EXISTS todos (
  id            TEXT PRIMARY KEY,
  household_id  TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  is_done       INTEGER NOT NULL DEFAULT 0,
  -- SET NULL, like every other authored row here: closing an account must not
  -- take the household's jobs with it.
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  done_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  done_at       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_household ON todos(household_id);
`),
  },
];
