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
];
