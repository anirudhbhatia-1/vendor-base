type Translate = (key: string, fallback: string) => string;

/**
 * What the basket says about a store group it cannot order from, by the
 * reason revalidation recorded. Each sentence names the way out the reason
 * allows: a closed store may reopen, an unlisted one will not, and an
 * out-of-zone address is the customer's to change.
 */
export function groupUnavailableSentence(reason: string | null, t: Translate): string | null {
  switch (reason) {
    case 'STORE_CLOSED':
      return t(
        'customer.cart.group.reason.store_closed',
        'The store is closed. Recheck later, or remove it from your basket.',
      );
    case 'STORE_UNPUBLISHED':
      return t(
        'customer.cart.group.reason.store_unpublished',
        'The store is no longer listed. Remove it from your basket.',
      );
    case 'ADDRESS_OUT_OF_ZONE':
      return t(
        'customer.cart.group.reason.address_out_of_zone',
        'The store does not deliver to your current address. Change the address, or remove the store.',
      );
    case null:
      return null;
    default:
      // A reason this build does not know still has to be shown as a problem,
      // never as a healthy group.
      return t('customer.cart.group.unavailable', 'This store cannot take this order right now');
  }
}

/** What the basket says about a line the quote would otherwise drop silently. */
export function lineStaleSentence(reason: string | null, t: Translate): string | null {
  switch (reason) {
    case 'PRODUCT_NO_LONGER_ACTIVE':
      return t(
        'customer.cart.line.stale.product_no_longer_active',
        'No longer sold by this store.',
      );
    case 'PRICE_WITHDRAWN':
      return t(
        'customer.cart.line.stale.price_withdrawn',
        'This store has not set a price for it.',
      );
    case 'AVAILABILITY_UNKNOWN':
      return t(
        'customer.cart.line.stale.availability_unknown',
        'The store has not confirmed whether it has this.',
      );
    case null:
      return null;
    default:
      return t(
        'customer.cart.line.stale.product_no_longer_active',
        'No longer sold by this store.',
      );
  }
}

/**
 * What the quote says about a store group it could not carry, by the reason
 * the server returned. The quote used to print the code in lower case; the
 * reason is the thing the customer can act on.
 */
export function quoteBlockedSentence(reason: string, t: Translate): string {
  switch (reason) {
    case 'STORE_UNAVAILABLE':
      return t(
        'customer.quote.blocked.store_unavailable',
        'The store cannot take orders right now, or does not deliver to this address.',
      );
    case 'FULFILMENT_METHOD_UNAVAILABLE':
      return t(
        'customer.quote.blocked.fulfilment_method_unavailable',
        'The store no longer offers the way you chose to receive this order. Pick another in your basket.',
      );
    case 'LINE_UNAVAILABLE':
      return t(
        'customer.quote.blocked.line_unavailable',
        'The store can no longer supply an item in this group. Recheck your basket and remove it.',
      );
    case 'MINIMUM_NOT_MET':
      return t(
        'customer.quote.blocked.minimum_not_met',
        'This group is under the store’s minimum order. Add a little more.',
      );
    case 'INVENTORY_UNAVAILABLE':
      return t(
        'customer.quote.blocked.inventory_unavailable',
        'The store does not have enough of something in this group. Lower the quantity or remove it.',
      );
    default:
      return t('customer.quote.blocked.other', 'This store cannot take this order right now.');
  }
}
