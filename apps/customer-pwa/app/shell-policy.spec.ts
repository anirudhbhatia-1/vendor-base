import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '@neighbourhood-store/contracts';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { createRequestScope, sessionFailureState, showBasketDock } from './shell-policy';

test('guest redirect preserves order filters inside the return URL', () => {
  const response = proxy(new NextRequest('https://shop.example/orders?status=active'));
  const location = response.headers.get('location');
  assert.ok(location);
  const destination = new URL(location);
  assert.equal(destination.pathname, '/login');
  assert.equal(destination.searchParams.get('next'), '/orders?status=active');
  assert.equal(destination.searchParams.has('status'), false);
});

test('only confirmed 401 failures redirect; outages and forbidden responses stay recoverable', () => {
  assert.equal(sessionFailureState(new ApiError(401, 'Expired')), 'unauthorized');
  for (const error of [
    new ApiError(503, 'Unavailable'),
    new ApiError(403, 'Forbidden'),
    new TypeError('Failed to fetch'),
  ]) {
    assert.equal(sessionFailureState(error), 'unavailable');
  }
});

test('checkout and basket own their action bars, including nested routes', () => {
  for (const path of ['/cart', '/cart/', '/checkout', '/checkout/payment']) {
    assert.equal(showBasketDock(path, 2), false);
  }
  for (const path of ['/', '/search', '/stores', '/checkout-help']) {
    assert.equal(showBasketDock(path, 2), true);
    assert.equal(showBasketDock(path, 0), false);
  }
});

test('late address results cannot overwrite a newer request or a cleared session', async () => {
  const scope = createRequestScope();
  let complete!: () => void;
  const response = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let label = 'new account';
  const old = scope.begin();
  const pending = response.then(() => {
    if (old()) label = 'old account address';
  });
  const latest = scope.begin();
  complete();
  await pending;
  assert.equal(label, 'new account');
  assert.equal(latest(), true);
  scope.invalidate();
  assert.equal(latest(), false);
});
