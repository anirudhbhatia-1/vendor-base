import assert from 'node:assert/strict';
import test from 'node:test';
import { groupUnavailableSentence, lineStaleSentence } from './basket-copy.js';

const fallback = (_key: string, text: string) => text;

test('an invalid group is explained by its reason, and an unknown reason is still a problem', () => {
  assert.match(groupUnavailableSentence('STORE_CLOSED', fallback) ?? '', /closed.*Recheck later/);
  assert.match(groupUnavailableSentence('STORE_UNPUBLISHED', fallback) ?? '', /no longer listed/);
  assert.match(
    groupUnavailableSentence('ADDRESS_OUT_OF_ZONE', fallback) ?? '',
    /does not deliver to your current address.*Change the address/,
  );
  assert.match(groupUnavailableSentence('SOMETHING_NEW', fallback) ?? '', /cannot take this order/);
  assert.equal(groupUnavailableSentence(null, fallback), null);
});

test('a stale line is explained by its reason and a healthy line says nothing', () => {
  assert.match(lineStaleSentence('PRODUCT_NO_LONGER_ACTIVE', fallback) ?? '', /No longer sold/);
  assert.match(lineStaleSentence('PRICE_WITHDRAWN', fallback) ?? '', /not set a price/);
  assert.match(lineStaleSentence('AVAILABILITY_UNKNOWN', fallback) ?? '', /not confirmed whether/);
  assert.equal(lineStaleSentence(null, fallback), null);
});

test('the sentences are translated by key', () => {
  const hindi = (key: string, text: string) =>
    key === 'customer.cart.group.reason.store_closed' ? 'दुकान बंद है' : text;
  assert.equal(groupUnavailableSentence('STORE_CLOSED', hindi), 'दुकान बंद है');
});
