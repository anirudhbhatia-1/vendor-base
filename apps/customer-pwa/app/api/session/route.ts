import { NextResponse, type NextRequest } from 'next/server';
import { customerCookiesSecure, customerMutationAllowed } from '../../customer-origin';
import {
  ACCESS_COOKIE,
  EXPIRES_COOKIE,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  apiUrl,
  clearSession,
  csrfTokenMatches,
  exchangeRefreshToken,
  setSession,
  type Tokens,
} from '../session-cookies';

async function readSession(request: NextRequest) {
  let access = request.cookies.get(ACCESS_COOKIE)?.value;
  let expiresAt = request.cookies.get(EXPIRES_COOKIE)?.value;
  let sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  let rotated: Tokens | null = null;
  if (!access || !expiresAt || !(Date.parse(expiresAt) - Date.now() > 30_000)) {
    const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
    rotated = refresh ? await exchangeRefreshToken(refresh) : null;
    access = undefined;
    expiresAt = undefined;
    sessionId = undefined;
    if (rotated) {
      access = rotated.access_token;
      expiresAt = rotated.access_expires_at;
      sessionId = rotated.session_id;
    }
  }
  if (!access || !expiresAt || !sessionId) {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    clearSession(response, customerCookiesSecure(request));
    return response;
  }
  const identity = await fetch(`${apiUrl()}/auth/customer/me`, {
    headers: { authorization: `Bearer ${access}` },
    cache: 'no-store',
  }).catch(() => null);
  if (identity?.status === 401) {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    clearSession(response, customerCookiesSecure(request));
    return response;
  }
  if (identity?.status === 403) {
    // A role restriction must not erase a valid identity or automatically enrol it again.
    const denied = NextResponse.json(
      { error: { code: 'CUSTOMER_ACCESS_DENIED' } },
      { status: 403 },
    );
    if (rotated) setSession(denied, rotated, customerCookiesSecure(request));
    return denied;
  }
  if (!identity?.ok) {
    const unavailable = NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE' } },
      { status: 503 },
    );
    // Rotation has already invalidated the old credential. Preserve its replacement
    // even when the subsequent identity lookup cannot finish.
    if (rotated) setSession(unavailable, rotated, customerCookiesSecure(request));
    return unavailable;
  }
  const response = NextResponse.json({
    authenticated: true,
    access_expires_at: expiresAt,
    session_id: sessionId,
  });
  if (rotated) setSession(response, rotated, customerCookiesSecure(request));
  return response;
}

export async function GET(request: NextRequest) {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN' } },
      {
        status: 403,
        headers: { 'cache-control': 'no-store' },
      },
    );
  }
  let response: NextResponse;
  try {
    response = await readSession(request);
  } catch {
    // A temporary API outage must not destroy the only usable refresh credential.
    response = NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE' } }, { status: 503 });
  }
  response.headers.set('cache-control', 'no-store');
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!customerMutationAllowed(request)) {
    return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  }
  if (!csrfTokenMatches(request)) {
    return NextResponse.json({ error: { code: 'FORBIDDEN' } }, { status: 403 });
  }
  let rotated: Tokens | null = null;
  try {
    const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
    // Even an expired access token must revoke the still-active refresh session.
    rotated = refresh ? await exchangeRefreshToken(refresh) : null;
    const access = refresh ? rotated?.access_token : request.cookies.get(ACCESS_COOKIE)?.value;
    if (access) {
      const upstream = await fetch(`${apiUrl()}/auth/sessions/sign-out`, {
        headers: { authorization: `Bearer ${access}` },
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
      if (!upstream.ok && upstream.status !== 401) throw new Error('Sign-out unavailable');
    }
  } catch {
    const unavailable = NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE' } },
      {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      },
    );
    if (rotated) setSession(unavailable, rotated, customerCookiesSecure(request));
    return unavailable;
  }
  const response = NextResponse.json(
    { signed_out: true },
    { headers: { 'cache-control': 'no-store' } },
  );
  clearSession(response, customerCookiesSecure(request));
  return response;
}
