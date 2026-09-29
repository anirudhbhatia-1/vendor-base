import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupUnavailableSentence,
  lineStaleSentence,
  quoteBlockedSentence,
  quotePromiseSentence,
} from './basket-copy.js';

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

test('a blocked quote group is explained by its reason, and a new reason is still a problem', () => {
  assert.match(quoteBlockedSentence('STORE_UNAVAILABLE', fallback), /cannot take orders right now/);
  assert.match(
    quoteBlockedSentence('FULFILMENT_METHOD_UNAVAILABLE', fallback),
    /no longer offers the way/,
  );
  assert.match(quoteBlockedSentence('LINE_UNAVAILABLE', fallback), /no longer supply an item/);
  assert.match(quoteBlockedSentence('MINIMUM_NOT_MET', fallback), /under the store’s minimum/);
  assert.match(
    quoteBlockedSentence('CUSTOMER_RESTRICTED', fallback),
    /existing orders are not affected/,
  );
  assert.match(quoteBlockedSentence('INVENTORY_UNAVAILABLE', fallback), /not have enough/);
  assert.match(quoteBlockedSentence('INCIDENT_PAUSED', fallback), /paused for now/);
  assert.match(quoteBlockedSentence('SOMETHING_NEW', fallback), /cannot take this order/);
});

test('the promise is composed from the stored numbers, and an estimated road says so', () => {
  assert.equal(
    quotePromiseSentence(
      {
        fulfilment_method: 'CUSTOMER_PICKUP',
        ready_after_seconds: 900,
        arrives_after_seconds: null,
        route_metres: null,
        route_source: null,
      },
      fallback,
    ),
    'Ready in about 15 minutes.',
  );
  assert.equal(
    quotePromiseSentence(
      {
        fulfilment_method: 'PLATFORM_DELIVERY',
        ready_after_seconds: 900,
        arrives_after_seconds: 1_500,
        route_metres: 2_346,
        route_source: 'MAPBOX',
      },
      fallback,
    ),
    'Arrives in about 25–40 minutes, 2.3 km by road.',
  );
  assert.match(
    quotePromiseSentence(
      {
        fulfilment_method: 'VENDOR_DELIVERY',
        ready_after_seconds: 600,
        arrives_after_seconds: 1_200,
        route_metres: 1_950,
        route_source: 'ESTIMATE',
      },
      fallback,
    ),
    /Arrives in about 20–35 minutes, 1\.9 km by road\. The road is estimated\./,
  );
});
