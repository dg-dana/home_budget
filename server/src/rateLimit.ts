import type { RequestHandler } from 'express';
import { HttpError } from './http.js';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Small in-process fixed-window limiter. Enough to blunt password guessing and
 * share-token scanning on a single-instance deployment; swap for a shared store
 * (Redis) if this ever runs on more than one process.
 */
export function rateLimit(options: { windowMs: number; max: number; message?: string }): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    } else if (bucket.count >= options.max) {
      next(new HttpError(429, options.message ?? 'Too many requests, please slow down'));
      return;
    } else {
      bucket.count += 1;
    }

    // Opportunistic cleanup so the map cannot grow without bound.
    if (buckets.size > 5_000) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(entryKey);
      }
    }
    next();
  };
}
