import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { config } from './config.js';
import './db.js';
import { errorMiddleware, notFound } from './http.js';
import { rateLimit } from './rateLimit.js';
import { authRouter } from './routes/auth.js';
import { categoriesRouter } from './routes/categories.js';
import { expensesRouter } from './routes/expenses.js';
import { householdRouter } from './routes/household.js';
import { listsRouter } from './routes/lists.js';
import { shareRouter } from './routes/share.js';

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Sign-in and sign-up are the endpoints worth guessing at, so they get a
// tighter budget than the rest of the API.
app.use(
  '/api/auth',
  rateLimit({ windowMs: 15 * 60_000, max: 60, message: 'Too many attempts, please try again later' }),
  authRouter,
);
app.use('/api/household', householdRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/lists', listsRouter);
app.use('/api/share', shareRouter);

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

app.listen(config.port, () => {
  console.log(`Home Budget API listening on http://localhost:${config.port}`);
});
