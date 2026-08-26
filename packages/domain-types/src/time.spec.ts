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
