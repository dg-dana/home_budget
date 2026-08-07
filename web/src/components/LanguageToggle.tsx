import { useI18n } from '../i18n';
import type { Language } from '../language';

/**
 * Two states, and each one is labelled in **its own language**: somebody
 * looking for German is looking for the word "Deutsch", not for whatever the
 * interface currently calls it. The same reason airport signs do not translate
 * "Deutsch" into English.
 *
 * It sits everywhere `ThemeToggle` sits — both headers and `AuthPage` — which
 * is what puts it on the sign-in page and the guest share page. A guest has no
 * account to hang a preference on, so this has to work with no session at all
 * (`language.ts`).
 */
const OPTIONS: { value: Language; short: string; label: string }[] = [
  { value: 'en', short: 'EN', label: 'English' },
  { value: 'de', short: 'DE', label: 'Deutsch' },
];

export default function LanguageToggle() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="theme-toggle lang-toggle" role="group" aria-label={t('lang.group')}>
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="theme-option lang-option"
          aria-pressed={language === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => setLanguage(option.value)}
        >
          <span aria-hidden="true">{option.short}</span>
        </button>
      ))}
    </div>
  );
}
