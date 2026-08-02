import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api, type Household, type SessionPayload, type SessionUser } from './api';

interface SessionState {
  user: SessionUser | null;
  /** The household currently open. Null when the account has none, or has
   *  several and has not picked one yet. */
  household: Household | null;
  /** Every household this account belongs to. */
  households: Household[];
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
  const [loading, setLoading] = useState(true);

  const apply = useCallback((data: SessionPayload) => {
    setUser(data.user);
    setHousehold(data.household);
    setHouseholds(data.households);
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
      loading,
      refresh,
      setSession,
      switchHousehold,
      signOut,
    }),
    [user, household, households, loading, refresh, setSession, switchHousehold, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}

/** Convenience hook for pages that only render behind the household guard. */
export function useHousehold(): Household {
  const { household } = useSession();
  if (!household) throw new Error('No household loaded');
  return household;
}
