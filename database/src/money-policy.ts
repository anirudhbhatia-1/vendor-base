export const SYNTHETIC_FINANCIAL_POLICY = Object.freeze({
  currency: 'INR' as const,
  delivery_base_minor: 1_500,
  included_metres: 2_000,
  per_km_minor: 800,
  outer_route_metres: 40_000,
  settlement_delay_seconds: 86_400,
  vendor_fee_minor: 500,
  wait_cap_minor: 1_000,
  wait_included_seconds: 300,
  wait_per_completed_minute_minor: 100,
});

function safeInteger(value: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be a safe integer of at least ${minimum}`);
  }
  return value;
}

function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export function calculateDistanceAmount(routeMetres: number): number {
  safeInteger(routeMetres, 'route metres');
  if (routeMetres > SYNTHETIC_FINANCIAL_POLICY.outer_route_metres) {
    throw new RangeError('Route exceeds the synthetic financial-policy boundary');
  }
  const extraMetres = Math.max(0, routeMetres - SYNTHETIC_FINANCIAL_POLICY.included_metres);
  const extra = roundHalfUp(
    BigInt(extraMetres) * BigInt(SYNTHETIC_FINANCIAL_POLICY.per_km_minor),
    1_000n,
  );
  return safeInteger(
    SYNTHETIC_FINANCIAL_POLICY.delivery_base_minor + Number(extra),
    'distance amount',
  );
}

export function calculateWaitingAmount(waitSeconds: number): number {
  safeInteger(waitSeconds, 'wait seconds');
  const completedPaidMinutes = Math.max(
    0,
    Math.floor(waitSeconds / 60) -
      Math.floor(SYNTHETIC_FINANCIAL_POLICY.wait_included_seconds / 60),
  );
  return Math.min(
    completedPaidMinutes * SYNTHETIC_FINANCIAL_POLICY.wait_per_completed_minute_minor,
    SYNTHETIC_FINANCIAL_POLICY.wait_cap_minor,
  );
}

export function allocateMinorUnits(
  totalMinor: number,
  weights: readonly number[],
): readonly number[] {
  safeInteger(totalMinor, 'allocation total');
  if (weights.length === 0) throw new RangeError('Allocation requires at least one weight');
  weights.forEach((weight) => safeInteger(weight, 'allocation weight'));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  safeInteger(weightTotal, 'weight total', 1);
  const result = weights.map((weight) =>
    Number((BigInt(totalMinor) * BigInt(weight)) / BigInt(weightTotal)),
  );
  let remaining = totalMinor - result.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remaining > 0; index = (index + 1) % result.length) {
    result[index] = (result[index] ?? 0) + 1;
    remaining -= 1;
  }
  return Object.freeze(result);
}

export type FakeProviderScenario = 'DECLINE' | 'MALFORMED' | 'SUCCESS' | 'UNKNOWN';
export type FakeProviderOutcome = 'DECLINED' | 'SUCCEEDED' | 'UNKNOWN';

const OPERATION_PATTERN = /^SYNTH-(PAY|REF|PAYOUT)-[A-Z0-9-]{4,64}$/;

export class LocalFakeMoneyProvider {
  readonly #results = new Map<string, FakeProviderOutcome>();

  execute(input: {
    readonly amount_minor: number;
    readonly operation_reference: string;
    readonly scenario: FakeProviderScenario;
  }): FakeProviderOutcome {
    safeInteger(input.amount_minor, 'provider amount', 1);
    if (!OPERATION_PATTERN.test(input.operation_reference)) {
      throw new TypeError('Fake provider requires a marked synthetic operation reference');
    }
    const prior = this.#results.get(input.operation_reference);
    if (prior) return prior;
    if (input.scenario === 'MALFORMED') throw new Error('Synthetic malformed provider response');
    const outcome =
      input.scenario === 'SUCCESS'
        ? 'SUCCEEDED'
        : input.scenario === 'DECLINE'
          ? 'DECLINED'
          : 'UNKNOWN';
    this.#results.set(input.operation_reference, outcome);
    return outcome;
  }
}
