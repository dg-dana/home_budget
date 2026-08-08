import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api, type Household, type SessionPayload, type SessionUser } from './api';
import { useI18n } from './i18n';
import { useTheme } from './theme';

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
 * Makes the language and theme belong to the **account**, not the browser.
 *
 * They were per device to begin with, on the reasoning that one person may
 * want different answers on a phone and a laptop (`ARCHITECTURE.md` §9.1).
 * That reasoning was wrong about the case that actually happens: a browser
 * loses its `localStorage` — iOS evicts it, a Home Screen shortcut keeps a
 * separate copy, a reinstall wipes it — and the choice is gone with no way
 * back except making it again. A setting you have to keep re-making is not a
 * setting.
 *
 * So there are two rules, and the order between them is the whole design:
 *
 * 1. **On sign-in, the account wins.** Its saved pair is adopted and written
 *    into `localStorage`, so the pre-paint script gets it right next time.
 * 2. **After that, the device wins and is written up.** Changing either
 *    control saves both, and the next device to sign in adopts them.
 *
 * The exception is an account that has **never saved a pair** — every account
 * that existed before this shipped. There, rule 1 is skipped and the device's
 * current settings are written up instead, so nobody's app changed appearance
 * the day this deployed; it simply started sticking.
 *
 * Signed out, and for a guest, none of this runs: `localStorage` is the only
 * store there is, and it is unchanged.
 */
export function useAccountPreferences(): void {
  const { user, refresh } = useSession();
  const { language, setLanguage } = useI18n();
  const [theme, setTheme] = useTheme();
  /** The account these settings have already been adopted for. */
  const adopted = useRef<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!user) {
      // Signing out means the next account gets its own adoption rather than
      // inheriting whatever the last one left on screen.
      adopted.current = null;
      return;
    }

    if (adopted.current !== user.id) {
      adopted.current = user.id;
      if (user.preferencesSaved) {
        // Rule 1. Both setters write `localStorage` on the way through, which
        // is what the pre-paint script reads on the next load.
        if (user.language !== language) setLanguage(user.language);
        if (user.theme !== theme) setTheme(user.theme);
      } else {
        save();
      }
      return;
    }

    // Rule 2.
    if (user.language !== language || user.theme !== theme) save();

    function save() {
      if (saving.current) return;
      saving.current = true;
      api
        .put('/auth/preferences', { language, theme })
        .then(refresh)
        .catch(() => {
          // Not worth an alert: the app already looks the way they asked. The
          // next change, or the next sign-in on this device, tries again.
        })
        .finally(() => {
          saving.current = false;
        });
    }
  }, [user, language, theme, setLanguage, setTheme, refresh]);
}

/** Convenience hook for pages that only render behind the household guard. */
export function useHousehold(): Household {
  const { household } = useSession();
  if (!household) throw new Error('No household loaded');
  return household;
}
