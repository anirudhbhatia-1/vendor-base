'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@neighbourhood-store/contracts';
import type {
  Address,
  Product,
  RecentSearch,
  SearchResult,
  Store,
  Storefront,
} from '@neighbourhood-store/contracts';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  Icon,
  IconButton,
  LoadingState,
  PageHeader,
  Panel,
  SearchField,
  Skeleton,
  TextAction,
  formatDistanceMeters,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import { AddressSetup } from './address-setup';
import { CatalogueTile } from './catalogue-tile';
import {
  anonymousCustomerClient,
  clearCustomerSession,
  customerApiClient,
  readCustomerSession,
} from './customer-session';
import { displayLabel } from './display';
import { readBrowseLocation, type BrowseLocation } from './browse-location';
import { useLocale } from './locale';
import { StatePill } from './state-pill';
import { LocationWelcome } from './location-welcome';

export type FeedView = 'home' | 'categories' | 'stores';

/** How many of a store's items the feed previews before sending you to its page. */
const PREVIEW_LIMIT = 6;
/** Catalogues are fetched a few stores at a time so one slow store cannot stall the feed. */
const CATALOGUE_BATCH = 4;

type Category = { readonly category: string; readonly product_count: number };

/** A product together with the shop selling it. Never one without the other. */
type Shelved = { readonly product: Product; readonly store: Store };

/**
 * A product tile for a grid that spans more than one shop.
 *
 * Search results and category aisles mix stores, so the tile itself has to name
 * the seller and link to it — on a store page the heading does that, here there
 * is no heading to do it. Losing the shop's name is what EXC-02 forbids and is
 * the whole difference between this and a dark store.
 */
function ShelfTile({ product, store }: Shelved) {
  const { t } = useLocale();
  return (
    <CatalogueTile
      footer={
        <Link href={`/stores/${store.vendor_location_id}`}>
          {t('customer.product.sold_by', 'from')} {displayLabel(store.location_name)}
        </Link>
      }
      product={product}
      supportsPlatformDelivery={store.fulfilment_modes.includes('PLATFORM_DELIVERY')}
      vendorLocationId={store.vendor_location_id}
    />
  );
}

function StoreCard({
  favourite,
  matchingProductIds,
  onToggleFavourite,
  storefront,
  store,
}: {
  readonly store: Store;
  readonly storefront: Storefront | undefined;
  readonly favourite: boolean;
  readonly matchingProductIds: readonly string[] | null;
  readonly onToggleFavourite: () => void;
}) {
  const { t } = useLocale();
  const name = displayLabel(store.location_name);
  const supportsPlatformDelivery = store.fulfilment_modes.includes('PLATFORM_DELIVERY');
  const products = (storefront?.products ?? []).filter(
    (product) =>
      matchingProductIds === null || matchingProductIds.includes(product.catalogue_product_id),
  );

  return (
    <Card as="article" className="store-card" tone="raised">
      <div className="store-card__head">
        <div className="store-card__identity">
          <h3 className="store-card__name">
            <Link href={`/stores/${store.vendor_location_id}`}>{name}</Link>
          </h3>
          <p className="store-card__meta">
            <span className="store-card__category">
              {store.category.replaceAll('_', ' ').toLowerCase()}
            </span>{' '}
            · {formatDistanceMeters(store.distance_meters)} ·{' '}
            {t('customer.store.minimum', 'Minimum')}{' '}
            {formatMoneyMinor(store.minimum_order_minor, 'compact')}
          </p>
          <div className="ns-row">
            <StatePill
              label={
                store.is_open_now
                  ? t('customer.store.open', 'Open now')
                  : t('customer.store.closed', 'Closed — browse for later')
              }
              state={store.is_open_now ? 'AVAILABLE' : 'VENDOR_CONFIRMS'}
            />
            {supportsPlatformDelivery ? (
              <StatePill
                label={t('customer.store.delivers', 'Delivers')}
                state="OUT_FOR_DELIVERY"
              />
            ) : null}
            {store.fulfilment_modes.includes('CUSTOMER_PICKUP') ? (
              <StatePill label={t('customer.store.pickup', 'Pickup')} state="READY" />
            ) : null}
          </div>
        </div>
        <IconButton
          label={
            favourite
              ? `${t('customer.store.unfavourite', 'Remove from favourites')}: ${name}`
              : `${t('customer.store.favourite', 'Save to favourites')}: ${name}`
          }
          onClick={onToggleFavourite}
          pressed={favourite}
        >
          <Icon name={favourite ? 'heart-filled' : 'heart'} />
        </IconButton>
      </div>

      {storefront === undefined ? (
        <div className="ns-product-grid">
          {Array.from({ length: 3 }, (_unused, index) => (
            <Skeleton key={index} lines={3} variant="tile" />
          ))}
        </div>
      ) : products.length === 0 ? (
        <p className="store-card__empty">
          {matchingProductIds
            ? t('customer.store.no_matches', 'Nothing here matches that search right now.')
            : t('customer.store.no_items', 'This store has nothing published right now.')}
        </p>
      ) : (
        <>
          <div className="ns-product-grid">
            {products.slice(0, PREVIEW_LIMIT).map((product) => (
              <CatalogueTile
                key={product.catalogue_product_id}
                product={product}
                supportsPlatformDelivery={supportsPlatformDelivery}
                vendorLocationId={store.vendor_location_id}
              />
            ))}
          </div>
          {products.length > PREVIEW_LIMIT ? (
            <Link className="store-card__more" href={`/stores/${store.vendor_location_id}`}>
              {t('customer.store.see_all', 'See all')} {products.length}{' '}
              {t('customer.store.items', 'items')} →
            </Link>
          ) : null}
        </>
      )}
    </Card>
  );
}

/**
 * Discovery: address, search, categories, and the eligible stores near you.
 *
 * Replaces an 804-line panel that also owned the cart, the storefront overlay,
 * the address form and the basket dock. Each of those now lives where it
 * belongs — the basket in the shared store, the storefront on its own route —
 * so this file is about finding a shop and nothing else.
 */
export function HomeFeed({ view = 'home' }: { readonly view?: FeedView }) {
  const { t } = useLocale();
  const [addresses, setAddresses] = useState<readonly Address[]>([]);
  const [addressesLoaded, setAddressesLoaded] = useState(false);
  const [stores, setStores] = useState<readonly Store[]>([]);
  const [storefronts, setStorefronts] = useState<Record<string, Storefront>>({});
  const [favourites, setFavourites] = useState<ReadonlySet<string>>(new Set());
  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [maxDistanceKm, setMaxDistanceKm] = useState('');
  const [query, setQuery] = useState('');
  const [activeTerm, setActiveTerm] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<readonly SearchResult[] | null>(null);
  // The aisle a category tile opened, if any. Null is the rail of categories.
  const [aisle, setAisle] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<readonly RecentSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Where an unauthenticated visitor is shopping from. A saved address always
  // wins when there is one; this is only what makes browsing possible first.
  const [browseLocation, setBrowseLocation] = useState<BrowseLocation | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const request = useRef(0);
  const activeTermRef = useRef<string | null>(null);
  activeTermRef.current = activeTerm;

  useEffect(() => {
    setSignedIn(readCustomerSession() !== null);
    setBrowseLocation(readBrowseLocation());
    const sync = () => {
      setSignedIn(readCustomerSession() !== null);
      setBrowseLocation(readBrowseLocation());
    };
    window.addEventListener('neighbourhood:customer-session', sync);
    window.addEventListener('neighbourhood:browse-location', sync);
    return () => {
      window.removeEventListener('neighbourhood:customer-session', sync);
      window.removeEventListener('neighbourhood:browse-location', sync);
    };
  }, []);

  const selectedAddressId =
    addresses.find((address) => address.is_selected)?.customer_address_id ??
    addresses[0]?.customer_address_id ??
    null;

  const loadCatalogues = useCallback(async (nextStores: readonly Store[], ticket: number) => {
    setStorefronts({});
    if (nextStores.length === 0) return;
    // The public store page is the same projection without the per-user view
    // event, so a signed-out visitor sees the same shelves. The client has to be
    // chosen the same way: asking for the authenticated one first threw before
    // the public method was ever reached, so the whole signed-out feed failed
    // with "sign in to continue" and never issued a request at all.
    const signedInNow = readCustomerSession() !== null;
    const client = signedInNow ? await customerApiClient() : anonymousCustomerClient();
    for (let index = 0; index < nextStores.length; index += CATALOGUE_BATCH) {
      const batch = nextStores.slice(index, index + CATALOGUE_BATCH);
      const results = await Promise.allSettled(
        batch.map((store) =>
          signedInNow
            ? client.discovery.storefront(store.vendor_location_id)
            : client.catalogue.storefront(store.vendor_location_id),
        ),
      );
      if (request.current !== ticket) return;
      const loadedBatch: Record<string, Storefront> = {};
      results.forEach((result, position) => {
        const store = batch[position];
        if (store && result.status === 'fulfilled') {
          // Keyed by the store it was requested for, so one store's items can
          // never appear under another's name (MKT-01, MKT-06).
          loadedBatch[store.vendor_location_id] = result.value;
        }
      });
      setStorefronts((current) => ({ ...current, ...loadedBatch }));
    }
  }, []);

  const discover = useCallback(
    async (term: string | null, addressId: string | null, point: BrowseLocation | null) => {
      // A saved address wins: it is what checkout binds to. A coordinate is the
      // stand-in that lets someone look around before they have one.
      const origin = addressId
        ? ({ kind: 'ADDRESS', customer_address_id: addressId } as const)
        : point
          ? ({ kind: 'POINT', latitude: point.latitude, longitude: point.longitude } as const)
          : null;
      if (!origin) return;
      const ticket = ++request.current;
      setLoading(true);
      setError(null);
      try {
        // An address origin only exists for a signed-in customer; a coordinate
        // is the signed-out one, and must not need a session to be honoured.
        const client =
          origin.kind === 'ADDRESS' ? await customerApiClient() : anonymousCustomerClient();
        const all =
          origin.kind === 'ADDRESS'
            ? await client.discovery.stores({ customer_address_id: origin.customer_address_id })
            : await client.catalogue.stores({
                latitude: origin.latitude,
                longitude: origin.longitude,
              });
        if (request.current !== ticket) return;

        if (term) {
          const filters = {
            ...(categoryFilter ? { category: categoryFilter } : {}),
            ...(availableOnly ? { available_only: true } : {}),
            ...(maxDistanceKm ? { max_distance_meters: Number(maxDistanceKm) * 1000 } : {}),
          };
          const search = await (origin.kind === 'ADDRESS'
            ? client.discovery.search({
                customer_address_id: origin.customer_address_id,
                term,
                ...filters,
              })
            : client.catalogue.search({
                latitude: origin.latitude,
                longitude: origin.longitude,
                term,
                ...filters,
              }));
          if (request.current !== ticket) return;
          const matched = new Set(search.results.map((item) => item.vendor_location_id));
          setSearchResults(search.results);
          const filtered = all.stores.filter((store) => matched.has(store.vendor_location_id));
          setStores(filtered);
          void loadCatalogues(filtered, ticket);
          // Recent searches belong to a person, so they are only read and
          // written for one.
          if (origin.kind === 'ADDRESS') {
            void client.discovery
              .recentSearches()
              .then((body) => setRecentSearches(body.recent_searches))
              .catch(() => undefined);
          }
        } else {
          setSearchResults(null);
          setStores(all.stores);
          void loadCatalogues(all.stores, ticket);
        }
        setActiveTerm(term);
        setLoaded(true);
      } catch (cause) {
        if (request.current !== ticket) return;
        setError(cause instanceof Error ? cause.message : 'Stores could not be loaded.');
      } finally {
        if (request.current === ticket) setLoading(false);
      }
    },
    [availableOnly, categoryFilter, loadCatalogues, maxDistanceKm],
  );

  const loadAddresses = useCallback(async (): Promise<string | null> => {
    if (!readCustomerSession()) {
      setAddressesLoaded(true);
      return null;
    }
    try {
      const client = await customerApiClient();
      const body = await client.addresses.list();
      setAddresses(body.addresses);
      return (
        body.addresses.find((address) => address.is_selected)?.customer_address_id ??
        body.addresses[0]?.customer_address_id ??
        null
      );
    } catch (cause) {
      // A session the server no longer honours (the local database was rebuilt,
      // the refresh token expired) must return the app to a signed-out state.
      // Left alone it rendered the first-run "add a delivery address" form to
      // someone who cannot save one, and every action failed silently.
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        clearCustomerSession();
        setAddresses([]);
        return null;
      }
      setError(cause instanceof Error ? cause.message : 'Your addresses could not be loaded.');
      return null;
    } finally {
      setAddressesLoaded(true);
    }
  }, []);

  const loadFavourites = useCallback(async (addressId: string | null) => {
    if (!readCustomerSession()) return;
    try {
      const client = await customerApiClient();
      const body = await client.discovery.favourites(
        addressId ? { customer_address_id: addressId } : {},
      );
      setFavourites(new Set(body.favourites.map((store) => store.vendor_location_id)));
    } catch {
      // Favourites decorate the feed; failing to load them must not hide it.
    }
  }, []);

  // Categories are public, so the aisle rail renders before sign-in.
  useEffect(() => {
    anonymousCustomerClient()
      .discovery.categories()
      .then((body) => setCategories(body.categories))
      .catch(() => setCategories([]));
  }, []);

  /**
   * The reload the address switcher triggers, always the current one.
   *
   * The listener is registered once — re-subscribing on every render of a
   * screen that re-renders on every keystroke would churn listeners — but it
   * must call today's `discover` with today's search term, not the closure
   * captured on first mount. A ref updated each render is the honest way to
   * have both; a dependency-array suppression would only hide the staleness.
   */
  const reload = useRef<(term: string | null) => void>(() => {});
  reload.current = (term: string | null) => {
    void (async () => {
      const addressId = await loadAddresses();
      await Promise.all([discover(term, addressId, browseLocation), loadFavourites(addressId)]);
    })();
  };

  useEffect(() => {
    reload.current(null);
  }, [browseLocation, signedIn]);

  useEffect(() => {
    const onAddress = () => reload.current(activeTermRef.current);
    window.addEventListener('neighbourhood:customer-address', onAddress);
    window.addEventListener('neighbourhood:customer-session', onAddress);
    return () => {
      window.removeEventListener('neighbourhood:customer-address', onAddress);
      window.removeEventListener('neighbourhood:customer-session', onAddress);
    };
  }, []);

  const storeById = useMemo(
    () => new Map(stores.map((store) => [store.vendor_location_id, store] as const)),
    [stores],
  );

  const matchingProductIds = useMemo(
    () => (searchResults === null ? null : searchResults.map((hit) => hit.catalogue_product_id)),
    [searchResults],
  );

  /**
   * The searched-for products themselves.
   *
   * The search endpoint ranks products, not shops; this used to keep only the
   * shop ids and throw the ranking away, so searching "tamatar" answered "these
   * four shops might have it" instead of "here it is, add it". The full product
   * comes from the storefront already being fetched for each matching store, so
   * tiles appear as those land rather than waiting for the slowest one.
   */
  const productHits = useMemo<readonly Shelved[] | null>(() => {
    if (searchResults === null) return null;
    const hits: Shelved[] = [];
    const seen = new Set<string>();
    for (const hit of searchResults) {
      const store = storeById.get(hit.vendor_location_id);
      const product = storefronts[hit.vendor_location_id]?.products.find(
        (candidate) => candidate.catalogue_product_id === hit.catalogue_product_id,
      );
      // Keyed by store as well as variant: the same product sold by two shops
      // is two things you can buy, not a duplicate.
      const key = `${hit.vendor_location_id}:${hit.catalogue_variant_id}`;
      if (!store || !product || seen.has(key)) continue;
      seen.add(key);
      hits.push({ product, store });
    }
    return hits;
  }, [searchResults, storeById, storefronts]);

  /** Everything in one aisle, across every shop that can reach you. */
  const aisleProducts = useMemo<readonly Shelved[]>(() => {
    if (aisle === null) return [];
    const shelved: Shelved[] = [];
    for (const store of stores) {
      for (const product of storefronts[store.vendor_location_id]?.products ?? []) {
        if (product.category === aisle) shelved.push({ product, store });
      }
    }
    return shelved;
  }, [aisle, stores, storefronts]);

  async function toggleFavourite(vendorLocationId: string) {
    const wasFavourite = favourites.has(vendorLocationId);
    setFavourites((current) => {
      const next = new Set(current);
      if (wasFavourite) next.delete(vendorLocationId);
      else next.add(vendorLocationId);
      return next;
    });
    try {
      const client = await customerApiClient();
      if (wasFavourite) await client.discovery.removeFavourite(vendorLocationId);
      else await client.discovery.addFavourite(vendorLocationId);
    } catch {
      // Put the heart back rather than leave it lying about the saved state.
      setFavourites((current) => {
        const next = new Set(current);
        if (wasFavourite) next.add(vendorLocationId);
        else next.delete(vendorLocationId);
        return next;
      });
    }
  }

  // A signed-out visitor with no location gets the location ask, not a sign-in
  // wall: there is nothing to sign in *for* until they have seen the shops.
  if (!signedIn && !browseLocation) {
    return <LocationWelcome onLocated={setBrowseLocation} />;
  }

  if (addressesLoaded && addresses.length === 0 && signedIn) {
    return (
      <AddressSetup
        onSaved={() => {
          void (async () => {
            const addressId = await loadAddresses();
            await discover(null, addressId, browseLocation);
          })();
        }}
      />
    );
  }

  const visibleStores =
    view === 'stores' ? stores.filter((s) => favourites.has(s.vendor_location_id)) : stores;

  return (
    <div className="ns-stack">
      <PageHeader
        description={
          view === 'stores'
            ? t(
                'customer.home.stores.description',
                'The shops you saved, and whether they can reach you today.',
              )
            : t('customer.home.description', 'Every basket comes from a shop you can name.')
        }
        eyebrow={t('customer.home.eyebrow', 'Local shopping')}
        title={
          view === 'categories'
            ? t('customer.home.categories.title', 'Browse by aisle')
            : view === 'stores'
              ? t('customer.home.stores.title', 'Your stores')
              : t('customer.home.title', 'What does your home need today?')
        }
      />

      {view !== 'categories' ? (
        <Card className="discovery-controls" tone="sunken">
          <SearchField
            busy={loading}
            label={t('customer.search.label', 'Search stores and products')}
            onChange={setQuery}
            onSubmit={() => void discover(query.trim() || null, selectedAddressId, browseLocation)}
            placeholder={t('customer.search.placeholder', 'Tomatoes, atta, a shop name…')}
            submitLabel={t('customer.search.submit', 'Search')}
            value={query}
          />

          {categories.length > 0 ? (
            <FilterChips
              label={t('customer.filter.category', 'Category')}
              onSelect={(id) => {
                setCategoryFilter(id);
                void discover(activeTerm, selectedAddressId, browseLocation);
              }}
              options={categories.map((entry) => ({
                id: entry.category,
                label: entry.category.replaceAll('_', ' ').toLowerCase(),
                count: entry.product_count,
              }))}
              selected={categoryFilter}
            />
          ) : null}

          <details className="discovery-filters">
            <summary>{t('customer.filter.more', 'More filters')}</summary>
            <div className="ns-stack">
              <Field
                inputMode="numeric"
                label={t('customer.filter.distance', 'Within (km)')}
                max={50}
                min={1}
                onChange={(event) => setMaxDistanceKm(event.target.value)}
                placeholder={t('customer.filter.any_distance', 'Any distance')}
                type="number"
                value={maxDistanceKm}
              />
              <label className="checkbox-row">
                <input
                  checked={availableOnly}
                  onChange={(event) => setAvailableOnly(event.target.checked)}
                  type="checkbox"
                />
                <span>{t('customer.filter.in_stock', 'Only what is in stock right now')}</span>
              </label>
              <Button
                onClick={() => void discover(activeTerm, selectedAddressId, browseLocation)}
                variant="secondary"
              >
                {t('customer.filter.apply', 'Apply filters')}
              </Button>
            </div>
          </details>

          {recentSearches.length > 0 ? (
            <div className="recent-searches">
              <p className="ns-eyebrow">{t('customer.search.recent', 'Recent searches')}</p>
              <div className="ns-row">
                {recentSearches.map((search) => (
                  <span className="recent-search" key={search.display_term}>
                    <TextAction
                      onClick={() => {
                        setQuery(search.display_term);
                        void discover(search.display_term, selectedAddressId, browseLocation);
                      }}
                    >
                      {search.display_term}
                    </TextAction>
                    <IconButton
                      label={`${t('customer.search.forget', 'Forget')} ${search.display_term}`}
                      onClick={() => {
                        void customerApiClient()
                          .then((client) =>
                            client.discovery.deleteRecentSearch(search.display_term),
                          )
                          .then(() =>
                            setRecentSearches((current) =>
                              current.filter((entry) => entry.display_term !== search.display_term),
                            ),
                          )
                          .catch(() => undefined);
                      }}
                    >
                      <Icon name="close" />
                    </IconButton>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {activeTerm ? (
            <p className="ns-row">
              <span>
                {t('customer.search.showing', 'Showing results for')} “{activeTerm}”
              </span>
              <TextAction
                onClick={() => {
                  setQuery('');
                  void discover(null, selectedAddressId, browseLocation);
                }}
              >
                {t('customer.search.clear', 'Clear')}
              </TextAction>
            </p>
          ) : null}
        </Card>
      ) : null}

      {view !== 'stores' && categories.length > 0 ? (
        <Panel
          eyebrow={t('customer.categories.eyebrow', 'Everyday aisles')}
          id="aisles"
          level={2}
          title={t('customer.categories.title', 'Shop by category')}
        >
          <div className="ns-rail category-rail">
            {categories.map((entry) => (
              <button
                aria-pressed={aisle === entry.category}
                className="category-tile"
                key={entry.category}
                onClick={() => setAisle(aisle === entry.category ? null : entry.category)}
                type="button"
              >
                <strong>{entry.category.replaceAll('_', ' ').toLowerCase()}</strong>
                <small>
                  {entry.product_count} {t('customer.categories.items', 'items')}
                </small>
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      {view !== 'stores' && aisle !== null ? (
        <Panel
          actions={
            <TextAction onClick={() => setAisle(null)}>
              {t('customer.aisle.close', 'Back to aisles')}
            </TextAction>
          }
          eyebrow={t('customer.aisle.eyebrow', 'Across every shop that reaches you')}
          id="aisle"
          level={2}
          title={aisle.replaceAll('_', ' ').toLowerCase()}
        >
          {aisleProducts.length === 0 ? (
            loading ? (
              <LoadingState label={t('customer.aisle.loading', 'Filling the aisle…')} lines={3} />
            ) : (
              <EmptyState
                description={t(
                  'customer.aisle.empty.description',
                  'No shop near you has published anything in this aisle yet.',
                )}
                glyph="⌕"
                title={t('customer.aisle.empty.title', 'This aisle is empty near you')}
              />
            )
          ) : (
            <div className="ns-product-grid">
              {aisleProducts.map(({ product, store }) => (
                <ShelfTile
                  key={`${store.vendor_location_id}:${product.catalogue_variant_id}`}
                  product={product}
                  store={store}
                />
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {view === 'home' && activeTerm && productHits !== null ? (
        <Panel
          eyebrow={t('customer.results.eyebrow', 'Every item names its shop')}
          id="results"
          level={2}
          title={`${t('customer.results.title', 'Items matching')} “${activeTerm}”`}
          {...(productHits.length > 0
            ? {
                actions: (
                  <span className="ns-eyebrow">
                    {productHits.length} {t('customer.results.count', 'items')}
                  </span>
                ),
              }
            : {})}
        >
          {productHits.length === 0 ? (
            loading ? (
              <LoadingState label={t('customer.results.loading', 'Looking…')} lines={3} />
            ) : (
              <EmptyState
                description={t(
                  'customer.results.empty.description',
                  'The shops below may still stock something close.',
                )}
                glyph="⌕"
                title={t('customer.results.empty.title', 'No item matched that')}
              />
            )
          ) : (
            <div className="ns-product-grid">
              {productHits.map(({ product, store }) => (
                <ShelfTile
                  key={`${store.vendor_location_id}:${product.catalogue_variant_id}`}
                  product={product}
                  store={store}
                />
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {view !== 'categories' ? (
        <Panel
          eyebrow={t('customer.stores.eyebrow', 'Named local stores')}
          id="stores"
          level={2}
          title={
            view === 'stores'
              ? t('customer.stores.saved', 'Saved stores')
              : t('customer.stores.nearby', 'Near your address')
          }
          {...(visibleStores.length > 0
            ? {
                actions: (
                  <span className="ns-eyebrow">
                    {visibleStores.length} {t('customer.stores.serving', 'serving now')}
                  </span>
                ),
              }
            : {})}
        >
          {error ? (
            <ErrorState
              description={t(
                'customer.stores.error.description',
                'This is usually a connection problem rather than a problem with your basket.',
              )}
              onRetry={() => void discover(activeTerm, selectedAddressId, browseLocation)}
              retryLabel={t('customer.retry', 'Try again')}
              title={error}
            />
          ) : loading && !loaded ? (
            <LoadingState
              label={t('customer.stores.loading', 'Finding stores near you…')}
              lines={4}
            />
          ) : visibleStores.length === 0 ? (
            <EmptyState
              action={
                activeTerm ? (
                  <Button
                    onClick={() => {
                      setQuery('');
                      void discover(null, selectedAddressId, browseLocation);
                    }}
                    variant="secondary"
                  >
                    {t('customer.stores.show_all', 'Show every nearby store')}
                  </Button>
                ) : null
              }
              description={
                view === 'stores'
                  ? t('customer.stores.empty.saved', 'Tap the heart on a store to keep it here.')
                  : t(
                      'customer.stores.empty.description',
                      'Try another search, or a different delivery address.',
                    )
              }
              glyph="⌕"
              title={
                view === 'stores'
                  ? t('customer.stores.empty.saved_title', 'No saved stores yet')
                  : t('customer.stores.empty.title', 'No stores match this')
              }
            />
          ) : (
            <div className="store-list">
              {visibleStores.map((store) => (
                <StoreCard
                  favourite={favourites.has(store.vendor_location_id)}
                  key={store.vendor_location_id}
                  matchingProductIds={matchingProductIds}
                  onToggleFavourite={() => void toggleFavourite(store.vendor_location_id)}
                  store={store}
                  storefront={storefronts[store.vendor_location_id]}
                />
              ))}
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
