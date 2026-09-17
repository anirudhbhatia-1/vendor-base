import { ApiError } from '@neighbourhood-store/contracts';

/** Only a confirmed authentication failure should send a shopper to sign in. */
export function sessionFailureState(error: unknown): 'unauthorized' | 'unavailable' {
  return error instanceof ApiError && error.status === 401 ? 'unauthorized' : 'unavailable';
}

export function showBasketDock(pathname: string, itemCount: number): boolean {
  return (
    itemCount > 0 &&
    !['/cart', '/checkout'].some((route) => pathname === route || pathname.startsWith(`${route}/`))
  );
}

/** Invalidates pending UI responses on reload, account change, and unmount. */
export function createRequestScope() {
  let generation = 0;
  return {
    invalidate() {
      generation += 1;
    },
    begin() {
      const current = ++generation;
      return () => current === generation;
    },
  };
}
