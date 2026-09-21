/**
 * The last server-confirmed picture of the partner's work (9.4).
 *
 * The workspace used to hold assignments in memory only: a reload in a lane
 * with no signal, or an API that would not answer, left the partner with
 * "Dispatch could not be loaded" and no way to see where the job was or what
 * step they were on. The picture the server last confirmed is kept on the
 * device with the time it was confirmed, shown as such when nothing fresher
 * can be had, and never acted on as if it were current: every command still
 * carries the version it was built against, so a stale one is refused.
 */
const KEY = 'partner.active-jobs.v1';

export interface CachedAssignments<T> {
  readonly assignments: readonly T[];
  readonly confirmed_at: number;
}

export function rememberAssignments<T>(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  assignments: readonly T[],
  confirmedAt: number,
): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ assignments, confirmed_at: confirmedAt }));
  } catch {
    // Storage denied or full: the live picture is unaffected.
  }
}

export function recallAssignments<T>(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): CachedAssignments<T> | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { assignments?: unknown; confirmed_at?: unknown };
    if (!Array.isArray(parsed.assignments) || typeof parsed.confirmed_at !== 'number') {
      return null;
    }
    return { assignments: parsed.assignments as T[], confirmed_at: parsed.confirmed_at };
  } catch {
    return null;
  }
}

export function forgetAssignments(storage: Pick<Storage, 'removeItem'> | null | undefined): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** How the partner is told the picture is not live. */
export function staleSentence(confirmedAt: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - confirmedAt) / 60_000));
  const when =
    minutes < 1 ? 'a moment ago' : minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  return `Showing the job as the server last confirmed it, ${when}. Reconnect to take the next step.`;
}

/**
 * The route in words (DLP-46): distance and compass direction from where the
 * device is to where the store is, so a map is never the only account of it.
 */
export function directionSentence(
  from: { readonly latitude: number; readonly longitude: number } | null,
  to: { readonly latitude: number; readonly longitude: number },
): string | null {
  if (!from) return null;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const φ1 = toRadians(from.latitude);
  const φ2 = toRadians(to.latitude);
  const Δφ = toRadians(to.latitude - from.latitude);
  const Δλ = toRadians(to.longitude - from.longitude);
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const metres = 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (metres < 50) return 'You are at the store';
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const points = [
    'north',
    'north-east',
    'east',
    'south-east',
    'south',
    'south-west',
    'west',
    'north-west',
  ];
  const point = points[Math.round(bearing / 45) % 8] ?? 'north';
  const distance =
    metres < 950 ? `${Math.round(metres / 50) * 50} m` : `${(metres / 1000).toFixed(1)} km`;
  return `About ${distance} to the ${point}`;
}
