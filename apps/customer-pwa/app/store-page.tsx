'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { catalogueImageUrl, type Product, type Storefront } from '@neighbourhood-store/contracts';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  FilterChips,
  Icon,
  LoadingState,
  PageHeader,
  ProductImage,
  QuantityStepper,
  SearchField,
  Sheet,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import { useCart } from './cart-store';
import { CatalogueTile } from './catalogue-tile';
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The product detail a customer opens from a tile (CUS-25, CUS-27, CUS-28). */
function ProductSheet({
  onClose,
  product,
  storefront,
}: {
  readonly product: Product | null;
  readonly storefront: Storefront;
  readonly onClose: () => void;
}) {
  const { busyVariantIds, quantityOf, setQuantity } = useCart();
  const { t } = useLocale();
  if (!product) return null;
  const title = displayLabel(product.title);
  const imageId = product.image_ids[0];
  const quantity = quantityOf(product.catalogue_variant_id);
  const supportsPlatformDelivery = storefront.fulfilment_modes.includes('PLATFORM_DELIVERY');
  const freshness = freshnessSentence(product, t);
  const variance = weightVarianceSentence(product, t);

  return (
    <Sheet
      footer={
        quantity > 0 ? (
          <QuantityStepper
            busy={busyVariantIds.has(product.catalogue_variant_id)}
            itemLabel={title}
            onChange={(next) =>
              void setQuantity({
                catalogueVariantId: product.catalogue_variant_id,
                priceMinor: product.price_minor,
                title: product.title,
                quantity: next,
                vendorLocationId: storefront.vendor_location_id,
              })
            }
            quantity={quantity}
          />
        ) : (
          <Button
            block
            busy={busyVariantIds.has(product.catalogue_variant_id)}
            disabled={product.price_minor === null || product.is_stale}
            onClick={() =>
              void setQuantity({
                catalogueVariantId: product.catalogue_variant_id,
                priceMinor: product.price_minor,
                title: product.title,
                quantity: 1,
                vendorLocationId: storefront.vendor_location_id,
                ...(supportsPlatformDelivery
                  ? { fulfilmentMethod: 'PLATFORM_DELIVERY' as const }
                  : {}),
                substitutionPreference: product.substitution_available
                  ? ('ASK_CUSTOMER' as const)
                  : ('NO_SUBSTITUTION' as const),
              })
            }
            size="large"
          >
            {t('customer.product.add', 'Add to basket')}
          </Button>
        )
      }
      onClose={onClose}
      open={product !== null}
      title={title}
    >
      <ProductImage
        category={product.category}
        size="hero"
        src={imageId ? catalogueImageUrl(apiUrl, imageId) : null}
        title={title}
      />
      <div className="ns-row">
        <strong className="product-sheet__price">
          {product.price_minor === null
            ? t('customer.product.no_price', 'Price unavailable')
            : formatMoneyMinor(product.price_minor)}
        </strong>
        <StatePill
          state={
            product.is_stale ? 'VENDOR_CONFIRMS' : (product.availability_state ?? 'VENDOR_CONFIRMS')
          }
          {...(product.is_stale
            ? { label: t('customer.product.stale', 'The store needs to reconfirm this') }
            : {})}
        />
      </div>
      <dl className="product-sheet__facts">
        <div>
          <dt>{t('customer.product.unit', 'Sold as')}</dt>
          <dd>{product.unit_label}</dd>
        </div>
        <div>
          <dt>{t('customer.product.store', 'Sold by')}</dt>
          <dd>{displayLabel(storefront.location_name)}</dd>
        </div>
        {freshness ? (
          <div>
            <dt>{t('customer.product.freshness', 'Stock check')}</dt>
            <dd>{freshness}</dd>
          </div>
        ) : null}
        <div>
          <dt>{t('customer.product.substitution', 'If it runs out')}</dt>
          <dd>
            {product.substitution_available
              ? t(
                  'customer.product.substitution.available',
                  'The store may propose a replacement. You decide before it is packed — you can change this rule for the line in your basket.',
                )
              : t(
                  'customer.product.substitution.none',
                  'No replacement will be offered. The line is removed and refunded.',
                )}
          </dd>
        </div>
        {product.variable_weight ? (
          <div>
            <dt>{t('customer.product.weight', 'Weight')}</dt>
            <dd>
              {t(
                'customer.product.weight.detail',
                'Sold loose. The store weighs it and the final price follows the actual weight — a material difference comes back to you to approve.',
              )}
              {variance ? ` ${variance}` : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </Sheet>
  );
}

/**
 * A store's own page (CUS-23).
 *
 * The feed previously inlined every store's entire catalogue into the home
 * screen, so a shopper never arrived anywhere that belonged to one shop: hours,
 * rating, policies and fulfilment options had nowhere to live. MKT-01 is the
 * point of the product — a store is a place, and it needs an address.
 */
export function StorePage({ vendorLocationId }: { readonly vendorLocationId: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const [storefront, setStorefront] = useState<Storefront | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<Product | null>(null);
  const [favourite, setFavourite] = useState(false);

  async function load() {
    setError(null);
    try {
      // Signed in, the store view is recorded against the customer (funnel
      // reporting). Signed out, the same projection comes from the public
      // route — the anonymous client was already being built here, but it was
      // calling the capability-guarded route and could only ever get a 403.
      const signedIn = readCustomerSession() !== null;
      const client = signedIn ? await customerApiClient() : anonymousCustomerClient();
      setStorefront(
        signedIn
          ? await client.discovery.storefront(vendorLocationId)
          : await client.catalogue.storefront(vendorLocationId),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This store could not be opened.');
    }
  }

  // The store id is the only real dependency; `load` closes over state that
  // changes as the page is used. A ref keeps the effect honest without a
  // dependency-array suppression.
  const openStore = useRef<() => void>(() => {});
  openStore.current = () => {
    void load();
    if (!readCustomerSession()) return;
    void customerApiClient()
      .then((client) => client.discovery.favourites({}))
      .then((body) =>
        setFavourite(
          body.favourites.some((store) => store.vendor_location_id === vendorLocationId),
        ),
      )
      .catch(() => undefined);
  };

  useEffect(() => {
    openStore.current();
  }, [vendorLocationId]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of storefront?.products ?? []) {
      counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
    }
    return [...counts.entries()].map(([id, count]) => ({
      id,
      label: id.replaceAll('_', ' ').toLowerCase(),
      count,
    }));
  }, [storefront]);

  const products = useMemo(() => {
    const all = storefront?.products ?? [];
    const needle = term.trim().toLowerCase();
    return all.filter(
      (product) =>
        (category === null || product.category === category) &&
        (needle === '' || displayLabel(product.title).toLowerCase().includes(needle)),
    );
  }, [category, storefront, term]);

  if (error) {
    return (
      <ErrorState
        description={t(
          'customer.store.error.description',
          'The store may have paused, or the link may be old.',
        )}
        onRetry={() => void load()}
        retryLabel={t('customer.retry', 'Try again')}
        title={error}
      />
    );
  }
  if (!storefront) {
    return <LoadingState label={t('customer.store.loading', 'Opening the store…')} lines={5} />;
  }

  const name = displayLabel(storefront.location_name);
  const supportsPlatformDelivery = storefront.fulfilment_modes.includes('PLATFORM_DELIVERY');

  return (
    <div className="ns-stack">
      <PageHeader
        actions={
          <>
            <Button
              onClick={async () => {
                const next = !favourite;
                setFavourite(next);
                try {
                  const client = await customerApiClient();
                  if (next) await client.discovery.addFavourite(vendorLocationId);
                  else await client.discovery.removeFavourite(vendorLocationId);
                } catch {
                  setFavourite(!next);
                }
              }}
              variant="secondary"
            >
              <Icon name={favourite ? 'heart-filled' : 'heart'} />{' '}
              {favourite
                ? t('customer.store.saved', 'Saved')
                : t('customer.store.save', 'Save store')}
            </Button>
            <Button
              onClick={() => {
                void customerApiClient()
                  .then((client) => client.discovery.setPreferredStore(vendorLocationId))
                  .catch(() => undefined);
              }}
              variant="ghost"
            >
              {t('customer.store.prefer', 'Make this my usual store')}
            </Button>
          </>
        }
        description={
          storefront.profile_description ??
          t('customer.store.default_description', 'Everyday essentials from this shop.')
        }
        eyebrow={storefront.category.replaceAll('_', ' ').toLowerCase()}
        title={name}
      />

      <Card className="store-facts" tone="sunken">
        <div className="store-facts__grid">
          <div>
            <p className="ns-eyebrow">{t('customer.store.rating', 'Rating')}</p>
            <strong>
              {storefront.rating_average === null
                ? t('customer.store.no_rating', 'Not rated yet')
                : `${storefront.rating_average.toFixed(1)} ★`}
            </strong>
            {storefront.rating_count > 0 ? (
              <small>
                {storefront.rating_count} {t('customer.store.reviews', 'reviews')}
              </small>
            ) : null}
          </div>
          <div>
            <p className="ns-eyebrow">{t('customer.store.minimum', 'Minimum')}</p>
            <strong>{formatMoneyMinor(storefront.minimum_order_minor, 'compact')}</strong>
          </div>
          <div>
            <p className="ns-eyebrow">{t('customer.store.fulfilment', 'How you get it')}</p>
            <div className="ns-row">
              {storefront.fulfilment_modes.map((mode) => (
                <StatePill
                  key={mode}
                  label={
                    mode === 'CUSTOMER_PICKUP'
                      ? t('customer.store.pickup', 'Pickup')
                      : mode === 'VENDOR_DELIVERY'
                        ? t('customer.store.vendor_delivery', 'Store delivers')
                        : t('customer.store.platform_delivery', 'Delivery partner')
                  }
                  state="READY"
                />
              ))}
            </div>
          </div>
        </div>
        {/* Hours as text, never only as a graphic — a store's opening time is
            information a screen reader must be able to read out (UX-12). */}
        {storefront.operating_hours.length > 0 ? (
          <details className="store-hours">
            <summary>{t('customer.store.hours', 'Opening hours')}</summary>
            <dl>
              {storefront.operating_hours.map((hours) => (
                <div key={`${hours.weekday}-${hours.opens_at}`}>
                  <dt>{WEEKDAYS[hours.weekday] ?? `Day ${hours.weekday}`}</dt>
                  <dd>
                    {hours.opens_at} – {hours.closes_at}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </Card>

      <SearchField
        label={t('customer.store.search', 'Search this store')}
        onChange={setQuery}
        onSubmit={() => setTerm(query)}
        placeholder={t('customer.store.search.placeholder', 'Search inside this store')}
        submitLabel={t('customer.search.submit', 'Search')}
        value={query}
      />

      {categories.length > 1 ? (
        <FilterChips
          label={t('customer.filter.category', 'Category')}
          onSelect={setCategory}
          options={categories}
          selected={category}
        />
      ) : null}

      {products.length === 0 ? (
        <EmptyState
          description={t(
            'customer.store.empty.description',
            'Try a different aisle, or clear the search.',
          )}
          glyph="◌"
          title={t('customer.store.empty.title', 'Nothing here right now')}
        />
      ) : (
        <div className="ns-product-grid">
          {products.map((product) => (
            <CatalogueTile
              key={product.catalogue_product_id}
              onOpen={() =>
                router.push(
                  `/stores/${storefront.vendor_location_id}/products/${product.catalogue_product_id}`,
                )
              }
              product={product}
              supportsPlatformDelivery={supportsPlatformDelivery}
              vendorLocationId={storefront.vendor_location_id}
            />
          ))}
        </div>
      )}

      <ProductSheet onClose={() => setOpen(null)} product={open} storefront={storefront} />
    </div>
  );
}
