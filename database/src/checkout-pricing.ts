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
  readonly policy_version_reference: 'SYNTH-POLICY-D05-LOCAL-V1';
  readonly total_minor: number;
}

function minor(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
    throw new RangeError(`${label} must be a non-negative safe INR minor-unit amount`);
  }
  return value;
}

export function calculateCheckoutPricing(
  input: readonly CheckoutPricingGroupInput[],
): CheckoutPricingResult {
  if (input.length < 1 || input.length > 3)
    throw new RangeError('Checkout requires one to three groups');
  const groups = input.map((group) => {
    if (!group.vendor_location_id) throw new TypeError('Vendor location is required');
    const itemSubtotal = minor(group.item_subtotal_minor, 'Item subtotal');
    const tip = minor(group.tip_minor, 'Tip');
    const delivery = calculateDistanceAmount(group.route_metres);
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
    policy_version_reference: 'SYNTH-POLICY-D05-LOCAL-V1',
    total_minor: minor(
      groups.reduce((sum, group) => sum + group.total_minor, 0),
      'Checkout total',
    ),
  });
}
