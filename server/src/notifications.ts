/**
 * Where "we sent you an email" is decided.
 *
 * There is no email provider wired up (`ARCHITECTURE.md` §14), and this app has
 * always dealt with that the same way: it generates the link and shows it to
 * whoever needs to pass it on. Invites and password resets already work like
 * that, so email confirmation does too rather than inventing a second answer.
 *
 * The point of this module is that the decision lives in **one** place. When a
 * provider is added, `deliver()` grows a real implementation and every caller
 * keeps working — none of them knows how a message travels.
 */

export type NoticeKind = 'verify-email' | 'household-created';

export interface Notice {
  kind: NoticeKind;
  to: string;
  subject: string;
  /** Present when the notice is an action the person has to take. */
  link?: string;
  body: string;
}

/**
 * Hands a notice to whatever can deliver it. Today that is the response the
 * caller is already sending — so this only records it — but the shape is the
 * shape a mailer needs, not the shape a JSON response happens to want.
 */
export function deliver(notice: Notice): Notice {
  // A provider would go here. Deliberately not console.log: a verification
  // link in the server's stdout would put a credential in the deploy logs.
  return notice;
}

export function verifyEmailNotice(to: string, link: string): Notice {
  return deliver({
    kind: 'verify-email',
    to,
    subject: 'Confirm your email address',
    link,
    body: 'Confirm your address to create or join a household. The link works once and expires in 24 hours.',
  });
}

export function householdCreatedNotice(to: string, householdName: string): Notice {
  return deliver({
    kind: 'household-created',
    to,
    subject: `You created ${householdName}`,
    body: `"${householdName}" is ready. You are its owner, so you can invite the rest of the household from the Household page.`,
  });
}
