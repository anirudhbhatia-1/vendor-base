import { calculateCommissionAmount } from './money-policy.js';

/**
 * How one vendor order's money divides, as a pure function (10.3).
 *
 * Settlement creation and the re-division a later refund triggers used to
 * carry two copies of this arithmetic with different inputs: creation took the
 * whole refund (delivery fee and tip included) off the shop's goods, while the
 * re-division took only the goods' part, re-read the commission rate from the
 * policy in force when the settlement was written rather than the one the
 * order was quoted under, and charged commission on orders that had been
 * settled without it. Both now ask this function for the division that should
 * stand, and the re-division posts only the difference.
 */
export type OrderDivisionInput = {
  /** What the customer paid for this order: its allocation of the capture. */
  readonly captured_minor: number;
  /** Every refund on the order that has succeeded, in total. */
  readonly refunds_minor: number;
  /** The shop's goods as sold, before any return. */
  readonly goods_minor: number;
  /** The goods' share of those refunds: what came back to the shelf. */
  readonly goods_refunds_minor: number;
  /** What the delivery partner is owed for this order. */
  readonly partner_payable_minor: number;
  /** The commission rate of the policy the order was quoted under. */
  readonly commission_basis_points: number;
  /** A completed order pays commission; a failed or cancelled one does not. */
  readonly fee_applies: boolean;
};

export type OrderDivision = {
  readonly customer_net_minor: number;
  readonly remaining_goods_minor: number;
  readonly vendor_fee_minor: number;
  readonly vendor_payable_minor: number;
  readonly partner_payable_minor: number;
  /** May be negative: the platform then subsidises the order. */
  readonly platform_remainder_minor: number;
};

export class OrderDivisionError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}

function paise(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OrderDivisionError(`${label} must be non-negative integer paise`);
  }
  return value;
}

export function divideOrder(input: OrderDivisionInput): OrderDivision {
  const captured = paise(input.captured_minor, 'Captured amount');
  const refunds = paise(input.refunds_minor, 'Refunds');
  const goods = paise(input.goods_minor, 'Goods');
  const goodsRefunds = paise(input.goods_refunds_minor, 'Goods refunds');
  const partner = paise(input.partner_payable_minor, 'Partner payable');
  if (goodsRefunds > refunds) {
    throw new OrderDivisionError('The goods refunded cannot exceed the refunds');
  }
  if (refunds > captured) {
    throw new OrderDivisionError('Refunds cannot exceed what the customer paid');
  }
  const customerNet = captured - refunds;
  const remainingGoods = Math.max(0, goods - goodsRefunds);
  // Commission is a rate on what the shop actually supplied, so a returned
  // pack takes its share of the fee with it.
  const fee =
    input.fee_applies && remainingGoods > 0
      ? calculateCommissionAmount(remainingGoods, input.commission_basis_points)
      : 0;
  const vendorPayable = remainingGoods - fee;
  return Object.freeze({
    customer_net_minor: customerNet,
    remaining_goods_minor: remainingGoods,
    vendor_fee_minor: fee,
    vendor_payable_minor: vendorPayable,
    partner_payable_minor: partner,
    platform_remainder_minor: customerNet - vendorPayable - partner,
  });
}
