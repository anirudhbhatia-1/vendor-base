import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  formatCountdown,
  formatDistanceMeters,
  formatMoneyMinor,
  humaniseEnum,
  parseRupeesToMinor,
} from './format.js';

test('money formats integer minor units without floating-point arithmetic', () => {
  assert.equal(formatMoneyMinor(0), '₹0.00');
  assert.equal(formatMoneyMinor(1), '₹0.01');
  assert.equal(formatMoneyMinor(1999), '₹19.99');
  assert.equal(formatMoneyMinor(100_000), '₹1,000.00');
  assert.equal(formatMoneyMinor(-2550), '-₹25.50');
});

test('money rejects a non-integer amount rather than silently rounding it', () => {
  // A float here means someone divided by 100 before reaching the formatter,
  // which is exactly the arithmetic the repository prohibits for money.
  assert.throws(() => formatMoneyMinor(19.99), TypeError);
  assert.throws(() => formatMoneyMinor(Number.NaN), TypeError);
});

test('compact money drops an empty paise tail but keeps a real one', () => {
  assert.equal(formatMoneyMinor(4500, 'compact'), '₹45');
  assert.equal(formatMoneyMinor(4550, 'compact'), '₹45.50');
});

test('distance reads in metres below a kilometre', () => {
  assert.equal(formatDistanceMeters(240), '240 m');
  assert.equal(formatDistanceMeters(1500), '1.5 km');
  assert.equal(formatDistanceMeters(-1), '—');
});

test('an unknown wire enum degrades to a sentence, never a raw constant', () => {
  assert.equal(humaniseEnum('AWAITING_CUSTOMER_DECISION'), 'Awaiting customer decision');
  assert.equal(humaniseEnum('READY'), 'Ready');
});

test('a countdown past its deadline returns null instead of counting negative', () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.equal(formatCountdown(new Date(now + 90_000).toISOString(), now), '1:30');
  assert.equal(formatCountdown(new Date(now - 1000).toISOString(), now), null);
});

test('a typed rupee amount parses to exact minor units', () => {
  assert.equal(parseRupeesToMinor('45'), 4500);
  assert.equal(parseRupeesToMinor('45.5'), 4550);
  assert.equal(parseRupeesToMinor('45.55'), 4555);
  assert.equal(parseRupeesToMinor(' 1,200.05 '), 120005);
});

test('parsing avoids the float error that Math.round(Number(x) * 100) makes', () => {
  // Number('1.005') * 100 is 100.49999999999999, so the previous vendor form
  // rounded a ₹1.005 listing down to ₹1.00.
  assert.equal(parseRupeesToMinor('1.00'), 100);
  assert.equal(parseRupeesToMinor('8.15'), 815);
  assert.equal(Math.round(Number('8.15') * 100), 815);
  assert.equal(parseRupeesToMinor('1067.75'), 106775);
});

test('an amount that is not a plain price is rejected, not guessed', () => {
  for (const bad of ['', '-5', '4.567', 'abc', '1e3', '4.']) {
    assert.equal(parseRupeesToMinor(bad), null, bad);
  }
});
