import type { ResolvedFinancialPolicy } from './financial-policy.js';
import { calculateDistanceAmount } from './money-policy.js';

export interface CheckoutPricingGroupInput {
  readonly item_subtotal_minor: number;
  readonly route_metres: number;
  readonly tip_minor: number;
  readonly vendor_location_id: string;
}

export interface CheckoutPricingGroup {
  readonly delivery_minor: number;
  readonly discount_minor: 0;
  readonly item_subtotal_minor: number;
  readonly tax_minor: 0;
  readonly tip_minor: number;
  readonly total_minor: number;
  readonly vendor_location_id: string;
}

export interface CheckoutPricingResult {
  readonly authorization_buffer_minor: 0;
  readonly currency: 'INR';
  readonly groups: readonly CheckoutPricingGroup[];
  /** The exact policy version that priced this quote, stamped onto the order. */
  readonly policy_version_reference: string;
  readonly total_minor: number;
}

function minor(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
    throw new RangeError(`${label} must be a non-negative safe INR minor-unit amount`);
  }
  return value;
}

/**
 * Prices a checkout against a policy the caller resolved.
 *
 * Still a pure function of its arguments — the policy arrives as one, rather
 * than being read from a module-level constant, so an order can be priced under
 * the rules in force when it was quoted and re-priced under none other.
 */
export function calculateCheckoutPricing(
  input: readonly CheckoutPricingGroupInput[],
  resolved: ResolvedFinancialPolicy,
): CheckoutPricingResult {
  if (input.length < 1 || input.length > 3)
    throw new RangeError('Checkout requires one to three groups');
  const groups = input.map((group) => {
    if (!group.vendor_location_id) throw new TypeError('Vendor location is required');
    const itemSubtotal = minor(group.item_subtotal_minor, 'Item subtotal');
    const tip = minor(group.tip_minor, 'Tip');
    const delivery = calculateDistanceAmount(group.route_metres, resolved.policy);
    const total = minor(itemSubtotal + delivery + tip, 'Group total');
    return Object.freeze({
      delivery_minor: delivery,
      discount_minor: 0 as const,
      item_subtotal_minor: itemSubtotal,
      tax_minor: 0 as const,
      tip_minor: tip,
      total_minor: total,
      vendor_location_id: group.vendor_location_id,
    });
  });
  return Object.freeze({
    authorization_buffer_minor: 0,
    currency: 'INR',
    groups: Object.freeze(groups),
    policy_version_reference: resolved.version_reference,
    total_minor: minor(
      groups.reduce((sum, group) => sum + group.total_minor, 0),
      'Checkout total',
    ),
  });
}
