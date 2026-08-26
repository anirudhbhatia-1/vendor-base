import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defineAggregatePolicy, type AggregatePolicy } from './aggregate-versioning.js';

function policy(overrides: Partial<AggregatePolicy> = {}): AggregatePolicy {
  return {
    aggregate_type: 'synthetic_order',
    creation: {
      allowed_actor_kinds: ['customer'],
      allowed_initial_states: ['PLACED'],
      reason: 'forbidden',
      required_evidence: ['checkout_reference'],
    },
    states: ['PLACED', 'ACCEPTED', 'CANCELLED'],
    transitions: [
      {
        allowed_actor_kinds: ['vendor_staff'],
        from_state: 'PLACED',
        reason: 'optional',
        required_evidence: ['vendor_location_id'],
        to_state: 'ACCEPTED',
      },
    ],
    ...overrides,
  };
}

describe('aggregate policy definition', () => {
  it('returns an immutable validated policy', () => {
    const defined = defineAggregatePolicy(policy());
    assert.equal(defined.aggregate_type, 'synthetic_order');
    assert.ok(Object.isFrozen(defined));
    assert.ok(Object.isFrozen(defined.creation));
    assert.ok(Object.isFrozen(defined.transitions));
    assert.ok(Object.isFrozen(defined.transitions[0]));
  });

  it('rejects undeclared and duplicate transition states', () => {
    assert.throws(
      () =>
        defineAggregatePolicy(
          policy({
            transitions: [
              {
                allowed_actor_kinds: ['admin'],
                from_state: 'PLACED',
                reason: 'required',
                required_evidence: [],
                to_state: 'UNKNOWN',
              },
            ],
          }),
        ),
      /belong to the aggregate policy/,
    );
    assert.throws(
      () => defineAggregatePolicy(policy({ states: ['PLACED', 'PLACED'] })),
      /non-empty and unique/,
    );
  });

  it('rejects unsafe policy identifiers and empty actor policy', () => {
    assert.throws(
      () => defineAggregatePolicy(policy({ aggregate_type: 'Synthetic Order' })),
      /Aggregate type is invalid/,
    );
    assert.throws(
      () =>
        defineAggregatePolicy(
          policy({
            creation: {
              allowed_actor_kinds: [],
              allowed_initial_states: ['PLACED'],
              reason: 'forbidden',
              required_evidence: [],
            },
          }),
        ),
      /at least one actor kind/,
    );
  });
});
