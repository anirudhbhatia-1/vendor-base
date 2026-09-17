import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMERGENCY_KINDS, PARTNER_SELF_RESOLUTIONS } from './partner-field-ops.js';

test('a partner may only record what they did, never direct the delivery', () => {
  // Returning, cancelling and reassigning move custody and money. The workflow
  // places those with operations (§8.2.2, §11), and the UI used to offer all
  // six to the partner — so someone at an unsafe address could close their own
  // exception as CANCEL, ending an order with no operations decision anywhere.
  assert.deepEqual([...PARTNER_SELF_RESOLUTIONS].sort(), ['CONTINUE', 'RETRY', 'SUPPORT']);
  for (const directed of ['RETURN_TO_VENDOR', 'CANCEL', 'REASSIGN']) {
    assert.ok(
      !PARTNER_SELF_RESOLUTIONS.has(directed as never),
      `${directed} is an operations decision`,
    );
  }
});

test('OPEN is never a resolution a partner can record', () => {
  // OPEN means "still needs guidance"; recording it as an outcome would close
  // nothing while looking like it had.
  assert.ok(!PARTNER_SELF_RESOLUTIONS.has('OPEN' as never));
});

test('emergencies stay a separate set from routine exceptions', () => {
  assert.deepEqual([...EMERGENCY_KINDS].sort(), ['ACCIDENT', 'MEDICAL_EMERGENCY', 'THREAT']);
  // An emergency must not be reachable only through the generic support bucket.
  assert.ok(!EMERGENCY_KINDS.has('VENDOR_DELAY' as never));
});
