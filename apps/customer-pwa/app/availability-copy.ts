import type { Product } from '@neighbourhood-store/contracts';

type Translate = (key: string, fallback: string) => string;

/**
 * What a product sheet says about how recently the shop confirmed its stock.
 *
 * The tiers are the server's (fifteen minutes, an hour), and the sentence is
 * information rather than a gate: the shop confirms stock when it accepts the
 * order, so an old confirmation is something to know, not a reason to refuse
 * the add. A product with no inventory row is a different case and already
 * has its own label on the availability pill, so it says nothing here.
 */
export function freshnessSentence(
  product: Pick<Product, 'freshness' | 'is_stale'>,
  t: Translate,
): string | null {
  if (product.is_stale || product.freshness === null) return null;
  switch (product.freshness) {
    case 'FRESH':
      return t(
        'customer.product.freshness.fresh',
        'Stock confirmed by the store in the last 15 minutes.',
      );
    case 'STALE':
      return t(
        'customer.product.freshness.stale',
        'Stock confirmed by the store within the last hour.',
      );
    case 'EXPIRED':
      return t(
        'customer.product.freshness.expired',
        'The store last confirmed stock over an hour ago. It reconfirms when it accepts your order.',
      );
  }
}

/**
 * The bound on a loose product's final weight, as the shop set it. Basis
 * points are the server's unit; a person reads a percentage.
 */
export function weightVarianceSentence(
  product: Pick<Product, 'variable_weight' | 'permitted_weight_variance_bps'>,
  t: Translate,
): string | null {
  if (!product.variable_weight || product.permitted_weight_variance_bps === null) return null;
  const percent = (product.permitted_weight_variance_bps / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });
  return t(
    'customer.product.weight.variance',
    'The final weight may differ from what you order by up to {percent}%.',
  ).replace('{percent}', percent);
}
