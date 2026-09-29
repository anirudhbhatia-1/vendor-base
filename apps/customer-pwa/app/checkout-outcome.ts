import {
  ApiError,
  type CheckoutGroupQuote,
  type CheckoutQuote,
  type DecisionRule,
} from '@neighbourhood-store/contracts';

type Translate = (key: string, fallback: string) => string;

/**
 * What a placement that did not come back "placed" means for the screen.
 *
 * A decline, a lapsed quote and a changed basket are the checkout's own
 * answers, each with a code (0088), and each has its own way forward. An
 * answer that never arrived -- the connection dropped, the API was
 * unavailable, the request was rate-limited -- is not a refusal: the order
 * may well have been placed, and the only safe move is to ask again with the
 * same idempotency key, which the server answers with the same result. The
 * screen used to treat every failure alike, with a "Try again" that fetched
 * a fresh quote -- so an order whose confirmation was lost was followed by a
 * second basket, and a declined customer read a sentence written for a shop.
 */
export type PlacementFailure =
  | { readonly kind: 'declined' }
  | { readonly kind: 'quote_expired' }
  | { readonly kind: 'quote_changed' }
  | { readonly kind: 'paused'; readonly pause: PausedCheckout }
  | { readonly kind: 'interrupted'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

/** What operations have paused that stops this checkout (11.7). */
export type PausedCheckout = 'GROUPED' | 'PAYMENT';

export function pausedCheckout(cause: unknown): PausedCheckout | null {
  if (!(cause instanceof ApiError)) return null;
  return cause.code === 'GROUPED_CHECKOUT_PAUSED'
    ? 'GROUPED'
    : cause.code === 'PAYMENT_PAUSED'
      ? 'PAYMENT'
      : null;
}

/** The way forward each pause leaves: one shop at a time, or another way to pay. */
export function pausedSentence(pause: PausedCheckout, t: Translate): string {
  return pause === 'GROUPED'
    ? t(
        'checkout.grouped_checkout_paused',
        'Ordering from more than one store at once is paused for now. Check out one store at a time.',
      )
    : t(
        'checkout.payment_paused',
        'This way of paying is paused for now. Choose another, or try again later.',
      );
}

export function classifyPlacementFailure(cause: unknown): PlacementFailure {
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case 'PAYMENT_DECLINED':
        return { kind: 'declined' };
      case 'QUOTE_EXPIRED':
        return { kind: 'quote_expired' };
      case 'QUOTE_CHANGED':
        return { kind: 'quote_changed' };
      case 'GROUPED_CHECKOUT_PAUSED':
        return { kind: 'paused', pause: 'GROUPED' };
      case 'PAYMENT_PAUSED':
        return { kind: 'paused', pause: 'PAYMENT' };
      default:
        break;
    }
    // A definitive refusal is a 4xx other than the two that mean "not now":
    // 408 is the request that never arrived, 429 the one asked to wait.
    if (cause.status >= 400 && cause.status < 500 && cause.status !== 408 && cause.status !== 429)
      return { kind: 'refused', message: cause.message };
    return { kind: 'interrupted', message: cause.message };
  }
  return {
    kind: 'interrupted',
    message: cause instanceof Error ? cause.message : 'The connection dropped.',
  };
}

/** The rule the group's order proceeds under, in words. */
export function decisionRuleSentence(rule: DecisionRule, t: Translate): string {
  switch (rule) {
    case 'ASK_CUSTOMER':
      return t('customer.quote.decision.ask_customer', 'the store asks you before replacing it');
    case 'ALLOW_SAME_STORE':
      return t('customer.quote.decision.allow_same_store', 'the store may choose a close match');
    case 'NO_SUBSTITUTION':
      return t('customer.quote.decision.no_substitution', 'it is refunded, never replaced');
    case 'MIXED':
      return t('customer.quote.decision.mixed', 'each item follows the rule you set for it');
  }
}

/** How the store gets the group's order to the customer, in words. */
export function fulfilmentSentence(method: CheckoutGroupQuote['fulfilment_method'], t: Translate) {
  switch (method) {
    case 'CUSTOMER_PICKUP':
      return t('customer.fulfilment.customer_pickup', 'I will collect it');
    case 'PLATFORM_DELIVERY':
      return t('customer.fulfilment.platform_delivery', 'Delivery partner brings it');
    case 'VENDOR_DELIVERY':
      return t('customer.fulfilment.vendor_delivery', 'The store delivers it');
    default:
      return method;
  }
}

/**
 * What the authorised amount includes beyond the quoted total. A buffer is
 * explained; the absence of one is said too, because "You authorise ₹349"
 * with nothing under it left the customer to wonder what else might be held.
 */
export function bufferSentence(
  quote: Pick<CheckoutQuote, 'authorization_buffer_minor'>,
  formatMoney: (minor: number) => string,
  t: Translate,
): string {
  if (quote.authorization_buffer_minor > 0)
    return `${t('customer.quote.buffer', 'Includes a buffer of')} ${formatMoney(
      quote.authorization_buffer_minor,
    )} ${t(
      'customer.quote.buffer.detail',
      'for loose items weighed at the shop. Anything unused is released.',
    )}`;
  return t(
    'customer.quote.no_buffer',
    'No buffer is added: this is exactly the amount your bank is asked to hold.',
  );
}
