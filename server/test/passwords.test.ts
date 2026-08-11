/**
 * What counts as a usable password.
 *
 * The rules follow current guidance (NIST SP 800-63B) rather than the rules
 * most people picture, so the cases that matter most here are the **negative**
 * ones: that a passphrase full of lowercase letters and spaces is accepted, and
 * that nothing demands a capital, a digit or a symbol. Those are the ones a
 * future "let us tighten this up" change would break first, and they are the
 * whole point (`server/src/passwords.ts`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from '../src/commonPasswords.js';
import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  assertUsablePassword,
} from '../src/passwords.js';
import { HttpError } from '../src/http.js';
import { PASSWORD, createClient, registerAccount, resetDatabase, startServer, stopServer, uniqueEmail } from './helpers.js';

/** The code a refusal carries, or `null` if it was accepted. */
function refusal(password: string, email?: string): string | null {
  try {
    assertUsablePassword(password, { email });
    return null;
  } catch (err) {
    if (err instanceof HttpError) return err.code ?? 'uncoded';
    throw err;
  }
}

describe('what a usable password is', () => {
  describe('accepts', () => {
    it('a passphrase of nothing but lowercase letters and spaces', () => {
      // The single most important case in this file. Every "strengthen the
      // password rules" instinct starts by breaking it.
      expect(refusal('the quiet blue kettle')).toBeNull();
      expect(refusal('correct horse battery staple')).toBeNull();
    });

    it('anything long enough, whatever it is made of', () => {
      for (const password of [
        'aardvark lantern', // no digits, no capitals, no symbols
        'ÄÖÜ schöne Grüße!', // not ASCII
        '🔑🔑 keys to the flat', // emoji
        '            x            ', // spaces are characters
      ]) {
        expect(refusal(password)).toBeNull();
      }
    });

    it('a password of exactly the minimum length', () => {
      expect('twelve chars'.length).toBe(MIN_PASSWORD_LENGTH);
      expect(refusal('twelve chars')).toBeNull();
    });
  });

  describe('refuses', () => {
    it('anything shorter than the minimum', () => {
      expect(refusal('elevenchars')).toBe('error.passwordTooShort');
      // Counted by code point, so an emoji is one character and not two.
      expect(refusal('🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑🔑')).toBe('error.passwordTooShort');
    });

    it('anything past what bcrypt actually reads', () => {
      // Longer than 72 bytes and bcrypt silently ignores the tail, storing a
      // password weaker than the one that was typed. Refusing is honest.
      expect(refusal('a'.repeat(MAX_PASSWORD_BYTES) + 'b')).toBe('error.passwordTooLong');
      // Bytes, not characters: umlauts are two bytes each.
      expect(refusal('ü'.repeat(37))).toBe('error.passwordTooLong');
      expect(refusal('grüße über schöße'.repeat(2))).toBeNull();
    });

    it('one of the commonest passwords', () => {
      // Long enough to clear the length rule, and still hopeless.
      expect(refusal('masterbating')).toBe('error.passwordCommon');
      expect(COMMON_PASSWORDS.has('password')).toBe(true);
    });

    it('a common password padded out to reach the minimum', () => {
      // The one that matters. Only ten entries in the list are 12 characters
      // or more, so without this the blocklist is very nearly decoration:
      // told to type twelve, people lengthen what they already use.
      expect(refusal('password1234')).toBe('error.passwordCommon');
      expect(refusal('!!!qwerty!!!')).toBe('error.passwordCommon');
      expect(refusal('123iloveyou123')).toBe('error.passwordCommon');
    });

    it('a single repeated character, or a run off the keyboard', () => {
      // None of these is in the top 10,000 — those lists are full of short
      // passwords — and every one is what gets typed when 12 is in the way.
      expect(refusal('aaaaaaaaaaaa')).toBe('error.passwordTooSimple');
      expect(refusal('123456789012')).toBe('error.passwordTooSimple');
      expect(refusal('abcdefghijkl')).toBe('error.passwordTooSimple');
      expect(refusal('qwertyuiopas')).toBe('error.passwordTooSimple');
      expect(refusal('mnbvcxzlkjhg')).toBe('error.passwordTooSimple');
    });

    it('the local part of the account’s own address, or the name of the app', () => {
      expect(refusal('dana-the-great', 'dana@example.test')).toBe('error.passwordPersonal');
      expect(refusal('my home budget pass')).toBe('error.passwordPersonal');
      // The domain is shared by everybody at it, so it is not a secret worth
      // refusing over — otherwise nobody at gmail could use the word.
      expect(refusal('a gmail full of cats', 'dana@gmail.com')).toBeNull();
    });
  });
});

describe('where the rules apply', () => {
  beforeAll(async () => {
    await startServer({ enableRateLimits: false });
  });
  afterAll(stopServer);
  beforeEach(() => resetDatabase());

  it('refuses a weak password at registration, with a code the page can translate', async () => {
    const client = createClient();
    const refused = await client.post('/api/auth/register', {
      email: uniqueEmail('weak'),
      password: 'password1234',
    });

    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('error.passwordCommon');
  });

  it('carries the values its message interpolates', async () => {
    const client = createClient();
    const refused = await client.post('/api/auth/register', {
      email: uniqueEmail('short'),
      password: 'tooshort',
    });

    expect(refused.body.code).toBe('error.passwordTooShort');
    expect(refused.body.vars).toEqual({ min: String(MIN_PASSWORD_LENGTH) });
  });

  it('refuses a weak one when changing it, and leaves the old one working', async () => {
    const account = await registerAccount();

    const refused = await account.client.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'aaaaaaaaaaaa',
    });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('error.passwordTooSimple');

    // Nothing changed, so the password that was there still signs in.
    const stillIn = await createClient().post('/api/auth/login', {
      email: account.email,
      password: PASSWORD,
    });
    expect(stillIn.status).toBe(200);
  });

  it('never applies them at sign-in', async () => {
    // An account whose password predates a rule keeps working. Checking at the
    // door would lock people out of their own data over a rule change, and
    // would say something about a password to whoever is guessing at it.
    const account = await registerAccount();
    const signedIn = await createClient().post('/api/auth/login', {
      email: account.email,
      password: PASSWORD,
    });
    expect(signedIn.status).toBe(200);
  });
});
