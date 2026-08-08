import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api, type Household, type SessionPayload, type SessionUser } from './api';
import { useI18n } from './i18n';

interface SessionState {
  user: SessionUser | null;
  /** The household currently open. Null when the account has none, or has
   *  several and has not picked one yet. */
  household: Household | null;
  /** Every household this account belongs to. */
  households: Household[];
  /** Whether an owner can mint a recovery link — only where email is off. */
  ownerRecovery: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (value: SessionPayload) => void;
  switchHousehold: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  // Defaults to false so a page rendered before /auth/me lands does not flash a
  // control that is about to disappear. The signed-out case never reads it.
  const [ownerRecovery, setOwnerRecovery] = useState(false);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((data: SessionPayload) => {
    setUser(data.user);
    setHousehold(data.household);
    setHouseholds(data.households);
    setOwnerRecovery(data.ownerRecovery);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.get<SessionPayload>('/auth/me'));
    } catch (err) {
      // A 401 here just means nobody is signed in yet.
      if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
      setUser(null);
      setHousehold(null);
      setHouseholds([]);
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setSession = useCallback(
    (value: SessionPayload) => {
      apply(value);
      setLoading(false);
    },
    [apply],
  );

  /**
   * Switching re-issues the session cookie server-side, so the whole app moves
   * with it. Refetching rather than patching local state keeps this honest: the
   * server decides what the new household contains.
   */
  const switchHousehold = useCallback(
    async (id: string) => {
      await api.post(`/households/${id}/switch`);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
    setHousehold(null);
    setHouseholds([]);
  }, []);

  const value = useMemo(
    () => ({
      user,
      household,
      households,
      ownerRecovery,
      loading,
      refresh,
      setSession,
      switchHousehold,
      signOut,
    }),
    [
      user,
      household,
      households,
      ownerRecovery,
      loading,
      refresh,
      setSession,
      switchHousehold,
      signOut,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}

/**
 * Keeps the language an account is **emailed** in level with the language the
 * person is reading.
 *
 * These are two different settings on purpose. Reading is per device: it works
 * signed out, it works for a guest with no account, and it never touches the
 * API (`ARCHITECTURE.md` §9.1a). Writing has to be per account, because half
 * the messages the server sends go to people who are not making the request —
 * an owner hearing that somebody joined is not holding a browser.
 *
 * So this is the one place they meet, and it is a **follow rather than a
 * binding**: flipping the picker while signed in tells the server "write to me
 * in this from now on". A second device left in English does not drag it back;
 * whichever device last made a choice while signed in is the one that set it.
 *
 * The ref is what stops the effect firing twice before the refetch lands.
 * Called once, from `App`, so the dependency on `I18nProvider` wrapping
 * `SessionProvider` is visible at a call site rather than buried in one.
 */
export function useEmailLanguage(): void {
  const { user, refresh } = useSession();
  const { language } = useI18n();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!user || user.language === language || sent.current === language) return;
    sent.current = language;
    api
      .put('/auth/language', { language })
      .then(refresh)
      .catch(() => {
        // Not worth an alert: the app is still in the right language, and the
        // next flip — or the next sign-in on this device — tries again.
        sent.current = null;
      });
  }, [user, language, refresh]);
}

/** Convenience hook for pages that only render behind the household guard. */
export function useHousehold(): Household {
  const { household } = useSession();
  if (!household) throw new Error('No household loaded');
  return household;
}
