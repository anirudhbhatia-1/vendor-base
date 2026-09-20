/**
 * What a checkout group is, read off its children.
 *
 * A group owns nothing but its payment: PROCESSING while the provider is
 * asked, PAYMENT_UNKNOWN while it is awaited, CANCELLED when it declined or
 * was abandoned, ACTIVE once it authorised. Everything after that happens to
 * the vendor orders, each on its own path, and the group's state is a
 * summary of theirs -- derived at read time, never stored, never transitioned
 * (phases.md 7.7; prd.md: processing, partially accepted, active, partially
 * completed, completed, partially cancelled, cancelled). Until audit run 47
 * the stored payment state stood in for the summary everywhere the customer
 * looked, so a group of delivered orders read "In progress" forever, and the
 * one derivation that existed counted CANCELLED children only, so an order
 * the shop never answered (EXPIRED) left its group "In progress" too.
 */
export type CheckoutGroupSummaryState =
  | 'PROCESSING'
  | 'PAYMENT_UNKNOWN'
  | 'PARTIALLY_ACCEPTED'
  | 'ACTIVE'
  | 'PARTIALLY_COMPLETED'
  | 'COMPLETED'
  | 'PARTIALLY_CANCELLED'
  | 'CANCELLED';

/** One child order as the derivation reads it. */
export interface ChildOrderState {
  readonly lifecycle_state: string;
  /**
   * How the order reaches the customer. PICKED_UP is the end of a collected
   * order and the middle of a delivered one (the partner has it), so the
   * method decides what the state means.
   */
  readonly fulfilment_method: string | null;
}

/** A vendor order that ended without the goods reaching the customer. */
const ENDED_STATES: ReadonlySet<string> = new Set(['CANCELLED', 'EXPIRED', 'RETURNED']);

/** Whether an order finished with the goods handed to the customer. */
function isCompleted(order: ChildOrderState): boolean {
  if (order.lifecycle_state === 'DELIVERED') return true;
  return order.lifecycle_state === 'PICKED_UP' && order.fulfilment_method === 'CUSTOMER_PICKUP';
}

export function deriveCheckoutGroupState(input: {
  /** The group's own, stored, payment-level state. */
  readonly payment_state: string;
  /** Each child order, in any order. */
  readonly orders: readonly ChildOrderState[];
}): CheckoutGroupSummaryState {
  switch (input.payment_state) {
    case 'PROCESSING':
      return 'PROCESSING';
    case 'PAYMENT_UNKNOWN':
      return 'PAYMENT_UNKNOWN';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      break;
  }
  const orders = input.orders;
  if (orders.length === 0) return 'PROCESSING';
  const ended = orders.filter((order) => ENDED_STATES.has(order.lifecycle_state)).length;
  const completed = orders.filter(isCompleted).length;
  const placed = orders.filter((order) => order.lifecycle_state === 'PLACED').length;
  if (ended === orders.length) return 'CANCELLED';
  // Some of the basket will never arrive: that is what the customer needs
  // to know first, whatever the rest is doing.
  if (ended > 0) return 'PARTIALLY_CANCELLED';
  if (completed === orders.length) return 'COMPLETED';
  if (completed > 0) return 'PARTIALLY_COMPLETED';
  if (placed === orders.length) return 'PROCESSING';
  if (placed > 0) return 'PARTIALLY_ACCEPTED';
  return 'ACTIVE';
}
