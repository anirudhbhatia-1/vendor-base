import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { createApiClient, type SessionTokens } from '@neighbourhood-store/contracts';
import { loadPersistedSession, persistSession } from './token-storage';
import { createSessionManager } from './session-manager';

const manager = createSessionManager({
  read: loadPersistedSession,
  write: persistSession,
  refresh: (token) =>
    createApiClient({
      baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3001',
      getToken: () => null,
    }).auth.refresh(token),
});

type SessionContextValue = {
  accessToken: string;
  ready: boolean;
  session: SessionTokens | null;
  setSession: (tokens: SessionTokens | null) => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const [session, setSessionState] = useState<SessionTokens | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const renew = async () => {
      try {
        const tokens = await manager.valid();
        if (active) setSessionState(tokens);
      } catch {
        // Retain the encrypted refresh token through network outages, but do
        // not offer an expired access token to the UI.
        if (active) setSessionState(null);
      } finally {
        if (active) setReady(true);
      }
    };
    void manager
      .restore()
      .then(renew)
      .catch(() => {
        if (active) setReady(true);
      });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void renew();
    }, 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void renew();
    });
    return () => {
      active = false;
      clearInterval(interval);
      subscription.remove();
    };
  }, []);
  const setSession = useCallback((tokens: SessionTokens | null) => {
    setSessionState(tokens);
    void manager.set(tokens).catch(() => setSessionState(null));
  }, []);
  const value = useMemo(
    () => ({ accessToken: session?.access_token ?? '', ready, session, setSession }),
    [ready, session, setSession],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useCustomerSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useCustomerSession must be used inside SessionProvider');
  return value;
}
