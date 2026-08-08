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
import { line, type NoticeStringKey } from './notificationStrings.js';
import type { Language } from './types.js';

/**
 * Who a notice is going to, and what language they read.
 *
 * The language travels with the address rather than being looked up here,
 * because half of these messages go to people who are not making the request —
 * an owner hearing that somebody joined is not holding the browser. It comes
 * from `users.language`, gathered by `householdAddresses()` in `auth.ts`, so
 * one household with an English and a German member gets two different emails
 * out of one call.
 */
export interface Recipient {
  email: string;
  language: Language;
}

/** For an address with no account behind it — an invite to a stranger. */
export const recipientAt = (email: string, language: Language): Recipient => ({ email, language });

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
  /** Which language it went out in — what the API returns, and the UI shows. */
  language: Language;
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

/**
 * One notice, composed in the recipient's language.
 *
 * Every builder below is this call with a different pair of dictionary keys —
 * which is what stops the thirteenth message quietly growing a shape the other
 * twelve do not have, and what makes "is this translated?" a question about
 * `notificationStrings.ts` rather than about thirteen functions.
 */
function compose(
  kind: NoticeKind,
  to: Recipient,
  subjectKey: NoticeStringKey,
  bodyKey: NoticeStringKey,
  vars: Record<string, string> = {},
  link?: string,
): Promise<Notice> {
  return deliver({
    kind,
    to: to.email,
    language: to.language,
    subject: line(subjectKey, to.language, vars),
    body: line(bodyKey, to.language, vars),
    ...(link === undefined ? {} : { link }),
  });
}

export function verifyEmailNotice(to: Recipient, link: string): Promise<Notice> {
  return compose('verify-email', to, 'verify.subject', 'verify.body', {}, link);
}

export function householdCreatedNotice(to: Recipient, household: string): Promise<Notice> {
  return compose('household-created', to, 'householdCreated.subject', 'householdCreated.body', {
    household,
  });
}

/**
 * An invite may carry no address — an owner can mint a link to hand over in
 * person. `deliver()` treats that as nothing to send, so the link is shown, as
 * it always was. Where there *is* an address and no account behind it yet, the
 * language is the inviting owner's: they are the only person who knows who
 * they are writing to.
 */
export function inviteNotice(to: Recipient, household: string, link: string): Promise<Notice> {
  return compose('invite', to, 'invite.subject', 'invite.body', { household }, link);
}

export function passwordResetNotice(to: Recipient, link: string): Promise<Notice> {
  return compose('password-reset', to, 'passwordReset.subject', 'passwordReset.body', {}, link);
}

/**
 * Sends the same notice to several people at once — everyone in a household,
 * or its owners. Recipients are gathered by `householdAddresses()` in
 * `auth.ts`, and for anything that deletes rows they must be gathered
 * **before** the deletion.
 *
 * Sent in parallel and bounded by the per-message timeout, so telling nine
 * people costs about what telling one does. Like every send, a failure is a
 * warning rather than an exception: nobody's account deletion fails because a
 * mail server was slow.
 *
 * Deduplication is by **address**, not by the whole recipient: one person is
 * one message even if two rows disagree about their language.
 */
export function notifyAll(
  recipients: readonly Recipient[],
  build: (to: Recipient) => Promise<Notice>,
): Promise<Notice[]> {
  const seen = new Map<string, Recipient>();
  for (const recipient of recipients) {
    if (recipient.email && !seen.has(recipient.email)) seen.set(recipient.email, recipient);
  }
  return Promise.all([...seen.values()].map(build));
}

/** Somebody's password changed — the one message worth sending unprompted. */
export function passwordChangedNotice(to: Recipient, how: 'changed' | 'reset'): Promise<Notice> {
  return compose('password-changed', to, 'passwordChanged.subject', `passwordChanged.body.${how}`);
}

export function accountDeletedNotice(to: Recipient): Promise<Notice> {
  return compose('account-deleted', to, 'accountDeleted.subject', 'accountDeleted.body');
}

export function householdDeletedNotice(to: Recipient, household: string): Promise<Notice> {
  return compose('household-deleted', to, 'householdDeleted.subject', 'householdDeleted.body', {
    household,
  });
}

/**
 * What actually moved, rather than a sentence describing it.
 *
 * The route used to hand over a ready-made English phrase, which made the
 * message untranslatable by construction. Passing the values means every
 * combination is one whole entry in the dictionary — which is also the only way
 * German puts the verb where German puts it.
 */
export interface HouseholdChange {
  oldName: string;
  newName: string;
  oldCurrency: string;
  newCurrency: string;
}

export function householdChangedNotice(
  to: Recipient,
  change: HouseholdChange,
): Promise<Notice> {
  const renamed = change.oldName !== change.newName;
  const redenominated = change.oldCurrency !== change.newCurrency;
  const body = renamed && redenominated ? 'both' : renamed ? 'name' : 'currency';
  return compose(
    'household-changed',
    to,
    'householdChanged.subject',
    `householdChanged.body.${body}`,
    { ...change, household: change.oldName },
  );
}

/** To the household's owners: somebody redeemed an invite. */
export function memberJoinedNotice(
  to: Recipient,
  household: string,
  who: string,
): Promise<Notice> {
  return compose('member-joined', to, 'memberJoined.subject', 'memberJoined.body', {
    household,
    who,
  });
}

/**
 * Somebody is no longer in a household. `who` is what makes one message do for
 * both ways out — being removed by an owner, and leaving by deleting the
 * account — since the household hears the same fact either way. `'you'` is the
 * sentinel for writing to the person it happened to.
 */
export function memberRemovedNotice(
  to: Recipient,
  household: string,
  who: 'you' | string,
): Promise<Notice> {
  const which = who === 'you' ? 'you' : 'other';
  return compose(
    'member-removed',
    to,
    `memberRemoved.subject.${which}`,
    `memberRemoved.body.${which}`,
    { household, who },
  );
}

export function roleChangedNotice(
  to: Recipient,
  household: string,
  role: 'owner' | 'member',
): Promise<Notice> {
  return compose('role-changed', to, `roleChanged.subject.${role}`, `roleChanged.body.${role}`, {
    household,
  });
}
