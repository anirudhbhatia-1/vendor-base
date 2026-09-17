import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIanaTimeZone,
  createOperatingTimeContext,
  createUtcInstant,
  instantEpochMilliseconds,
} from './time.js';

test('canonicalizes valid UTC instants and rejects timestamps without UTC context', () => {
  const instant = createUtcInstant('2026-08-20T10:15:30Z');
  assert.equal(instant, '2026-08-20T10:15:30.000Z');
  assert.equal(instantEpochMilliseconds(instant), Date.UTC(2026, 7, 20, 10, 15, 30));
  assert.throws(() => createUtcInstant('2026-08-20T10:15:30+05:30'), /ending in Z/);
  assert.throws(() => createUtcInstant('2026-02-31T10:15:30Z'), /invalid calendar/);
  assert.throws(() => createUtcInstant('not-a-date'), TypeError);
});

test('preserves a validated IANA operating timezone beside the UTC instant', () => {
  assert.deepEqual(createOperatingTimeContext('2026-08-20T10:15:30Z', 'Asia/Kolkata'), {
    instant: '2026-08-20T10:15:30.000Z',
    timezone: 'Asia/Kolkata',
  });
  assert.throws(() => createIanaTimeZone('Jaipur/Local'), /IANA timezone/);
});

test('createIanaTimeZone accepts named zones, including multi-part and alias names', () => {
  for (const zone of [
    'Asia/Kolkata',
    'America/Argentina/Buenos_Aires',
    'Europe/London',
    'Asia/Calcutta',
    'UTC',
  ]) {
    assert.equal(createIanaTimeZone(zone), zone);
  }
});

test('createIanaTimeZone refuses a fixed UTC offset that ECMA-402 would accept', () => {
  // `new Intl.DateTimeFormat('en', { timeZone: '+05:30' })` does not throw, so the Intl
  // probe alone let an offset through. An offset carries no daylight-saving rules, so a
  // vendor stored with one computes its own opening hours wrongly for half the year in
  // any zone that observes DST.
  for (const offset of ['+05:30', '-08:00', '+0530', '-8']) {
    assert.throws(() => createIanaTimeZone(offset), /not a fixed UTC offset/);
  }
});

test('createIanaTimeZone still refuses a zone that does not exist', () => {
  assert.throws(() => createIanaTimeZone('Mars/Olympus'), /valid IANA timezone name/);
});
