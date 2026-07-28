import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';

/**
 * Writes a consistent snapshot of the database.
 *
 * This uses SQLite's online backup API rather than copying the file. In WAL
 * mode a plain `cp` can capture the main file without the matching WAL
 * contents, producing a snapshot that is silently missing recent writes — or
 * is outright corrupt. The backup API cooperates with the running database and
 * always yields a valid, self-contained file.
 *
 * Run with `npm run backup`. Safe to run while the app is serving traffic.
 */

const backupDir =
  process.env.BACKUP_DIR ?? path.join(path.dirname(config.databasePath), 'backups');

/** How many snapshots to keep before the oldest are removed. */
const KEEP = Number(process.env.BACKUP_KEEP ?? 14);

function prune(): number {
  const snapshots = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith('home-budget-') && name.endsWith('.sqlite'))
    // Timestamped names sort chronologically, so newest last.
    .sort();

  const doomed = snapshots.slice(0, Math.max(0, snapshots.length - KEEP));
  for (const name of doomed) {
    // Anything that has opened a snapshot leaves WAL sidecars next to it.
    // Remove those too, or they accumulate on the volume forever.
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(path.join(backupDir, `${name}${suffix}`), { force: true });
    }
  }
  return doomed.length;
}

async function main() {
  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(backupDir, `home-budget-${stamp}.sqlite`);

  await db.backup(destination);

  const { size } = fs.statSync(destination);
  const removed = prune();

  console.log(`Backup written: ${destination} (${(size / 1024).toFixed(1)} kB)`);
  if (removed > 0) console.log(`Pruned ${removed} old snapshot(s), keeping the newest ${KEEP}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Backup failed:', error);
    process.exit(1);
  });
