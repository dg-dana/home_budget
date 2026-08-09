/**
 * Every word the app says, in both languages.
 *
 * **One entry, two values** — `[English, German]` — for the same reason every
 * colour is one `light-dark()` pair rather than two blocks half a file apart
 * (`ARCHITECTURE.md` §9.1): a new string is one line, and TypeScript refuses a
 * pair that is missing its other half, so German cannot silently fall behind.
 *
 * Rules for adding one:
 *
 * - **Whole sentences, never fragments joined at the call site.** German puts
 *   its verb somewhere else, so `'Delete ' + thing + '?'` is untranslatable.
 *   Placeholders are `{named}` and may be filled with a React node via `tx`,
 *   which is what keeps a `<strong>` or a `<Link>` inside one sentence.
 * - **Counted things get `_one` and `_other`**, looked up by `plural()`.
 * - German is informal (**du**), which is what a household of four is.
 */
export const STRINGS = {
  // --------------------------------------------------------------- common
  'common.loading': ['Loading…', 'Wird geladen…'],
  'common.cancel': ['Cancel', 'Abbrechen'],
  'common.copy': ['Copy', 'Kopieren'],
  'common.copied': ['Copied', 'Kopiert'],
  'common.copyFailed': [
    'Could not copy automatically — select the link and copy it manually.',
    'Automatisches Kopieren nicht möglich — markiere den Link und kopiere ihn von Hand.',
  ],
  'common.saving': ['Saving…', 'Wird gespeichert…'],
  'common.somethingWrong': ['Something went wrong', 'Etwas ist schiefgelaufen'],
  'common.edit': ['Edit', 'Bearbeiten'],
  'common.delete': ['Delete', 'Löschen'],
  'common.remove': ['Remove', 'Entfernen'],
  'common.you': ['you', 'du'],
  'common.total': ['Total', 'Gesamt'],
  'common.amount': ['Amount', 'Betrag'],
  /* A hint about the shape of the number, so it follows the decimal separator
     the browser will actually render in a `type="number"` field. */
  'common.amountPlaceholder': ['0.00', '0,00'],
  'common.date': ['Date', 'Datum'],
  'common.description': ['Description', 'Beschreibung'],
  'common.category': ['Category', 'Kategorie'],
  'common.uncategorised': ['Uncategorised', 'Ohne Kategorie'],
  'common.paidBy': ['Paid by', 'Bezahlt von'],
  'common.email': ['Email', 'E-Mail'],
  'common.password': ['Password', 'Passwort'],
  'common.currency': ['Currency', 'Währung'],
  'common.minPassword': ['At least 8 characters.', 'Mindestens 8 Zeichen.'],
  'common.confirmPassword': ['Confirm with your password', 'Mit deinem Passwort bestätigen'],
  'common.examplePerson': ['Dana', 'Dana'],
  'common.role.owner': ['owner', 'Eigentümer'],
  'common.role.member': ['member', 'Mitglied'],

  // ------------------------------------------------------------- controls
  'theme.group': ['Colour theme', 'Farbschema'],
  'theme.light': ['Light', 'Hell'],
  'theme.dark': ['Dark', 'Dunkel'],
  'theme.system': ['Match device', 'Wie das Gerät'],
  'lang.group': ['Language', 'Sprache'],

  // --------------------------------------------------------------- layout
  'nav.expenses': ['Expenses', 'Ausgaben'],
  'nav.statistics': ['Statistics', 'Statistik'],
  'nav.recurring': ['Recurring', 'Wiederkehrend'],
  'nav.shopping': ['Shopping', 'Einkaufen'],
  'nav.household': ['Household', 'Haushalt'],
  'nav.signOut': ['Sign out', 'Abmelden'],
  'switcher.label': ['Household', 'Haushalt'],
  'switcher.manageOne': ['Households…', 'Haushalte…'],
  'switcher.manageMany': ['All households…', 'Alle Haushalte…'],

  // ---------------------------------------------------------------- login
  'login.title': ['Welcome back', 'Willkommen zurück'],
  'login.subtitle': ['Sign in to your households.', 'Melde dich bei deinen Haushalten an.'],
  'login.submit': ['Sign in', 'Anmelden'],
  'login.submitting': ['Signing in…', 'Anmeldung läuft…'],
  'login.failed': ['Could not sign in', 'Anmeldung nicht möglich'],
  'login.newHere': ['Starting fresh? {link}', 'Neu hier? {link}'],
  'login.createAccount': ['Create an account', 'Konto erstellen'],
  'login.forgot': ['Forgotten your password?', 'Passwort vergessen?'],

  // ------------------------------------------------------------- register
  'register.title': ['Create your account', 'Erstelle dein Konto'],
  'register.subtitle': [
    'You will set up a household — or join one — next.',
    'Als Nächstes richtest du einen Haushalt ein — oder trittst einem bei.',
  ],
  'register.submit': ['Create account', 'Konto erstellen'],
  'register.submitting': ['Creating…', 'Wird erstellt…'],
  'register.failed': ['Could not create the account', 'Das Konto konnte nicht erstellt werden'],
  'register.haveAccount': ['Already have an account? {link}', 'Du hast schon ein Konto? {link}'],
  'register.signIn': ['Sign in', 'Anmelden'],
  'register.confirmTitle': ['Confirm your address', 'Bestätige deine Adresse'],
  'register.confirmSubtitle': [
    'One step left before you can create or join a household.',
    'Nur noch ein Schritt, bis du einen Haushalt erstellen oder einem beitreten kannst.',
  ],
  'register.continue': ['Continue', 'Weiter'],

  // --------------------------------------------------------------- forgot
  'forgot.title': ['Forgotten your password?', 'Passwort vergessen?'],
  'forgot.subtitle': [
    'Give us the address you signed up with and we will email you a link to choose a new one.',
    'Gib die Adresse an, mit der du dich registriert hast, und wir schicken dir per E-Mail einen Link für ein neues Passwort.',
  ],
  'forgot.submit': ['Email me a link', 'Schick mir einen Link'],
  'forgot.submitting': ['Sending…', 'Wird gesendet…'],
  'forgot.failed': [
    'Could not send a reset link',
    'Es konnte kein Link zum Zurücksetzen gesendet werden',
  ],
  'forgot.remembered': ['Remembered it? {link}', 'Doch wieder eingefallen? {link}'],
  'forgot.sentTitle': ['Check your email', 'Sieh in deinem Postfach nach'],
  'forgot.sentBody': [
    'If there is an account for {email}, a link to choose a new password is on its way. It works once and expires in 24 hours.',
    'Falls es ein Konto für {email} gibt, ist ein Link für ein neues Passwort unterwegs. Er funktioniert einmal und läuft nach 24 Stunden ab.',
  ],
  'forgot.nothingYet': [
    'Nothing after a few minutes? Check the spam folder, make sure the address is the one you signed up with, or {retry}.',
    'Nach ein paar Minuten immer noch nichts? Sieh im Spam-Ordner nach, prüfe, ob es die Adresse ist, mit der du dich registriert hast, oder {retry}.',
  ],
  'forgot.tryAnother': ['try another address', 'probiere eine andere Adresse'],
  'forgot.backToSignIn': ['Back to sign in', 'Zurück zur Anmeldung'],

  // ---------------------------------------------------------------- reset
  'link.notUsable': ['Link not usable', 'Link nicht verwendbar'],
  'link.checking': ['Checking link…', 'Link wird geprüft…'],
  'reset.linkHelp': ['{fresh}, or {signIn}.', '{fresh} oder {signIn}.'],
  'reset.askFresh': ['Ask for a fresh link', 'Fordere einen neuen Link an'],
  'reset.signIn': ['sign in', 'melde dich an'],
  'reset.title': ['Choose a new password', 'Neues Passwort wählen'],
  'reset.for': ['For {email}.', 'Für {email}.'],
  'reset.newPassword': ['New password', 'Neues Passwort'],
  'reset.repeat': ['Repeat it', 'Wiederholen'],
  'reset.mismatch': [
    'The two passwords do not match',
    'Die beiden Passwörter stimmen nicht überein',
  ],
  'reset.submit': ['Set password and sign in', 'Passwort setzen und anmelden'],
  'reset.failed': [
    'Could not set the new password',
    'Das neue Passwort konnte nicht gesetzt werden',
  ],
  'reset.evicts': [
    'This will sign out any device already using this account.',
    'Damit werden alle anderen Geräte abgemeldet, die dieses Konto benutzen.',
  ],

  // --------------------------------------------------------------- verify
  'verify.linkHelp': [
    'Confirmation links work once and expire after 24 hours. {signIn} to get a fresh one.',
    'Bestätigungslinks funktionieren einmal und laufen nach 24 Stunden ab. {signIn}, um einen neuen zu bekommen.',
  ],
  'verify.signIn': ['Sign in', 'Melde dich an'],
  'verify.title': ['Confirm your address', 'Bestätige deine Adresse'],
  'verify.submit': ['Confirm this address', 'Diese Adresse bestätigen'],
  'verify.submitting': ['Confirming…', 'Wird bestätigt…'],
  'verify.failed': [
    'Could not confirm the address',
    'Die Adresse konnte nicht bestätigt werden',
  ],
  'verify.after': [
    'Confirming signs you in on this device, so you can set up a household straight away.',
    'Mit der Bestätigung wirst du auf diesem Gerät angemeldet und kannst gleich einen Haushalt einrichten.',
  ],

  // ----------------------------------------------------------------- join
  'join.notUsable': ['Invite not usable', 'Einladung nicht verwendbar'],
  'join.notUsableHelp': [
    'Ask whoever invited you to send a fresh link, or {households}.',
    'Bitte die Person, die dich eingeladen hat, um einen neuen Link, oder {households}.',
  ],
  'join.yourHouseholds': ['go to your households', 'geh zu deinen Haushalten'],
  'join.checking': ['Checking invite…', 'Einladung wird geprüft…'],
  'join.alreadyIn': ['You are already in {household}', 'Du bist schon in {household}'],
  'join.alreadyInBody': [
    'Nothing to accept — this invite is not needed for you.',
    'Nichts anzunehmen — diese Einladung brauchst du nicht.',
  ],
  'join.open': ['Open {household}', '{household} öffnen'],
  'join.opening': ['Opening…', 'Wird geöffnet…'],
  'join.openFailed': ['Could not open it', 'Konnte nicht geöffnet werden'],
  'join.wrongPerson': [
    'Meant to invite somebody else? Send them their own link from the {page} — this one still works for whoever it was for.',
    'Wolltest du jemand anderen einladen? Schick dieser Person einen eigenen Link von der {page} — dieser hier gilt weiter für die Person, für die er ausgestellt wurde.',
  ],
  'join.householdPage': ['Household page', 'Haushaltsseite'],
  'join.title': ['Join {household}', '{household} beitreten'],
  'join.signedInAs': ['Signed in as {email}.', 'Angemeldet als {email}.'],
  'join.wrongAccount': [
    'This invite was issued for {email}. Sign in with that account to use it.',
    'Diese Einladung wurde für {email} ausgestellt. Melde dich mit diesem Konto an, um sie zu nutzen.',
  ],
  'join.confirmFirst': [
    'Confirm your email address before joining. {link}.',
    'Bestätige deine E-Mail-Adresse, bevor du beitrittst. {link}.',
  ],
  'join.getNewLink': ['Get a new link', 'Neuen Link anfordern'],
  'join.nameLabel': ['Your name in this household', 'Dein Name in diesem Haushalt'],
  'join.nameHelp': [
    'What the rest of {household} will see on expenses and shopping lists.',
    'Das sehen die anderen in {household} bei Ausgaben und Einkaufslisten.',
  ],
  'join.submit': ['Join household', 'Haushalt beitreten'],
  'join.submitting': ['Joining…', 'Beitritt läuft…'],
  'join.failed': ['Could not join the household', 'Beitritt zum Haushalt nicht möglich'],

  // ----------------------------------------------------------- households
  'households.title': ['Your households', 'Deine Haushalte'],
  'households.none': ['You are not in a household yet.', 'Du bist noch in keinem Haushalt.'],
  'households.pick': [
    'Pick the one to open, or add another.',
    'Wähle den, den du öffnen möchtest, oder füge einen weiteren hinzu.',
  ],
  'households.confirmFirst': [
    'Confirm {email} before creating or joining a household.',
    'Bestätige {email}, bevor du einen Haushalt erstellst oder einem beitrittst.',
  ],
  'households.sendNewLink': ['Send a new confirmation link', 'Neuen Bestätigungslink senden'],
  'households.sendLinkFailed': [
    'Could not send a new link',
    'Es konnte kein neuer Link gesendet werden',
  ],
  'households.invitations_one': ['You have an invitation', 'Du hast eine Einladung'],
  'households.invitations_other': ['You have invitations', 'Du hast Einladungen'],
  'households.invitedAs': ['invited as', 'eingeladen als'],
  'households.join': ['Join', 'Beitreten'],
  'households.joinNameLabel': ['Your name in that household', 'Dein Name in diesem Haushalt'],
  'households.as': ['as {name}', 'als {name}'],
  'households.open': ['Open', 'Öffnen'],
  'households.openFailed': [
    'Could not open that household',
    'Dieser Haushalt konnte nicht geöffnet werden',
  ],
  'households.nameLabel': ['Household name', 'Name des Haushalts'],
  'households.namePlaceholder': ['The Levy family', 'Familie Levy'],
  'households.yourNameLabel': ['Your name in it', 'Dein Name darin'],
  'households.displayNameHelp': [
    'This is the name the rest of the household sees on expenses and shopping lists. You can go by something different in each one.',
    'Diesen Namen sehen die anderen im Haushalt bei Ausgaben und Einkaufslisten. In jedem Haushalt kannst du anders heißen.',
  ],
  'households.create': ['Create household', 'Haushalt erstellen'],
  'households.creating': ['Creating…', 'Wird erstellt…'],
  'households.createFailed': [
    'Could not create the household',
    'Der Haushalt konnte nicht erstellt werden',
  ],
  'households.createCta': ['Create a household', 'Einen Haushalt erstellen'],
  'households.someoneElse': [
    "Joining someone else's? Open the invite link they sent you.",
    'Du willst einem fremden Haushalt beitreten? Öffne den Einladungslink, den man dir geschickt hat.',
  ],
  'households.signedInAs': ['Signed in as {email}. {signOut}', 'Angemeldet als {email}. {signOut}'],
  'households.deleteAccount': ['Delete account', 'Konto löschen'],
  'households.deleteTitle': ['Delete your account', 'Dein Konto löschen'],
  'households.deleteBodyNone': [
    'You are not in any household, so this removes the account and nothing else.',
    'Du bist in keinem Haushalt, es wird also nur das Konto gelöscht und sonst nichts.',
  ],
  'households.deleteBodySome': [
    'You lose your place in every household above, and any where you are the only person goes with you. What you spent stays in each history, listed without a payer.',
    'Du verlierst deinen Platz in jedem Haushalt oben, und jeder, in dem du die einzige Person bist, wird mitgelöscht. Was du ausgegeben hast, bleibt in der jeweiligen Historie — dort ohne Zahler aufgeführt.',
  ],
  'households.deleteSubmit': ['Delete my account', 'Mein Konto löschen'],
  'households.deleting': ['Deleting…', 'Wird gelöscht…'],
  'households.deleteFailed': [
    'Could not delete your account',
    'Dein Konto konnte nicht gelöscht werden',
  ],
  'households.confirmDeleteNone': [
    'Delete your account? This cannot be undone.',
    'Dein Konto löschen? Das lässt sich nicht rückgängig machen.',
  ],
  'households.confirmDeleteSome': [
    'Delete your account? You lose your place in every household listed here, and any household where you are the only person goes with you. What you spent stays in each history, listed without a payer. This cannot be undone.',
    'Dein Konto löschen? Du verlierst deinen Platz in jedem hier aufgeführten Haushalt, und jeder Haushalt, in dem du die einzige Person bist, wird mitgelöscht. Was du ausgegeben hast, bleibt in der jeweiligen Historie — dort ohne Zahler aufgeführt. Das lässt sich nicht rückgängig machen.',
  ],

  // ------------------------------------------------------------ household
  'household.title': ['Household', 'Haushalt'],
  'household.subtitle': [
    'Family members, invites, and the categories you budget against.',
    'Mitglieder, Einladungen und die Kategorien, für die du Budgets festlegst.',
  ],
  'household.thisHousehold': ['this household', 'diesem Haushalt'],
  'household.members': ['Family members', 'Mitglieder'],
  'household.lockedOutHint': [
    'Locked out? Anyone can reset their own password from the sign-in page — "Forgotten your password?" emails them a link.',
    'Ausgesperrt? Jede Person kann ihr Passwort selbst über die Anmeldeseite zurücksetzen — „Passwort vergessen?“ schickt ihr einen Link per E-Mail.',
  ],
  'household.resetPassword': ['Reset password', 'Passwort zurücksetzen'],
  'household.resetPasswordTitle': [
    'Create a password reset link for {name}',
    'Einen Link zum Zurücksetzen des Passworts für {name} erstellen',
  ],
  'household.resetFailed': [
    'Could not create a reset link',
    'Es konnte kein Link zum Zurücksetzen erstellt werden',
  ],
  'household.makeMember': ['Make member', 'Zu Mitglied machen'],
  'household.makeOwner': ['Make owner', 'Zu Eigentümer machen'],
  'household.makeMemberTitle': [
    'Make {name} an ordinary member',
    '{name} zu einem einfachen Mitglied machen',
  ],
  'household.makeOwnerTitle': [
    'Let {name} invite, rename and remove',
    '{name} darf einladen, umbenennen und entfernen',
  ],
  'household.confirmMakeOwner': [
    'Make {name} an owner? They will be able to invite and remove people, rename the household and delete it.',
    '{name} zum Eigentümer machen? Diese Person kann dann Leute einladen und entfernen, den Haushalt umbenennen und löschen.',
  ],
  'household.confirmMakeMember': [
    'Make {name} an ordinary member? They will lose those powers.',
    '{name} zu einem einfachen Mitglied machen? Diese Rechte gehen damit verloren.',
  ],
  'household.removeTitle': ['Remove {name}', '{name} entfernen'],
  'household.confirmRemove': [
    'Remove {name} from the household?',
    '{name} aus dem Haushalt entfernen?',
  ],
  'household.resetLinks': ['Reset links', 'Links zum Zurücksetzen'],
  'household.resetLinkEmailed': [
    'For {name} — emailed to them, and here as well. It works once, expires in 24 hours, and signs out their other devices.',
    'Für {name} — per E-Mail geschickt und hier ebenfalls. Der Link funktioniert einmal, läuft nach 24 Stunden ab und meldet die anderen Geräte dieser Person ab.',
  ],
  'household.resetLinkDirect': [
    'For {name} — send it to them directly. It works once, expires in 24 hours, and signs out their other devices.',
    'Für {name} — schick ihn dieser Person direkt. Der Link funktioniert einmal, läuft nach 24 Stunden ab und meldet ihre anderen Geräte ab.',
  ],
  'household.someMember': ['member', 'Mitglied'],
  'household.inviteEmailLabel': ['Invite email (optional)', 'E-Mail für die Einladung (optional)'],
  'household.inviteEmailPlaceholder': ['Email (optional)', 'E-Mail (optional)'],
  'household.createInvite': ['Create invite', 'Einladung erstellen'],
  'household.inviteFailed': [
    'Could not invite them',
    'Die Einladung konnte nicht erstellt werden',
  ],
  'household.inviteEmailed': [
    'Invite emailed to {email}. The link is below too.',
    'Einladung per E-Mail an {email} geschickt. Der Link steht auch unten.',
  ],
  'household.pendingInvites': ['Pending invites', 'Offene Einladungen'],
  'household.revoke': ['Revoke', 'Zurückziehen'],
  'household.inviteExpiry': [
    'Each link works once and expires after 14 days.',
    'Jeder Link funktioniert einmal und läuft nach 14 Tagen ab.',
  ],
  'household.settings': ['Settings', 'Einstellungen'],
  'household.nameLabel': ['Household name', 'Name des Haushalts'],
  'household.saveSettings': ['Save settings', 'Einstellungen speichern'],
  'household.ownerOnly': [
    'Only the household owner can change these settings.',
    'Nur der Eigentümer des Haushalts kann diese Einstellungen ändern.',
  ],
  'household.yourNameHere': ['Your name here', 'Dein Name hier'],
  'household.nameInLabel': ['Name in {household}', 'Name in {household}'],
  'household.saveName': ['Save name', 'Namen speichern'],
  'household.saved': ['Saved.', 'Gespeichert.'],
  'household.nameHelp': [
    'Only for this household — you can go by something different in each one. Your email and password belong to your account and are shared across all of them.',
    'Nur für diesen Haushalt — in jedem kannst du anders heißen. Deine E-Mail-Adresse und dein Passwort gehören zu deinem Konto und gelten überall.',
  ],
  'household.yourPassword': ['Your password', 'Dein Passwort'],
  'household.currentPassword': ['Current password', 'Aktuelles Passwort'],
  'household.newPassword': ['New password', 'Neues Passwort'],
  'household.changePassword': ['Change password', 'Passwort ändern'],
  'household.passwordChanged': [
    'Password changed. Any other device using this account was signed out.',
    'Passwort geändert. Alle anderen Geräte mit diesem Konto wurden abgemeldet.',
  ],
  'household.passwordFailed': [
    'Could not change the password',
    'Das Passwort konnte nicht geändert werden',
  ],
  'household.passwordHelp': [
    'Changing it signs out every other device using your account.',
    'Beim Ändern werden alle anderen Geräte mit deinem Konto abgemeldet.',
  ],
  'household.categories': ['Categories & budgets', 'Kategorien & Budgets'],
  'household.monthlyBudget': ['Monthly budget', 'Monatsbudget'],
  'household.actions': ['Actions', 'Aktionen'],
  'household.categoryColour': ['{name} colour', 'Farbe von {name}'],
  'household.categoryBudget': ['{name} monthly budget', 'Monatsbudget von {name}'],
  'household.noLimit': ['No limit', 'Kein Limit'],
  'household.deleteCategoryTitle': ['Delete {name}', '{name} löschen'],
  'household.confirmDeleteCategory': [
    'Delete "{name}"? Its expenses stay, but become uncategorised.',
    '„{name}“ löschen? Die Ausgaben bleiben, werden aber ohne Kategorie geführt.',
  ],
  'household.newCategoryName': ['New category name', 'Name der neuen Kategorie'],
  'household.newCategory': ['New category', 'Neue Kategorie'],
  'household.newCategoryColour': ['New category colour', 'Farbe der neuen Kategorie'],
  'household.budgetPlaceholder': ['Budget ({currency})', 'Budget ({currency})'],
  'household.add': ['Add', 'Hinzufügen'],
  'household.budgetPositive': [
    'Budget must be a positive number',
    'Das Budget muss eine positive Zahl sein',
  ],
  'household.budgetHelp': [
    "Budgets are compared against each month's spending on the Expenses page. Example limit: {amount}.",
    'Budgets werden auf der Seite „Ausgaben“ mit den Ausgaben des Monats verglichen. Beispiel für ein Limit: {amount}.',
  ],
  'household.dangerZone': ['Danger zone', 'Gefahrenzone'],
  'household.leaveTitle': ['Leave this household', 'Diesen Haushalt verlassen'],
  'household.leaveSoleOwner': [
    'You are this household’s only owner. Make someone else an owner first.',
    'Du bist der einzige Eigentümer dieses Haushalts. Mach zuerst jemand anderen zum Eigentümer.',
  ],
  'household.leaveLastPerson': [
    'You are the only person here, so there would be nobody left to reach it. Delete the household instead.',
    'Du bist die einzige Person hier — danach käme niemand mehr an den Haushalt heran. Lösche ihn stattdessen.',
  ],
  'household.leaveBody': [
    'Your account stays, and so does everything you spent — it is listed without a payer from then on. Getting back in needs a new invite.',
    'Dein Konto bleibt, und alles, was du ausgegeben hast, auch — es wird von da an ohne Zahler geführt. Für die Rückkehr brauchst du eine neue Einladung.',
  ],
  'household.leaveButton': ['Leave household', 'Haushalt verlassen'],
  'household.confirmLeave': [
    'Leave "{household}"? You lose access to its expenses and lists. What you spent stays in its history, listed without a payer. Getting back in needs a new invite.',
    '„{household}“ verlassen? Du verlierst den Zugriff auf die Ausgaben und Listen. Was du ausgegeben hast, bleibt in der Historie — dort ohne Zahler aufgeführt. Für die Rückkehr brauchst du eine neue Einladung.',
  ],
  'household.leaveFailed': [
    'Could not leave the household',
    'Der Haushalt konnte nicht verlassen werden',
  ],
  'household.deleteTitle': ['Delete this household', 'Diesen Haushalt löschen'],
  'household.deleteBody': [
    'Removes every expense, budget, recurring rule, shopping list and share link, for everyone in it. Their accounts survive — only this household goes.',
    'Löscht jede Ausgabe, jedes Budget, jede wiederkehrende Regel, jede Einkaufsliste und jeden Freigabelink, für alle darin. Die Konten der anderen bleiben — nur dieser Haushalt verschwindet.',
  ],
  'household.deleteButton': ['Delete household', 'Haushalt löschen'],
  'household.deleteFailed': [
    'Could not delete the household',
    'Der Haushalt konnte nicht gelöscht werden',
  ],
  'household.confirmDelete': [
    'Delete "{household}"? Every expense, budget, recurring rule and shopping list goes, and share links stop working. This cannot be undone.',
    '„{household}“ löschen? Jede Ausgabe, jedes Budget, jede wiederkehrende Regel und jede Einkaufsliste verschwindet, und Freigabelinks funktionieren nicht mehr. Das lässt sich nicht rückgängig machen.',
  ],
  'household.confirmDeleteOthers_one': [
    'Delete "{household}"? Every expense, budget, recurring rule and shopping list goes, and share links stop working. {count} other person loses access to it — their account survives. This cannot be undone.',
    '„{household}“ löschen? Jede Ausgabe, jedes Budget, jede wiederkehrende Regel und jede Einkaufsliste verschwindet, und Freigabelinks funktionieren nicht mehr. {count} weitere Person verliert den Zugriff — ihr Konto bleibt bestehen. Das lässt sich nicht rückgängig machen.',
  ],
  'household.confirmDeleteOthers_other': [
    'Delete "{household}"? Every expense, budget, recurring rule and shopping list goes, and share links stop working. {count} other people lose access to it — their accounts survive. This cannot be undone.',
    '„{household}“ löschen? Jede Ausgabe, jedes Budget, jede wiederkehrende Regel und jede Einkaufsliste verschwindet, und Freigabelinks funktionieren nicht mehr. {count} weitere Personen verlieren den Zugriff — ihre Konten bleiben bestehen. Das lässt sich nicht rückgängig machen.',
  ],
  'household.dangerFooter': [
    'Leaving can be undone with a new invite. Deleting cannot be undone at all — there is no export, and nothing it removes comes back. To close your account instead, go to {link}.',
    'Das Verlassen lässt sich mit einer neuen Einladung rückgängig machen. Das Löschen überhaupt nicht — es gibt keinen Export, und nichts davon kommt zurück. Wenn du stattdessen dein Konto schließen willst, geh zu {link}.',
  ],
  'household.yourHouseholds': ['Your households', 'Deine Haushalte'],

  // ------------------------------------------------------------- expenses
  'expenses.count_one': ['{count} expense this month', '{count} Ausgabe in diesem Monat'],
  'expenses.count_other': ['{count} expenses this month', '{count} Ausgaben in diesem Monat'],
  'expenses.previous': ['← Previous', '← Vorheriger'],
  'expenses.thisMonth': ['This month', 'Dieser Monat'],
  'expenses.next': ['Next →', 'Nächster →'],
  'expenses.totalSpent': ['Total spent', 'Gesamtausgaben'],
  'expenses.biggestCategory': ['Biggest category', 'Größte Kategorie'],
  'expenses.dailyAverage': ['Daily average', 'Tagesdurchschnitt'],
  'expenses.editTitle': ['Edit expense', 'Ausgabe bearbeiten'],
  'expenses.addTitle': ['Add an expense', 'Ausgabe hinzufügen'],
  'expenses.descriptionPlaceholder': [
    'Supermarket, electricity bill…',
    'Supermarkt, Stromrechnung…',
  ],
  'expenses.saveChanges': ['Save changes', 'Änderungen speichern'],
  'expenses.addSubmit': ['Add expense', 'Ausgabe hinzufügen'],
  'expenses.amountPositive': [
    'Enter an amount greater than zero',
    'Gib einen Betrag größer als null ein',
  ],
  'expenses.saveFailed': [
    'Could not save the expense',
    'Die Ausgabe konnte nicht gespeichert werden',
  ],
  'expenses.deleteFailed': [
    'Could not delete the expense',
    'Die Ausgabe konnte nicht gelöscht werden',
  ],
  'expenses.confirmDelete': ['Delete "{what}"?', '„{what}“ löschen?'],
  'expenses.thisExpense': ['this expense', 'diese Ausgabe'],
  'expenses.listTitle': ['Expenses', 'Ausgaben'],
  'expenses.shown': ['{count} shown', '{count} angezeigt'],
  'expenses.emptyMonth': [
    'Nothing recorded for {month} yet.',
    'Für {month} ist noch nichts erfasst.',
  ],
  'expenses.fallbackName': ['Expense', 'Ausgabe'],
  /* Icon-only buttons need a name of their own: the accessible name comes from
     the glyph inside them, never from `title`, so without these a screen reader
     announces every row's controls as "x" and "pencil". */
  'expenses.editRow': ['Edit {what}', '{what} bearbeiten'],
  'expenses.deleteRow': ['Delete {what}', '{what} löschen'],
  'expenses.repeating': ['↻ repeating', '↻ wiederkehrend'],
  'expenses.repeatingTitle': [
    'Added automatically by a recurring rule',
    'Automatisch durch eine wiederkehrende Regel hinzugefügt',
  ],
  'expenses.budgets': ['Budgets', 'Budgets'],
  'expenses.noBudgets': [
    'No monthly limits set yet. Add them under Household → Categories.',
    'Noch keine Monatslimits gesetzt. Du legst sie unter Haushalt → Kategorien an.',
  ],
  'expenses.overBy': ['Over by {amount}', '{amount} über dem Limit'],
  'expenses.byCategory': ['By category', 'Nach Kategorie'],
  'expenses.noBreakdown': [
    'No spending to break down yet.',
    'Noch keine Ausgaben zum Aufschlüsseln.',
  ],
  'expenses.whoPaid': ['Who paid', 'Wer bezahlt hat'],
  'expenses.nothingRecorded': ['Nothing recorded yet.', 'Noch nichts erfasst.'],
  'expenses.lastSixMonths': ['Last 6 months', 'Letzte 6 Monate'],
  'expenses.notEnoughHistory': ['Not enough history yet.', 'Noch nicht genug Verlauf.'],

  // ------------------------------------------------------------ recurring
  'recurring.title': ['Recurring expenses', 'Wiederkehrende Ausgaben'],
  'recurring.subtitle': [
    'Rent, bills and subscriptions. Each one is added to your expenses automatically when it falls due — including anything missed while you were away.',
    'Miete, Rechnungen und Abos. Jede wird automatisch zu deinen Ausgaben hinzugefügt, sobald sie fällig ist — auch das, was liegen geblieben ist, während du weg warst.',
  ],
  'recurring.committed': ['Committed per month', 'Monatliche Fixkosten'],
  'recurring.activeRules': ['Active rules', 'Aktive Regeln'],
  'recurring.editTitle': ['Edit recurring expense', 'Wiederkehrende Ausgabe bearbeiten'],
  'recurring.addTitle': ['Add a recurring expense', 'Wiederkehrende Ausgabe hinzufügen'],
  'recurring.repeats': ['Repeats', 'Wiederholt sich'],
  'recurring.weekly': ['Every week', 'Jede Woche'],
  'recurring.monthly': ['Every month', 'Jeden Monat'],
  'recurring.yearly': ['Every year', 'Jedes Jahr'],
  'recurring.descriptionPlaceholder': [
    'Rent, electricity, streaming…',
    'Miete, Strom, Streaming…',
  ],
  'recurring.firstCharge': ['First charge', 'Erste Buchung'],
  'recurring.stopsAfter': ['Stops after (optional)', 'Endet am (optional)'],
  'recurring.addSubmit': ['Add recurring expense', 'Wiederkehrende Ausgabe hinzufügen'],
  'recurring.scheduled': ['Scheduled', 'Geplant'],
  'recurring.totalCount': ['{count} total', '{count} insgesamt'],
  'recurring.empty': [
    'Nothing recurring yet. Add your rent or a subscription above and it will appear in your expenses on its own.',
    'Noch nichts Wiederkehrendes. Trag oben deine Miete oder ein Abo ein, und es erscheint von selbst in deinen Ausgaben.',
  ],
  'recurring.fallbackName': ['Recurring expense', 'Wiederkehrende Ausgabe'],
  'recurring.paused': ['Paused', 'Pausiert'],
  'recurring.nextOn': ['next {date}', 'nächste am {date}'],
  'recurring.until': ['until {date}', 'bis {date}'],
  'recurring.pause': ['Pause', 'Pausieren'],
  'recurring.resume': ['Resume', 'Fortsetzen'],
  'recurring.confirmDelete': [
    'Stop "{what}"? Expenses it already created are kept.',
    '„{what}“ beenden? Bereits erzeugte Ausgaben bleiben erhalten.',
  ],
  'recurring.thisRule': ['this recurring expense', 'diese wiederkehrende Ausgabe'],

  // ---------------------------------------------------------------- lists
  'lists.title': ['Shopping lists', 'Einkaufslisten'],
  'lists.subtitle': [
    'Share a list by link so anyone can pick things up — no account needed.',
    'Teile eine Liste per Link, damit jede Person etwas mitbringen kann — ganz ohne Konto.',
  ],
  'lists.newListName': ['New list name', 'Name der neuen Liste'],
  'lists.newListPlaceholder': ['Supermarket, hardware store…', 'Supermarkt, Baumarkt…'],
  'lists.newList': ['New list', 'Neue Liste'],
  'lists.createFailed': ['Could not create the list', 'Die Liste konnte nicht erstellt werden'],
  'lists.empty': [
    'No lists yet. Create your first one above.',
    'Noch keine Listen. Erstell oben deine erste.',
  ],
  'lists.stillToBuy': ['{open} of {total} still to buy', '{open} von {total} noch zu kaufen'],
  'lists.shared': ['🔗 Shared', '🔗 Geteilt'],
  'lists.sharedViewOnly': ['🔗 Shared (view only)', '🔗 Geteilt (nur ansehen)'],

  // ----------------------------------------------------------- one list
  'list.summary': ['{open} to buy · {done} in the basket', '{open} zu kaufen · {done} im Korb'],
  'list.rename': ['Rename', 'Umbenennen'],
  'list.renamePrompt': ['List name', 'Name der Liste'],
  'list.delete': ['Delete list', 'Liste löschen'],
  'list.confirmDelete': [
    'Delete the list "{name}" and everything on it?',
    'Die Liste „{name}“ mit allem darauf löschen?',
  ],
  'list.deleteFailed': ['Could not delete the list', 'Die Liste konnte nicht gelöscht werden'],
  'list.toBuy': ['To buy', 'Zu kaufen'],
  'list.clearBought': ['Clear {count} bought', '{count} Gekaufte entfernen'],
  'list.empty': ['This list is empty.', 'Diese Liste ist leer.'],
  'list.shareTitle': ['Share with anyone', 'Mit anderen teilen'],
  'list.shareBody': [
    'Anyone with this link can open the list without signing in. They cannot see your expenses or anything else in the household.',
    'Wer diesen Link hat, kann die Liste ohne Anmeldung öffnen. Deine Ausgaben oder sonst irgendetwas aus dem Haushalt sieht diese Person nicht.',
  ],
  'list.copyLink': ['Copy link', 'Link kopieren'],
  'list.guestsCanEdit': [
    'Let guests add items and tick things off',
    'Gäste dürfen Einträge hinzufügen und abhaken',
  ],
  'list.stopSharing': ['Stop sharing', 'Teilen beenden'],
  'list.notSharedBody': [
    'Create a link for people outside the household — a neighbour, a babysitter, whoever is near the shop.',
    'Erstelle einen Link für Leute außerhalb des Haushalts — die Nachbarin, den Babysitter, wer gerade beim Laden ist.',
  ],
  'list.createShareLink': ['Create share link', 'Link zum Teilen erstellen'],

  // -------------------------------------------------------- guest sharing
  'share.linkNotActive': ['Link not active', 'Link nicht aktiv'],
  'share.linkNotActiveHelp': [
    'Ask whoever sent it to share the list again.',
    'Bitte die Person, die ihn geschickt hat, die Liste noch einmal zu teilen.',
  ],
  'share.whoIsShopping': [
    "Who's shopping? This is only used to label items on the list.",
    'Wer geht einkaufen? Das dient nur dazu, Einträge auf der Liste zu kennzeichnen.',
  ],
  'share.yourName': ['Your name', 'Dein Name'],
  'share.openList': ['Open list', 'Liste öffnen'],
  'share.shoppingAs': ['Shopping as {name}', 'Unterwegs als {name}'],
  'share.change': ['Change', 'Ändern'],
  'share.viewOnly': [
    'This list is shared as view-only — you can see it but not change it.',
    'Diese Liste ist nur zum Ansehen freigegeben — du kannst sie sehen, aber nicht ändern.',
  ],
  'share.left': ['{count} left', 'noch {count}'],
  'share.emptyList': ['Nothing on the list yet.', 'Noch nichts auf der Liste.'],
  'share.footer': [
    'Shared from a Home Budget household. Only this list is visible through this link.',
    'Geteilt aus einem Home-Budget-Haushalt. Über diesen Link ist nur diese Liste sichtbar.',
  ],
  'share.quantityShort': ['Qty', 'Menge'],

  // ---------------------------------------------------------------- items
  'item.label': ['Item', 'Eintrag'],
  'item.placeholder': ['Add an item…', 'Eintrag hinzufügen…'],
  'item.quantity': ['Quantity', 'Menge'],
  'item.quantityPlaceholder': ['Qty (2 kg)', 'Menge (2 kg)'],
  'item.add': ['Add', 'Hinzufügen'],
  'item.hideComment': ['Hide comment', 'Kommentar ausblenden'],
  'item.addComment': ['Add a comment', 'Kommentar hinzufügen'],
  'item.withComment': ['With a comment', 'Mit Kommentar'],
  'item.comment': ['Comment', 'Kommentar'],
  'item.commentPlaceholder': [
    'Which brand, which shelf, what it is for…',
    'Welche Marke, welches Regal, wofür…',
  ],
  'item.commentOn': ['Comment on {name}', 'Kommentar zu {name}'],
  'item.editCommentOn': ['Edit the comment on {name}', 'Kommentar zu {name} bearbeiten'],
  'item.markBought': ['Mark {name} as bought', '{name} als gekauft markieren'],
  'item.addedBy': ['Added by {name}', 'Hinzugefügt von {name}'],
  'item.pickedUpBy': ['· picked up by {name}', '· mitgenommen von {name}'],
  'item.removeItem': ['Remove {name}', '{name} entfernen'],

  // ------------------------------------------------------------ copy list
  'copy.button': ['Copy list', 'Liste kopieren'],
  'copy.short': ['Copy', 'Kopieren'],
  'copy.failed': [
    'Could not copy the list — your browser blocked the clipboard.',
    'Die Liste konnte nicht kopiert werden — dein Browser hat die Zwischenablage blockiert.',
  ],
  /*
   * The three lines of the copied text itself. Kept plain — no quotes, dashes
   * or arrows — because a text message written in the GSM 7-bit alphabet fits
   * 160 characters and one stray character halves that to 70 (`listText.ts`).
   * German umlauts are in that alphabet; typographic quotes are not.
   */
  'copy.toBuy': ['To buy:', 'Zu kaufen:'],
  'copy.nothingYet': ['Nothing on the list yet.', 'Noch nichts auf der Liste.'],
  'copy.nothingLeft': ['Nothing left to buy.', 'Nichts mehr zu kaufen.'],

  // --------------------------------------------------------------- notice
  'notice.emailedWithLink': [
    'We have emailed {to} — open the link in that message to carry on.',
    'Wir haben eine E-Mail an {to} geschickt — öffne den Link darin, um weiterzumachen.',
  ],
  'notice.sentTo': ['Sent to {to}.', 'An {to} gesendet.'],
  'notice.notEmailed': [
    'Nothing was emailed, so this link is the only copy. Open it, or pass it on, to confirm {to}.',
    'Es wurde keine E-Mail verschickt, dieser Link ist also die einzige Kopie. Öffne ihn oder gib ihn weiter, um {to} zu bestätigen.',
  ],
  'notice.sentAgain': [
    'Sent again to {to}. Only the newest link works.',
    'Erneut an {to} geschickt. Nur der neueste Link funktioniert.',
  ],
  'notice.notThere': [
    'Not there? Check the spam folder, or {resend}.',
    'Nicht angekommen? Sieh im Spam-Ordner nach, oder {resend}.',
  ],
  'notice.resend': ['send the confirmation link again', 'den Bestätigungslink erneut senden'],
  'notice.resending': ['sending…', 'wird gesendet…'],
  'notice.resendFailed': ['Could not send it again', 'Erneutes Senden nicht möglich'],

  /*
   * What the API says when it refuses.
   *
   * The server still sends an English sentence and always will — it is what a
   * `curl` and a log line have to go on — but it now sends a **code** beside
   * it, and this is where that becomes a sentence in the reader's language
   * (`server/src/errorCodes.ts`). A code with no entry here falls back to the
   * English, so this list may lag without anything breaking; a server test
   * fails if it does.
   */
  'error.notSignedIn': ['Not signed in', 'Nicht angemeldet'],
  'error.notAllowed': ['Not allowed', 'Nicht erlaubt'],
  'error.notFound': ['Not found', 'Nicht gefunden'],
  'error.serverError': [
    'Something went wrong on the server',
    'Auf dem Server ist etwas schiefgelaufen',
  ],
  'error.unknownEndpoint': ['Unknown API endpoint', 'Unbekannter API-Endpunkt'],

  'error.wrongPassword': ['That is not your password', 'Das ist nicht dein Passwort'],
  'error.chooseHousehold': ['Choose a household first', 'Wähle zuerst einen Haushalt'],
  'error.ownerOnly': [
    'Only the household owner can do this',
    'Das kann nur der Eigentümer des Haushalts',
  ],
  'error.confirmFirst': [
    'Confirm your email address first',
    'Bestätige zuerst deine E-Mail-Adresse',
  ],

  'error.signInFailed': [
    'Incorrect email or password',
    'E-Mail-Adresse oder Passwort stimmt nicht',
  ],
  'error.emailTaken': [
    'An account with that email already exists',
    'Mit dieser E-Mail-Adresse gibt es bereits ein Konto',
  ],
  'error.wrongCurrentPassword': [
    'That is not your current password',
    'Das ist nicht dein aktuelles Passwort',
  ],
  'error.verifyLinkBad': [
    'This confirmation link is invalid or has expired',
    'Dieser Bestätigungslink ist ungültig oder abgelaufen',
  ],
  'error.alreadyConfirmed': [
    'That address is already confirmed',
    'Diese Adresse ist bereits bestätigt',
  ],
  'error.resetLinkBad': [
    'This reset link is invalid or has expired',
    'Dieser Link zum Zurücksetzen ist ungültig oder abgelaufen',
  ],
  'error.cannotSendEmail': [
    'This site cannot send email, so it cannot reset a password by itself. Ask a household owner to send you a reset link.',
    'Diese Seite kann keine E-Mails versenden und daher kein Passwort selbst zurücksetzen. Bitte einen Eigentümer des Haushalts, dir einen Link zum Zurücksetzen zu schicken.',
  ],

  'error.inviteLinkBad': [
    'This invite link is invalid or has expired',
    'Dieser Einladungslink ist ungültig oder abgelaufen',
  ],
  'error.inviteForOther': [
    'This invite was issued for {email}',
    'Diese Einladung wurde für {email} ausgestellt',
  ],
  'error.inviteNotFound': ['That invite does not exist', 'Diese Einladung gibt es nicht'],
  'error.alreadyMember': [
    '{name} is already in this household — no invite needed.',
    '{name} ist bereits in diesem Haushalt — es braucht keine Einladung.',
  ],
  'error.alreadyInHousehold': [
    'You are already in that household',
    'Du bist bereits in diesem Haushalt',
  ],

  'error.householdNotFound': ['That household does not exist', 'Diesen Haushalt gibt es nicht'],
  'error.memberNotFound': ['That member does not exist', 'Dieses Mitglied gibt es nicht'],
  'error.removeSelf': [
    'You cannot remove yourself from the household',
    'Du kannst dich nicht selbst aus dem Haushalt entfernen',
  ],
  'error.ownRole': [
    'You cannot change your own role — ask another owner',
    'Du kannst deine eigene Rolle nicht ändern — bitte einen anderen Eigentümer darum',
  ],
  'error.leaveLastPerson': [
    'You are the only person in "{household}", so there would be nobody left to reach it. Delete the household instead, from the Danger zone below.',
    'Du bist die einzige Person in „{household}“ — danach käme niemand mehr an den Haushalt heran. Lösche ihn stattdessen unten in der Gefahrenzone.',
  ],
  'error.leaveSoleOwner': [
    'You are the only owner of "{household}". Make someone else an owner first.',
    'Du bist der einzige Eigentümer von „{household}“. Mach zuerst jemand anderen zum Eigentümer.',
  ],
  'error.strandedOwner': [
    'You are the only owner of {households}. Make someone else an owner there first, or delete the household itself.',
    'Du bist der einzige Eigentümer von {households}. Mach dort zuerst jemand anderen zum Eigentümer, oder lösche den Haushalt selbst.',
  ],
  'error.ownerRecoveryOff': [
    'Anyone locked out can reset their own password from the sign-in page — "Forgotten your password?". Owner-issued links are only used where this site cannot send email.',
    'Wer ausgesperrt ist, kann das Passwort selbst über die Anmeldeseite zurücksetzen — „Passwort vergessen?“. Von Eigentümern ausgestellte Links gibt es nur dort, wo diese Seite keine E-Mails versenden kann.',
  ],

  'error.expenseNotFound': ['That expense does not exist', 'Diese Ausgabe gibt es nicht'],
  'error.recurringNotFound': [
    'That recurring expense does not exist',
    'Diese wiederkehrende Ausgabe gibt es nicht',
  ],
  'error.categoryNotFound': ['That category does not exist', 'Diese Kategorie gibt es nicht'],
  'error.categoryNameTaken': [
    'A category with that name already exists',
    'Eine Kategorie mit diesem Namen gibt es schon',
  ],
  'error.unknownCategory': ['Unknown category', 'Unbekannte Kategorie'],
  'error.unknownMember': ['Unknown household member', 'Unbekanntes Haushaltsmitglied'],
  'error.monthFormat': [
    'month must be in YYYY-MM format',
    'Der Monat muss im Format JJJJ-MM angegeben werden',
  ],
  'error.rangeOrder': [
    'from must not be after to',
    'Der Anfang darf nicht nach dem Ende liegen',
  ],
  'error.rangeTooLong': [
    'Range must be {months} months or fewer',
    'Der Zeitraum darf höchstens {months} Monate umfassen',
  ],

  'error.listNotFound': ['That shopping list does not exist', 'Diese Einkaufsliste gibt es nicht'],
  'error.itemNotFound': ['That item does not exist', 'Diesen Eintrag gibt es nicht'],
  'error.shareInactive': [
    'This shopping list link is no longer active',
    'Dieser Link zur Einkaufsliste ist nicht mehr aktiv',
  ],
  'error.shareViewOnly': [
    'This list is shared as view-only',
    'Diese Liste ist nur zum Ansehen freigegeben',
  ],

  // ----------------------------------------------------------- statistics
  'stats.title': ['Statistics', 'Statistik'],
  'stats.count_one': ['{count} expense · {range}', '{count} Ausgabe · {range}'],
  'stats.count_other': ['{count} expenses · {range}', '{count} Ausgaben · {range}'],
  'stats.presetThisMonth': ['This month', 'Dieser Monat'],
  'stats.preset3': ['3 months', '3 Monate'],
  'stats.preset6': ['6 months', '6 Monate'],
  'stats.preset12': ['12 months', '12 Monate'],
  'stats.from': ['From', 'Von'],
  'stats.to': ['To', 'Bis'],
  'stats.totalSpent': ['Total spent', 'Gesamtausgaben'],
  'stats.monthlyAverage': ['Monthly average', 'Monatsdurchschnitt'],
  'stats.spentMost': ['Spent most', 'Am meisten ausgegeben'],
  'stats.biggestCategory': ['Biggest category', 'Größte Kategorie'],
  'stats.whoSpentWhat': ['Who spent what', 'Wer wie viel ausgegeben hat'],
  'stats.nothingInRange': [
    'Nothing recorded in this range yet.',
    'In diesem Zeitraum ist noch nichts erfasst.',
  ],
  'stats.expenses_one': ['{count} expense', '{count} Ausgabe'],
  'stats.expenses_other': ['{count} expenses', '{count} Ausgaben'],
  'stats.average': [' · {amount} average', ' · {amount} im Schnitt'],
  'stats.whereItWent': ['Where it went', 'Wofür es ausgegeben wurde'],
  'stats.noBreakdown': ['No spending to break down yet.', 'Noch keine Ausgaben zum Aufschlüsseln.'],
  'stats.pickCategory': [
    'Pick a category to see how it moved over the range.',
    'Wähle eine Kategorie, um zu sehen, wie sie sich über den Zeitraum entwickelt hat.',
  ],
  'stats.monthByMonth': ['Month by month', 'Monat für Monat'],
  'stats.stackedByPayer': ['Stacked by who paid', 'Gestapelt nach Zahler'],
  'stats.crossTab': [
    'How much each spent, per category',
    'Wer wie viel pro Kategorie ausgegeben hat',
  ],
  'stats.nothingToCross': ['Nothing to cross-reference yet.', 'Noch nichts zum Gegenüberstellen.'],
  'stats.showNumbers': ['Show the numbers', 'Zahlen anzeigen'],
  'stats.unassigned': ['Unassigned', 'Nicht zugeordnet'],
  'stats.otherPeople': ['Other people', 'Andere Personen'],
  'stats.everythingElse': ['Everything else ({count})', 'Alles Übrige ({count})'],
  'stats.oneMonth': [
    '{amount} in {month}. Widen the range to see how it moves.',
    '{amount} im {month}. Erweitere den Zeitraum, um die Entwicklung zu sehen.',
  ],
  'stats.trendSummary': [
    '{average} a month on average · highest {peak} in {month}',
    '{average} pro Monat im Schnitt · Höchstwert {peak} im {month}',
  ],
  'stats.trendAria': ['{label} by month: {series}', '{label} nach Monat: {series}'],
  'stats.pieAria': ['{name} spent {amount}: {slices}', '{name} hat {amount} ausgegeben: {slices}'],
  'stats.sliceTitle': [
    '{name} · {label}: {amount} ({percent}%)',
    '{name} · {label}: {amount} ({percent} %)',
  ],
  'stats.monthTitle': ['{month}: {amount}', '{month}: {amount}'],
  'stats.segmentTitle': ['{label}, {month}: {amount}', '{label}, {month}: {amount}'],
} as const satisfies Record<string, readonly [string, string]>;

export type StringKey = keyof typeof STRINGS;
