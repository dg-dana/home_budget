import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4400);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Computed as this config module loads, which is before the web server starts
// and before global teardown runs, so both can rely on it.
process.env.E2E_DATABASE_PATH ??= path.join(
  os.tmpdir(),
  `home-budget-e2e-${crypto.randomUUID()}.sqlite`,
);

/**
 * The sandbox ships a prebuilt Chromium that Playwright's own download step is
 * told to skip. Use it when it is there, and fall back to a normally installed
 * browser everywhere else.
 */
const sandboxChromium = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const executablePath = fs.existsSync(sandboxChromium) ? sandboxChromium : undefined;

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/teardown.ts',
  // Tests create their own household, so they share nothing but the server.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  /**
   * Runs the production build the same way a deployment does: one process
   * serving both the API and the built frontend.
   */
  webServer: {
    command: 'npm run build && npm start',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      NODE_ENV: 'development',
      JWT_SECRET: 'e2e-secret-not-used-anywhere-real',
      // A seven-person household plus every other test signs in far more often
      // in 15 minutes than a real visitor ever would, and the auth limiter is
      // right to refuse that. Production ignores this variable (config.ts).
      RATE_LIMITS: 'off',
      DATABASE_PATH: process.env.E2E_DATABASE_PATH,
    },
  },
});
