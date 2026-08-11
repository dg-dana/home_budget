/**
 * What counts as a usable password.
 *
 * Written to current guidance (NIST SP 800-63B, and the UK NCSC's advice),
 * which is worth stating because it is close to the **opposite** of the rules
 * most people picture:
 *
 * - **Length is the requirement.** The minimum is 12 characters. Nothing else
 *   moves the difficulty of guessing anywhere near as much.
 * - **There are deliberately no composition rules** — no "must contain an
 *   uppercase letter, a digit and a symbol". Those rules do not produce strong
 *   passwords, they produce `Password1!`: everybody satisfies them the same
 *   predictable way, so an attacker learns the shape and the search space
 *   barely grows. 800-63B says verifiers SHOULD NOT impose them. If a policy
 *   ever demands them, add them knowing they cost more than they buy.
 * - **No forced expiry**, for the same reason: rotation produces `Password2!`.
 *   Nothing here makes an existing password stop working.
 * - **Everything is allowed** — spaces, punctuation, emoji, any language. A
 *   passphrase is the best thing somebody can choose and it must not be fought.
 *
 * What *is* checked is the small set of things that make a long password
 * guessable anyway, and each exists because of how people reach a minimum:
 *
 * 1. **The commonest 10,000 passwords**, and — the one that matters at this
 *    length — their **stems**. Told to type 12 characters, people pad the
 *    password they already use: `password1234` has to fail for the same reason
 *    `password` does. Only ten entries in that list are 12 characters or more,
 *    so an exact-match lookup on its own would be very close to decoration.
 * 2. **Runs and walks.** `aaaaaaaaaaaa`, `123456789012`, `qwertyuiopas` and
 *    `abcdefghijkl` all clear a length rule and are in nobody's top-10,000,
 *    because those lists are full of short passwords. They are also exactly
 *    what gets typed when a length minimum is in the way.
 * 3. **The obvious personal words** — the local part of the person's own
 *    address, and the name of this app.
 *
 * What is deliberately *not* done: checking against a full breach corpus, which
 * means Have I Been Pwned's range API. It is the single most valuable check
 * there is, and it is a network call per sign-up on an app that has to keep
 * working with no outbound access at all (`ARCHITECTURE.md` §4.1). The bundled
 * list is the offline half of it.
 *
 * These run **only when a password is set** — registering, changing, and
 * redeeming a recovery link. Never on sign-in: an account whose password
 * predates a rule keeps working, and telling somebody at the door that their
 * existing password is now too weak helps nobody and leaks what it is not.
 */
import { COMMON_PASSWORDS } from './commonPasswords.js';
import { badRequest } from './http.js';

export const MIN_PASSWORD_LENGTH = 12;

/**
 * bcrypt reads **72 bytes** and silently ignores the rest, so anything longer
 * would have its tail quietly discarded — a password that looks stronger than
 * it is stored as. Refusing is honest; truncating is not. It is still well past
 * the 64 characters 800-63B says must be allowed, for anything but a very
 * multi-byte passphrase.
 */
export const MAX_PASSWORD_BYTES = 72;

/** Strings a guessable password tends to be a slice of, plus their reverses. */
const WALKS = [
  '01234567890123456789',
  'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiopasdfghjklzxcvbnm',
  'qwertzuiopasdfghjklyxcvbnm',
  'azertyuiopqsdfghjklmwxcvbn',
];

const REVERSED = WALKS.map((walk) => [...walk].reverse().join(''));

/** A trailing or leading run of anything that is not a letter. */
const EDGE_PADDING = /^[^\p{L}]+|[^\p{L}]+$/gu;

/**
 * The forms of a password worth looking up in the blocklist: the whole thing,
 * and what is left once the padding somebody added to reach the minimum is
 * taken off either end.
 */
function stems(lowered: string): string[] {
  const stripped = lowered.replace(EDGE_PADDING, '');
  return stripped && stripped !== lowered ? [lowered, stripped] : [lowered];
}

/** Whether the password is a slice of a counting, alphabet or keyboard run. */
function isWalk(lowered: string): boolean {
  return [...WALKS, ...REVERSED].some((walk) => walk.includes(lowered));
}

export function assertUsablePassword(password: string, { email }: { email?: string } = {}): void {
  // Count by code point, so an emoji is one character rather than two.
  const characters = [...password];
  if (characters.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      'error.passwordTooShort',
      { min: String(MIN_PASSWORD_LENGTH) },
    );
  }

  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw badRequest(
      `Password must be ${MAX_PASSWORD_BYTES} bytes or fewer`,
      'error.passwordTooLong',
      { max: String(MAX_PASSWORD_BYTES) },
    );
  }

  const lowered = password.toLowerCase();

  if (stems(lowered).some((stem) => COMMON_PASSWORDS.has(stem))) {
    throw badRequest(
      'That is one of the most commonly used passwords',
      'error.passwordCommon',
    );
  }

  if (new Set(characters).size === 1 || isWalk(lowered)) {
    throw badRequest(
      'That is too easy to guess — it is a single repeated character or a run off the keyboard',
      'error.passwordTooSimple',
    );
  }

  // The local part only: the domain is shared by everybody at it, and refusing
  // every password containing "gmail" would be noise.
  const local = email?.split('@')[0]?.toLowerCase() ?? '';
  const personal = [local, 'homebudget', 'home budget'].filter((word) => word.length >= 3);
  if (personal.some((word) => lowered.includes(word))) {
    throw badRequest(
      'Do not use your email address or the name of this app in your password',
      'error.passwordPersonal',
    );
  }
}
