import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  currentCustomerTokens,
  readCustomerSession,
  restoreCustomerSession,
  signOutCustomer,
  storeCustomerSession,
  verifyCustomerOtp,
} from './customer-session';

function browser(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      dispatchEvent: () => true,
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  });
}
const summary = { session_id: 'session', access_expires_at: '2099-01-01T00:00:00Z' };

test('temporary and forbidden session checks keep UI summary; only 401 clears it', async (t) => {
  browser(t);
  for (const status of [503, 403, 401]) {
    storeCustomerSession(summary);
    t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status }));
    await assert.rejects(
      currentCustomerTokens(),
      (error: unknown) =>
        typeof error === 'object' && error !== null && 'status' in error && error.status === status,
    );
    assert.deepEqual(readCustomerSession(), status === 401 ? null : summary);
    t.mock.restoreAll();
  }
});

test('restoration does not turn a server outage into a guest login', async (t) => {
  browser(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 503 }));
  await assert.rejects(restoreCustomerSession());
});

test('concurrent session checks share one introspection request', async (t) => {
  browser(t);
  const spy = t.mock.method(globalThis, 'fetch', async () => Response.json(summary));
  const results = await Promise.all([
    currentCustomerTokens(),
    currentCustomerTokens(),
    currentCustomerTokens(),
  ]);
  assert.equal(spy.mock.callCount(), 1);
  assert.deepEqual(results, [summary, summary, summary]);
});

test('failed signout is not shown as success or erased locally', async (t) => {
  browser(t);
  storeCustomerSession(summary);
  t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 503 }));
  await assert.rejects(signOutCustomer());
  assert.deepEqual(readCustomerSession(), summary);
});

test('OTP success stores only the browser summary and a consumed challenge cannot overwrite it', async (t) => {
  browser(t);
  t.mock.method(globalThis, 'fetch', async () => Response.json(summary));
  await verifyCustomerOtp({ challenge_id: 'challenge', code: '123456', device_id: 'device' });
  assert.deepEqual(readCustomerSession(), summary);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ error: { code: 'OTP_ALREADY_VERIFIED' } }, { status: 409 }),
  );
  await assert.rejects(
    verifyCustomerOtp({ challenge_id: 'challenge', code: '123456', device_id: 'device' }),
    /already used/,
  );
  assert.deepEqual(readCustomerSession(), summary);
});
