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
 *
 * Buckets are keyed by client IP unless `key` says otherwise — recovery is
 * limited per **address** as well, since one request there sends mail to
 * somebody who did not ask for it, and changing IP is cheap.
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  message?: string;
  /** What to count against. Returning an empty string skips the limiter. */
  key?: (req: Parameters<RequestHandler>[0]) => string;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req, _res, next) => {
    const now = Date.now();
    const key = options.key ? options.key(req) : (req.ip ?? 'unknown');
    // A request the key function cannot read (a malformed body, say) is left to
    // the route to reject, rather than counted against everybody at once.
    if (!key) {
      next();
      return;
    }
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
