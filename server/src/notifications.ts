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

export type NoticeKind =
  | 'verify-email'
  | 'household-created'
  | 'invite'
  | 'password-reset'
  /**
   * Everything below is a **told, not asked** notice: something has already
   * happened and the people it affects are being informed. They carry no link,
   * so with no provider configured they are simply dropped — which is the same
   * silence the app had before any of this existed.
   */
  | 'password-changed'
  | 'account-deleted'
  | 'household-deleted'
  | 'household-changed'
  | 'member-joined'
  | 'member-removed'
  | 'role-changed';

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

/**
 * Sends the same notice to several people at once — everyone in a household,
 * or its owners. Addresses are gathered by `householdAddresses()` in
 * `auth.ts`, and for anything that deletes rows they must be gathered
 * **before** the deletion.
 *
 * Sent in parallel and bounded by the per-message timeout, so telling nine
 * people costs about what telling one does. Like every send, a failure is a
 * warning rather than an exception: nobody's account deletion fails because a
 * mail server was slow.
 */
export function notifyAll(
  recipients: readonly string[],
  build: (to: string) => Promise<Notice>,
): Promise<Notice[]> {
  const addresses = [...new Set(recipients.filter(Boolean))];
  return Promise.all(addresses.map(build));
}

/** Somebody's password changed — the one message worth sending unprompted. */
export function passwordChangedNotice(to: string, how: 'changed' | 'reset'): Promise<Notice> {
  return deliver({
    kind: 'password-changed',
    to,
    subject: 'Your Home Budget password was changed',
    body:
      how === 'reset'
        ? 'Your password was just set using a recovery link, and every other device was signed out. If this was not you, change your password now — whoever holds that link can use it once.'
        : 'Your password was just changed, and every other device was signed out. If this was not you, reset it now.',
  });
}

export function accountDeletedNotice(to: string): Promise<Notice> {
  return deliver({
    kind: 'account-deleted',
    to,
    subject: 'Your Home Budget account was deleted',
    body: 'Your account, and your place in every household it belonged to, has been deleted. Expenses you had already recorded stay with those households, so nobody else\'s totals moved. There is no undo — signing up again starts from nothing.',
  });
}

export function householdDeletedNotice(to: string, householdName: string): Promise<Notice> {
  return deliver({
    kind: 'household-deleted',
    to,
    subject: `"${householdName}" was deleted`,
    body: `An owner deleted "${householdName}". Its expenses, budgets, recurring rules, shopping lists and share links are gone, and so is everyone's place in it. Accounts are untouched — anyone in another household still has it.`,
  });
}

export function householdChangedNotice(
  to: string,
  householdName: string,
  what: string,
): Promise<Notice> {
  return deliver({
    kind: 'household-changed',
    to,
    subject: `"${householdName}" was changed`,
    body: `An owner changed ${what}.`,
  });
}

/** To the household's owners: somebody redeemed an invite. */
export function memberJoinedNotice(
  to: string,
  householdName: string,
  who: string,
): Promise<Notice> {
  return deliver({
    kind: 'member-joined',
    to,
    subject: `${who} joined "${householdName}"`,
    body: `${who} redeemed an invite and is now in "${householdName}". They can see and add expenses, budgets, recurring rules and shopping lists. If you did not expect this, remove them from the Household page.`,
  });
}

/**
 * Somebody is no longer in a household. `reason` is what makes one message do
 * for both ways out — being removed by an owner, and leaving by deleting the
 * account — since the household hears the same fact either way.
 */
export function memberRemovedNotice(
  to: string,
  householdName: string,
  who: 'you' | string,
): Promise<Notice> {
  const isSubject = who === 'you';
  return deliver({
    kind: 'member-removed',
    to,
    subject: isSubject ? `You were removed from "${householdName}"` : `${who} left "${householdName}"`,
    body: isSubject
      ? `An owner removed you from "${householdName}". You can no longer see it, and any recovery link outstanding for you has been retired. The expenses you recorded stay with the household. Your account and any other household you belong to are untouched.`
      : `${who} is no longer in "${householdName}". The expenses they recorded stay, so nobody's totals moved.`,
  });
}

export function roleChangedNotice(
  to: string,
  householdName: string,
  role: 'owner' | 'member',
): Promise<Notice> {
  return deliver({
    kind: 'role-changed',
    to,
    subject:
      role === 'owner'
        ? `You are now an owner of "${householdName}"`
        : `You are no longer an owner of "${householdName}"`,
    body:
      role === 'owner'
        ? `An owner made you an owner of "${householdName}". You can now invite and remove people, rename it, issue recovery links, and delete it.`
        : `An owner changed your role in "${householdName}" back to member. You keep full access to the money and the lists; what goes is inviting, removing, renaming and deleting.`,
  });
}
