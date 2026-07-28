import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * The schema is applied on every boot. Every statement is idempotent, so this
 * doubles as the migration step for a fresh database and a no-op for an
 * existing one.
 */
const SCHEMA = `
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
`;

db.exec(SCHEMA);
