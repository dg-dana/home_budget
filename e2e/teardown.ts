import fs from 'node:fs';

/** Removes the throwaway database the run created, including its WAL sidecars. */
export default function globalTeardown() {
  const databasePath = process.env.E2E_DATABASE_PATH;
  if (!databasePath) return;
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
  }
}
