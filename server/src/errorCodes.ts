/**
 * Every refusal the API can hand back, as a code the frontend can translate.
 *
 * The messages themselves stay in English and stay in the response, because
 * they are the only thing a `curl`, a log line or an unrecognising client has
 * to go on. The **code** is what turns a refusal into a sentence in whoever's
 * language: `web/src/strings.ts` holds an `error.…` entry for each one, and a
 * code it does not recognise falls back to the English sentence rather than to
 * nothing (`ARCHITECTURE.md` §8, "Refusals").
 *
 * Interpolated values travel as `vars` rather than baked into the message, for
 * the same reason notices hand over values rather than phrases (§4.2): a
 * sentence assembled here could only ever be English.
 *
 * **Adding one means adding both halves.** `errorCodes.test.ts` fails if a code
 * in this list has no entry in the web dictionary, which is the only way to
 * enforce that across a workspace boundary.
 */
export const ERROR_CODES = [
  // -------------------------------------------------------------- generic
  'error.notSignedIn',
  'error.notAllowed',
  'error.notFound',
  'error.serverError',
  'error.unknownEndpoint',

  // ------------------------------------------------------ session, access
  'error.wrongPassword',
  'error.chooseHousehold',
  'error.ownerOnly',
  'error.confirmFirst',

  // ------------------------------------------------------------- sign-in
  'error.signInFailed',
  'error.emailTaken',
  'error.wrongCurrentPassword',
  'error.passwordTooShort',
  'error.passwordTooLong',
  'error.passwordCommon',
  'error.passwordTooSimple',
  'error.passwordPersonal',
  'error.verifyLinkBad',
  'error.alreadyConfirmed',
  'error.resetLinkBad',
  'error.cannotSendEmail',

  // ------------------------------------------------------------- invites
  'error.inviteLinkBad',
  'error.inviteForOther',
  'error.inviteNotFound',
  'error.alreadyMember',
  'error.alreadyInHousehold',

  // ----------------------------------------------------------- household
  'error.householdNotFound',
  'error.memberNotFound',
  'error.removeSelf',
  'error.ownRole',
  'error.leaveLastPerson',
  'error.leaveSoleOwner',
  'error.strandedOwner',
  'error.ownerRecoveryOff',

  // ------------------------------------------------------ money and rules
  'error.expenseNotFound',
  'error.recurringNotFound',
  'error.categoryNotFound',
  'error.categoryNameTaken',
  'error.unknownCategory',
  'error.unknownMember',
  'error.monthFormat',
  'error.rangeOrder',
  'error.rangeTooLong',

  // ------------------------------------------------------------- shopping
  'error.listNotFound',
  'error.itemNotFound',
  'error.shareInactive',
  'error.shareViewOnly',

  // ----------------------------------------------------------------- to-do
  'error.todoNotFound',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Values a message interpolates. Strings only — the frontend formats nothing. */
export type ErrorVars = Record<string, string>;
