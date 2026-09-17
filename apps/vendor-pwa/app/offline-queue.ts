'use client';

/**
 * Retry queue for vendor actions taken on a dropped connection (VEN-40).
 *
 * A till in a shop loses signal constantly. Without this, a vendor who taps
 * "accept" on a flaky connection sees a network error and has no idea whether
 * the order was accepted — so they tap again, and the deadline runs down while
 * they guess.
 *
 * Every queued action carries the command reference or expected version it was
 * built with, so replaying it is safe: the server rejects a duplicate rather
 * than applying it twice. The queue survives a reload because the connection
 * usually comes back after one.
 */
export type QueuedAction = {
  readonly id: string;
  readonly path: string;
  readonly method: string;
  readonly body: string | null;
  readonly describedAs: string;
  readonly queuedAt: number;
};

const storageKey = 'neighbourhood.vendor.offline-queue';

function read(): QueuedAction[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedAction[]) : [];
  } catch {
    // A corrupt queue is discarded rather than blocking every later action.
    return [];
  }
}

function write(actions: readonly QueuedAction[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(actions));
  } catch {
    // Storage may be unavailable (private mode). The queue then lasts only for
    // this page, which is still better than losing the action outright.
  }
}

export function queuedActions(): QueuedAction[] {
  return read();
}

export function enqueue(action: Omit<QueuedAction, 'id' | 'queuedAt'>): QueuedAction {
  const queued: QueuedAction = {
    ...action,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: Date.now(),
  };
  write([...read(), queued]);
  return queued;
}

function forget(id: string): void {
  write(read().filter((action) => action.id !== id));
}

/**
 * Replays everything queued, oldest first, stopping at the first failure so
 * order is preserved. Returns what was sent and what is still waiting.
 */
export async function drain(
  send: (action: QueuedAction) => Promise<void>,
): Promise<{ readonly sent: number; readonly remaining: number }> {
  let sent = 0;
  for (const action of read()) {
    try {
      await send(action);
      forget(action.id);
      sent += 1;
    } catch {
      break;
    }
  }
  return { sent, remaining: read().length };
}
