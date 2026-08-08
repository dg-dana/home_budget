import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { config } from './config.js';
import './db.js';
import { errorMiddleware, notFound } from './http.js';
import { rateLimit } from './rateLimit.js';
import { authRouter } from './routes/auth.js';
import { categoriesRouter } from './routes/categories.js';
import { expensesRouter } from './routes/expenses.js';
import { householdRouter } from './routes/household.js';
import { householdsRouter } from './routes/households.js';
import { listsRouter } from './routes/lists.js';
import { recurringRouter } from './routes/recurring.js';
import { shareRouter } from './routes/share.js';

export interface CreateAppOptions {
  /**
   * Rate limiting is on by default. Tests that hammer an endpoint turn it off,
   * except for the tests that exercise the limiter itself.
   */
  enableRateLimits?: boolean;
}

/**
 * Builds the Express app without binding a port, so tests can mount it on an
 * ephemeral port and the entry point can own the `listen` call.
 */
export function createApp({ enableRateLimits = true }: CreateAppOptions = {}): Express {
  const app = express();

  app.set('trust proxy', 1);

  // Before the routes and the static handler, so it covers both the JSON API
  // and the built frontend. A month of expenses is mostly repeated field names
  // and ISO dates, which gzip extremely well — it is the difference between a
  // snappy and a sluggish page on a phone.
  app.use(compression());

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Sign-in and sign-up are the endpoints worth guessing at, so they get a
  // tighter budget than the rest of the API.
  const authLimiter = enableRateLimits
    ? [rateLimit({ windowMs: 15 * 60_000, max: 60, message: 'Too many attempts, please try again later' })]
    : [];
  const shareLimiter = enableRateLimits
    ? [rateLimit({ windowMs: 60_000, max: 120, message: 'Too many requests, please wait a moment' })]
    : [];
  // Asking for a recovery link is the one unauthenticated route that sends mail
  // to somebody who did not ask for it, so it is counted per address as well —
  // the per-IP budget above does nothing about a mailbox being flooded from a
  // dozen addresses of a dozen IPs. Mounted ahead of the router rather than
  // inside it so it stays with the other limiters and off with them in tests.
  if (enableRateLimits) {
    app.use(
      '/api/auth/forgot',
      rateLimit({
        windowMs: 60 * 60_000,
        max: 5,
        key: (req) =>
          typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '',
        message: 'Too many reset requests for that address, please try again later',
      }),
    );
  }

  app.use('/api/auth', ...authLimiter, authRouter);
  // Plural: the households an account belongs to, and which one is open.
  // Singular: administering the one that is open. Mounted in this order
  // because `/households` must not sit behind `requireHousehold`.
  app.use('/api/households', householdsRouter);
  app.use('/api/household', householdRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/recurring', recurringRouter);
  app.use('/api/lists', listsRouter);
  app.use('/api/share', ...shareLimiter, shareRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Unknown API endpoint', 'error.unknownEndpoint')));

  // In production the API also serves the built frontend, so the whole app is a
  // single process behind one port.
  if (fs.existsSync(config.webDistPath)) {
    app.use(express.static(config.webDistPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(config.webDistPath, 'index.html'));
    });
  }

  app.use(errorMiddleware);

  return app;
}
