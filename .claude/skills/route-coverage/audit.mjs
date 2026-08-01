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

/** Which test files call each route, across the whole suite. */
function readAllCalls() {
  const byFile = {};
  for (const file of fs.readdirSync(serverTest).sort()) {
    if (file.endsWith('.test.ts')) byFile[file] = readCalls(file);
  }
  return byFile;
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

  const byFile = readAllCalls();

  const callers = (route) =>
    Object.entries(byFile)
      .filter(([, calls]) =>
        calls.some((call) => call.method === route.method && call.shape === shape(route.path)),
      )
      .map(([file]) => file);

  const rows = routes.map((route) => {
    const suite = obligation(route);
    const files = callers(route);
    return { ...route, suite, files, home: suite ? files.includes(suite) : null };
  });

  // Untouched by the whole suite. Nothing anywhere would notice if the handler
  // stopped filtering, so this is the list that actually matters.
  const untested = rows.filter((row) => row.suite && row.files.length === 0);
  console.log(`\nCalled by no test at all — ${untested.length} route(s)`);
  for (const row of untested) {
    // A path parameter means the route accepts an id from the caller, which is
    // what `assertOwned()` exists for and what one household would use to reach
    // into another's rows.
    const aimed = row.path.includes('/:') ? '  <- takes an id from the caller' : '';
    console.log(`  -> ${row.method.padEnd(6)} ${row.path}${aimed}`);
  }
  if (untested.length === 0) console.log('  none — every route is exercised somewhere');

  // Covered, but somewhere other than the file §15 names. Often legitimate:
  // recurring keeps its own cross-household case in `recurring.test.ts`. Worth
  // an eye, never an alarm.
  const elsewhere = rows.filter((row) => row.suite && row.files.length > 0 && !row.home);
  console.log(`\nExercised elsewhere, not in the file §15 names — ${elsewhere.length} route(s)`);
  for (const row of elsewhere) {
    console.log(`     ${row.method.padEnd(6)} ${row.path.padEnd(44)} ${row.files.join(', ')}`);
  }

  if (showAll) {
    for (const suite of ['isolation.test.ts', 'share.test.ts']) {
      const group = rows.filter((row) => row.suite === suite);
      console.log(`\n${suite} — ${group.filter((row) => row.home).length}/${group.length} routes`);
      for (const row of group) {
        console.log(`  ${row.home ? '  ' : '->'} ${row.method.padEnd(6)} ${row.path}`);
      }
    }
    const exempt = rows.filter((row) => row.suite === null);
    console.log(`\n${exempt.length} auth routes exempt:`);
    for (const row of exempt) console.log(`     ${row.method.padEnd(6)} ${row.path}`);
  } else {
    const exempt = rows.filter((row) => row.suite === null).length;
    console.log(`\n${exempt} auth routes exempt (auth.test.ts covers them on its own terms).`);
  }

  console.log(
    untested.length === 0
      ? '\nEvery household-scoped and guest-reachable route is exercised by some test.'
      : '\nA route no test calls is definitely untested. One that is called is only a' +
          '\ncandidate: reaching it is the floor, and the case still has to assert that the' +
          '\nother household gets nothing. Break the code once to find out which you have.',
  );

  if (strict && untested.length > 0) process.exitCode = 1;
}

main();
