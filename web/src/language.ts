/**
 * Which language the app speaks, and the locale its money and dates follow.
 *
 * A **per-device** preference, exactly like the theme (`theme.ts`) and for the
 * same reasons: a guest with no account has to be able to set it, and the same
 * person may want different answers on a phone and a shared laptop. It lives in
 * `localStorage` and never touches the API — so nothing here depends on being
 * signed in, and the guest share page gets it for free.
 */
export type Language = 'en' | 'de';

export const LANGUAGE_KEY = 'home-budget:language';

/**
 * The locale `format.ts` hands to `Intl`.
 *
 * German pins `de-DE`: asking for German on an English phone means the decimal
 * comma and `7. Aug.` too, not English numbers with German labels. English
 * deliberately pins **nothing** — it is the default, so it leaves the device to
 * say whether today is `7 Aug` or `Aug 7` and whether USD prints as `$` or
 * `US$`. `undefined` is how you tell `Intl` "ask the browser".
 */
const LOCALES: Record<Language, string | undefined> = { en: undefined, de: 'de-DE' };

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'de';
}

/** What the device asks for, used only when nothing has been chosen here yet. */
function deviceLanguage(): Language {
  try {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
    return tags.some((tag) => String(tag).toLowerCase().startsWith('de')) ? 'de' : 'en';
  } catch {
    return 'en';
  }
}

export function readLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Private-mode Safari throws on localStorage. Fall through to the device.
  }
  return deviceLanguage();
}

/**
 * Read at import rather than on first render, so the very first `formatMoney`
 * call already formats in the right locale. `applyLanguage` keeps it current.
 */
let active: Language = readLanguage();

/**
 * `lang` on `<html>` is what a screen reader changes voice on and what the
 * browser's own "translate this page?" prompt reads. The inline script in
 * `web/index.html` makes the same assignment before first paint — change one
 * and change the other, exactly as with `applyTheme`.
 */
export function applyLanguage(language: Language): void {
  active = language;
  document.documentElement.lang = language;
}

/** The locale for `Intl`. `undefined` means "whatever the browser is set to". */
export function activeLocale(): string | undefined {
  return LOCALES[active];
}
