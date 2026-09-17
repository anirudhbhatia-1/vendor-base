import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deliveryProofAllowed,
  offerIsCurrent,
  transitionCommandReference,
} from './job-action-policy';

test('an emergency hold prevents delivery proof even after arrival', () => {
  assert.equal(deliveryProofAllowed('ARRIVED', true), false);
  assert.equal(deliveryProofAllowed('ARRIVED', false), true);
  for (const state of ['ASSIGNED', 'AT_VENDOR', 'DELIVERED', 'RETURNING']) {
    assert.equal(deliveryProofAllowed(state, false), false);
  }
});
test('accept requires a valid future server deadline', () => {
  const now = Date.parse('2026-09-07T12:00:00Z');
  assert.equal(offerIsCurrent('2026-09-07T12:00:01Z', now), true);
  for (const expiry of [null, 'invalid', '2026-09-07T12:00:00Z', '2026-09-07T11:59:00Z']) {
    assert.equal(offerIsCurrent(expiry, now), false);
  }
});

test('every step the console can send produces a command reference the schema accepts', () => {
  // `assignment_event_command_shape`, migration 0014. Mirrored here because the
  // console cannot import the database package; if the constraint changes, this
  // is the test that has to change with it.
  const schema = /^SYNTH-CMD-[A-Z0-9-]{4,64}$/;
  const at = Date.parse('2026-09-14T12:19:07.790Z');
  for (const action of [
    'accept',
    'decline',
    'arrive-vendor',
    'pickup',
    'begin-route',
    'arrive-customer',
    'deliver',
    'fail',
    'require-return',
    'begin-return',
    'complete-return',
  ]) {
    const reference = transitionCommandReference(action, at);
    assert.match(reference, schema, `${action} -> ${reference}`);
  }
  // The shape that failed in the field: an underscore where the route's hyphen was.
  assert.doesNotMatch('SYNTH-CMD-ARRIVE_VENDOR-MFXQ1', schema);
  // Distinct steps stay distinct references, so a replay of one is not a replay of another.
  assert.notEqual(
    transitionCommandReference('arrive-vendor', at),
    transitionCommandReference('arrive-customer', at),
  );
});
