'use client';

import Link from 'next/link';
import {
  Card,
  EmptyState,
  Notice,
  PageHeader,
  QuantityStepper,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import { useCart } from './cart-store';
import { readGuestCart } from './guest-cart';
import { displayLabel } from './display';
import { useLocale } from './locale';

/**
 * The basket, before sign-in.
 *
 * A guest could previously not even look at what they had picked: the cart
 * route demanded a session, so the basket the app had just encouraged them to
 * fill was behind the wall too. Sign-in belongs at the till, not at the basket.
 *
 * Totals stop at the item subtotal on purpose. Delivery fees, per-vendor
 * minimums and eligibility are server decisions computed against a real saved
 * address (MKT-08, CUS-36); showing a guessed total here would be a promise the
 * quote might not keep.
 */
export function GuestBasket() {
  const { cart, itemCount, quantityOf, setQuantity, totalMinor } = useCart();
  const { t } = useLocale();

  // The signed-in basket is a different component entirely; this one only ever
  // renders the local lines. `readGuestCart` returns [] during server
  // rendering, where there is no localStorage.
  const lines = cart === null ? readGuestCart() : [];

  if (itemCount === 0) {
    return (
      <EmptyState
        description={t(
          'customer.guest_basket.empty_description',
          'Add something from a shop near you and it will wait here.',
        )}
        glyph="◌"
        title={t('customer.guest_basket.empty', 'Your basket is empty')}
      />
    );
  }

  return (
    <div className="ns-stack">
      <PageHeader
        description={t(
          'customer.guest_basket.description',
          'Sign in to see delivery fees, each shop’s minimum, and to place the order.',
        )}
        eyebrow={t('customer.guest_basket.eyebrow', 'Basket')}
        title={
          itemCount === 1
            ? t('customer.cart.one_item', '1 item')
            : `${itemCount} ${t('customer.cart.items', 'items')}`
        }
      />

      <div className="ns-stack">
        {lines.map((line) => (
          <Card className="guest-basket__line" key={line.catalogue_variant_id}>
            <div>
              <h3>{displayLabel(line.title)}</h3>
              {line.price_minor === null ? (
                <p>{t('customer.cart.total_pending', 'Price confirmed at checkout')}</p>
              ) : (
                <p>{formatMoneyMinor(line.price_minor)}</p>
              )}
            </div>
            <QuantityStepper
              itemLabel={displayLabel(line.title)}
              onChange={(quantity) =>
                void setQuantity({
                  catalogueVariantId: line.catalogue_variant_id,
                  priceMinor: line.price_minor,
                  quantity,
                  title: line.title,
                  vendorLocationId: line.vendor_location_id,
                })
              }
              quantity={quantityOf(line.catalogue_variant_id)}
            />
          </Card>
        ))}
      </div>

      {totalMinor !== null ? (
        <Notice tone="information">
          {t('customer.guest_basket.subtotal', 'Items')} {formatMoneyMinor(totalMinor)} ·{' '}
          {t('customer.guest_basket.fees_pending', 'fees and minimums are shown once you sign in.')}
        </Notice>
      ) : null}

      <Link className="ns-button ns-button--primary ns-button--large" href="/login">
        <span className="ns-button__label">
          {t('customer.guest_basket.sign_in', 'Sign in to place this order')}
        </span>
      </Link>
    </div>
  );
}
