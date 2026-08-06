/**
 * Where "we sent you an email" is decided.
 *
 * Every message the app produces — confirmation, invites, password recovery —
 * comes through here, and this is the **only** place that knows how a message
 * travels. Callers hand over a notice and get it back saying whether it was
 * delivered; none of them knows a provider exists.
 *
 * Two ways out, and both are supported states:
 *
 * - **A provider is configured** (`RESEND_API_KEY` + `MAIL_FROM`) — the notice
 *   is emailed, and `delivered` comes back true.
 * - **Nothing is configured** — `delivered` is false and the caller shows the
 *   link on screen for whoever is signed in to pass on, which is how this app
 *   has always worked (`ARCHITECTURE.md` §14).
 *
 * The fallback is not a leftover. It is what lets the test suite and local
 * development run with no provider, and what stops an expired key locking
 * everybody out of inviting anyone: sending failures are warnings, never
 * thrown, and the link is still returned.
 */

import { config } from './config.js';

export type NoticeKind = 'verify-email' | 'household-created' | 'invite' | 'password-reset';

export interface Notice {
  kind: NoticeKind;
  to: string;
  subject: string;
  /** Present when the notice is an action the person has to take. */
  link?: string;
  body: string;
  /**
   * Whether a provider accepted it. False means the link on screen is the only
   * copy in existence — so the caller must keep showing it.
   */
  delivered: boolean;
}

/** What a caller builds. Delivery is this module's answer, not the caller's. */
type Draft = Omit<Notice, 'delivered'>;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
/** A provider having a bad day must not hold up a registration for long. */
const SEND_TIMEOUT_MS = 5000;

const warn = (reason: string) => {
  // Never the link or the address: a working confirmation link in the deploy
  // logs would be a credential sitting in plain sight.
  console.warn(`[notifications] not sent (${reason})`);
};

/**
 * Links are stored relative — the browser resolves them against wherever it
 * already is. An inbox cannot, so a message needs `APP_URL` to make one
 * absolute, and a notice with a link but no base is not sendable.
 */
function emailBody(notice: Draft): string | null {
  if (!notice.link) return notice.body;
  if (!config.appUrl) return null;
  return `${notice.body}\n\n${config.appUrl}${notice.link}`;
}

async function send(notice: Draft): Promise<boolean> {
  if (!config.resendApiKey || !config.mailFrom) return false;
  if (!notice.to) return false;

  const text = emailBody(notice);
  if (text === null) {
    warn('APP_URL is not set, so the link would be relative');
    return false;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: config.mailFrom,
        to: [notice.to],
        subject: notice.subject,
        text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      warn(`the provider answered ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    warn(err instanceof Error ? err.message : 'the request failed');
    return false;
  }
}

/**
 * Hands a notice to whatever can deliver it, and says what happened. Awaited
 * rather than fired and forgotten, so `delivered` is the truth about this
 * message rather than a guess — bounded by `SEND_TIMEOUT_MS`, and a failure
 * degrades to the on-screen link instead of failing the request.
 */
export async function deliver(notice: Draft): Promise<Notice> {
  return { ...notice, delivered: await send(notice) };
}

export function verifyEmailNotice(to: string, link: string): Promise<Notice> {
  return deliver({
    kind: 'verify-email',
    to,
    subject: 'Confirm your email address',
    link,
    body: 'Confirm your address to create or join a household. The link works once and expires in 24 hours.',
  });
}

export function householdCreatedNotice(to: string, householdName: string): Promise<Notice> {
  return deliver({
    kind: 'household-created',
    to,
    subject: `You created ${householdName}`,
    body: `"${householdName}" is ready. You are its owner, so you can invite the rest of the household from the Household page.`,
  });
}

/**
 * An invite may carry no address — an owner can mint a link to hand over in
 * person. `deliver()` treats that as nothing to send, so the link is shown, as
 * it always was.
 */
export function inviteNotice(to: string, householdName: string, link: string): Promise<Notice> {
  return deliver({
    kind: 'invite',
    to,
    subject: `Join ${householdName} on Home Budget`,
    link,
    body: `You have been invited to join "${householdName}". Open the link to accept — it works once and expires in 14 days.`,
  });
}

export function passwordResetNotice(to: string, link: string): Promise<Notice> {
  return deliver({
    kind: 'password-reset',
    to,
    subject: 'Reset your Home Budget password',
    link,
    body: 'Open the link to choose a new password. It works once, expires in 24 hours, and signs out every other device.',
  });
}
