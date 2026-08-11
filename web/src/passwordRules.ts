/**
 * The one number the password fields agree on.
 *
 * The **server decides** what a usable password is (`server/src/passwords.ts`)
 * and its refusal is what actually stops a weak one. This is only so the form
 * can say the rule before somebody types, and so the browser's own `minLength`
 * catches the commonest case without a round trip — which means it has to be
 * in one place rather than repeated in three fields and a sentence.
 */
export const MIN_PASSWORD_LENGTH = 12;
