import type { Pool } from 'pg';
import type { FinancialPolicy } from './money-policy.js';
import { resolveConfiguration } from './versioned-configuration.js';

export class FinancialPolicyUnavailableError extends Error {
  readonly code = 'FINANCIAL_POLICY_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialPolicyUnavailableError';
  }
}

/** The configuration key the fee model is published under (0058). */
export const FINANCIAL_POLICY_KEY = 'finance.financial_policy';

export interface ResolvedFinancialPolicy {
  readonly policy: FinancialPolicy;
  /**
   * The reference stamped onto whatever this policy priced.
   *
   * Carries the version number so it reads, and the head of the version id so
   * it resolves to exactly one row. Shaped to satisfy the `SYNTH-POLICY-` form
   * the quote, allocation and settlement tables all require.
   */
  readonly version_reference: string;
}

const NUMERIC_FIELDS = [
  'commission_basis_points',
  'delivery_base_minor',
  'included_metres',
  'per_km_minor',
  'outer_route_metres',
  'settlement_delay_seconds',
  'partner_base_minor',
  'partner_per_km_minor',
  'partner_per_package_minor',
  'wait_cap_minor',
  'wait_included_seconds',
  'wait_per_completed_minute_minor',
] as const;

function readPolicy(value: unknown, reference: string): FinancialPolicy {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FinancialPolicyUnavailableError(`Financial policy ${reference} is not an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.currency !== 'INR') {
    throw new FinancialPolicyUnavailableError(`Financial policy ${reference} is not priced in INR`);
  }
  const policy: Record<string, unknown> = { currency: 'INR' };
  for (const field of NUMERIC_FIELDS) {
    const found = record[field];
    if (typeof found !== 'number' || !Number.isSafeInteger(found) || found < 0) {
      throw new FinancialPolicyUnavailableError(
        `Financial policy ${reference} is missing a whole-number ${field}`,
      );
    }
    policy[field] = found;
  }
  return Object.freeze(policy) as unknown as FinancialPolicy;
}

/**
 * The fee model in force at a given instant.
 *
 * Pass the moment the thing being priced was created, not the current time: a
 * settlement run today for an order quoted last week must divide the money by
 * last week's rules, which is the whole reason the policy is versioned (MKT-10).
 *
 * Deliberately throws rather than falling back to the compiled-in constant.
 * Pricing an order against numbers nobody reviewed is the failure this work
 * exists to remove, and a missing policy is a broken deployment rather than a
 * condition to paper over.
 */
export async function resolveFinancialPolicy(
  queryable: { query: Pool['query'] },
  input: { readonly at?: Date } = {},
): Promise<ResolvedFinancialPolicy> {
  const resolved = await resolveConfiguration(queryable, {
    configuration_key: FINANCIAL_POLICY_KEY,
    configuration_kind: 'SETTING',
    ...(input.at ? { at: input.at } : {}),
  });
  if (!resolved) {
    throw new FinancialPolicyUnavailableError(
      `No financial policy is active for ${FINANCIAL_POLICY_KEY}`,
    );
  }
  const head = String(resolved.configuration_version_id).replaceAll('-', '').slice(0, 8);
  const reference = `SYNTH-POLICY-FIN-V${resolved.version_number}-${head}`.toUpperCase();
  return Object.freeze({
    policy: readPolicy(resolved.configuration_value, reference),
    version_reference: reference,
  });
}
