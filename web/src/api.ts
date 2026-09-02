import type { Language } from './language';
import type { Theme } from './theme';

/**
 * A refusal from the API.
 *
 * `message` is the server's English sentence and is always present. `code` is
 * what lets the page say the same thing in the reader's language, and `vars`
 * carries the values it interpolates. Both are optional: a refusal with no code
 * — or with one this build has never heard of — falls back to the English
 * sentence, which is what shipped before any of this and is never nothing.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly vars?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: unknown; code?: unknown; vars?: unknown };
    const message =
      'error' in body ? String(body.error) : `Request failed (${response.status})`;
    throw new ApiError(
      response.status,
      message,
      typeof body.code === 'string' ? body.code : undefined,
      typeof body.vars === 'object' && body.vars !== null
        ? (body.vars as Record<string, string>)
        : undefined,
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  /** The body is for confirmations — deleting an account takes a password. */
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

// ---------------------------------------------------------------------------
// Shared response shapes
// ---------------------------------------------------------------------------

export type Role = 'owner' | 'member';

/**
 * The signed-in account. The household-shaped fields describe the household
 * currently open, and are null for an account that has not created or joined
 * one yet — the state every new sign-up starts in.
 */
export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  householdId: string | null;
  name: string | null;
  role: Role | null;
  /** The language this account reads and is written to in. */
  language: Language;
  /** The theme this account gets, on whatever it signs in to. */
  theme: Theme;
  /**
   * Whether this account has ever saved a pair. False means it has not, so the
   * device signing in decides and its choice is written up — which is what let
   * this ship without moving anything under anybody (`ARCHITECTURE.md` §9.1b).
   */
  preferencesSaved: boolean;
}

/** One of the households an account belongs to. */
export interface Household {
  id: string;
  name: string;
  currency: string;
  role: Role;
  /** What this account is called in *this* household. */
  displayName: string;
}

/** What `/auth/me` and every sign-in route return. */
export interface SessionPayload {
  user: SessionUser;
  household: Household | null;
  households: Household[];
  /**
   * Whether an owner can still mint a recovery link for somebody locked out.
   * True only where the app cannot send email: everywhere else people help
   * themselves from the sign-in page, and an owner holding a key to accounts
   * that may span other households is a power worth not having
   * (`ARCHITECTURE.md` §4).
   */
  ownerRecovery: boolean;
}

/**
 * A message the app would have emailed if it had a provider. It does not
 * (`ARCHITECTURE.md` §14), so the link comes back here and the page shows it —
 * the same bargain invites and password resets already make.
 */
export interface Notice {
  kind: string;
  to: string;
  subject: string;
  link?: string;
  body: string;
  /**
   * Whether it was emailed. False means the link on screen is the only copy —
   * either no provider is configured or the send failed, and the difference
   * does not matter to whoever is looking at it.
   */
  delivered: boolean;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  created_at: string;
}

export interface Invite {
  token: string;
  email: string | null;
  role: Role;
  expires_at: string;
}

/** An invite waiting for the signed-in account's address (`GET /households/invitations`). */
export interface Invitation {
  token: string;
  role: Role;
  expiresAt: string;
  householdName: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  monthly_budget_cents: number | null;
}

export interface Expense {
  id: string;
  amount_cents: number;
  description: string;
  spent_on: string;
  category_id: string | null;
  paid_by: string | null;
  category_name: string | null;
  category_color: string | null;
  paid_by_name: string | null;
  /** Set when this expense was generated by a recurring rule. */
  recurring_id: string | null;
}

export type Frequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurringExpense {
  id: string;
  amount_cents: number;
  description: string;
  category_id: string | null;
  paid_by: string | null;
  frequency: Frequency;
  starts_on: string;
  ends_on: string | null;
  last_generated_on: string | null;
  is_active: number;
  category_name: string | null;
  category_color: string | null;
  paid_by_name: string | null;
  /** Next date this rule will produce an expense; null when paused or finished. */
  next_due_on: string | null;
}

export interface Summary {
  month: string;
  total_cents: number;
  count: number;
  by_category: Array<{
    category_id: string;
    name: string;
    color: string;
    monthly_budget_cents: number | null;
    spent_cents: number;
  }>;
  uncategorised_cents: number;
  by_member: Array<{ user_id: string; name: string; spent_cents: number }>;
  trend: Array<{ month: string; total_cents: number }>;
}

/**
 * Statistics over a range of months. A `null` id (with a `null` name) is real
 * data, not a gap: spending whose payer was removed, or that has no category.
 * Naming those rows is the UI's job, which is why the server leaves it out.
 */
export interface Stats {
  from: string;
  to: string;
  months: number;
  total_cents: number;
  count: number;
  members: Array<{ user_id: string | null; name: string | null; spent_cents: number; count: number }>;
  categories: Array<{
    category_id: string | null;
    name: string | null;
    color: string | null;
    spent_cents: number;
    count: number;
  }>;
  /** One cell per member/category pair that has spending; the rest are zero. */
  matrix: Array<{
    user_id: string | null;
    category_id: string | null;
    spent_cents: number;
    count: number;
  }>;
  monthly: Array<{
    month: string;
    total_cents: number;
    by_member: Array<{ user_id: string | null; spent_cents: number }>;
    /** The same month split by category, for following one category over time. */
    by_category: Array<{ category_id: string | null; spent_cents: number }>;
  }>;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity: string;
  note: string;
  is_checked: number;
  added_by_name: string;
  checked_by_name: string | null;
}

export interface ShoppingList {
  id: string;
  name: string;
  shareToken: string | null;
  shareCanEdit: boolean;
  itemCount: number;
  openCount: number;
}

export interface ShoppingListDetail {
  id: string;
  name: string;
  shareToken: string | null;
  shareCanEdit: boolean;
  items: ShoppingItem[];
}

/**
 * One job on the household's to-do list.
 *
 * The two names are read through the household's memberships, so somebody who
 * has left reads as nobody — the row survives, the credit does not follow them
 * out (`ARCHITECTURE.md` §3).
 */
export interface Todo {
  id: string;
  title: string;
  is_done: number;
  created_by: string | null;
  done_by: string | null;
  done_at: string | null;
  added_by_name: string | null;
  done_by_name: string | null;
}

export interface SharedListView {
  name: string;
  canEdit: boolean;
  items: ShoppingItem[];
}
