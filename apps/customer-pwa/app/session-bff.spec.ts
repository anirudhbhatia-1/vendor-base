import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server.js';
import { POST as verifyOtp } from './api/session/otp/verify/route';
import { POST as requestOtp } from './api/session/otp/request/route';
import { GET as readSession, DELETE as signOut } from './api/session/route';
import { POST as proxyPost } from './api/backend/[...path]/route';

test('OTP verification requires atomic customer enrolment before publishing secure cookies', async (t) => {
  const access = 'test-access-value';
  const refresh = 'test-refresh-value';
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, options?: RequestInit) => {
    calls.push(String(_url));
    assert.equal(JSON.parse(String(options?.body)).customer_enrolment, true);
    // Nest creates the UUIDv7 request id if no valid id was supplied.
    assert.equal(new Headers(options?.headers).get('x-request-id'), null);
    return Response.json({
      customer_enrolled: true,
      tokens: {
        access_token: access,
        refresh_token: refresh,
        access_expires_at: new Date(Date.now() + 600_000).toISOString(),
        session_id: 'session-test',
      },
    });
  });
  const response = await verifyOtp(
    new NextRequest('https://shop.example/api/session/otp/verify', {
      method: 'POST',
      headers: { origin: 'https://shop.example' },
      body: JSON.stringify({ challenge_id: 'challenge', code: '123456' }),
    }),
  );
  assert.equal(response.status, 200);
  assert.ok(calls[0]?.endsWith('/auth/otp/verify'));
  assert.equal(calls.length, 1);
  const body = await response.text();
  assert.equal(body.includes(access), false);
  assert.equal(body.includes(refresh), false);
  for (const name of ['ns_customer_access', 'ns_customer_refresh']) {
    assert.equal(response.cookies.get(name)?.httpOnly, true);
    assert.equal(response.cookies.get(name)?.secure, true);
    assert.equal(response.cookies.get(name)?.sameSite, 'lax');
  }
});

test('cross-origin OTP requests cannot create a session or send a code', async (t) => {
  const spy = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Cross-origin request reached the API');
  });
  for (const handler of [requestOtp, verifyOtp]) {
    const response = await handler(
      new NextRequest('https://shop.example/api/session/otp/verify', {
        method: 'POST',
        headers: { origin: 'https://attacker.example' },
        body: '{}',
      }),
    );
    assert.equal(response.status, 403);
  }
  assert.equal(spy.mock.callCount(), 0);
});

function sessionRequest(expiresAt: string) {
  return new NextRequest('https://shop.example/api/session', {
    headers: {
      cookie: `ns_customer_access=access; ns_customer_refresh=refresh; ns_customer_session=session; ns_customer_access_expires=${expiresAt}`,
    },
  });
}

test('consumed OTP is a conflict, not a successful browser session', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      outcome: 'already_verified',
      replayed: true,
      tokens: null,
    }),
  );
  const response = await verifyOtp(
    new NextRequest('https://shop.example/api/session/otp/verify', {
      method: 'POST',
      headers: { origin: 'https://shop.example' },
      body: '{}',
    }),
  );
  assert.equal(response.status, 409);
  assert.equal(response.cookies.getAll().length, 0);
  assert.equal((await response.json()).error.code, 'OTP_ALREADY_VERIFIED');
});

test('malformed successful OTP response is rejected without leaking partial tokens', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ tokens: { access_token: 'secret' } }),
  );
  const response = await verifyOtp(
    new NextRequest('https://shop.example/api/session/otp/verify', {
      method: 'POST',
      headers: { origin: 'https://shop.example' },
      body: '{}',
    }),
  );
  assert.equal(response.status, 502);
  assert.equal(response.cookies.getAll().length, 0);
  assert.equal((await response.text()).includes('secret'), false);
});

test('rejected refresh cannot fall back to an expired access cookie', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 401 }));
  const response = await readSession(sessionRequest('2020-01-01T00:00:00Z'));
  assert.equal(response.status, 401);
  assert.equal(response.cookies.get('ns_customer_refresh')?.maxAge, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('fresh cookies still require a non-revoked customer session', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    assert.ok(String(url).endsWith('/auth/customer/me'));
    return new Response(null, { status: 401 });
  });
  const response = await readSession(sessionRequest(new Date(Date.now() + 600_000).toISOString()));
  assert.equal(response.status, 401);
});

test('customer permission denial is not an expired session and keeps credentials', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  const response = await readSession(sessionRequest(new Date(Date.now() + 600_000).toISOString()));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'CUSTOMER_ACCESS_DENIED');
  assert.equal(response.cookies.getAll().length, 0);
});

test('OTP mutation without a browser Origin fails closed before provider dispatch', async (t) => {
  const spy = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const response = await requestOtp(
    new NextRequest('https://shop.example/api/session/otp/request', {
      method: 'POST',
      body: '{}',
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(spy.mock.callCount(), 0);
});

test('temporary refresh outage returns retryable failure without clearing credentials', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  const response = await readSession(sessionRequest('2020-01-01T00:00:00Z'));
  assert.equal(response.status, 503);
  assert.equal(response.cookies.getAll().length, 0);
});

test('older API success without customer enrolment attestation cannot publish cookies', async (t) => {
  const spy = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      tokens: {
        access_token: 'access',
        refresh_token: 'refresh',
        session_id: 'session',
        access_expires_at: new Date(Date.now() + 600_000).toISOString(),
      },
    }),
  );
  const response = await verifyOtp(
    new NextRequest('https://shop.example/api/session/otp/verify', {
      method: 'POST',
      headers: { origin: 'https://shop.example' },
      body: '{}',
    }),
  );
  assert.equal(response.status, 503);
  assert.equal(response.cookies.getAll().length, 0);
  assert.equal(spy.mock.callCount(), 1);
});

test('signout requires same-origin and CSRF proof before using a credential', async (t) => {
  const spy = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Must not call API');
  });
  const response = await signOut(
    new NextRequest('https://shop.example/api/session', {
      method: 'DELETE',
      headers: { origin: 'https://shop.example', cookie: 'ns_customer_refresh=refresh' },
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(spy.mock.callCount(), 0);
});

test('a signout outage preserves rotated credentials rather than claiming success', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    if (String(url).endsWith('/auth/sessions/refresh'))
      return Response.json({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        session_id: 'session',
        access_expires_at: new Date(Date.now() + 600_000).toISOString(),
      });
    throw new Error('Offline');
  });
  const response = await signOut(
    new NextRequest('https://shop.example/api/session', {
      method: 'DELETE',
      headers: {
        origin: 'https://shop.example',
        'x-csrf-token': 'csrf',
        cookie: 'ns_customer_refresh=old-refresh; ns_customer_csrf=csrf',
      },
    }),
  );
  assert.equal(response.status, 503);
  assert.equal(response.cookies.get('ns_customer_refresh')?.value, 'new-refresh');
  assert.equal((await response.text()).includes('new-refresh'), false);
});

test('temporary failure after proxy rotation preserves the replacement refresh credential', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    if (++calls === 1) return new Response(null, { status: 401 });
    if (calls === 2)
      return Response.json({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        session_id: 'session',
        access_expires_at: new Date(Date.now() + 600_000).toISOString(),
      });
    throw new Error('Offline');
  });
  const response = await proxyPost(
    new NextRequest('https://shop.example/api/backend/cart', {
      method: 'POST',
      headers: {
        origin: 'https://shop.example',
        'x-csrf-token': 'csrf',
        cookie:
          'ns_customer_session=session; ns_customer_access=old; ns_customer_refresh=old-refresh; ns_customer_csrf=csrf',
      },
      body: '{}',
    }),
    { params: Promise.resolve({ path: ['cart'] }) },
  );
  assert.equal(response.status, 503);
  assert.equal(response.cookies.get('ns_customer_refresh')?.value, 'new-refresh');
});

test('role denial after rotation keeps new cookies without retrying self-enrolment', async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    calls.push(String(url));
    if (String(url).endsWith('/auth/sessions/refresh'))
      return Response.json({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        session_id: 'session',
        access_expires_at: new Date(Date.now() + 600_000).toISOString(),
      });
    return new Response(null, { status: 403 });
  });
  const response = await readSession(sessionRequest('2020-01-01T00:00:00Z'));
  assert.equal(response.status, 403);
  assert.equal(response.cookies.get('ns_customer_refresh')?.value, 'new-refresh');
  assert.equal(calls.length, 2);
  assert.ok(!calls.some((url) => url.endsWith('/enrol')));
});

test('rotated credentials survive an outage during the following identity lookup', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: unknown) => {
    if (String(url).endsWith('/auth/sessions/refresh')) {
      return Response.json({
        access_token: 'replacement-access',
        refresh_token: 'replacement-refresh',
        access_expires_at: new Date(Date.now() + 600_000).toISOString(),
        session_id: 'session',
      });
    }
    throw new Error('Temporarily offline');
  });
  const response = await readSession(sessionRequest('2020-01-01T00:00:00Z'));
  assert.equal(response.status, 503);
  assert.equal(response.cookies.get('ns_customer_refresh')?.value, 'replacement-refresh');
  assert.equal(response.cookies.get('ns_customer_refresh')?.httpOnly, true);
  assert.equal((await response.text()).includes('replacement-refresh'), false);
});

test('proxy replays an identical mutation body after rotation and handles no-content responses', async (t) => {
  const bodies: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: unknown, options?: RequestInit) => {
    if (String(url).endsWith('/auth/sessions/refresh')) {
      return Response.json({
        access_token: 'rotated',
        refresh_token: 'rotated-refresh',
        session_id: 'session',
        access_expires_at: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    bodies.push(new TextDecoder().decode(options?.body as ArrayBuffer));
    assert.equal(new Headers(options?.headers).get('idempotency-key'), 'same-command');
    return new Response(null, { status: bodies.length === 1 ? 401 : 204 });
  });
  const response = await proxyPost(
    new NextRequest('https://shop.example/api/backend/cart', {
      method: 'POST',
      headers: {
        origin: 'https://shop.example',
        'x-csrf-token': 'csrf',
        'idempotency-key': 'same-command',
        cookie:
          'ns_customer_session=session; ns_customer_access=old; ns_customer_refresh=refresh; ns_customer_csrf=csrf',
      },
      body: '{"quantity":2}',
    }),
    { params: Promise.resolve({ path: ['cart'] }) },
  );
  assert.equal(response.status, 204);
  assert.deepEqual(bodies, ['{"quantity":2}', '{"quantity":2}']);
  assert.equal(await response.text(), '');
});
