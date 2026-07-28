import { newId, nowIso } from './auth.js';
import { db } from './db.js';
import type { RecurringExpenseRow } from './types.js';

export type Frequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  frequency: Frequency;
  startsOn: string;
  endsOn: string | null;
}

// --------------------------------------------------------------------------
// Date helpers. Everything is a plain YYYY-MM-DD string; no Date objects are
// kept around, so there is no timezone to get wrong.
// --------------------------------------------------------------------------

const parse = (date: string) => ({
  year: Number(date.slice(0, 4)),
  month: Number(date.slice(5, 7)),
  day: Number(date.slice(8, 10)),
});

const formatParts = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Day 0 of the following month is the last day of this one. */
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Today, in the server's local calendar — the same "today" a user would name. */
export function today(): string {
  const now = new Date();
  return formatParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** The calendar day before `date`. */
export function previousDay(date: string): string {
  const { year, month, day } = parse(date);
  const shifted = new Date(Date.UTC(year, month - 1, day - 1));
  return formatParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * The nth occurrence of a rule, counting the start date as n = 0.
 *
 * Month and year steps keep the start date's day-of-month and clamp it to the
 * target month, so a rule starting on the 31st lands on the 30th, 29th or 28th
 * as needed — and, importantly, clamping never shifts the anchor: the 31st of
 * March follows the 28th of February, rather than every later month sticking
 * to the 28th.
 */
export function occurrenceAt(rule: RecurrenceRule, n: number): string {
  const { year, month, day } = parse(rule.startsOn);

  if (rule.frequency === 'weekly') {
    const shifted = new Date(Date.UTC(year, month - 1, day + n * 7));
    return formatParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
  }

  const monthsForward = rule.frequency === 'monthly' ? n : n * 12;
  const absoluteMonth = month - 1 + monthsForward;
  const targetYear = year + Math.floor(absoluteMonth / 12);
  const targetMonth = (absoluteMonth % 12) + 1;

  return formatParts(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

/** Guards against a pathological rule producing an unbounded list. */
const MAX_OCCURRENCES = 1000;

/**
 * Occurrence dates strictly after `after`, up to and including `through`.
 * `after` is the last date already generated; pass null for a fresh rule.
 */
export function occurrencesAfter(
  rule: RecurrenceRule,
  after: string | null,
  through: string,
): string[] {
  const limit = rule.endsOn && rule.endsOn < through ? rule.endsOn : through;
  const dates: string[] = [];

  for (let n = 0; n < MAX_OCCURRENCES; n += 1) {
    const date = occurrenceAt(rule, n);
    if (date > limit) break;
    if (after === null || date > after) dates.push(date);
  }

  return dates;
}

// --------------------------------------------------------------------------
// Materialisation
// --------------------------------------------------------------------------

const toRule = (row: RecurringExpenseRow): RecurrenceRule => ({
  frequency: row.frequency,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
});

/**
 * Turns every due occurrence of a household's active rules into real expense
 * rows, catching up on anything missed while nobody was using the app.
 *
 * Called at the start of the expense read endpoints rather than from a
 * scheduler: the app is a single SQLite process that may not be running when a
 * rule falls due, so it would need this catch-up path regardless. It is
 * idempotent — `last_generated_on` is what stops an occurrence being created
 * twice — and cheap, being one indexed query when nothing is due.
 *
 * Returns the number of expenses created.
 */
export function materialiseDueExpenses(householdId: string, asOf: string = today()): number {
  const rules = db
    .prepare(
      `SELECT * FROM recurring_expenses
       WHERE household_id = ? AND is_active = 1 AND starts_on <= ?`,
    )
    .all(householdId, asOf) as RecurringExpenseRow[];

  if (rules.length === 0) return 0;

  const insert = db.prepare(
    `INSERT INTO expenses
       (id, household_id, category_id, paid_by, amount_cents, description, spent_on,
        recurring_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const markGenerated = db.prepare('UPDATE recurring_expenses SET last_generated_on = ? WHERE id = ?');

  let created = 0;

  db.transaction(() => {
    for (const rule of rules) {
      const due = occurrencesAfter(toRule(rule), rule.last_generated_on, asOf);
      if (due.length === 0) continue;

      for (const date of due) {
        insert.run(
          newId(),
          rule.household_id,
          rule.category_id,
          rule.paid_by,
          rule.amount_cents,
          rule.description,
          date,
          rule.id,
          rule.created_by,
          nowIso(),
        );
        created += 1;
      }
      markGenerated.run(due[due.length - 1], rule.id);
    }
  })();

  return created;
}
