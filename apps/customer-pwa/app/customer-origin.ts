import type { NextRequest } from 'next/server';

/** A deployment origin is configuration, never a forwarded request header. */
function customerOrigin(request: NextRequest): string | null {
  const configured = process.env.CUSTOMER_PWA_ORIGIN;
  if (!configured && process.env.NODE_ENV === 'production') return null;
  const raw = configured ?? request.nextUrl.origin;
  try {
    const url = new URL(raw);
    if (raw !== url.origin || !['http:', 'https:'].includes(url.protocol)) return null;
    if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Hosts that resolve to this machine.
 *
 * Used only to explain a refusal, never to grant one: the origin comparison below
 * stays exact.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export function customerMutationAllowed(request: NextRequest): boolean {
  const expected = customerOrigin(request);
  const origin = request.headers.get('origin');
  // Missing/null Origin is not a bypass for cookie-authenticated browser APIs.
  // Native clients use the business API and do not use this cookie BFF.
  return Boolean(
    expected &&
    origin === expected &&
    !['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? ''),
  );
}

/**
 * Why a refusal happened, when the cause is the developer's address bar.
 *
 * NextURL normalizes `127.0.0.1` and `[::1]` to `localhost`, so in development the
 * expected origin reads `http://localhost:3100` while a browser on the loopback IP
 * sends `Origin: http://127.0.0.1:3100`. Those are different origins and the
 * policy refuses them, correctly and deliberately.
 *
 * What it did not do was say so. An earlier attempt to redirect the browser to the
 * canonical host could not work -- Next rewrites a same-origin `Location` to a
 * relative path, and it already considers the two the same origin, so the redirect
 * returned to `127.0.0.1` and looped for ever, leaving the app unreachable there.
 *
 * The policy stays exact; the refusal now explains itself. Returns null for every
 * other rejection, so a genuine cross-origin attempt is told nothing useful.
 */
export function customerOriginGuidance(request: NextRequest): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const expected = customerOrigin(request);
  const origin = request.headers.get('origin');
  if (!expected || !origin || origin === expected) return null;
  try {
    const canonical = new URL(expected);
    const supplied = new URL(origin);
    if (
      canonical.protocol !== supplied.protocol ||
      canonical.port !== supplied.port ||
      !LOOPBACK_HOSTS.has(canonical.hostname) ||
      !LOOPBACK_HOSTS.has(supplied.hostname)
    ) {
      return null;
    }
    return `This request came from ${supplied.origin}, and the canonical development origin is ${canonical.origin}. They are different origins, so the mutation was refused. Open the app at ${canonical.origin}.`;
  } catch {
    return null;
  }
}

export function customerCookiesSecure(request: NextRequest): boolean {
  return customerOrigin(request)?.startsWith('https:') ?? true;
}
