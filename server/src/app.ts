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

  app.use('/api/auth', ...authLimiter, authRouter);
  app.use('/api/household', householdRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/expenses', expensesRouter);
  app.use('/api/recurring', recurringRouter);
  app.use('/api/lists', listsRouter);
  app.use('/api/share', ...shareLimiter, shareRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Unknown API endpoint')));

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
