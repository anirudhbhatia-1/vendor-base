'use client';

/**
 * Where a visitor is shopping from, before they have an account.
 *
 * Discovery is calculated for a point inside a vendor's service zone (MKT-03),
 * and until now the only point the app could use was a *saved address* — which
 * needs a session. So the first thing a new visitor met was a sign-in screen,
 * with nothing behind it to justify signing in. `architecture.md` §6.1 asks for
 * public store pages precisely so that does not happen.
 *
 * A saved address still wins whenever one exists: it is what the quote, the
 * zone check and the delivery fee bind to at checkout. This is only the
 * stand-in that lets someone look around first.
 */
const STORAGE_KEY = 'neighbourhood:browse-location';

export type BrowseLocation = {
  readonly latitude: number;
  readonly longitude: number;
  /** What to call this place on screen; the device rarely tells us a name. */
  readonly label: string;
};

function isBrowseLocation(value: unknown): value is BrowseLocation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['latitude'] === 'number' &&
    typeof candidate['longitude'] === 'number' &&
    typeof candidate['label'] === 'string'
  );
}

export function readBrowseLocation(): BrowseLocation | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isBrowseLocation(parsed) ? parsed : null;
  } catch {
    // A private window, cleared site data, or a value written by an older
    // build. None of those should stop the page rendering.
    return null;
  }
}

function writeBrowseLocation(location: BrowseLocation): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    window.dispatchEvent(new Event('neighbourhood:browse-location'));
  } catch {
    // Storage refused. The location still works for this page view.
  }
}

/**
 * Asks the device where it is.
 *
 * Permission is genuinely optional (CUS-08): a refusal returns a reason to
 * show, never an exception to swallow. Manual entry of a pin code is the
 * documented alternative (CUS-09) but needs a geocoder to become a point —
 * that is the maps adapter (INT-04), an unresolved production gate, so it is
 * deliberately not faked with a hardcoded lookup here.
 */
export async function requestDeviceLocation(): Promise<
  | { readonly ok: true; readonly location: BrowseLocation }
  | { readonly ok: false; readonly reason: string }
> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { ok: false, reason: 'This device cannot share its location.' };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location: BrowseLocation = {
          label: 'Near you',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        writeBrowseLocation(location);
        resolve({ location, ok: true });
      },
      (error) => {
        resolve({
          ok: false,
          reason:
            error.code === error.PERMISSION_DENIED
              ? 'Location is off, so we cannot tell which shops can reach you.'
              : 'We could not read your location just now.',
        });
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
    );
  });
}
