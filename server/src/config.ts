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

export const config = {
  isProduction,
  rateLimitsDisabled,
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: jwtSecret || 'dev-only-insecure-secret',
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
