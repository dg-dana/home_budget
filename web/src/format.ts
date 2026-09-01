import { activeLocale } from './language';

/**
 * Money and dates follow the **chosen language**, not only the device
 * (`language.ts`): picking German has to move the decimal point as well as the
 * labels, or the page reads as half-translated. `activeLocale()` is read on
 * every call rather than captured, so switching repaints straight into the new
 * conventions — the toggle sets it before the re-render it triggers.
 */

/** Formats integer cents using the household's currency. */
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(activeLocale(), {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export const centsToAmount = (cents: number) => (cents / 100).toFixed(2);

/** A German keypad's decimal key sends ",", but `Number()` only reads ".". */
export function normalizeAmountInput(raw: string): string {
  return raw.replace(',', '.');
}

/** Current month as YYYY-MM in the viewer's local time, not UTC. */
export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Today as YYYY-MM-DD in the viewer's local time. */
export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const date = new Date(year, index + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string): string {
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  return date.toLocaleDateString(activeLocale(), { month: 'long', year: 'numeric' });
}

export function shortMonthLabel(month: string): string {
  const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
  return date.toLocaleDateString(activeLocale(), { month: 'short' });
}

export function dayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString(activeLocale(), { day: 'numeric', month: 'short' });
}
