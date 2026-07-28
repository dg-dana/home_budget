import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, api, type Household, type SessionUser } from './api';

interface SessionState {
  user: SessionUser | null;
  household: Household | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setSession: (value: { user: SessionUser; household: Household }) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: SessionUser; household: Household }>('/auth/me');
      setUser(data.user);
      setHousehold(data.household);
    } catch (err) {
      // A 401 here just means nobody is signed in yet.
      if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
      setUser(null);
      setHousehold(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setSession = useCallback((value: { user: SessionUser; household: Household }) => {
    setUser(value.user);
    setHousehold(value.household);
    setLoading(false);
  }, []);

  const signOut = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
    setHousehold(null);
  }, []);

  const value = useMemo(
    () => ({ user, household, loading, refresh, setSession, signOut }),
    [user, household, loading, refresh, setSession, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}

/** Convenience hook for pages that only render behind the auth guard. */
export function useHousehold(): Household {
  const { household } = useSession();
  if (!household) throw new Error('No household loaded');
  return household;
}
