import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import {
  customerCookiesSecure,
  customerMutationAllowed,
  customerOriginGuidance,
} from './customer-origin';
import { proxy } from '../proxy';
import { customerLoginReturn } from './login-return';

test('a loopback-alias refusal explains which origin to use, and does not redirect', () => {
  // The proxy used to redirect loopback navigation to the canonical host, and this
  // test asserted the Location on the returned NextResponse object -- where the
  // absolute URL survives. Over real HTTP it did not: Next rewrites a same-origin
  // Location to a relative path, and because NextURL normalizes 127.0.0.1 to
  // localhost it considered the two identical. The browser came back to the same
  // host and looped for ever, and this test stayed green throughout, because it
  // checked the intent rather than what was delivered.
  for (const host of ['127.0.0.1:3100', '[::1]:3100']) {
    const response = proxy(
      new NextRequest(`http://${host}/login?next=%2Forders`, { headers: { host } }),
    );
    assert.notEqual(response.status, 307, `${host} must not be redirected`);
  }

  // The strict policy still refuses the alias -- see the test below -- but the
  // refusal now names the origin to use instead of failing silently.
  const guidance = customerOriginGuidance(
    new NextRequest('http://localhost:3100/api/session', {
      headers: { host: 'localhost:3100', origin: 'http://127.0.0.1:3100' },
    }),
  );
  assert.match(guidance ?? '', /http:\/\/127\.0\.0\.1:3100/);
  assert.match(guidance ?? '', /http:\/\/localhost:3100/);

  // A genuine cross-origin attempt is told nothing it can use.
  assert.equal(
    customerOriginGuidance(
      new NextRequest('http://localhost:3100/api/session', {
        headers: { host: 'localhost:3100', origin: 'https://evil.example' },
      }),
    ),
    null,
  );
  // Nor is a port change on the same host: a different port is a different origin,
  // not a spelling of this one.
  assert.equal(
    customerOriginGuidance(
      new NextRequest('http://localhost:3100/api/session', {
        headers: { host: 'localhost:3100', origin: 'http://127.0.0.1:3101' },
      }),
    ),
    null,
  );
});

test('strict origin policy rejects missing/null origin, alternate port, scheme, host and forged forwarding', () => {
  for (const origin of [
    undefined,
    'null',
    'http://localhost:3101',
    'https://localhost:3100',
    'http://127.0.0.1:3100',
    'https://evil.example',
  ]) {
    const request = new NextRequest('http://localhost:3100/api/session/otp/request', {
      method: 'POST',
      headers: {
        ...(origin ? { origin } : {}),
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
      },
    });
    assert.equal(customerMutationAllowed(request), false, String(origin));
  }
  assert.equal(
    customerMutationAllowed(
      new NextRequest('http://localhost:3100/api/session', {
        method: 'POST',
        headers: { origin: 'http://localhost:3100' },
      }),
    ),
    true,
  );
});

test('deployed origin and cookie security come from explicit trusted configuration', (t) => {
  const previous = process.env.CUSTOMER_PWA_ORIGIN;
  t.after(() => {
    if (previous === undefined) delete process.env.CUSTOMER_PWA_ORIGIN;
    else process.env.CUSTOMER_PWA_ORIGIN = previous;
  });
  process.env.CUSTOMER_PWA_ORIGIN = 'https://shop.example';
  const request = new NextRequest('http://internal:3000/api/session', {
    method: 'POST',
    headers: { origin: 'https://shop.example' },
  });
  assert.equal(customerMutationAllowed(request), true);
  assert.equal(customerCookiesSecure(request), true);
  process.env.CUSTOMER_PWA_ORIGIN = 'https://shop.example/extra';
  assert.equal(customerMutationAllowed(request), false);
});

test('internal return destinations preserve deep links, while redirects and token routes are refused', () => {
  assert.equal(
    customerLoginReturn('/orders/order-1?tab=receipt#total'),
    '/orders/order-1?tab=receipt#total',
  );
  assert.equal(customerLoginReturn('/checkout?coupon=SAVE10'), '/checkout?coupon=SAVE10');
  for (const value of [
    undefined,
    ['orders'],
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/%2f%2fevil.example',
    '/%252fevil.example',
    '/\nevil.example',
    '/api/session',
    '/login?next=/login',
    '/orders/../../api/session',
  ]) {
    assert.equal(customerLoginReturn(value), '/', String(value));
  }
});
