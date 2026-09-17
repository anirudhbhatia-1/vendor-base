/**
 * Seeds a browsable synthetic marketplace for local development.
 *
 * `db:seed` loads the reference-module fixtures only, so a freshly migrated
 * database has no vendor, no catalogue and no customer: running the apps
 * against it shows four correct, entirely empty screens, and nothing about the
 * shopping experience can be seen or tested. Every existing path to real data
 * ran inside a `verify-*` script that tore its own fixtures down again.
 *
 * Creates, idempotently by phone identity and store name:
 *   - a customer with a phone identity, a saved Jaipur address, and consent to
 *     sign in by OTP
 *   - three published, in-zone vendor locations with real service polygons
 *   - a priced, stocked catalogue for each
 *
 * Usage: pnpm db:seed:marketplace
 * Environment:
 *   DATABASE_URL       local database
 *   OTP_HASH_KEY       must match the API's, or the seeded phone cannot sign in
 *   CUSTOMER_PHONE     default SYNTH-PHONE-CUSTOMER-001
 */
import { createHmac } from 'node:crypto';
import process from 'node:process';
import { Pool } from 'pg';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';

const connectionString =
  process.env['DATABASE_URL'] ??
  'postgresql://marketplace_local:marketplace_local_only@127.0.0.1:5432/neighbourhood_store_local';
const hashKey =
  process.env['OTP_HASH_KEY'] ??
  ['local', 'synthetic', 'otp', 'hash', 'material', 'only'].join('-');
const customerPhone = process.env['CUSTOMER_PHONE'] ?? 'SYNTH-PHONE-CUSTOMER-001';

/** Mansarovar, Jaipur — the pilot neighbourhood the fixtures are written around. */
const JAIPUR = { latitude: 26.8505, longitude: 75.7628 };

type SeedProduct = {
  readonly reference: string;
  readonly title: string;
  readonly category: string;
  readonly unit: string;
  readonly sku: string;
  readonly variant: string;
  readonly priceMinor: number;
  readonly variableWeight: boolean;
  /** Required for a loose item: how far the weighed amount may differ (CUS-27). */
  readonly varianceBps?: number;
  readonly stock: number;
};

const STORES: readonly {
  readonly name: string;
  readonly offset: readonly [number, number];
  readonly products: readonly SeedProduct[];
}[] = [
  {
    name: 'SYNTH Sharma Fresh Sabzi',
    offset: [0.004, 0.003],
    products: [
      {
        reference: 'SYNTH-PROD-TOMATO',
        title: 'SYNTH Tomato',
        category: 'FRUIT_VEGETABLE',
        unit: 'KG',
        sku: 'SYNTH-SKU-TOMATO',
        variant: 'SYNTH Tomato Loose',
        priceMinor: 4000,
        variableWeight: true,
        varianceBps: 1000,
        stock: 60,
      },
      {
        reference: 'SYNTH-PROD-ONION',
        title: 'SYNTH Onion',
        category: 'FRUIT_VEGETABLE',
        unit: 'KG',
        sku: 'SYNTH-SKU-ONION',
        variant: 'SYNTH Onion Loose',
        priceMinor: 3500,
        variableWeight: true,
        varianceBps: 1000,
        stock: 80,
      },
      {
        reference: 'SYNTH-PROD-POTATO',
        title: 'SYNTH Potato',
        category: 'FRUIT_VEGETABLE',
        unit: 'KG',
        sku: 'SYNTH-SKU-POTATO',
        variant: 'SYNTH Potato Loose',
        priceMinor: 3000,
        variableWeight: true,
        varianceBps: 1000,
        stock: 100,
      },
      {
        reference: 'SYNTH-PROD-SPINACH',
        title: 'SYNTH Palak Bunch',
        category: 'FRUIT_VEGETABLE',
        unit: 'BUNCH',
        sku: 'SYNTH-SKU-SPINACH',
        variant: 'SYNTH Palak Bunch',
        priceMinor: 2500,
        variableWeight: false,
        stock: 25,
      },
      {
        reference: 'SYNTH-PROD-BANANA',
        title: 'SYNTH Banana',
        category: 'FRUIT_VEGETABLE',
        unit: 'DOZEN',
        sku: 'SYNTH-SKU-BANANA',
        variant: 'SYNTH Banana Dozen',
        priceMinor: 6000,
        variableWeight: false,
        stock: 40,
      },
      {
        reference: 'SYNTH-PROD-LEMON',
        title: 'SYNTH Lemon',
        category: 'FRUIT_VEGETABLE',
        unit: 'PACK',
        sku: 'SYNTH-SKU-LEMON',
        variant: 'SYNTH Lemon Pack',
        priceMinor: 2000,
        variableWeight: false,
        stock: 35,
      },
    ],
  },
  {
    name: 'SYNTH Verma Kirana Store',
    offset: [-0.005, 0.002],
    products: [
      {
        reference: 'SYNTH-PROD-ATTA',
        title: 'SYNTH Whole Wheat Atta',
        category: 'KIRANA',
        unit: 'PACK',
        sku: 'SYNTH-SKU-ATTA',
        variant: 'SYNTH Atta 5kg Pack',
        priceMinor: 24500,
        variableWeight: false,
        stock: 30,
      },
      {
        reference: 'SYNTH-PROD-RICE',
        title: 'SYNTH Basmati Rice',
        category: 'KIRANA',
        unit: 'PACK',
        sku: 'SYNTH-SKU-RICE',
        variant: 'SYNTH Basmati 1kg Pack',
        priceMinor: 14000,
        variableWeight: false,
        stock: 45,
      },
      {
        reference: 'SYNTH-PROD-TOORDAL',
        title: 'SYNTH Toor Dal',
        category: 'KIRANA',
        unit: 'PACK',
        sku: 'SYNTH-SKU-TOORDAL',
        variant: 'SYNTH Toor Dal 1kg',
        priceMinor: 17500,
        variableWeight: false,
        stock: 50,
      },
      {
        reference: 'SYNTH-PROD-MUSTARD-OIL',
        title: 'SYNTH Mustard Oil',
        category: 'KIRANA',
        unit: 'BOTTLE',
        sku: 'SYNTH-SKU-OILX',
        variant: 'SYNTH Mustard Oil 1L',
        priceMinor: 19000,
        variableWeight: false,
        stock: 28,
      },
      {
        reference: 'SYNTH-PROD-SUGAR',
        title: 'SYNTH Sugar',
        category: 'KIRANA',
        unit: 'PACK',
        sku: 'SYNTH-SKU-SUGAR',
        variant: 'SYNTH Sugar 1kg',
        priceMinor: 5500,
        variableWeight: false,
        stock: 60,
      },
      {
        reference: 'SYNTH-PROD-ASSAM-TEA',
        title: 'SYNTH Assam Tea',
        category: 'KIRANA',
        unit: 'PACK',
        sku: 'SYNTH-SKU-TEAX',
        variant: 'SYNTH Assam Tea 250g',
        priceMinor: 13000,
        variableWeight: false,
        stock: 22,
      },
      {
        reference: 'SYNTH-PROD-SALT',
        title: 'SYNTH Iodised Salt',
        category: 'KIRANA',
        unit: 'PACK',
        sku: 'SYNTH-SKU-SALT',
        variant: 'SYNTH Salt 1kg',
        priceMinor: 2800,
        variableWeight: false,
        stock: 70,
      },
    ],
  },
  {
    name: 'SYNTH Gupta Dairy Corner',
    offset: [0.002, -0.004],
    products: [
      {
        reference: 'SYNTH-PROD-MILK',
        title: 'SYNTH Full Cream Milk',
        category: 'DAIRY',
        unit: 'PACK',
        sku: 'SYNTH-SKU-MILK',
        variant: 'SYNTH Milk 500ml',
        priceMinor: 3400,
        variableWeight: false,
        stock: 90,
      },
      {
        reference: 'SYNTH-PROD-CURD',
        title: 'SYNTH Curd',
        category: 'DAIRY',
        unit: 'CUP',
        sku: 'SYNTH-SKU-CURD',
        variant: 'SYNTH Curd 400g',
        priceMinor: 4500,
        variableWeight: false,
        stock: 35,
      },
      {
        reference: 'SYNTH-PROD-PANEER',
        title: 'SYNTH Paneer',
        category: 'DAIRY',
        unit: 'PACK',
        sku: 'SYNTH-SKU-PANEER',
        variant: 'SYNTH Paneer 200g',
        priceMinor: 9500,
        variableWeight: false,
        stock: 18,
      },
      {
        reference: 'SYNTH-PROD-BUTTER',
        title: 'SYNTH Butter',
        category: 'DAIRY',
        unit: 'PACK',
        sku: 'SYNTH-SKU-BUTTER',
        variant: 'SYNTH Butter 100g',
        priceMinor: 6200,
        variableWeight: false,
        stock: 26,
      },
      {
        reference: 'SYNTH-PROD-GHEE',
        title: 'SYNTH Desi Ghee',
        category: 'DAIRY',
        unit: 'JAR',
        sku: 'SYNTH-SKU-GHEE',
        variant: 'SYNTH Ghee 500ml',
        priceMinor: 41000,
        variableWeight: false,
        stock: 12,
      },
    ],
  },
];

function vendorContext(userId: UuidV7): RequestContext {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'vendor_staff',
      session_id: createUuidV7(),
    }),
  });
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString });
  const catalogue = new CatalogueProductService({ connection_string: connectionString });
  const now = new Date();
  const oneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);

  try {
    // ── Customer ────────────────────────────────────────────────────────────
    const phoneHash = createHmac('sha256', hashKey).update(`phone:${customerPhone}`).digest('hex');
    const existing = await pool.query<{ user_id: string }>(
      'SELECT user_id FROM marketplace.phone_identities WHERE phone_lookup_hash = $1',
      [phoneHash],
    );
    let customerId: UuidV7;
    if (existing.rows[0]) {
      customerId = parseUuidV7(existing.rows[0].user_id);
      console.log(`Customer ${customerId} already exists for ${customerPhone}`);
    } else {
      customerId = createUuidV7({ now_ms: now.getTime() });
      await pool.query(
        `INSERT INTO marketplace.users (user_id, retention_review_at, created_at, updated_at)
         VALUES ($1,$2,$3,$3)`,
        [customerId, oneYear, now],
      );
      await pool.query(
        `INSERT INTO marketplace.phone_identities
           (phone_identity_id, user_id, phone_lookup_hash, retention_review_at,
            verified_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5,$5)`,
        [createUuidV7({ now_ms: now.getTime() }), customerId, phoneHash, oneYear, now],
      );
      console.log(`Created customer ${customerId} for ${customerPhone}`);
    }

    const address = await pool.query<{ customer_address_id: string }>(
      `INSERT INTO marketplace.customer_addresses
         (customer_address_id,user_id,address_reference,label,pin_code,coordinates,
          landmark,is_selected,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH-ADDRESS-SEED-HOME','SYNTH Home','302020',
         ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,
         'Near the water tank',true,$5,$5)
       ON CONFLICT (address_reference) DO UPDATE SET is_selected = true
       RETURNING customer_address_id`,
      [createUuidV7(), customerId, JAIPUR.longitude, JAIPUR.latitude, createUuidV7()],
    );
    console.log(`Address ${address.rows[0]?.customer_address_id} selected for the customer`);

    // ── Stores and catalogues ───────────────────────────────────────────────
    for (const store of STORES) {
      const already = await pool.query<{ vendor_location_id: string; owner: string }>(
        `SELECT l.vendor_location_id,
                (SELECT user_id FROM marketplace.staff_memberships m
                  WHERE m.vendor_location_id = l.vendor_location_id LIMIT 1) AS owner
           FROM marketplace.vendor_locations l WHERE l.location_name = $1`,
        [store.name],
      );
      const existingStore = already.rows[0];
      const [dLat, dLon] = store.offset;
      const fixture = existingStore?.owner
        ? {
            locationId: parseUuidV7(existingStore.vendor_location_id),
            ownerUserId: parseUuidV7(existingStore.owner),
          }
        : await createDiscoverableStoreFixture(pool, {
            location_name: store.name,
            latitude: JAIPUR.latitude + dLat,
            longitude: JAIPUR.longitude + dLon,
            fulfilment_modes: ['CUSTOMER_PICKUP', 'PLATFORM_DELIVERY'],
          });
      for (const product of store.products) {
        // Per product, not per store: a run that fails partway leaves a store
        // row behind, and a store-level guard would then skip its remaining
        // products for ever.
        const seeded = await pool.query(
          `SELECT 1 FROM marketplace.catalogue_products
            WHERE vendor_location_id = $1 AND product_reference = $2`,
          [fixture.locationId, product.reference],
        );
        if (!seeded.rows[0]) {
          await catalogue.createProduct({
            context: vendorContext(fixture.ownerUserId),
            vendor_location_id: fixture.locationId,
            product_reference: product.reference,
            title: product.title,
            category: product.category,
            unit_label: product.unit,
            tax_basis: 'EXEMPT',
            variable_weight: product.variableWeight,
            ...(product.varianceBps === undefined
              ? {}
              : { permitted_weight_variance_bps: product.varianceBps }),
            sku: product.sku,
            variant_title: product.variant,
            price_minor: product.priceMinor,
            // `createProduct` provisions the `inventory_items` row itself and
            // makes it COUNTED when a quantity is supplied. Creating the stock
            // row separately afterwards collided with that one, which is how
            // every seeded product ended up VENDOR_CONFIRMS with no quantity —
            // the collision was being swallowed and the counted row lost.
            initial_stock_quantity: product.stock,
            low_stock_threshold: 5,
            now,
          });
        }
      }
      console.log(`Store "${store.name}": ${store.products.length} products present`);
    }

    console.log('\nMarketplace seed complete. Sign in to the customer PWA as:');
    console.log(`  Phone: ${customerPhone}`);
    console.log('  OTP:   read it from marketplace.otp_protected_test_outbox');
  } finally {
    await catalogue.close();
    await pool.end();
  }
}

await main();
