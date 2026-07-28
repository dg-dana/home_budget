import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { migrations } from './migrations.js';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new Database(config.databasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Applies any migrations this database has not seen, in order, each in its own
 * transaction. Runs on every boot; a database that is already current does no
 * work beyond one SELECT.
 */
export function runMigrations(database: Database.Database = db): string[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (database.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map(
      (row) => row.id,
    ),
  );

  const record = database.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  const ran: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    database.transaction(() => {
      migration.up(database);
      record.run(migration.id, new Date().toISOString());
    })();
    ran.push(migration.id);
  }

  return ran;
}

const ran = runMigrations();
if (ran.length > 0) {
  console.log(`Applied ${ran.length} migration(s): ${ran.join(', ')}`);
}
