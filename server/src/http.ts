import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type TypeOf, type ZodTypeAny } from 'zod';
import type { ErrorCode, ErrorVars } from './errorCodes.js';

/**
 * An error with an HTTP status attached, thrown from anywhere inside a handler.
 *
 * The `message` is English and always will be: it is what a `curl`, a log line
 * and an unrecognising client have to go on. The optional `code` is what lets
 * the frontend say the same thing in the reader's language, and `vars` carries
 * the values it interpolates — never a phrase built here, for the same reason
 * notices hand over values rather than sentences (`errorCodes.ts`).
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ErrorCode,
    readonly vars?: ErrorVars,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, code?: ErrorCode, vars?: ErrorVars) =>
  new HttpError(400, message, code, vars);
export const unauthorized = (message = 'Not signed in', code: ErrorCode = 'error.notSignedIn') =>
  new HttpError(401, message, code);
export const forbidden = (message = 'Not allowed', code: ErrorCode = 'error.notAllowed') =>
  new HttpError(403, message, code);
export const notFound = (message = 'Not found', code: ErrorCode = 'error.notFound') =>
  new HttpError(404, message, code);
export const conflict = (message: string, code?: ErrorCode, vars?: ErrorVars) =>
  new HttpError(409, message, code, vars);
/** The app is working, but this particular thing is not configured here. */
export const unavailable = (message: string, code?: ErrorCode) =>
  new HttpError(503, message, code);

/** Wraps a handler so a rejected promise reaches the Express error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

/**
 * Validates `req.body` against a Zod schema, turning failures into a 400.
 * Generic over the schema itself so defaults resolve to the parsed output type.
 */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): TypeOf<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest(formatZodError(result.error));
  }
  return result.data;
}

/**
 * Zod failures carry **no code**, deliberately.
 *
 * They name a field and say what is wrong with it, which is worth more than a
 * generic translated "check that form" — and every one of them is unreachable
 * through the interface anyway, because the forms carry the same `required`,
 * `minLength` and `maxLength` the schemas do. What reaches this path is a
 * script or a stale client, and English is the right language for both.
 */
function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.join('.');
      return field ? `${field}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    // `error` is the English sentence and stays the contract; `code` and `vars`
    // are additive, so a client that has never heard of them behaves exactly as
    // it did before.
    res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.vars ? { vars: err.vars } : {}),
    });
    return;
  }
  console.error('Unhandled server error:', err);
  res
    .status(500)
    .json({ error: 'Something went wrong on the server', code: 'error.serverError' });
}
