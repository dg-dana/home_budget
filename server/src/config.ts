import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ (dev) and dist/ (build) both sit one level under server/, which sits
// one level under the repo root.
export const repoRoot = path.resolve(here, '..', '..');

dotenv.config({ path: path.join(repoRoot, '.env') });

const isProduction = process.env.NODE_ENV === 'production';

const jwtSecret = process.env.JWT_SECRET ?? '';
if (isProduction && (!jwtSecret || jwtSecret === 'change-me-in-production')) {
  throw new Error('JWT_SECRET must be set to a unique value when NODE_ENV=production');
}

/**
 * The browser suite signs a seven-person household in and out inside one
 * 15-minute window, which the auth limiter is right to refuse from a real
 * visitor. `RATE_LIMITS=off` lets that run turn it off — and **production
 * ignores the request entirely**, so setting it on the server can never
 * un-protect the live site.
 */
const rateLimitsDisabled = process.env.RATE_LIMITS === 'off' && !isProduction;

/**
 * Email. All three are optional and absent is a supported state: with no
 * provider configured the app behaves exactly as it always has, putting the
 * link on screen for whoever is signed in to pass on (`notifications.ts`).
 *
 * `APP_URL` exists because notices carry **relative** links — the browser
 * turns them into absolute ones against wherever it already is, which an
 * inbox cannot do. Compose derives it from `DOMAIN`, so production has it
 * without a second thing to set.
 */
const domain = process.env.DOMAIN?.trim() ?? '';
const resendApiKey = process.env.RESEND_API_KEY?.trim() ?? '';
// Both derive from the domain the app is already served on, so turning email
// on is one secret and nothing else. Set either explicitly to override.
const mailFrom =
  process.env.MAIL_FROM?.trim() || (domain ? `Home Budget <noreply@${domain}>` : '');
const appUrl = (process.env.APP_URL?.trim() || (domain ? `https://${domain}` : '')).replace(
  /\/+$/,
  '',
);

/**
 * Whether a notice carrying a link can actually reach an inbox. All three parts
 * are needed: a key and a from address to send at all, and a base URL to turn a
 * relative link into one an inbox can follow (`notifications.ts`).
 *
 * Most of the app treats an unconfigured deployment as normal and shows the
 * link on screen instead. Self-service recovery cannot — printing the link
 * would hand anybody a way into any account by typing its address — so it is
 * the one route that refuses to work without this.
 */
const emailConfigured = Boolean(resendApiKey && mailFrom && appUrl);

export const config = {
  isProduction,
  rateLimitsDisabled,
  emailConfigured,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: jwtSecret || 'dev-only-insecure-secret',
  appUrl,
  mailFrom,
  resendApiKey,
  databasePath: path.resolve(repoRoot, process.env.DATABASE_PATH ?? 'data/home-budget.sqlite'),
  webDistPath: path.join(repoRoot, 'web', 'dist'),
  /** How long a login session stays valid. */
  sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  /** How long an unused family invite link stays valid. */
  inviteMaxAgeMs: 14 * 24 * 60 * 60 * 1000,
  /** How long a password recovery link stays valid. Shorter than an invite:
   *  it grants access to an existing account rather than creating a new one. */
  passwordResetMaxAgeMs: 24 * 60 * 60 * 1000,
  /** How long an email confirmation link stays valid. Same day-long window as
   *  a recovery link: both are proof of reaching one particular inbox. */
  emailVerificationMaxAgeMs: 24 * 60 * 60 * 1000,
} as const;
