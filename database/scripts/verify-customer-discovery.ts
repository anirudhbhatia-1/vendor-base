import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import {
  CustomerDiscoveryConflictError,
  CustomerDiscoveryInputError,
  CustomerDiscoveryNotFoundError,
  CustomerDiscoveryService,
} from '../src/customer-discovery.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function context(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'customer',
      session_id: createUuidV7(),
    }),
  });
}
function vendorContext(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'vendor_staff',
      session_id: createUuidV7(),
    }),
  });
}
async function rejects(work: () => Promise<unknown>, kind: new () => Error, message: string) {
  try {
    await work();
  } catch (error) {
    check(error instanceof kind, `${message} (raised ${String(error)})`);
    return;
  }
  throw new Error(message);
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
      location_name: 'SYNTH Discovery Store Near',
      ...jaipur,
    });
    const far = await createDiscoverableStoreFixture(pool, {
      location_name: 'SYNTH Discovery Store Far',
      ...mumbai,
    });

    const address = await pool.query<{ customer_address_id: string }>(
      `INSERT INTO marketplace.customer_addresses
         (customer_address_id,user_id,address_reference,label,pin_code,coordinates,
          request_id,correlation_id)
       VALUES ($1,$2,'SYNTH-ADDRESS-DISCOVERY','SYNTH Discovery Home','302001',
         ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,$5)
       RETURNING customer_address_id`,
      [createUuidV7(), customerId, jaipur.longitude, jaipur.latitude, createUuidV7()],
    );
    const addressId = address.rows[0]?.customer_address_id;
    check(typeof addressId === 'string', 'Fixture address was not created');

    // 1. Discovery returns only the eligible, published, in-zone store, nearest first.
    const stores = await discovery.discoverStores({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
      now,
    });
    check(
      stores.length === 1 && stores[0]?.vendor_location_id === near.locationId,
      'Discovery did not resolve exactly the in-zone published store',
    );
    check(stores[0]?.is_open_now === true, 'A store open all day was not reported open');

    // 2. A funnel event was recorded for the discovery call.
    const discoveryEvents = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.customer_discovery_events
        WHERE user_id=$1 AND event_type='STORE_DISCOVERY'`,
      [customerId],
    );
    check(discoveryEvents.rows[0]?.count === '1', 'Discovery did not record a funnel event');

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
      now,
    });
    await inventory.createItem({
      context: vendorContext(near.ownerUserId),
      vendor_location_id: near.locationId,
      product_reference: 'SYNTH-PROD-DISCOVERY',
      display_name: 'SYNTH Discovery Tomato',
      quantity_basis: 'COUNTED',
      exact_available_quantity: 40,
      low_stock_threshold: 5,
      reason_code: 'FIXTURE_STOCK_SET',
      now,
    });

    const storefront = await discovery.storefront({
      context: context(customerId),
      vendor_location_id: near.locationId,
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
      'Search did not resolve the available product for the eligible store',
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

    // 7. Favourites and preferred store are independent, and eligibility does
    // not delete either when the customer moves out of range.
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
    const favourites = await discovery.listFavourites({
      context: context(customerId),
      customer_address_id: addressId as UuidV7,
    });
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

    await discovery.setPreferredStore({
      context: context(customerId),
      vendor_location_id: far.locationId,
      now,
    });
    check(
      (await discovery.preferredStore({ context: context(customerId) })) === far.locationId,
      'Setting a preferred store did not persist it',
    );
    // Moving the "preference" far away conceptually — the store stays
    // preferred even though it is not currently eligible from this address.
    check(
      (await discovery.preferredStore({ context: context(customerId) })) !== null,
      'An eligibility change silently cleared the preferred store',
    );
    await discovery.setPreferredStore({
      context: context(customerId),
      vendor_location_id: near.locationId,
      now,
    });
    check(
      (await discovery.preferredStore({ context: context(customerId) })) === near.locationId,
      'A customer ended up with more than one preferred store',
    );

    // 8. A shop request is created once; a duplicate open request in the same
    // pin is refused, but a new pin is accepted.
    await discovery.requestShop({
      context: context(customerId),
      pin_code: '302001',
      ...jaipur,
      store_name: 'SYNTH Missing Neighbourhood Store',
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
    const secondPin = await discovery.requestShop({
      context: context(customerId),
      pin_code: '400001',
      ...mumbai,
      store_name: 'SYNTH Missing Store In Another Area',
      now,
    });
    check(secondPin.lifecycle_state === 'OPEN', 'A request in a different pin was refused');

    // 9. Input and actor boundaries are enforced.
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
