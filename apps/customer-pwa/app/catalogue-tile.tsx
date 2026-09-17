'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { catalogueImageUrl, type Product } from '@neighbourhood-store/contracts';
import { ProductTile } from '@neighbourhood-store/ui';
import { useCart } from './cart-store';
import { displayLabel } from './display';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

/**
 * A product tile bound to the shared basket.
 *
 * The quantity shown is the quantity actually in the basket, so the same item
 * reads the same on the home feed, the store page and the detail sheet. The
 * previous card had no notion of what was already in the basket at all: it
 * offered "Add" forever and always sent quantity 1.
 */
export function CatalogueTile({
  footer,
  onOpen,
  product,
  vendorLocationId,
  supportsPlatformDelivery,
}: {
  readonly product: Product;
  readonly vendorLocationId: string;
  readonly supportsPlatformDelivery: boolean;
  readonly onOpen?: () => void;
  /**
   * Rendered under the add button. Off a store page the shop's name has to
   * travel with the product, because the tile is then the only thing naming
   * the seller (MKT-01, EXC-02).
   */
  readonly footer?: ReactNode;
}) {
  const router = useRouter();
  const { busyVariantIds, quantityOf, setQuantity } = useCart();
  const title = displayLabel(product.title);
  const imageId = product.image_ids[0];

  return (
    <ProductTile
      availabilityState={product.availability_state}
      busy={busyVariantIds.has(product.catalogue_variant_id)}
      category={product.category}
      {...(footer === undefined ? {} : { footer })}
      imageSrc={imageId ? catalogueImageUrl(apiUrl, imageId) : null}
      onOpen={
        onOpen ??
        (() => router.push(`/stores/${vendorLocationId}/products/${product.catalogue_product_id}`))
      }
      onQuantityChange={(next) =>
        void setQuantity({
          catalogueVariantId: product.catalogue_variant_id,
          priceMinor: product.price_minor,
          title: product.title,
          quantity: next,
          vendorLocationId,
          ...(supportsPlatformDelivery ? { fulfilmentMethod: 'PLATFORM_DELIVERY' as const } : {}),
          // The customer refines this per line in the basket (CUS-34); the
          // opening position simply reflects whether the store offers one.
          substitutionPreference: product.substitution_available
            ? ('ASK_CUSTOMER' as const)
            : ('NO_SUBSTITUTION' as const),
        })
      }
      priceMinor={product.price_minor}
      quantity={quantityOf(product.catalogue_variant_id)}
      stale={product.is_stale}
      title={title}
      unitLabel={product.unit_label}
      variableWeight={product.variable_weight}
    />
  );
}
