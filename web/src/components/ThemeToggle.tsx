import { useI18n } from '../i18n';
import type { StringKey } from '../strings';
import { useTheme, type Theme } from '../theme';

/**
 * Three states rather than an on/off switch, because "follow the device" is a
 * real answer and the common default — a two-way toggle would strand anyone
 * whose phone flips to dark at sunset.
 */
const OPTIONS: { value: Theme; icon: string; label: StringKey }[] = [
  { value: 'light', icon: '☀', label: 'theme.light' },
  { value: 'dark', icon: '☾', label: 'theme.dark' },
  { value: 'system', icon: '◐', label: 'theme.system' },
];

export default function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const { t } = useI18n();

  return (
    <div className="theme-toggle" role="group" aria-label={t('theme.group')}>
      {OPTIONS.map((option) => {
        // The icon is the only thing on screen, so this label is the whole
        // control as far as a screen reader is concerned.
        const label = t(option.label);
        return (
          <button
            key={option.value}
            type="button"
            className="theme-option"
            aria-pressed={theme === option.value}
            aria-label={label}
            title={label}
            onClick={() => setTheme(option.value)}
          >
            <span aria-hidden="true">{option.icon}</span>
          </button>
        );
      })}
    </div>
  );
}
