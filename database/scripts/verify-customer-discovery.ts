import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import {
  CustomerDiscoveryConflictError,
  CustomerDiscoveryInputError,
  CustomerDiscoveryNotFoundError,
  CustomerDiscoveryService,
} from '../src/customer-discovery.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { LocalProtectedObjectStorage } from '../src/protected-object-storage.js';
import { VendorOnboardingService } from '../src/vendor-onboarding.js';
import { ESTIMATE_ROAD_FACTOR } from '../src/routing.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import { adminContext, check, rejects, vendorContext } from './verify-support.js';

function context(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'customer',
      session_id: createUuidV7(),
    }),
  });
}
const jaipur = { latitude: 26.91, longitude: 75.81 };
const mumbai = { latitude: 19.076, longitude: 72.8777 };

export async function verifyCustomerDiscovery(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const discovery = new CustomerDiscoveryService({ connection_string: connectionString });
  const catalogue = new CatalogueProductService({ connection_string: connectionString });
  const inventory = new InventoryReservationService({ connection_string: connectionString });
  const customerId = createUuidV7();
  const now = new Date('2026-08-26T10:00:00.000Z');
  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [customerId],
    );
    const near = await createDiscoverableStoreFixture(pool, {
      location_name: 'SYNTH Near Store',
      ...jaipur,
    });
    const far = await createDiscoverableStoreFixture(pool, {
      location_name: 'SYNTH Far Store',
      ...mumbai,
    });
    // In zone but genuinely distant. The near store sits on the customer's own
    // coordinates, so its distance is zero and no positive `max_distance_meters`
    // could ever exclude it -- the filter was untestable until a second eligible
    // store existed. 0.1 degrees of longitude here is roughly ten kilometres,
    // and the fixture's zone spans 0.2 degrees, so this store still covers the
    // address. It is also the second page that run 34 had no way to ask for.
    const midtown = await createDiscoverableStoreFixture(pool, {
      location_name: 'SYNTH Greenfield Store',
      latitude: jaipur.latitude,
      longitude: jaipur.longitude + 0.1,
    });

    const address = await pool.query<{ customer_address_id: string }>(
      `INSERT INTO marketplace.customer_addresses
         (customer_address_id,user_id,address_reference,label,pin_code,coordinates,
          request_id,correlation_id)
       VALUES ($1,$2,$6,'SYNTH Discovery Home','302001',
         ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,$5)
       RETURNING customer_address_id`,
      [
        createUuidV7(),
        customerId,
        jaipur.longitude,
        jaipur.latitude,
        createUuidV7(),
        // Unique per run: address_reference is globally unique, so a fixed
        // value let this script succeed exactly once per database.
        `SYNTH-ADDRESS-DISCOVERY-${customerId.replaceAll('-', '').slice(-10).toUpperCase()}`,
      ],
    );
    const addressId = address.rows[0]?.customer_address_id;
    check(typeof addressId === 'string', 'Fixture address was not created');

    // A second zone over the same street: the nearest store now reaches the
    // address twice over, and must still be listed once. Joining the zones
    // themselves listed it once per covering zone.
    await pool.query(
      `INSERT INTO marketplace.vendor_service_zones
         (service_zone_id,vendor_location_id,zone_name,operating_timezone,boundary,
          lifecycle_state,request_id,correlation_id)
       SELECT $1, vendor_location_id, 'SYNTH Second Zone', operating_timezone, boundary,
              'ACTIVE', request_id, correlation_id
         FROM marketplace.vendor_service_zones WHERE vendor_location_id=$2 LIMIT 1`,
      [createUuidV7(), near.locationId],
    );

    // 1. Discovery returns only the eligible, published, in-zone store, nearest first.
    const stores = await discovery.discoverStores({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      now,
    });
    check(
      stores.length === 2 &&
        stores[0]?.vendor_location_id === near.locationId &&
        stores[1]?.vendor_location_id === midtown.locationId,
      `Discovery did not resolve exactly the in-zone published stores once each, nearest first (${JSON.stringify(
        stores.map((store) => store.vendor_location_id),
      )})`,
    );
    // D-17: the distance a store is listed at is the road, and it says where
    // it came from. No maps provider is configured here, so the road is the
    // labelled estimate -- the straight line times the road factor -- and the
    // travel time follows from it.
    const midtownLine = await pool.query<{ metres: string }>(
      `SELECT ST_Distance(l.coordinates, a.coordinates)::text AS metres
         FROM marketplace.vendor_locations l, marketplace.customer_addresses a
        WHERE l.vendor_location_id=$1 AND a.customer_address_id=$2`,
      [midtown.locationId, addressId],
    );
    const midtownRoad = Math.round(Number(midtownLine.rows[0]?.metres) * ESTIMATE_ROAD_FACTOR);
    check(
      stores[1] !== undefined &&
        stores[1].distance_source === 'ESTIMATE' &&
        // The estimate is spherical and PostGIS is spheroidal: a quarter of a
        // percent apart at ten kilometres.
        Math.abs(stores[1].distance_meters - midtownRoad) <= midtownRoad * 0.005 &&
        stores[1].travel_seconds === Math.max(60, Math.round(stores[1].distance_meters / 5)) &&
        stores[0]?.distance_meters === 0 &&
        stores[0].travel_seconds === 60,
      `Stores are not listed at their road distance with its source (${JSON.stringify(stores.map((s) => [s.distance_meters, s.travel_seconds, s.distance_source]))}, expected road ${midtownRoad})`,
    );
    check(
      !stores.some((store) => store.vendor_location_id === far.locationId),
      'Discovery returned a store whose zone does not cover the address',
    );
    check(stores[0]?.is_open_now === true, 'A store open all day was not reported open');

    // 1b. The same feed, before sign-in.
    const eventsBeforePublicBrowsing = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.customer_discovery_events',
    );
    //
    // Discovery used to require a saved address, so nothing was visible until a
    // visitor had created an account — while architecture.md §6.1 asks for
    // public store pages. The coordinate origin must resolve exactly the same
    // eligible, published, in-zone store as the address origin.
    const publicStores = await discovery.discoverStoresNear({ ...jaipur, now });
    check(
      publicStores.length === 2 &&
        publicStores[0]?.vendor_location_id === near.locationId &&
        publicStores[1]?.vendor_location_id === midtown.locationId,
      'Public discovery did not resolve the same stores as the address-scoped feed',
    );
    // Out of zone stays out of zone: a public caller cannot see a shop that
    // cannot serve the point they gave.
    const farFromEverything = await discovery.discoverStoresNear({ ...mumbai, now });
    check(
      !farFromEverything.some((store) => store.vendor_location_id === near.locationId),
      'Public discovery ignored the service zone',
    );
    await rejects(
      () => discovery.discoverStoresNear({ latitude: 91, longitude: 75.81, now }),
      CustomerDiscoveryInputError,
      'An impossible latitude was accepted',
    );

    // The public store page is the same page, and only for a published store.
    const publicPage = await discovery.publicStorefront({ vendor_location_id: near.locationId });
    check(
      publicPage.location_name.length > 0 && publicPage.products.length >= 0,
      'The public storefront did not project the store',
    );

    // Browsing anonymously leaves no per-person trace: discovery events and the
    // recent-search list both belong to a user, and a visitor is not one.
    const eventsAfterPublicBrowsing = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.customer_discovery_events',
    );
    check(
      eventsAfterPublicBrowsing.rows[0]?.count === eventsBeforePublicBrowsing.rows[0]?.count,
      'Anonymous browsing wrote a per-user discovery event',
    );

    // 2. A funnel event was recorded for the discovery call.
    const discoveryEvents = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.customer_discovery_events
        WHERE user_id=$1 AND event_type='STORE_DISCOVERY'`,
      [customerId],
    );
    check(discoveryEvents.rows[0]?.count === '1', 'Discovery did not record a funnel event');

    // Requirement 3 asks for pagination and deterministic ordering, and neither was
    // exercised. `limit` and `offset` are optional parameters, so dropping them from the
    // query entirely would have changed nothing any assertion could see.
    //
    // Run 34 could only prove the parameters reached the query, because the fixture
    // published a single in-zone store and there was no second page to ask for. With
    // two eligible stores the real property is testable: consecutive pages must return
    // different stores, in the same order the unpaginated feed returned them, and the
    // page after the last must be empty.
    const firstPage = await discovery.discoverStores({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      limit: 1,
      now,
      offset: 0,
    });
    const beyondLastPage = await discovery.discoverStores({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      limit: 1,
      now,
      offset: 1,
    });
    const beyondEveryPage = await discovery.discoverStores({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      limit: 1,
      now,
      offset: 2,
    });
    check(firstPage.length === 1, 'The first discovery page did not honour its limit');
    check(
      firstPage[0]?.vendor_location_id === near.locationId,
      'The first discovery page did not start at the nearest store',
    );
    check(
      beyondLastPage.length === 1 && beyondLastPage[0]?.vendor_location_id === midtown.locationId,
      'The second discovery page did not continue where the first ended',
    );
    check(
      beyondEveryPage.length === 0,
      'An offset past the last result still returned a store, so offset is ignored',
    );
    const pagedEvents = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.customer_discovery_events
        WHERE user_id=$1 AND event_type='STORE_DISCOVERY'`,
      [customerId],
    );
    check(
      pagedEvents.rows[0]?.count === '4',
      'Paginated discovery calls were not recorded in the funnel',
    );

    // 3. Build a real catalogue product and inventory row for the near store,
    // then confirm the storefront joins price and freshness correctly.
    const product = await catalogue.createProduct({
      context: vendorContext(near.ownerUserId),
      vendor_location_id: near.locationId,
      product_reference: 'SYNTH-PROD-DISCOVERY',
      title: 'SYNTH Discovery Tomato',
      category: 'FRUIT_VEGETABLE',
      unit_label: 'CRATE',
      tax_basis: 'EXEMPT',
      variable_weight: false,
      sku: 'SYNTH-SKU-DISCOVERY',
      variant_title: 'SYNTH Discovery Tomato Crate',
      price_minor: 18000,
      // `createProduct` provisions the inventory row keyed by
      // (vendor_location_id, product_reference) so discovery does not treat a
      // new product as stale; creating one separately duplicated that unique
      // key. Supplying the stock here is what makes it a COUNTED item.
      initial_stock_quantity: 40,
      low_stock_threshold: 5,
      now,
    });

    // Requirement 2 ranks available results ahead of unavailable ones, and the
    // fixture published exactly one product -- so the ORDER BY could have been
    // deleted entirely and every assertion would still have passed. A second
    // product in the same category, out of stock, is what makes the ordering
    // observable. It deliberately avoids the word "discovery" so the existing
    // single-result assertions keep their meaning.
    const outOfStock = await catalogue.createProduct({
      context: vendorContext(near.ownerUserId),
      vendor_location_id: near.locationId,
      product_reference: 'SYNTH-PROD-SOLDOUT',
      title: 'SYNTH Basket Onion',
      category: 'FRUIT_VEGETABLE',
      unit_label: 'CRATE',
      tax_basis: 'EXEMPT',
      variable_weight: false,
      sku: 'SYNTH-SKU-SOLDOUT',
      variant_title: 'SYNTH Basket Onion Crate',
      price_minor: 9000,
      initial_stock_quantity: 0,
      low_stock_threshold: 5,
      now,
    });

    // A product in the distant in-zone store, in a different category so it stays
    // out of the FRUIT_VEGETABLE ranking and category assertions above. This is
    // what makes the distance filter observable.
    const midtownProduct = await catalogue.createProduct({
      context: vendorContext(midtown.ownerUserId),
      vendor_location_id: midtown.locationId,
      product_reference: 'SYNTH-PROD-MIDTOWN',
      title: 'SYNTH Midtown Milk',
      category: 'DAIRY_EGGS',
      unit_label: 'PACK',
      tax_basis: 'EXEMPT',
      variable_weight: false,
      sku: 'SYNTH-SKU-MIDTOWN',
      variant_title: 'SYNTH Midtown Milk Pack',
      price_minor: 5000,
      initial_stock_quantity: 25,
      low_stock_threshold: 5,
      now,
    });

    // A loose product with a weight bound, so the storefront's variable-weight
    // estimate (6.5 requirement 3) is observable rather than always null. In a
    // category of its own so the FRUIT_VEGETABLE ranking and filter assertions
    // below keep their exact counts.
    const loose = await catalogue.createProduct({
      context: vendorContext(near.ownerUserId),
      vendor_location_id: near.locationId,
      product_reference: 'SYNTH-PROD-LOOSE',
      title: 'SYNTH Loose Pumpkin',
      category: 'STAPLES',
      unit_label: 'KG',
      tax_basis: 'EXEMPT',
      variable_weight: true,
      permitted_weight_variance_bps: 1000,
      sku: 'SYNTH-SKU-LOOSE',
      variant_title: 'SYNTH Loose Pumpkin Kilo',
      price_minor: 4000,
      initial_stock_quantity: 12,
      low_stock_threshold: 2,
      now,
    });

    const storefront = await discovery.storefront({
      context: context(customerId),
      vendor_location_id: near.locationId,
      now,
    });
    const listed = storefront.products.find(
      (p) => p.catalogue_product_id === product.catalogue_product_id,
    );
    check(listed !== undefined, 'Storefront did not list the created product');
    check(listed.price_minor === 18000, 'Storefront price did not resolve from catalogue prices');
    check(
      listed.availability_state === 'AVAILABLE',
      'Storefront did not resolve live availability',
    );
    check(!listed.is_stale, 'A product with a confirmed inventory row was reported stale');

    // 6.5 requirement 3: availability freshness is the 5.7 tier, not merely
    // "has an inventory row". Confirmed at `now`, the stock is FRESH; read an
    // hour and a minute later it is EXPIRED, and the confirmation time is
    // carried so a client can say when. Neither tier hides the product.
    check(
      listed.freshness === 'FRESH' &&
        listed.last_confirmed_at !== null &&
        listed.last_confirmed_at.getTime() === now.getTime(),
      'A just-confirmed product was not reported FRESH with its confirmation time',
    );
    const later = await discovery.publicStorefront({
      vendor_location_id: near.locationId,
      now: new Date(now.getTime() + 61 * 60_000),
    });
    const listedLater = later.products.find(
      (p) => p.catalogue_product_id === product.catalogue_product_id,
    );
    check(
      listedLater?.freshness === 'EXPIRED' && listedLater.is_stale === false,
      'A confirmation over an hour old was not reported EXPIRED, or hid the product',
    );
    check(
      listedLater.availability_state === 'AVAILABLE',
      'An expired confirmation changed the availability state itself',
    );
    const listedLoose = storefront.products.find(
      (p) => p.catalogue_product_id === loose.catalogue_product_id,
    );
    check(
      listedLoose?.variable_weight === true && listedLoose.permitted_weight_variance_bps === 1000,
      'The loose product did not carry its permitted weight variance',
    );
    check(
      listed.permitted_weight_variance_bps === null,
      'A packaged product carried a weight variance',
    );

    // 6.5 requirement 5: no cross-vendor catalogue mixing. The midtown store's
    // product is published and in zone, and must not appear on the near store's
    // page, nor the near store's on midtown's.
    const midtownPage = await discovery.publicStorefront({
      vendor_location_id: midtown.locationId,
      now,
    });
    check(
      !storefront.products.some(
        (p) => p.catalogue_product_id === midtownProduct.catalogue_product_id,
      ) &&
        !midtownPage.products.some((p) => p.catalogue_product_id === product.catalogue_product_id),
      'A storefront listed another vendor’s product',
    );
    check(
      midtownPage.products.some(
        (p) => p.catalogue_product_id === midtownProduct.catalogue_product_id,
      ),
      'The midtown storefront did not list its own product',
    );

    // 4. A store the customer never viewed is not reachable through the
    // storefront endpoint; an unpublished/absent location resolves not-found.
    await rejects(
      () =>
        discovery.storefront({
          context: context(customerId),
          vendor_location_id: createUuidV7(),
        }),
      CustomerDiscoveryNotFoundError,
      'An unknown vendor location resolved a storefront',
    );

    // 5. Search ranks available products first and records a zero-result event
    // when nothing matches; it stays scoped to eligible stores.
    const results = await discovery.searchProducts({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      term: 'discovery',
      now,
    });
    check(
      results.length === 1 && results[0]?.is_available === true,
      `Search did not resolve the available product for the eligible store once (${results.length})`,
    );

    // The same ranked search, before sign-in, from the same point.
    const publicHits = await discovery.searchProductsNear({ ...jaipur, term: 'discovery' });
    check(
      publicHits.length === 1 &&
        publicHits[0]?.catalogue_product_id === results[0]?.catalogue_product_id,
      'Public search did not resolve the same product as the address-scoped search',
    );
    const recentBefore = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.customer_recent_searches',
    );
    await discovery.searchProductsNear({ ...jaipur, term: 'discovery' });
    const recentAfter = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.customer_recent_searches',
    );
    check(
      recentBefore.rows[0]?.count === recentAfter.rows[0]?.count,
      "An anonymous search was written to somebody's recent-search history",
    );
    const zero = await discovery.searchProducts({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      term: 'nonexistentproductterm',
      now,
    });
    check(zero.length === 0, 'Search returned results for a term that matches nothing');
    const zeroEvents = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.customer_discovery_events
        WHERE user_id=$1 AND event_type='SEARCH_ZERO_RESULT'`,
      [customerId],
    );
    check(zeroEvents.rows[0]?.count === '1', 'A zero-result search left no funnel evidence');

    // Requirement 2: available ranks ahead of unavailable. The category term
    // matches both products, so the order is the only thing under test.
    const ranked = await discovery.searchProducts({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      term: 'FRUIT_VEGETABLE',
      now,
    });
    check(ranked.length === 2, 'A category term did not match both products in that category');
    check(
      ranked[0]?.catalogue_product_id === product.catalogue_product_id &&
        ranked[0]?.is_available === true,
      'Search did not rank the available product first',
    );
    check(
      ranked[1]?.catalogue_product_id === outOfStock.catalogue_product_id &&
        ranked[1]?.is_available === false,
      'Search did not rank the out-of-stock product last',
    );

    // Requirement 3: the approved filters. Every one of the four was accepted
    // and none was exercised, so each could have been dropped from the WHERE
    // clause unnoticed -- a customer filtering to in-stock items would have
    // been shown sold-out ones.
    const availableOnly = await discovery.searchProducts({
      available_only: true,
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      term: 'FRUIT_VEGETABLE',
      now,
    });
    check(
      availableOnly.length === 1 &&
        availableOnly[0]?.catalogue_product_id === product.catalogue_product_id,
      'The available-only filter still returned an out-of-stock product',
    );
    const wrongCategory = await discovery.searchProducts({
      category: 'DAIRY_EGGS',
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      term: 'FRUIT_VEGETABLE',
      now,
    });
    check(wrongCategory.length === 0, 'The category filter did not exclude another category');
    const unsupportedMode = await discovery.searchProducts({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      fulfilment_mode: 'SYNTH_UNSUPPORTED_MODE',
      term: 'FRUIT_VEGETABLE',
      now,
    });
    check(
      unsupportedMode.length === 0,
      'The fulfilment-mode filter matched a mode the store does not offer',
    );
    const nearAndFar = await discovery.searchProducts({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      term: 'milk',
      now,
    });
    check(
      nearAndFar.some((hit) => hit.catalogue_product_id === midtownProduct.catalogue_product_id),
      'Search did not reach a product in the more distant in-zone store',
    );
    const tooFar = await discovery.searchProducts({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      // The midtown store is about ten kilometres away, so this excludes it and
      // nothing else. Asserting against the near store was impossible: it sits on
      // the customer's own coordinates, so its distance is zero.
      max_distance_meters: 5000,
      term: 'milk',
      now,
    });
    check(tooFar.length === 0, 'The maximum-distance filter did not exclude a distant store');

    // Requirement 1 also lists store names as a term kind. "Greenfield" appears in
    // the store's name and in none of its product titles, so nothing but the
    // store-name branch can produce this hit.
    const byStoreName = await discovery.searchProducts({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      term: 'greenfield',
      now,
    });
    check(
      byStoreName.some((hit) => hit.catalogue_product_id === midtownProduct.catalogue_product_id),
      'Searching a store by name returned none of its products',
    );

    // Requirement 5's other half. SEARCH_TO_CART was a member of the event-type
    // union that nothing ever wrote, so search-to-cart conversion -- named in the
    // requirement alongside zero-result -- could not be measured at all.
    await discovery.recordSearchToCart({ context: context(customerId), now });
    const conversionEvents = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.customer_discovery_events
        WHERE user_id=$1 AND event_type='SEARCH_TO_CART'`,
      [customerId],
    );
    check(
      conversionEvents.rows[0]?.count === '1',
      'A search-to-cart conversion left no funnel evidence',
    );

    // Requirement 1: Hindi, transliteration, synonym and misspelling all have
    // to reach the same tomato. Nothing exercised the synonym table, so it
    // could have been emptied without a single assertion noticing.
    for (const [term, label] of [
      ['tamatar', 'a transliterated Hindi term'],
      ['टमाटर', 'a Devanagari term'],
      ['tomatoe', 'a common misspelling'],
    ] as const) {
      const hits = await discovery.searchProductsNear({ ...jaipur, term });
      check(
        hits.some((hit) => hit.catalogue_product_id === product.catalogue_product_id),
        `Search did not resolve the tomato for ${label} (${term})`,
      );
    }

    // 6. Recent searches are stored, deduplicated, and deletable.
    await discovery.searchProducts({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      term: 'discovery',
      now,
    });
    const recents = await discovery.recentSearches({ context: context(customerId) });
    check(
      recents.filter((r) => r.display_term === 'discovery').length === 1,
      'A repeated search term was stored more than once',
    );
    await discovery.deleteRecentSearch({ context: context(customerId), display_term: 'discovery' });
    const afterDelete = await discovery.recentSearches({ context: context(customerId) });
    check(
      !afterDelete.some((r) => r.display_term === 'discovery'),
      'Deleting a recent search left it in the list',
    );

    // 7. Favourites: added, listed with eligibility derived from the address,
    // idempotent on a repeat, refused for a store that does not exist, and
    // actually removed -- the removal had never been asserted, so its DELETE
    // could have been dropped unnoticed.
    await discovery.addFavourite({
      context: context(customerId),
      vendor_location_id: near.locationId,
      now,
    });
    await discovery.addFavourite({
      context: context(customerId),
      vendor_location_id: near.locationId,
      now,
    });
    await discovery.addFavourite({
      context: context(customerId),
      vendor_location_id: far.locationId,
      now,
    });
    await rejects(
      () =>
        discovery.addFavourite({
          context: context(customerId),
          vendor_location_id: createUuidV7(),
          now,
        }),
      CustomerDiscoveryNotFoundError,
      'Favouriting a store that does not exist was not refused as not found',
    );
    const favourites = await discovery.listFavourites({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
    });
    check(favourites.length === 2, 'Favouriting the same store twice listed it twice');
    const nearFavourite = favourites.find((f) => f.vendor_location_id === near.locationId);
    const farFavourite = favourites.find((f) => f.vendor_location_id === far.locationId);
    check(
      nearFavourite?.is_currently_eligible === true,
      'An in-zone favourite reported ineligible',
    );
    check(
      farFavourite?.is_currently_eligible === false,
      'An out-of-zone favourite reported eligible',
    );
    await discovery.removeFavourite({
      context: context(customerId),
      vendor_location_id: far.locationId,
    });
    const afterRemoval = await discovery.listFavourites({ context: context(customerId) });
    check(
      afterRemoval.length === 1 && afterRemoval[0]?.vendor_location_id === near.locationId,
      'Removing a favourite did not remove it',
    );

    // Preferred store: exactly one, refused for an unknown store, and shown
    // with its eligibility from the address in hand rather than dropped when
    // the store cannot serve that address. The earlier assertion read the same
    // preference twice with nothing changed between the reads; this one sets
    // an out-of-zone store and asks the question the requirement asks.
    await rejects(
      () =>
        discovery.setPreferredStore({
          context: context(customerId),
          vendor_location_id: createUuidV7(),
          now,
        }),
      CustomerDiscoveryNotFoundError,
      'Preferring a store that does not exist was not refused as not found',
    );
    await discovery.setPreferredStore({
      context: context(customerId),
      vendor_location_id: far.locationId,
      now,
    });
    const preferredFar = await discovery.preferredStore({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
    });
    check(
      preferredFar?.vendor_location_id === far.locationId,
      'Setting a preferred store did not persist it',
    );
    check(
      preferredFar?.is_currently_eligible === false,
      'A preferred store outside the address zone was reported eligible',
    );
    check(
      preferredFar?.location_name === 'SYNTH Far Store',
      'The preferred store came back without its name',
    );
    await discovery.setPreferredStore({
      context: context(customerId),
      vendor_location_id: near.locationId,
      now,
    });
    const preferredNear = await discovery.preferredStore({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
    });
    check(
      preferredNear?.vendor_location_id === near.locationId &&
        preferredNear.is_currently_eligible === true,
      'Changing the preferred store did not replace the earlier one, or lost its eligibility',
    );
    const preferredCount = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM marketplace.customer_preferred_store WHERE user_id = $1',
      [customerId],
    );
    check(
      preferredCount.rows[0]?.count === '1',
      'A customer ended up with more than one preferred store',
    );
    await discovery.clearPreferredStore({ context: context(customerId) });
    check(
      (await discovery.preferredStore({ context: context(customerId) })) === null,
      'Clearing the preferred store left it set',
    );

    // 8. A shop request is created once; a duplicate open request in the same
    // pin is refused, but a new pin is accepted.
    const firstRequest = await discovery.requestShop({
      context: context(customerId),
      pin_code: '302001',
      ...jaipur,
      store_name: 'SYNTH Missing Neighbourhood Store',
      note: '  Opposite the park  ',
      now,
    });
    await rejects(
      () =>
        discovery.requestShop({
          context: context(customerId),
          pin_code: '302001',
          ...jaipur,
          store_name: 'SYNTH Missing Neighbourhood Store Duplicate',
          now,
        }),
      CustomerDiscoveryConflictError,
      'A second open shop request in the same pin was accepted',
    );
    // Submitted a minute *earlier* than the first request, so "oldest first"
    // is observable: heap order alone would list the first request first.
    const secondPin = await discovery.requestShop({
      context: context(customerId),
      pin_code: '400001',
      ...mumbai,
      store_name: 'SYNTH Missing Store In Another Area',
      now: new Date(now.getTime() - 60_000),
    });
    check(secondPin.lifecycle_state === 'OPEN', 'A request in a different pin was refused');
    // The service accepted any letter while the table accepted ASCII only, so
    // a shop named in Hindi was a server fault after passing validation.
    const hindi = await discovery
      .requestShop({
        context: context(customerId),
        pin_code: '500001',
        ...jaipur,
        store_name: 'शर्मा किराना',
        now,
      })
      .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    check(
      !(hindi instanceof Error) && hindi.store_name === 'शर्मा किराना',
      `A shop named in Hindi could not be requested (${String(hindi)})`,
    );

    // 9. The pipeline side (requirement 4). A request used to be written and
    // never read: TRIAGED and CLOSED were unreachable. An operator now sees the
    // queue, triages a request into an onboarding lead, and closes one with the
    // reason -- after which the customer may ask again for the same pin.
    const operatorId = createUuidV7();
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [operatorId],
    );
    await rejects(
      () => discovery.listShopRequests({ context: context(customerId) }),
      Error,
      'A customer read the shop-request queue',
    );
    const queue = await discovery.listShopRequests({
      context: adminContext(operatorId),
      state: 'OPEN',
    });
    const queuedFirst = queue.find(
      (entry) => entry.customer_shop_request_id === firstRequest.customer_shop_request_id,
    );
    check(
      queuedFirst?.pin_code === '302001' &&
        queuedFirst.note === 'Opposite the park' &&
        Math.abs(queuedFirst.latitude - jaipur.latitude) < 1e-6 &&
        Math.abs(queuedFirst.longitude - jaipur.longitude) < 1e-6,
      'The open queue did not carry the request as the customer submitted it',
    );
    check(
      !('user_id' in (queuedFirst ?? {})),
      'The shop-request queue exposed the customer identity',
    );
    check(
      queue.findIndex((e) => e.customer_shop_request_id === secondPin.customer_shop_request_id) <
        queue.findIndex(
          (e) => e.customer_shop_request_id === firstRequest.customer_shop_request_id,
        ),
      'The queue is not oldest first',
    );
    // The table refuses the states the service could reach by mistake: a
    // close without a reason, and a move nobody is recorded as having made.
    await rejects(
      () =>
        pool.query(
          `UPDATE marketplace.customer_shop_requests SET lifecycle_state = 'CLOSED', handled_by_user_id = $2
            WHERE customer_shop_request_id = $1`,
          [firstRequest.customer_shop_request_id, operatorId],
        ),
      Error,
      'The table let a request close without a reason',
    );
    await rejects(
      () =>
        pool.query(
          `UPDATE marketplace.customer_shop_requests SET lifecycle_state = 'TRIAGED'
            WHERE customer_shop_request_id = $1`,
          [firstRequest.customer_shop_request_id],
        ),
      Error,
      'The table let a request move with nobody recorded as handling it',
    );

    await rejects(
      () =>
        discovery.triageShopRequest({
          context: adminContext(operatorId),
          customer_shop_request_id: firstRequest.customer_shop_request_id,
          onboarding_case_id: createUuidV7(),
          now,
        }),
      CustomerDiscoveryNotFoundError,
      'Triage into an onboarding case that does not exist was not refused',
    );
    const leadRoot = await mkdtemp(join(tmpdir(), 'discovery-verifier-'));
    const onboarding = new VendorOnboardingService({
      connection_string: connectionString,
      storage: new LocalProtectedObjectStorage({
        grant_key: 'synthetic-discovery-verifier-grant-key-0001',
        root_directory: leadRoot,
      }),
    });
    let leadId: UuidV7;
    try {
      leadId = await onboarding.createLead({ context: adminContext(operatorId), now });
    } finally {
      await onboarding.close();
      await rm(leadRoot, { force: true, recursive: true });
    }
    const triaged = await discovery.triageShopRequest({
      context: adminContext(operatorId),
      customer_shop_request_id: firstRequest.customer_shop_request_id,
      onboarding_case_id: leadId,
      now,
    });
    check(
      triaged.lifecycle_state === 'TRIAGED' && triaged.onboarding_case_id === leadId,
      'Triage did not move the request or link the onboarding lead',
    );
    await rejects(
      () =>
        discovery.triageShopRequest({
          context: adminContext(operatorId),
          customer_shop_request_id: firstRequest.customer_shop_request_id,
          now,
        }),
      CustomerDiscoveryConflictError,
      'A triaged request was triaged again',
    );
    await rejects(
      () =>
        discovery.closeShopRequest({
          context: adminContext(operatorId),
          customer_shop_request_id: secondPin.customer_shop_request_id,
          resolution: '   ',
          now,
        }),
      CustomerDiscoveryInputError,
      'A request was closed without a reason',
    );
    const closed = await discovery.closeShopRequest({
      context: adminContext(operatorId),
      customer_shop_request_id: secondPin.customer_shop_request_id,
      resolution: 'No serviceable zone in this pin yet',
      now,
    });
    check(
      closed.lifecycle_state === 'CLOSED' &&
        closed.resolution === 'No serviceable zone in this pin yet',
      'Closing did not record the state and the reason',
    );
    await rejects(
      () =>
        discovery.closeShopRequest({
          context: adminContext(operatorId),
          customer_shop_request_id: secondPin.customer_shop_request_id,
          resolution: 'Again',
          now,
        }),
      CustomerDiscoveryConflictError,
      'A closed request was closed again',
    );
    await rejects(
      () =>
        discovery.closeShopRequest({
          context: adminContext(operatorId),
          customer_shop_request_id: createUuidV7(),
          resolution: 'Nothing here',
          now,
        }),
      CustomerDiscoveryNotFoundError,
      'Closing a request that does not exist was not refused as not found',
    );
    const openAfter = await discovery.listShopRequests({
      context: adminContext(operatorId),
      state: 'OPEN',
    });
    check(
      !openAfter.some((e) =>
        [firstRequest.customer_shop_request_id, secondPin.customer_shop_request_id].includes(
          e.customer_shop_request_id,
        ),
      ),
      'Handled requests still appear in the open queue',
    );
    const again = await discovery.requestShop({
      context: context(customerId),
      pin_code: '400001',
      ...mumbai,
      store_name: 'SYNTH Missing Store In Another Area Again',
      now,
    });
    check(
      again.lifecycle_state === 'OPEN',
      'A customer could not ask again for a pin once the earlier request was closed',
    );

    // 10. Input and actor boundaries are enforced.
    await rejects(
      () =>
        discovery.requestShop({
          context: context(customerId),
          pin_code: '02001',
          ...jaipur,
          store_name: 'SYNTH Bad Pin Store',
          now,
        }),
      CustomerDiscoveryInputError,
      'An invalid pin code was accepted for a shop request',
    );
    await rejects(
      () =>
        discovery.discoverStores({
          context: createRequestContext({}),
          customer_address_id: addressId as UuidV7,
        }),
      Error,
      'An unauthenticated caller discovered stores',
    );
  } finally {
    await discovery.close();
    await catalogue.close();
    await inventory.close();
    await pool.end();
  }
}
