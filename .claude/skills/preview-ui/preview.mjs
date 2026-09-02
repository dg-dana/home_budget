#!/usr/bin/env node
/**
 * Screenshots any page of the real app, in both themes and at both widths.
 *
 * Builds the production bundle, runs it on a spare port against a throwaway
 * database, seeds a household with enough data that no page is empty, signs in
 * through the sign-in form, and captures each route. Nothing it touches
 * survives the run except the PNGs.
 *
 * See SKILL.md for the flags and the worked examples.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, request as playwrightRequest } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PASSWORD = 'preview-password';
const OWNER = 'Dana';
/** Screens that only exist for somebody with no session (`web/src/App.tsx`). */
const SIGNED_OUT_ROUTES = ['/login', '/register', '/forgot', '/reset/', '/verify/'];

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    routes: [],
    themes: ['light', 'dark'],
    widths: [1100, 390],
    out: path.join(repoRoot, '.preview'),
    build: true,
    fullPage: true,
    keepOpen: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };

    if (arg === '--route') options.routes.push(value());
    else if (arg === '--themes') options.themes = value().split(',').map((t) => t.trim());
    else if (arg === '--widths') options.widths = value().split(',').map((w) => Number(w.trim()));
    else if (arg === '--out') options.out = path.resolve(value());
    else if (arg === '--skip-build') options.build = false;
    else if (arg === '--fold') options.fullPage = false;
    else if (arg === '--keep-open') options.keepOpen = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`);
    else options.routes.push(arg);
  }

  if (options.routes.length === 0) options.routes = ['/'];
  for (const theme of options.themes) {
    if (!['light', 'dark', 'system'].includes(theme)) {
      throw new Error(`Unknown theme "${theme}" — use light, dark or system`);
    }
  }
  return options;
}

const HELP = `
Usage: node .claude/skills/preview-ui/preview.mjs [routes...] [options]

Routes are app paths: /  /stats  /recurring  /lists  /lists/:id  /todo  /household
  /lists/:id   the seeded list's id is substituted
  /s/:token    the seeded share link; captured as a guest, with no sign-in

Options:
  --themes light,dark    default: light,dark
  --widths 1100,390      default: 1100,390
  --out <dir>            default: <repo>/.preview
  --skip-build           reuse server/dist + web/dist as they are
  --fold                 capture the viewport only, not the full page
  --keep-open            leave the server running and print how to reach it
`.trim();

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${label} failed (exit ${code}):\n${output.slice(-4000)}`));
    });
  });
}

/**
 * Starts the built server the way a deployment does — one process serving the
 * API and the built frontend.
 *
 * `NODE_ENV` is deliberately *not* production: production cookies are `Secure`
 * and would be dropped over plain http, so sign-in would fail. That also lets
 * `RATE_LIMITS=off` take effect, which matters because this script signs in
 * several times a minute. Production ignores that variable (`config.ts`).
 */
async function startServer(port, databasePath, logPath) {
  // Its output goes to a file, not to a pipe. A pipe would keep this script's
  // caller waiting for the server to exit even after the script itself is
  // done, which would make `--keep-open` hang whoever ran it.
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, [path.join(repoRoot, 'server', 'dist', 'index.js')], {
    cwd: repoRoot,
    stdio: ['ignore', logFd, logFd],
    // Its own process group, so the whole tree can be killed at the end. A bare
    // `pkill -f` would match this script's own command line and kill the caller.
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      JWT_SECRET: 'preview-only-secret-not-used-anywhere-real',
      RATE_LIMITS: 'off',
      DATABASE_PATH: databasePath,
    },
  });
  fs.closeSync(logFd);

  const log = () => {
    try {
      return fs.readFileSync(logPath, 'utf8');
    } catch {
      return '(no server log)';
    }
  };
  const exited = new Promise((_, reject) =>
    child.on('exit', (code) => reject(new Error(`server exited early (${code}):\n${log()}`))),
  );

  const health = `http://127.0.0.1:${port}/api/health`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const reached = await Promise.race([
      fetch(health).then((r) => r.ok).catch(() => false),
      exited,
    ]);
    if (reached) {
      // Nothing in this process is waiting on the child any more, so it must
      // not hold the event loop open either.
      child.unref();
      return { child, log };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server never answered ${health}:\n${log()}`);
}

function stopServer(server) {
  try {
    process.kill(-server.child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const stamp = Date.now();
const email = (who) => `${who}-${stamp}@preview.local`;

/** The 15th of a month N months back, in local time — the app's own reckoning. */
function monthsAgo(count) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() - count, 15);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-15`;
}

async function post(api, url, data) {
  const response = await api.post(url, { data });
  if (!response.ok()) throw new Error(`POST ${url} → ${response.status()} ${await response.text()}`);
  return response.status() === 204 ? null : response.json();
}

/**
 * A household with three people, three months of expenses across several
 * categories, a recurring rule, two lists — one of them shared — and a to-do or two.
 *
 * Built through the API rather than the UI: this is a tool for looking at
 * pages, and how the data got in is not what is being looked at. It is also
 * the same shape the e2e helpers use, so the pages render the way the browser
 * tests already exercise them.
 */
async function seed(baseURL) {
  const api = await playwrightRequest.newContext({ baseURL });
  const ownerEmail = email('dana');

  // An account, a confirmed address, then a household: the three steps a real
  // sign-up goes through now.
  const registered = await post(api, '/api/auth/register', {
    email: ownerEmail,
    password: PASSWORD,
  });
  await post(api, '/api/auth/verify', {
    token: String(registered.verification.link).split('/').pop(),
  });
  await post(api, '/api/households', {
    name: 'Preview Household',
    currency: 'USD',
    displayName: OWNER,
  });

  // A second household, so the header's switcher has something to switch
  // between — with one it deliberately renders as plain text.
  await post(api, '/api/households', {
    name: 'Beach Flat',
    currency: 'USD',
    displayName: OWNER,
  });
  const { households } = await (await api.get('/api/households')).json();
  const main = households.find((h) => h.name === 'Preview Household');
  await post(api, `/api/households/${main.id}/switch`, {});

  const members = [{ id: registered.user.id, name: OWNER }];
  for (const name of ['Yossi', 'Noa']) {
    const invite = await post(api, '/api/household/invites', { role: 'member' });
    // Joining sets a session cookie, so each member joins in a context of its
    // own — a shared jar would sign the owner out halfway through.
    const joiner = await playwrightRequest.newContext({ baseURL });
    const account = await post(joiner, '/api/auth/register', {
      email: email(name.toLowerCase()),
      password: PASSWORD,
    });
    await post(joiner, '/api/auth/verify', {
      token: String(account.verification.link).split('/').pop(),
    });
    await post(joiner, '/api/households/join', { token: invite.token, displayName: name });
    members.push({ id: account.user.id, name });
    await joiner.dispose();
  }

  const categories = await (await api.get('/api/categories')).json();
  const category = (name) => categories.find((c) => c.name === name)?.id ?? null;

  const expenses = [
    ['Weekly shop', 128.4, 'Groceries', 0, 0],
    ['Bus pass', 42, 'Transport', 1, 0],
    ['Pharmacy', 23.9, 'Health', 2, 0],
    ['Cinema', 31.5, 'Leisure', 1, 0],
    ['Weekly shop', 96.75, 'Groceries', 0, 1],
    ['Electricity', 210, 'Rent & Bills', 0, 1],
    ['Taxi', 18.25, 'Transport', 2, 1],
    ['Weekly shop', 141.2, 'Groceries', 1, 2],
    ['Plumber', 260, 'Home', 0, 2],
    ['Dentist', 88, 'Health', 2, 2],
  ];
  for (const [description, amount, categoryName, member, month] of expenses) {
    await post(api, '/api/expenses', {
      amount,
      description,
      categoryId: category(categoryName),
      paidBy: members[member].id,
      spentOn: monthsAgo(month),
    });
  }

  // Deliberately not a realistic rent. It materialises for every month in
  // range, so a real one would out-total the hand-entered expenses several
  // times over and leave every chart a single colour.
  await post(api, '/api/recurring', {
    amount: 320,
    description: 'Rent',
    categoryId: category('Rent & Bills'),
    paidBy: members[0].id,
    frequency: 'monthly',
    startsOn: monthsAgo(2),
    endsOn: null,
    isActive: true,
  });

  const groceries = await post(api, '/api/lists', { name: 'Supermarket' });
  const items = {};
  for (const name of ['Milk', 'Bread', 'Olive oil', 'Coffee']) {
    items[name] = await post(api, `/api/lists/${groceries.id}/items`, { name });
  }
  // One comment, so the list pages are looked at with a row carrying one.
  await api.patch(`/api/lists/${groceries.id}/items/${items.Bread.id}`, {
    data: { note: 'The seeded rye from the back shelf, not the sliced white one.' },
  });
  const hardware = await post(api, '/api/lists', { name: 'Hardware store' });
  for (const name of ['Light bulbs', 'Picture hooks']) {
    await post(api, `/api/lists/${hardware.id}/items`, { name });
  }

  // The to-do page wants one job still open, one already done and one added by
  // somebody else, so `/todo` is looked at with all three states on screen.
  const todos = {};
  for (const title of ['Call the plumber about the boiler', 'Take out the recycling']) {
    todos[title] = await post(api, '/api/todos', { title });
  }
  await api.patch(`/api/todos/${todos['Take out the recycling'].id}`, {
    data: { isDone: true },
  });

  const shared = await post(api, `/api/lists/${groceries.id}/share`, { canEdit: true });
  // One invite left unredeemed, so `/join/:token` can be looked at. Opened as
  // the owner it shows the "you are already in this household" screen, which
  // is the state that has no browser test and the one somebody hits by
  // inviting themselves.
  const openInvite = await post(api, '/api/household/invites', { role: 'member' });
  await api.dispose();

  return {
    email: ownerEmail,
    listId: groceries.id,
    shareToken: shared.shareToken,
    inviteToken: openInvite.token,
  };
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

function resolveChromium() {
  const configured = process.env.CHROMIUM_PATH;
  if (configured && fs.existsSync(configured)) return configured;
  // The sandbox ships a prebuilt Chromium; `playwright install` must not run
  // here. The symlink is stable, the versioned directory underneath is not.
  if (fs.existsSync('/opt/pw-browsers/chromium')) return '/opt/pw-browsers/chromium';
  const versioned = fs
    .readdirSync('/opt/pw-browsers', { withFileTypes: true })
    .filter((entry) => entry.name.startsWith('chromium-'))
    .map((entry) => path.join('/opt/pw-browsers', entry.name, 'chrome-linux', 'chrome'))
    .find((candidate) => fs.existsSync(candidate));
  // Undefined means "whatever Playwright installed normally", for a laptop.
  return versioned;
}

const slug = (route) => route.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';

async function signIn(page, ownerEmail) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ownerEmail);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/');
}

/**
 * Whether the header offers a way to this page.
 *
 * Worth reporting even though it is not a screenshot: this project has shipped
 * a feature that was built, merged and deployed and still counted as missing,
 * because no screen anybody looked at carried a control that reached it.
 *
 * Only asked of routes with no parameter in them. A page like `/lists/:id` is
 * reached from its parent by design and could never be a header link, so
 * checking would only produce a warning that is always wrong.
 */
async function reachableFromHeader(page, requested, resolved) {
  if (requested.startsWith('/s/') || /:|\bTOKEN\b|\bID\b/.test(requested)) return null;
  return page.evaluate((target) => {
    const links = [...document.querySelectorAll('header a[href]')];
    return links.some((link) => new URL(link.href).pathname === target);
  }, resolved);
}

/** One browser context: one theme, one width, one kind of visitor. */
async function captureGroup(browser, options, context, group, theme, width) {
  const { baseURL, ownerEmail } = context;
  const results = [];

  const browserContext = await browser.newContext({
    baseURL,
    viewport: { width, height: width < 700 ? 844 : 900 },
  });
  // Set before any script on the page runs, so the pre-paint script in
  // index.html sees the choice and the page never renders the other theme.
  await browserContext.addInitScript(
    ([key, value]) => {
      if (value === 'system') localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    },
    ['home-budget:theme', theme],
  );
  // A guest who has not said who they are gets the name prompt, which is a
  // screen of its own and not the list anybody asked to look at.
  if (group.asGuest) {
    await browserContext.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      ['home-budget:guest-name', 'Ruti next door'],
    );
  }

  const page = await browserContext.newPage();
  const problems = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    // `SessionProvider` hydrates from `/auth/me` on every mount, including on
    // the guest route, and treats a 401 as "nobody is signed in". The browser
    // still logs the status, so filter that one case rather than teach the
    // reader to ignore warnings.
    const url = message.location()?.url ?? '';
    if (url.endsWith('/api/auth/me') && message.text().includes('401')) return;
    problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) =>
    problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`),
  );

  try {
    if (!group.asGuest && !group.signedOut) await signIn(page, ownerEmail);

    for (const { requested, resolved } of group.routes) {
      const before = problems.length;
      await page.goto(resolved, { waitUntil: 'networkidle' });
      // Named for what was asked for, so a seeded id does not end up in the
      // filename and change on every run.
      const file = path.join(options.out, `${slug(requested)}-${theme}-${width}.png`);
      await page.screenshot({ path: file, fullPage: options.fullPage });
      results.push({
        route: requested,
        theme,
        width,
        file,
        background: await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        inHeader: await reachableFromHeader(page, requested, resolved),
        problems: problems.slice(before),
      });
    }
  } finally {
    await browserContext.close();
  }
  return results;
}

async function capture(browser, options, context) {
  // Share links are captured in a context of their own, with no sign-in. A
  // guest is *defined* by having no cookie, so viewing `/s/:token` from a
  // signed-in session would not be the thing anybody wants to look at.
  const isShare = (route) => route.requested.startsWith('/s/');
  // The signed-out screens bounce a session straight to the app (or, for a
  // recovery link, refuse to render at all), so signing in first would
  // screenshot the expenses page under their name. They are not guests either
  // — no share token, no name prompt — so they get a context of their own.
  const isSignedOut = (route) => SIGNED_OUT_ROUTES.some((prefix) => route.requested.startsWith(prefix));

  const groups = [
    {
      routes: context.routes.filter((route) => !isShare(route) && !isSignedOut(route)),
    },
    { asGuest: true, routes: context.routes.filter(isShare) },
    { signedOut: true, routes: context.routes.filter(isSignedOut) },
  ].filter((group) => group.routes.length > 0);

  const results = [];
  for (const width of options.widths) {
    for (const theme of options.themes) {
      for (const group of groups) {
        results.push(...(await captureGroup(browser, options, context, group, theme, width)));
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  const databasePath = path.join(
    process.env.TMPDIR ?? '/tmp',
    `home-budget-preview-${process.pid}-${stamp}.sqlite`,
  );
  const logPath = `${databasePath}.log`;
  fs.mkdirSync(options.out, { recursive: true });

  if (options.build) {
    console.log('Building…');
    await run('npm', ['run', 'build'], 'npm run build');
  } else if (!fs.existsSync(path.join(repoRoot, 'server', 'dist', 'index.js'))) {
    throw new Error('--skip-build was passed but server/dist is missing. Run without it once.');
  }

  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  console.log(`Starting the built app on ${baseURL}…`);
  const server = await startServer(port, databasePath, logPath);

  let results;
  let seeded;
  try {
    seeded = await seed(baseURL);
    const routes = options.routes.map((requested) => ({
      requested,
      resolved: requested
        // `/join/:token` takes the invite; every other :token is the share
        // link, which is the one people ask for by far the most often.
        .replace(/:token\b|\bTOKEN\b/, requested.startsWith('/join/') ? seeded.inviteToken : seeded.shareToken)
        .replace(/:id\b|\bID\b/, seeded.listId),
    }));

    const executablePath = resolveChromium();
    const browser = await chromium.launch({ executablePath });
    try {
      results = await capture(browser, options, { baseURL, ownerEmail: seeded.email, routes });
    } finally {
      await browser.close();
    }

    if (options.keepOpen) {
      console.log(`\nServer left running: ${baseURL}`);
      console.log(`Sign in as ${seeded.email} / ${PASSWORD}`);
      console.log(`Guest link: ${baseURL}/s/${seeded.shareToken}`);
      console.log(`Stop it with: kill -- -${server.child.pid}`);
      console.log(`Server log: ${logPath}`);
      // A run that cleans up after itself would take the running server's
      // database with it, so --keep-open leaves both and says so.
      console.log(`Left behind for you — delete ${databasePath}* once you are done.`);
    }
  } catch (error) {
    stopServer(server);
    console.error(`\nServer log:\n${server.log()}`);
    throw error;
  }

  if (!options.keepOpen) {
    stopServer(server);
    for (const suffix of ['', '-wal', '-shm', '.log']) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  }

  console.log('');
  let problems = 0;
  for (const shot of results) {
    const header =
      shot.inHeader === null ? '' : shot.inHeader ? '  in header' : '  NOT LINKED FROM HEADER';
    console.log(
      `${shot.route.padEnd(28)} ${shot.theme.padEnd(6)} ${String(shot.width).padStart(5)}px  ` +
        `body ${shot.background}${header}\n  ${shot.file}`,
    );
    for (const problem of shot.problems) {
      problems += 1;
      console.log(`  ! ${problem}`);
    }
  }

  // Only meaningful when light and dark were both asked for by name: headless
  // Chromium reports a light OS, so `system` matching `light` proves nothing.
  const named = results.filter((shot) => shot.theme === 'light' || shot.theme === 'dark');
  const backgrounds = new Set(named.map((shot) => shot.background));
  if (new Set(named.map((shot) => shot.theme)).size === 2 && backgrounds.size < 2) {
    console.log(
      '\n! Light and dark produced the same body colour. Either the theme did not apply, ' +
        'or this page paints its own background instead of using the variables.',
    );
  }
  console.log(`\n${results.length} screenshots in ${options.out}` + (problems ? `, ${problems} console problems` : ''));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
