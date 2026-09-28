'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type PolledResource<Value> = {
  readonly data: Value | null;
  readonly error: unknown;
  /** True only before the first result; a background refresh never blanks the screen. */
  readonly loading: boolean;
  /** True while any load is in flight, including background refreshes. */
  readonly refreshing: boolean;
  readonly refresh: () => Promise<void>;
  /** Applies a server response the caller already holds, e.g. after a write. */
  readonly replace: (value: Value) => void;
};

/**
 * The one polling loop.
 *
 * Every workspace hand-rolled its own setInterval and they disagreed on the
 * details that matter: some paused while the tab was hidden, some polled a
 * sleeping phone's radio awake all night, and none refreshed on `online`.
 * This hook pauses while hidden (an immediate refresh runs on return), always
 * refreshes on reconnect, and never overlaps two loads.
 */
export function usePolledResource<Value>(options: {
  readonly load: () => Promise<Value>;
  readonly intervalMs: number;
  /** Off only for presence signals like a partner heartbeat, which must keep beating. */
  readonly pauseWhenHidden?: boolean;
  readonly enabled?: boolean;
}): PolledResource<Value> {
  const { intervalMs, enabled = true, pauseWhenHidden = true } = options;
  const [data, setData] = useState<Value | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(options.load);
  loadRef.current = options.load;
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const value = await loadRef.current();
      setData(value);
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      inFlight.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer !== undefined) return;
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
    };
    const stop = () => {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else start();
    };
    const onOnline = () => void refresh();
    if (!pauseWhenHidden || document.visibilityState === 'visible') start();
    if (pauseWhenHidden) document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      stop();
      if (pauseWhenHidden) document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, intervalMs, pauseWhenHidden, refresh]);

  return { data, error, loading, refreshing, refresh, replace: setData };
}
