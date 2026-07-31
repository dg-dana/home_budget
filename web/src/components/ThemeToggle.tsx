import { useTheme, type Theme } from '../theme';

/**
 * Three states rather than an on/off switch, because "follow the device" is a
 * real answer and the common default — a two-way toggle would strand anyone
 * whose phone flips to dark at sunset.
 */
const OPTIONS: { value: Theme; icon: string; label: string }[] = [
  { value: 'light', icon: '☀', label: 'Light' },
  { value: 'dark', icon: '☾', label: 'Dark' },
  { value: 'system', icon: '◐', label: 'Match device' },
];

export default function ThemeToggle() {
  const [theme, setTheme] = useTheme();

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className="theme-option"
          aria-pressed={theme === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => setTheme(option.value)}
        >
          <span aria-hidden="true">{option.icon}</span>
        </button>
      ))}
    </div>
  );
}
