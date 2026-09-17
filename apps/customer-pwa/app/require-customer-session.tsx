'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { currentCustomerTokens } from './customer-session';
import { sessionFailureState } from './shell-policy';

type GateState = 'checking' | 'authorized' | 'unauthorized' | 'unavailable';

/**
 * Client-side gate for the signed-in customer routes.
 *
 * The same-origin BFF validates the HttpOnly session. A connection failure is
 * recoverable in place; only a confirmed 401 redirects to sign in.
 *
 * The API's per-route capability checks remain the actual boundary.
 */
export function RequireCustomerSession({ children }: { children: ReactNode }): ReactNode {
  const pathname = usePathname();
  const [state, setState] = useState<GateState>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState('checking');
    currentCustomerTokens()
      .then(() => {
        if (active) setState('authorized');
      })
      .catch((error: unknown) => {
        if (!active) return;
        const failure = sessionFailureState(error);
        setState(failure);
        if (failure === 'unauthorized') {
          const next = window.location.pathname + window.location.search;
          window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        }
      });
    return () => {
      active = false;
    };
  }, [pathname, attempt]);

  if (state === 'authorized') return children;
  if (state === 'unavailable')
    return (
      <section className="route-section" aria-labelledby="session-recovery-title">
        <h2 id="session-recovery-title">Let’s reconnect</h2>
        <p role="status">We couldn’t check your session. Check your connection and try again.</p>
        <button
          className="ns-button ns-button--primary ns-button--medium"
          type="button"
          onClick={() => {
            setState('checking');
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </section>
    );
  return (
    <section className="route-section" aria-busy={state === 'checking'}>
      <p>{state === 'checking' ? 'Checking your session…' : 'Taking you to sign in…'}</p>
    </section>
  );
}

/**
 * Whether there is a usable session, without redirecting.
 *
 * `RequireCustomerSession` sends an unauthenticated visitor away, which is
 * right for orders and account but wrong for the basket: a guest should see
 * what they picked and be asked to sign in at the till, not bounced off the
 * page. Returns false while it resolves, so the guest view renders first and
 * never flashes a signed-in shell at someone who is not.
 */
export function useCustomerSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    const resolve = () => {
      currentCustomerTokens()
        .then(() => {
          if (active) setSignedIn(true);
        })
        .catch(() => {
          if (active) setSignedIn(false);
        });
    };
    resolve();
    window.addEventListener('neighbourhood:customer-session', resolve);
    return () => {
      active = false;
      window.removeEventListener('neighbourhood:customer-session', resolve);
    };
  }, []);

  return signedIn;
}
