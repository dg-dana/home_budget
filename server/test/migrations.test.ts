import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db.js';
import { migrations } from '../src/migrations.js';

const temporaryFiles: string[] = [];

function freshDatabase(): Database.Database {
  const file = path.join(os.tmpdir(), `home-budget-migration-${crypto.randomUUID()}.sqlite`);
  temporaryFiles.push(file);
  const database = new Database(file);
  database.pragma('foreign_keys = ON');
  return database;
}

afterEach(() => {
  for (const file of temporaryFiles.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
  }
});

const tableNames = (database: Database.Database) =>
  (
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);

const columnNames = (database: Database.Database, table: string) =>
  (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name,
  );

describe('migrations', () => {
  it('builds the whole schema on an empty database', () => {
    const database = freshDatabase();
    const ran = runMigrations(database);

    expect(ran).toEqual(migrations.map((migration) => migration.id));
    expect(tableNames(database)).toEqual(
      expect.arrayContaining([
        'households',
        'users',
        'invites',
        'categories',
        'expenses',
        'shopping_lists',
        'shopping_items',
        'recurring_expenses',
        'schema_migrations',
      ]),
    );
    expect(columnNames(database, 'expenses')).toContain('recurring_id');
  });

  it('is a no-op on a database that is already current', () => {
    const database = freshDatabase();
    runMigrations(database);

    expect(runMigrations(database)).toEqual([]);
    expect(runMigrations(database)).toEqual([]);
  });

  it('records every applied migration exactly once', () => {
    const database = freshDatabase();
    runMigrations(database);
    runMigrations(database);

    const applied = (
      database.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>
    ).map((row) => row.id);

    expect(applied).toEqual(migrations.map((migration) => migration.id).sort());
  });

  it('adopts a database that predates the migration system', () => {
    // Simulates a deployment created before schema_migrations existed: the
    // original tables are present, but nothing has been recorded. Migration 001
    // is idempotent, so it passes over harmlessly and 002 still applies.
    const database = freshDatabase();
    const initial = migrations[0];
    if (!initial) throw new Error('expected an initial migration');
    initial.up(database);

    expect(tableNames(database)).not.toContain('schema_migrations');
    expect(columnNames(database, 'expenses')).not.toContain('recurring_id');

    const ran = runMigrations(database);

    expect(ran).toEqual(migrations.map((migration) => migration.id));
    expect(columnNames(database, 'expenses')).toContain('recurring_id');
    // And the pre-existing tables were not clobbered.
    expect(tableNames(database)).toEqual(expect.arrayContaining(['households', 'users']));
  });

  it('preserves existing rows when upgrading', () => {
    const database = freshDatabase();
    const initial = migrations[0];
    if (!initial) throw new Error('expected an initial migration');
    initial.up(database);

    database
      .prepare('INSERT INTO households (id, name, currency, created_at) VALUES (?, ?, ?, ?)')
      .run('h1', 'Existing Home', 'GBP', new Date().toISOString());

    runMigrations(database);

    const row = database.prepare('SELECT name, currency FROM households WHERE id = ?').get('h1');
    expect(row).toEqual({ name: 'Existing Home', currency: 'GBP' });
  });

  it('has unique, stable migration ids', () => {
    const ids = migrations.map((migration) => migration.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The first id is depended upon by the adoption path above.
    expect(ids[0]).toBe('001-initial-schema');
  });
});
