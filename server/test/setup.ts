import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

/**
 * Vitest runs this before the test file's own imports, and gives each test
 * file a fresh module registry. Pointing DATABASE_PATH somewhere unique here
 * therefore means every test file gets its own database, and files can run in
 * parallel without touching each other's rows.
 *
 * `config.ts` reads these at import time, so nothing may import application
 * code before this runs.
 */
const databasePath = path.join(os.tmpdir(), `home-budget-test-${crypto.randomUUID()}.sqlite`);

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';
process.env.DATABASE_PATH = databasePath;

afterAll(() => {
  // WAL mode leaves sidecar files next to the database.
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
});
