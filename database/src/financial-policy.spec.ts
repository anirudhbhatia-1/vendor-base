import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { FinancialPolicyUnavailableError, resolveFinancialPolicy } from './financial-policy.js';
import { SYNTHETIC_FINANCIAL_POLICY } from './money-policy.js';

/**
 * The policy is read from versioned configuration; these tests hand the
 * resolver a queryable that answers with one row, so the reader's refusals
 * (7.1 requirement 4: unsupported currency) are proven without a database.
 */
function queryable(row: Record<string, unknown> | null): { query: Pool['query'] } {
  return {
    query: (async () => ({
      rows: row ? [row] : [],
      rowCount: row ? 1 : 0,
    })) as unknown as Pool['query'],
  };
}

function activeRow(value: unknown) {
  return {
    configuration_version_id: '019930aa-1234-7abc-8def-0123456789ab',
    configuration_key: 'finance.financial_policy',
    version_number: 3,
    configuration_kind: 'SETTING',
    value_type: 'JSON',
    configuration_value: value,
    scope_kind: 'GLOBAL',
    scope_reference: 'global',
    status: 'ACTIVE',
    rollback_of_version_id: null,
    effective_from: new Date('2026-08-01T00:00:00.000Z'),
    effective_until: null,
  };
}

test('an active INR policy resolves with a reference that names its version and row', async () => {
  const resolved = await resolveFinancialPolicy(queryable(activeRow(SYNTHETIC_FINANCIAL_POLICY)));
  assert.equal(resolved.version_reference, 'SYNTH-POLICY-FIN-V3-019930AA');
  assert.equal(resolved.policy.delivery_base_minor, 1_500);
  assert.equal(resolved.policy.currency, 'INR');
});

test('a policy in any currency but INR is refused, not priced as rupees', async () => {
  await assert.rejects(
    () =>
      resolveFinancialPolicy(
        queryable(activeRow({ ...SYNTHETIC_FINANCIAL_POLICY, currency: 'USD' })),
      ),
    (error: unknown) =>
      error instanceof FinancialPolicyUnavailableError && /not priced in INR/.test(error.message),
  );
});

test('a policy missing a field, or carrying a fraction or a negative, is refused', async () => {
  const { per_km_minor: _dropped, ...missing } = SYNTHETIC_FINANCIAL_POLICY;
  void _dropped;
  await assert.rejects(
    () => resolveFinancialPolicy(queryable(activeRow(missing))),
    /whole-number per_km_minor/,
  );
  await assert.rejects(
    () =>
      resolveFinancialPolicy(
        queryable(activeRow({ ...SYNTHETIC_FINANCIAL_POLICY, delivery_base_minor: 15.5 })),
      ),
    /whole-number delivery_base_minor/,
  );
  await assert.rejects(
    () =>
      resolveFinancialPolicy(
        queryable(activeRow({ ...SYNTHETIC_FINANCIAL_POLICY, included_metres: -1 })),
      ),
    /whole-number included_metres/,
  );
});

test('no policy in force is a refusal, never a fallback to the compiled-in constant', async () => {
  await assert.rejects(
    () => resolveFinancialPolicy(queryable(null)),
    (error: unknown) =>
      error instanceof FinancialPolicyUnavailableError &&
      /No financial policy is active/.test(error.message),
  );
});
