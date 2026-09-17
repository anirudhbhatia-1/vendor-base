/**
 * When a customer's order carries a code they can show, and what its state is
 * called on their screen.
 *
 * A pickup order is proven at the counter with a collection code (CUS-51),
 * available once the shop has packed it. A platform delivery is proven at the
 * door with a delivery code (CUS-56), available once a partner holds the goods
 * -- which on the vendor order is `PICKED_UP`, the state the server accepts a
 * delivery code in. The card used to wait for `OUT_FOR_DELIVERY`, a phrase from
 * the workflow that no order is ever in, so the button never appeared and no
 * delivery could be completed from the apps: the partner stood at the door
 * asking for a code the customer had no way to open.
 */
export type CodeKind = 'COLLECTION' | 'DELIVERY';

export function orderCodeAvailable(order: {
  readonly lifecycle_state: string;
  readonly fulfilment_method: string | null;
}): CodeKind | null {
  const state = order.lifecycle_state.toUpperCase();
  if (order.fulfilment_method === 'CUSTOMER_PICKUP') {
    return state === 'READY' ? 'COLLECTION' : null;
  }
  return state === 'PICKED_UP' ? 'DELIVERY' : null;
}

/**
 * `PICKED_UP` reads as "Collected" -- true of a pickup order, and wrong for a
 * delivery the customer is still waiting for. The shared vocabulary already
 * has the right word for that leg; this chooses it.
 */
export function displayedOrderState(order: {
  readonly lifecycle_state: string;
  readonly fulfilment_method: string | null;
}): string {
  const state = order.lifecycle_state.toUpperCase();
  if (state === 'PICKED_UP' && order.fulfilment_method !== 'CUSTOMER_PICKUP') {
    return 'OUT_FOR_DELIVERY';
  }
  return state;
}
