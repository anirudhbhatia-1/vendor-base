import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextResponse } from 'next/server.js';
import {
  CSRF_COOKIE,
  clearSession,
  exchangeRefreshToken,
  setSession,
  tokenShape,
} from './api/session-cookies';

const future = () => new Date(Date.now() + 600_000).toISOString();
const tokens = () => ({
  access_expires_at: future(),
  access_token: 'a',
  refresh_token: 'r',
  session_id: 's',
});

test('a token set is a session only when every token is present and the access token is live', () => {
  // Two of the three former copies accepted these; cookies set from them could
  // only fail the next request.
  assert.equal(tokenShape(tokens()), true);
  assert.equal(tokenShape({ ...tokens(), access_token: '' }), false);
  assert.equal(tokenShape({ ...tokens(), refresh_token: '' }), false);
  assert.equal(tokenShape({ ...tokens(), session_id: '' }), false);
  assert.equal(
    tokenShape({ ...tokens(), access_expires_at: new Date(Date.now() - 1_000).toISOString() }),
    false,
  );
  assert.equal(tokenShape(null), false);
  assert.equal(tokenShape([]), false);
});

test('the session is five cookies, all but the CSRF token unreadable by the page', () => {
  const response = NextResponse.json({});
  setSession(response, tokens(), true);
  const set = response.cookies.getAll();
  assert.equal(set.length, 5);
  for (const cookie of set) {
    assert.equal(cookie.secure, true, cookie.name);
    assert.equal(cookie.sameSite, 'lax', cookie.name);
    assert.equal(cookie.httpOnly, cookie.name !== CSRF_COOKIE, cookie.name);
    assert.ok((cookie.maxAge ?? 0) >= 60, cookie.name);
  }
  const cleared = NextResponse.json({});
  clearSession(cleared, true);
  assert.equal(cleared.cookies.getAll().length, 5);
  for (const cookie of cleared.cookies.getAll()) assert.equal(cookie.maxAge, 0, cookie.name);
});

test('every refresh exchange times out and refuses redirects', async (t) => {
  // One copy carried neither, so a stalled or redirecting session service could
  // hang a proxy request or hand the refresh token to another origin.
  let seen: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    seen = init;
    return Response.json(tokens());
  });
  const rotated = await exchangeRefreshToken('r');
  assert.ok(rotated);
  assert.equal(seen?.redirect, 'error');
  assert.ok(seen?.signal instanceof AbortSignal);
});
