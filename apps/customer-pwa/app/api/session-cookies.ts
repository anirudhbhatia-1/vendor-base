import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

/**
 * The customer session as five cookies, and the one way to rotate it.
 *
 * Three route handlers -- the session reader, the OTP verifier and the backend
 * proxy -- each carried a copy of the cookie names, the token-shape check and
 * the refresh exchange. Two of the copies accepted a token set with an empty
 * refresh token, and one exchanged the refresh token with neither a timeout
 * nor a redirect policy. The rules live here once.
 *
 * Every cookie but the CSRF token is `httpOnly`: the page never sees a
 * credential, only proof that it is on the right origin.
 */
export const ACCESS_COOKIE = 'ns_customer_access';
export const REFRESH_COOKIE = 'ns_customer_refresh';
export const SESSION_COOKIE = 'ns_customer_session';
export const EXPIRES_COOKIE = 'ns_customer_access_expires';
export const CSRF_COOKIE = 'ns_customer_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** The refresh credential's lifetime at the API (`identity-sessions`). */
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const UPSTREAM_TIMEOUT_MS = 15_000;

export type Tokens = {
  readonly access_expires_at: string;
  readonly access_token: string;
  readonly refresh_token: string;
  readonly session_id: string;
};

export function apiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
}

/** A token set is a session only when every token is present and the access token is live. */
export function tokenShape(value: unknown): value is Tokens {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  for (const key of ['access_token', 'refresh_token', 'session_id', 'access_expires_at']) {
    if (typeof row[key] !== 'string' || row[key] === '') return false;
  }
  const expiresAt = Date.parse(row['access_expires_at'] as string);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function cookieOptions(secure: boolean, httpOnly: boolean, maxAge: number) {
  return { httpOnly, maxAge, path: '/', sameSite: 'lax' as const, secure };
}

export function setSession(response: NextResponse, tokens: Tokens, secure: boolean): void {
  const hidden = cookieOptions(secure, true, SESSION_COOKIE_MAX_AGE_SECONDS);
  response.cookies.set(ACCESS_COOKIE, tokens.access_token, hidden);
  response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, hidden);
  response.cookies.set(SESSION_COOKIE, tokens.session_id, hidden);
  response.cookies.set(EXPIRES_COOKIE, tokens.access_expires_at, hidden);
  response.cookies.set(
    CSRF_COOKIE,
    randomBytes(32).toString('base64url'),
    cookieOptions(secure, false, SESSION_COOKIE_MAX_AGE_SECONDS),
  );
}

export function clearSession(response: NextResponse, secure: boolean): void {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, SESSION_COOKIE, EXPIRES_COOKIE]) {
    response.cookies.set(name, '', cookieOptions(secure, true, 0));
  }
  response.cookies.set(CSRF_COOKIE, '', cookieOptions(secure, false, 0));
}

/** The double-submit check: the header the page sent equals the cookie only it could read. */
export function csrfTokenMatches(request: NextRequest): boolean {
  const cookie = request.cookies.get(CSRF_COOKIE)?.value ?? '';
  const header = request.headers.get(CSRF_HEADER) ?? '';
  if (!cookie || !header) return false;
  const expected = Buffer.from(cookie);
  const supplied = Buffer.from(header);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

/**
 * Rotate the refresh token at the API.
 *
 * Resolves to the replacement tokens, or `null` when the API refused the
 * credential -- a session that was revoked or has already been rotated. Any
 * other failure throws: an outage must not be mistaken for a rejection, since
 * the caller clears the only usable credential on a rejection.
 */
export async function exchangeRefreshToken(refreshToken: string): Promise<Tokens | null> {
  const upstream = await fetch(`${apiUrl()}/auth/sessions/refresh`, {
    body: JSON.stringify({ refresh_token: refreshToken }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (upstream.status === 401 || upstream.status === 403) return null;
  if (!upstream.ok) throw new Error(`Session refresh unavailable (${upstream.status})`);
  const value: unknown = await upstream.json().catch(() => null);
  if (!tokenShape(value)) throw new Error('Session refresh returned an invalid token set');
  return value;
}

/** The exchange, keyed by the request's refresh cookie; `null` when there is none. */
export async function refreshSessionFromCookie(request: NextRequest): Promise<Tokens | null> {
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  return refresh ? exchangeRefreshToken(refresh) : null;
}
