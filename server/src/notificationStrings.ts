/**
 * Every word the app **sends**, in both languages.
 *
 * Deliberately the same shape as `web/src/strings.ts`: one entry per string
 * holding `[English, German]`, whole sentences with `{named}` placeholders, and
 * a `satisfies` clause so TypeScript refuses a pair with a half missing. Two
 * dictionaries in one house style beats one clever mechanism shared across a
 * process boundary that has no reason to be crossed — the frontend's strings
 * are never sent and these are never rendered.
 *
 * The "whole sentences" rule matters more here than it does on screen, because
 * the temptation is stronger: a notice about a household being renamed *and*
 * re-denominated reads as two clauses, and joining two translated clauses with
 * a translated "and" produces German that no German speaker would write. Every
 * combination gets its own entry instead.
 */
import type { Language } from './types.js';

const STRINGS = {
  // ------------------------------------------------------- confirm address
  'verify.subject': ['Confirm your email address', 'Bestätige deine E-Mail-Adresse'],
  'verify.body': [
    'Confirm your address to create or join a household. The link works once and expires in 24 hours.',
    'Bestätige deine Adresse, um einen Haushalt zu erstellen oder einem beizutreten. Der Link funktioniert einmal und läuft nach 24 Stunden ab.',
  ],

  // ------------------------------------------------------ household created
  'householdCreated.subject': ['You created {household}', 'Du hast {household} erstellt'],
  'householdCreated.body': [
    '"{household}" is ready. You are its owner, so you can invite the rest of the household from the Household page.',
    '„{household}“ ist bereit. Du bist der Eigentümer und kannst den Rest des Haushalts über die Haushaltsseite einladen.',
  ],

  // ----------------------------------------------------------------- invite
  'invite.subject': [
    'Join {household} on Home Budget',
    'Tritt {household} bei Home Budget bei',
  ],
  'invite.body': [
    'You have been invited to join "{household}". Open the link to accept — it works once and expires in 14 days.',
    'Du wurdest eingeladen, „{household}“ beizutreten. Öffne den Link, um anzunehmen — er funktioniert einmal und läuft nach 14 Tagen ab.',
  ],

  // --------------------------------------------------------------- password
  'passwordReset.subject': [
    'Reset your Home Budget password',
    'Setze dein Home-Budget-Passwort zurück',
  ],
  'passwordReset.body': [
    'Open the link to choose a new password. It works once, expires in 24 hours, and signs out every other device.',
    'Öffne den Link, um ein neues Passwort zu wählen. Er funktioniert einmal, läuft nach 24 Stunden ab und meldet alle anderen Geräte ab.',
  ],
  'passwordChanged.subject': [
    'Your Home Budget password was changed',
    'Dein Home-Budget-Passwort wurde geändert',
  ],
  'passwordChanged.body.changed': [
    'Your password was just changed, and every other device was signed out. If this was not you, reset it now.',
    'Dein Passwort wurde soeben geändert, und alle anderen Geräte wurden abgemeldet. Warst du das nicht, setze es jetzt zurück.',
  ],
  'passwordChanged.body.reset': [
    'Your password was just set using a recovery link, and every other device was signed out. If this was not you, change your password now — whoever holds that link can use it once.',
    'Dein Passwort wurde soeben über einen Wiederherstellungslink gesetzt, und alle anderen Geräte wurden abgemeldet. Warst du das nicht, ändere dein Passwort jetzt — wer diesen Link hat, kann ihn einmal verwenden.',
  ],

  // -------------------------------------------------------------- deletions
  'accountDeleted.subject': [
    'Your Home Budget account was deleted',
    'Dein Home-Budget-Konto wurde gelöscht',
  ],
  'accountDeleted.body': [
    "Your account, and your place in every household it belonged to, has been deleted. Expenses you had already recorded stay with those households, so nobody else's totals moved. There is no undo — signing up again starts from nothing.",
    'Dein Konto und dein Platz in jedem Haushalt, zu dem es gehörte, wurden gelöscht. Bereits erfasste Ausgaben bleiben bei diesen Haushalten, die Summen der anderen haben sich also nicht verändert. Das lässt sich nicht rückgängig machen — eine neue Registrierung fängt bei null an.',
  ],
  'householdDeleted.subject': ['"{household}" was deleted', '„{household}“ wurde gelöscht'],
  'householdDeleted.body': [
    'An owner deleted "{household}". Its expenses, budgets, recurring rules, shopping lists and share links are gone, and so is everyone\'s place in it. Accounts are untouched — anyone in another household still has it.',
    'Ein Eigentümer hat „{household}“ gelöscht. Die Ausgaben, Budgets, wiederkehrenden Regeln, Einkaufslisten und Freigabelinks sind weg, und der Platz aller darin ebenfalls. Die Konten bleiben unberührt — wer in einem anderen Haushalt ist, hat diesen weiterhin.',
  ],

  // ------------------------------------------------------ household changed
  /*
   * Three entries rather than two clauses and a translated "and". German does
   * not join these the way English does, and a sentence assembled from parts
   * is the thing this whole file exists to avoid.
   */
  'householdChanged.subject': ['"{household}" was changed', '„{household}“ wurde geändert'],
  'householdChanged.body.name': [
    'An owner changed the name from "{oldName}" to "{newName}".',
    'Ein Eigentümer hat den Namen von „{oldName}“ in „{newName}“ geändert.',
  ],
  'householdChanged.body.currency': [
    'An owner changed the currency from {oldCurrency} to {newCurrency}.',
    'Ein Eigentümer hat die Währung von {oldCurrency} in {newCurrency} geändert.',
  ],
  'householdChanged.body.both': [
    'An owner changed the name from "{oldName}" to "{newName}", and the currency from {oldCurrency} to {newCurrency}.',
    'Ein Eigentümer hat den Namen von „{oldName}“ in „{newName}“ und die Währung von {oldCurrency} in {newCurrency} geändert.',
  ],

  // ------------------------------------------------------------- membership
  'memberJoined.subject': ['{who} joined "{household}"', '{who} ist „{household}“ beigetreten'],
  'memberJoined.body': [
    '{who} redeemed an invite and is now in "{household}". They can see and add expenses, budgets, recurring rules and shopping lists. If you did not expect this, remove them from the Household page.',
    '{who} hat eine Einladung eingelöst und ist jetzt in „{household}“. Diese Person kann Ausgaben, Budgets, wiederkehrende Regeln und Einkaufslisten sehen und anlegen. Falls du das nicht erwartet hast, entferne sie über die Haushaltsseite.',
  ],
  'memberRemoved.subject.you': [
    'You were removed from "{household}"',
    'Du wurdest aus „{household}“ entfernt',
  ],
  'memberRemoved.subject.other': [
    '{who} left "{household}"',
    '{who} hat „{household}“ verlassen',
  ],
  'memberRemoved.body.you': [
    'An owner removed you from "{household}". You can no longer see it, and any recovery link outstanding for you has been retired. The expenses you recorded stay with the household. Your account and any other household you belong to are untouched.',
    'Ein Eigentümer hat dich aus „{household}“ entfernt. Du siehst den Haushalt nicht mehr, und ein noch offener Wiederherstellungslink für dich wurde ungültig gemacht. Die von dir erfassten Ausgaben bleiben beim Haushalt. Dein Konto und alle anderen Haushalte, zu denen du gehörst, bleiben unberührt.',
  ],
  'memberRemoved.body.other': [
    "{who} is no longer in \"{household}\". The expenses they recorded stay, so nobody's totals moved.",
    '{who} ist nicht mehr in „{household}“. Die erfassten Ausgaben bleiben, die Summen haben sich also für niemanden verändert.',
  ],
  'roleChanged.subject.owner': [
    'You are now an owner of "{household}"',
    'Du bist jetzt Eigentümer von „{household}“',
  ],
  'roleChanged.subject.member': [
    'You are no longer an owner of "{household}"',
    'Du bist nicht mehr Eigentümer von „{household}“',
  ],
  'roleChanged.body.owner': [
    'An owner made you an owner of "{household}". You can now invite and remove people, rename it, and delete it.',
    'Ein Eigentümer hat dich zum Eigentümer von „{household}“ gemacht. Du kannst jetzt Leute einladen und entfernen, den Haushalt umbenennen und löschen.',
  ],
  'roleChanged.body.member': [
    'An owner changed your role in "{household}" back to member. You keep full access to the money and the lists; what goes is inviting, removing, renaming and deleting.',
    'Ein Eigentümer hat deine Rolle in „{household}“ wieder auf Mitglied gesetzt. Der volle Zugriff auf die Finanzen und die Listen bleibt; weg sind Einladen, Entfernen, Umbenennen und Löschen.',
  ],
} as const satisfies Record<string, readonly [string, string]>;

export type NoticeStringKey = keyof typeof STRINGS;

const PLACEHOLDER = /\{(\w+)\}/g;

/** One line of a notice, in the recipient's language, placeholders filled in. */
export function line(
  key: NoticeStringKey,
  language: Language,
  vars: Record<string, string> = {},
): string {
  const template = STRINGS[key][language === 'de' ? 1 : 0];
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    name in vars ? vars[name] : whole,
  );
}
