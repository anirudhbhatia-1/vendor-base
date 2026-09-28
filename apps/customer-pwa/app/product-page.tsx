'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { catalogueImageUrl, type Product, type Storefront } from '@neighbourhood-store/contracts';
import {
  actionErrorText,
  Button,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  ProductImage,
  QuantityStepper,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import { useCart } from './cart-store';
import {
  anonymousCustomerClient,
  customerApiClient,
  readCustomerSession,
} from './customer-session';
import { freshnessSentence, weightVarianceSentence } from './availability-copy';
import { displayLabel } from './display';
import { useLocale } from './locale';
import { StatePill } from './state-pill';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

export function ProductPage({
  productId,
  vendorLocationId,
}: {
  readonly productId: string;
  readonly vendorLocationId: string;
}) {
  const [store, setStore] = useState<Storefront | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { busyVariantIds, quantityOf, setQuantity } = useCart();
  const { t } = useLocale();

  useEffect(() => {
    let active = true;
    const client = readCustomerSession()
      ? customerApiClient()
      : Promise.resolve(anonymousCustomerClient());
    void client
      .then((api) =>
        readCustomerSession()
          ? api.discovery.storefront(vendorLocationId)
          : api.catalogue.storefront(vendorLocationId),
      )
      .then((result) => {
        if (active) setStore(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(actionErrorText(cause, 'Product unavailable'));
      });
    return () => {
      active = false;
    };
  }, [vendorLocationId]);

  if (error) return <ErrorState title={error} />;
  if (!store) return <LoadingState label="Loading product…" lines={4} />;
  const product: Product | undefined = store.products.find(
    (entry) => entry.catalogue_product_id === productId,
  );
  if (!product) {
    return (
      <ErrorState
        description="It may be paused, sold out, or no longer published."
        title="This product is not available"
      />
    );
  }

  const title = displayLabel(product.title);
  const quantity = quantityOf(product.catalogue_variant_id);
  const imageId = product.image_ids[0];
  const freshness = freshnessSentence(product, t);
  const variance = weightVarianceSentence(product, t);
  const update = (next: number) =>
    setQuantity({
      catalogueVariantId: product.catalogue_variant_id,
      priceMinor: product.price_minor,
      quantity: next,
      substitutionPreference: product.substitution_available ? 'ASK_CUSTOMER' : 'NO_SUBSTITUTION',
      title: product.title,
      vendorLocationId,
      ...(store.fulfilment_modes.includes('PLATFORM_DELIVERY')
        ? { fulfilmentMethod: 'PLATFORM_DELIVERY' as const }
        : {}),
    });

  return (
    <div className="ns-stack">
      <PageHeader
        description={`Sold by ${displayLabel(store.location_name)}`}
        eyebrow={product.category.replaceAll('_', ' ').toLowerCase()}
        title={title}
      />
      <Card className="product-detail" tone="raised">
        <ProductImage
          category={product.category}
          size="hero"
          src={imageId ? catalogueImageUrl(apiUrl, imageId) : null}
          title={title}
        />
        <div className="ns-stack">
          <div className="ns-row">
            <strong className="product-sheet__price">
              {product.price_minor === null
                ? 'Price unavailable'
                : formatMoneyMinor(product.price_minor)}
            </strong>
            <StatePill
              state={
                product.is_stale
                  ? 'VENDOR_CONFIRMS'
                  : (product.availability_state ?? 'VENDOR_CONFIRMS')
              }
            />
          </div>
          <p>{product.unit_label}</p>
          {freshness ? <p>{freshness}</p> : null}
          <p>
            {product.substitution_available
              ? 'If this runs out, the shop can propose a replacement. You approve it before packing.'
              : 'If this runs out, the line is removed and refunded.'}
          </p>
          {product.variable_weight ? (
            <p>
              The shop confirms the final weight. You approve any material increase before payment
              changes.
              {variance ? ` ${variance}` : null}
            </p>
          ) : null}
          {quantity > 0 ? (
            <QuantityStepper
              busy={busyVariantIds.has(product.catalogue_variant_id)}
              itemLabel={title}
              onChange={(next) => void update(next)}
              quantity={quantity}
            />
          ) : (
            <Button
              block
              disabled={product.price_minor === null || product.is_stale}
              onClick={() => void update(1)}
              size="large"
            >
              Add to basket
            </Button>
          )}
          <Link href={`/stores/${vendorLocationId}`}>
            Back to {displayLabel(store.location_name)}
          </Link>
        </div>
      </Card>
    </div>
  );
}
