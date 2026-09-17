import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchLocaleBundle, t } from './runtime.js';

/**
 * The fallback chain is the whole reason a missing translation is survivable.
 *
 * Every call site passes the English sentence as the fallback, so a key the
 * server has not learned yet degrades to readable English rather than to a bare
 * `customer.cart.empty.title` on somebody's screen.
 */
test('a translated key wins, a missing one falls back to the English sentence', () => {
  const bundle = { 'customer.order.rate': 'यह दुकान कैसी रही?' };
  assert.equal(t(bundle, 'customer.order.rate', 'How was this store?'), 'यह दुकान कैसी रही?');
  assert.equal(t(bundle, 'customer.order.rated', 'Thank you.'), 'Thank you.');
});

test('a key with no fallback degrades to the key rather than to undefined', () => {
  // Ugly on screen, but a caller that forgot its fallback should see the key it
  // forgot rather than the word "undefined".
  assert.equal(t({}, 'customer.order.rate'), 'customer.order.rate');
});

test('an empty translation is a translation, not a missing one', () => {
  // A deliberate blank — a label a language does not need — must not silently
  // reopen the fallback.
  assert.equal(t({ 'state.placed': '' }, 'state.placed', 'Placed'), '');
});

test('the bundle request carries the language, and the audience only when asked', async () => {
  const called: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    called.push(String(input));
    return new Response(JSON.stringify({ language: 'hi', bundle: {} }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  }) as typeof fetch;
  try {
    await fetchLocaleBundle('http://api.test', 'hi', 'CUSTOMER');
    await fetchLocaleBundle('http://api.test', 'en');
    assert.equal(called[0], 'http://api.test/locale/bundle?language=hi&audience=CUSTOMER');
    assert.equal(called[1], 'http://api.test/locale/bundle?language=en');
  } finally {
    globalThis.fetch = original;
  }
});

test('a failed bundle names the status instead of resolving to nothing', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('nope', { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(
      () => fetchLocaleBundle('http://api.test', 'en'),
      /Locale bundle request failed \(503\)/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
