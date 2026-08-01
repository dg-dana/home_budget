#!/usr/bin/env node
/**
 * Lists every route the app registers, and which ones no isolation or share
 * test ever calls.
 *
 * Rule 1 of this codebase is that every household-scoped query filters on the
 * caller's `household_id`, and `isolation.test.ts` is what holds it up. The
 * obligation to add a case there — and to `share.test.ts` for anything a guest
 * can reach — is written down in ARCHITECTURE.md §15 and enforced by nothing.
 * This turns it into a list you can read.
 *
 * It matches by method and path shape. That proves a test *reaches* a route,
 * never that it asserts the right thing — see SKILL.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const serverSrc = path.join(repoRoot, 'server', 'src');
const serverTest = path.join(repoRoot, 'server', 'test');

const strict = process.argv.includes('--strict');
const showAll = process.argv.includes('--all');

// ---------------------------------------------------------------------------
// What the app registers
// ---------------------------------------------------------------------------

/** `app.use('/api/lists', listsRouter)` → `{ listsRouter: '/api/lists' }`. */
function readMounts() {
  const source = fs.readFileSync(path.join(serverSrc, 'app.ts'), 'utf8');
  const mounts = {};
  // The router is the last argument, and some mounts spread a limiter in
  // between (`app.use('/api/auth', ...authLimiter, authRouter)`).
  for (const [, prefix, rest] of source.matchAll(/app\.use\(\s*'([^']+)'\s*,([^;]*?)\);/gs)) {
    const router = [...rest.matchAll(/(\w+Router)\b/g)].pop();
    if (router) mounts[router[1]] = prefix;
  }
  return mounts;
}

/** Every `xRouter.get('/path', …)` in the routes directory. */
function readRoutes(mounts) {
  const routes = [];
  for (const file of fs.readdirSync(path.join(serverSrc, 'routes')).sort()) {
    if (!file.endsWith('.ts')) continue;
    const source = fs.readFileSync(path.join(serverSrc, 'routes', file), 'utf8');
    // The path often sits on the line after the opening bracket, so this has
    // to cross newlines.
    const pattern = /(\w+Router)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\3/gs;
    for (const [, router, method, , routePath] of source.matchAll(pattern)) {
      const prefix = mounts[router];
      if (!prefix) continue;
      routes.push({
        method: method.toUpperCase(),
        path: join(prefix, routePath),
        router,
        file: `server/src/routes/${file}`,
      });
    }
  }
  return routes;
}

const join = (prefix, suffix) =>
  suffix === '/' || suffix === '' ? prefix : `${prefix}${suffix.startsWith('/') ? '' : '/'}${suffix}`;

// ---------------------------------------------------------------------------
// What the tests call
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reduces a path to its shape, so a call and a route definition can be
 * compared: `/api/lists/${list.body.id}/items` and `/api/lists/:id/items` both
 * become `/api/lists/:x/items`.
 */
function shape(rawPath) {
  return rawPath
    .split('?')[0]
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) return ':x';
      // `${...}` anywhere in a segment means a value was interpolated in.
      if (segment.includes('${')) return ':x';
      if (UUID.test(segment)) return ':x';
      return segment;
    })
    .join('/');
}

/** Every `something.post('/api/…')` in a test file. */
function readCalls(file) {
  const full = path.join(serverTest, file);
  if (!fs.existsSync(full)) return [];
  const source = fs.readFileSync(full, 'utf8');
  const pattern = /\.(get|post|put|patch|delete)\(\s*(['"`])(\/api\/[^'"`]*)\2/gs;
  return [...source.matchAll(pattern)].map(([, method, , callPath]) => ({
    method: method.toUpperCase(),
    shape: shape(callPath),
  }));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Which suite owes this route a case.
 *
 * Auth routes are exempt: they are not household-scoped, and `auth.test.ts`
 * covers registration, cookies and the invite lifecycle in its own terms.
 */
function obligation(route) {
  if (route.router === 'authRouter') return null;
  if (route.router === 'shareRouter') return 'share.test.ts';
  return 'isolation.test.ts';
}

function main() {
  const mounts = readMounts();
  const routes = readRoutes(mounts);
  if (routes.length === 0) {
    console.error('No routes found — has server/src/routes moved?');
    process.exitCode = 1;
    return;
  }

  const calls = {
    'isolation.test.ts': readCalls('isolation.test.ts'),
    'share.test.ts': readCalls('share.test.ts'),
  };

  const covered = (route, suite) =>
    calls[suite].some((call) => call.method === route.method && call.shape === shape(route.path));

  const rows = routes.map((route) => {
    const suite = obligation(route);
    return { ...route, suite, covered: suite ? covered(route, suite) : null };
  });

  for (const suite of ['isolation.test.ts', 'share.test.ts']) {
    const group = rows.filter((row) => row.suite === suite);
    const gaps = group.filter((row) => !row.covered);
    console.log(`\n${suite} — ${group.length - gaps.length}/${group.length} routes reached`);

    if (showAll) {
      for (const row of group) {
        console.log(`  ${row.covered ? '  ' : '->'} ${row.method.padEnd(6)} ${row.path}`);
      }
    }
    if (gaps.length === 0) {
      console.log('  every route is reached');
      continue;
    }

    // A route with a path parameter accepts an id from the caller, which is
    // exactly what `assertOwned()` exists for and what one household would use
    // to reach into another. A route without one can still leak, but it cannot
    // be *aimed*, so it is the less urgent half of the list.
    const takesId = gaps.filter((row) => row.path.includes('/:'));
    const rest = gaps.filter((row) => !row.path.includes('/:'));
    if (!showAll) {
      if (takesId.length > 0) {
        console.log('  takes an id from the caller — what rule 1 is about:');
        for (const row of takesId) console.log(`    -> ${row.method.padEnd(6)} ${row.path}`);
      }
      if (rest.length > 0) {
        console.log('  no path parameter — cannot be aimed at another household, still worth a case:');
        for (const row of rest) console.log(`    -> ${row.method.padEnd(6)} ${row.path}`);
      }
    }
  }

  const exempt = rows.filter((row) => row.suite === null);
  console.log(`\n${exempt.length} auth routes exempt (auth.test.ts covers them on its own terms)`);
  if (showAll) {
    for (const row of exempt) console.log(`     ${row.method.padEnd(6)} ${row.path}`);
  }

  const gaps = rows.filter((row) => row.suite && !row.covered);
  console.log(
    gaps.length === 0
      ? '\nEvery household-scoped and guest-reachable route is reached by its suite.'
      : `\n${gaps.length} route(s) above are never called by the suite that owes them a case.` +
          '\nReaching a route is the floor, not the bar: the case still has to assert that the' +
          '\nother household gets nothing, and you still break the code once to watch it fail.',
  );

  if (strict && gaps.length > 0) process.exitCode = 1;
}

main();
