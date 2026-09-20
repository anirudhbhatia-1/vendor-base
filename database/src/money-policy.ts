import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Every fee the platform charges or pays, as one reviewed object.
 *
 * Held in versioned configuration under `finance.financial_policy` (0058) and
 * resolved per priced order, so an order settles under the rules it was quoted
 * against rather than under today's. The constant below is the shape's initial
 * value and the shipped default, not the source of truth.
 */
export interface FinancialPolicy {
  readonly currency: 'INR';
  /** Vendor commission as basis points of the supplied item total. */
  readonly commission_basis_points: number;
  readonly delivery_base_minor: number;
  readonly included_metres: number;
  readonly per_km_minor: number;
  readonly outer_route_metres: number;
  readonly settlement_delay_seconds: number;
  readonly partner_base_minor: number;
  readonly partner_per_km_minor: number;
  readonly partner_per_package_minor: number;
  readonly wait_cap_minor: number;
  readonly wait_included_seconds: number;
  readonly wait_per_completed_minute_minor: number;
}

export const SYNTHETIC_FINANCIAL_POLICY: FinancialPolicy = Object.freeze({
  currency: 'INR' as const,
  delivery_base_minor: 1_500,
  included_metres: 2_000,
  per_km_minor: 800,
  outer_route_metres: 40_000,
  settlement_delay_seconds: 86_400,
  /**
   * Vendor commission, in basis points of the supplied item total.
   *
   * Was a flat 500 minor units per completed order, which charged the same
   * rupees on a ₹50 basket as on a ₹5,000 one. 500 basis points is what that
   * flat fee already worked out to on the ₹100 basket this platform is built
   * around, so the number is unchanged where it was calibrated and now scales
   * with the sale everywhere else.
   */
  commission_basis_points: 500,
  /**
   * Partner offer earning (DLP-48).
   *
   * Nothing in the platform computed an expected earning, so an offer card had
   * nothing truthful to show and a partner accepted work without knowing what
   * it paid. These are the synthetic pilot figures, versioned with the rest of
   * the financial policy so a change is a change to one reviewed place — and so
   * the number shown before acceptance is the number the earning record is
   * later built from (§12.2: a displayed job earning is preserved after
   * acceptance except by an auditable adjustment).
   */
  partner_base_minor: 2_000,
  partner_per_km_minor: 600,
  partner_per_package_minor: 200,
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

/**
 * Rounds a non-negative rational to the nearest whole minor unit, halves upward.
 *
 * Negatives are refused rather than rounded. BigInt division truncates toward zero,
 * so the bias term that makes this correct for positives is wrong for negatives by a
 * whole unit, not merely at the tie: -1.4 came out as 0 and -1.6 as -1. Both callers
 * already guarantee non-negative inputs through `safeInteger(..., 0)`, so nothing
 * reaches this today — but the alternative to refusing is picking a rounding
 * convention for negative money, and which way a refund rounds is a financial policy
 * decision with an owner, not something to settle in a helper.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError('Rounding denominator must be positive');
  }
  if (numerator < 0n) {
    throw new RangeError(
      'roundHalfUp is defined for non-negative amounts only; rounding negative money needs an approved convention',
    );
  }
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export function calculateDistanceAmount(
  routeMetres: number,
  policy: FinancialPolicy = SYNTHETIC_FINANCIAL_POLICY,
): number {
  safeInteger(routeMetres, 'route metres');
  if (routeMetres > policy.outer_route_metres) {
    throw new RangeError('Route exceeds the financial-policy boundary');
  }
  const extraMetres = Math.max(0, routeMetres - policy.included_metres);
  const extra = roundHalfUp(BigInt(extraMetres) * BigInt(policy.per_km_minor), 1_000n);
  return safeInteger(policy.delivery_base_minor + Number(extra), 'distance amount');
}

/**
 * The platform's commission on an order, in whole minor units.
 *
 * Integer arithmetic throughout, rounded half up by the same helper the
 * distance fee uses, so a rate can never introduce a fraction of a paisa.
 */
export function calculateCommissionAmount(itemTotalMinor: number, basisPoints: number): number {
  safeInteger(itemTotalMinor, 'item total');
  safeInteger(basisPoints, 'commission basis points');
  const commission = roundHalfUp(BigInt(itemTotalMinor) * BigInt(basisPoints), 10_000n);
  return safeInteger(Math.min(Number(commission), itemTotalMinor), 'commission amount');
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

/** One instruction to the provider: how much, under which reference. */
export interface ProviderOperationInput {
  readonly amount_minor: number;
  readonly operation_reference: string;
  /**
   * The synthetic steering recorded on the transaction. A real adapter
   * ignores it; the fake answers from it. It travels on the port so the
   * answer is decided by the record, not by the caller's mood.
   */
  readonly scenario: FakeProviderScenario;
}

/**
 * The provider-neutral money port (7.4). Every operation is asynchronous
 * because a real provider is a network away; every answer is one of three
 * words, because that is all the ledger can act on: the provider said yes,
 * the provider said no, or the provider did not say. A malformed response,
 * a timeout or a dropped connection is a thrown error, and `providerOutcome`
 * turns it into UNKNOWN for the caller -- money may have moved, and the only
 * honest state is "ask again", never "declined".
 */
export interface MoneyProviderAdapter {
  authorize(input: ProviderOperationInput): Promise<FakeProviderOutcome>;
  capture(input: ProviderOperationInput): Promise<FakeProviderOutcome>;
  /** Releases an authorisation that will not be captured. */
  void(input: ProviderOperationInput): Promise<FakeProviderOutcome>;
  refund(input: ProviderOperationInput): Promise<FakeProviderOutcome>;
  submitPayout(input: ProviderOperationInput): Promise<FakeProviderOutcome>;
  clearingAccountReference(): string;
  verifyWebhook(input: { readonly payload: string; readonly signature: string }): boolean;
  status(operation_reference: string): Promise<FakeProviderOutcome | undefined>;
}

/**
 * Asks the provider and answers UNKNOWN when it did not answer. Used at every
 * call site so that a thrown error -- the fake's MALFORMED, a real adapter's
 * timeout or parse failure -- is never mistaken for a decline and never
 * escapes the transaction with the in-flight record rolled back.
 */
export async function providerOutcome(
  ask: () => Promise<FakeProviderOutcome>,
): Promise<FakeProviderOutcome> {
  try {
    return await ask();
  } catch {
    return 'UNKNOWN';
  }
}

const OPERATION_PATTERN = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const ACCOUNT_PATTERN = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;

export class LocalFakeMoneyProvider implements MoneyProviderAdapter {
  readonly #results = new Map<string, FakeProviderOutcome>();
  readonly #clearingAccountReference: string;
  readonly #webhookKey: string;

  constructor(
    input: {
      readonly clearing_account_reference?: string;
      readonly webhook_key?: string;
    } = {},
  ) {
    // Must name an account that exists in the chart of accounts seeded by
    // 0028; a payout posting foreign-keys to it. The previous default named
    // an account that was never in the chart, so every payout ledger posting
    // failed on the foreign key.
    this.#clearingAccountReference =
      input.clearing_account_reference ?? 'SYNTH-ACCOUNT-FAKE-PROVIDER';
    this.#webhookKey = input.webhook_key ?? 'local-synthetic-payment-webhook-key-material';
    if (!ACCOUNT_PATTERN.test(this.#clearingAccountReference)) {
      throw new TypeError('Provider clearing account reference is invalid');
    }
    if (this.#webhookKey.length < 32) {
      throw new TypeError('Provider webhook verification key must contain at least 32 characters');
    }
  }

  execute(input: ProviderOperationInput): FakeProviderOutcome {
    safeInteger(input.amount_minor, 'provider amount', 1);
    if (!OPERATION_PATTERN.test(input.operation_reference)) {
      throw new TypeError('Provider operation reference is invalid');
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

  async authorize(input: ProviderOperationInput): Promise<FakeProviderOutcome> {
    return this.execute(input);
  }

  /**
   * Deterministic from the scenario, like every other operation on this port.
   *
   * It used to answer only from this instance's in-memory record of a previous
   * authorize, and return UNKNOWN when it found nothing. Authorization happens
   * in the checkout service and capture in the money service — two instances,
   * two empty maps — so a capture could never succeed outside a single process,
   * and every captured payment landed in UNKNOWN_REQUIRES_RECONCILIATION.
   */
  async capture(input: ProviderOperationInput): Promise<FakeProviderOutcome> {
    return this.execute(input);
  }

  async void(input: ProviderOperationInput): Promise<FakeProviderOutcome> {
    return this.execute(input);
  }

  async refund(input: ProviderOperationInput): Promise<FakeProviderOutcome> {
    return this.execute(input);
  }

  async submitPayout(input: ProviderOperationInput): Promise<FakeProviderOutcome> {
    return this.execute(input);
  }

  clearingAccountReference(): string {
    return this.#clearingAccountReference;
  }

  verifyWebhook(input: { readonly payload: string; readonly signature: string }): boolean {
    if (!/^[a-f0-9]{64}$/i.test(input.signature)) return false;
    const expected = createHmac('sha256', this.#webhookKey).update(input.payload).digest();
    const supplied = Buffer.from(input.signature, 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  async status(operation_reference: string): Promise<FakeProviderOutcome | undefined> {
    return this.#results.get(operation_reference);
  }
}

/**
 * What a partner is told an offer pays, before they accept it (DLP-48).
 *
 * A base, a distance component over the whole route, and a small per-package
 * amount beyond the first — the same integer arithmetic as every other money
 * calculation here, with the division done in `bigint` so no rupee is invented
 * by a float.
 *
 * This is the expected amount only. Waiting pay, return pay, incentives and
 * tips are added by the earning record from what actually happened.
 */
export function calculatePartnerOfferEarning(
  input: {
    readonly route_metres: number;
    readonly package_count: number;
  },
  policy: FinancialPolicy = SYNTHETIC_FINANCIAL_POLICY,
): { readonly base_minor: number; readonly distance_minor: number; readonly total_minor: number } {
  safeInteger(input.route_metres, 'route metres');
  safeInteger(input.package_count, 'package count', 1);
  if (input.route_metres > policy.outer_route_metres) {
    throw new RangeError('Route exceeds the financial-policy boundary');
  }
  const distance = Number(
    roundHalfUp(BigInt(input.route_metres) * BigInt(policy.partner_per_km_minor), 1_000n),
  );
  const packages = (input.package_count - 1) * policy.partner_per_package_minor;
  const base = policy.partner_base_minor + packages;
  return Object.freeze({
    base_minor: safeInteger(base, 'partner base'),
    distance_minor: safeInteger(distance, 'partner distance'),
    total_minor: safeInteger(base + distance, 'partner offer earning'),
  });
}
