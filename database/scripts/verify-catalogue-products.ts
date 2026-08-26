import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  CatalogueImportConflictError,
  CatalogueImportInputError,
  CatalogueProductService,
} from '../src/catalogue-products.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function context(kind: 'admin' | 'vendor_staff' = 'vendor_staff') {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: createUuidV7(),
      actor_kind: kind,
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

const header =
  'product_reference,title,category,unit_label,tax_basis,sku,variant_title,price_minor,quantity_basis,exact_available_quantity,low_stock_threshold,variable_weight,permitted_weight_variance_bps\n';

export async function verifyCatalogueProducts(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const catalogue = new CatalogueProductService({ connection_string: connectionString });
  const vendorId = createUuidV7();
  const locationA = createUuidV7();
  const locationB = createUuidV7();
  const now = new Date('2026-08-25T09:00:00.000Z');
  try {
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id)
       VALUES ($1,'SYNTH Catalogue Vendor','Synthetic catalogue test vendor','ACTIVE',$2,$2)`,
      [vendorId, createUuidV7()],
    );
    for (const [locationId, name] of [
      [locationA, 'SYNTH Catalogue Store'],
      [locationB, 'SYNTH Rival Store'],
    ] as const) {
      await pool.query(
        `INSERT INTO marketplace.vendor_locations
          (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
           coordinates,category,lifecycle_state,request_id,correlation_id)
         VALUES ($1,$2,$3,'Synthetic catalogue location','Asia/Kolkata',
           ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
           'FRUIT_VEGETABLE','ACTIVE',$4,$4)`,
        [locationId, vendorId, name, createUuidV7()],
      );
    }

    // 1. A packaged product creates product, variant and an open-ended price.
    const created = await catalogue.createProduct({
      context: context(),
      vendor_location_id: locationA,
      product_reference: 'SYNTH-PROD-TOMATO',
      title: 'SYNTH Tomato Crate',
      category: 'FRUIT_VEGETABLE',
      unit_label: 'CRATE',
      tax_basis: 'EXEMPT',
      variable_weight: false,
      sku: 'SYNTH-SKU-TOMATO',
      variant_title: 'SYNTH Tomato Crate Five Kilogram',
      price_minor: 24000,
      now,
    });
    check(created.version === 1, 'A newly created product did not start at version one');
    const price = await pool.query<{ price_minor: string }>(
      `SELECT price_minor::text FROM marketplace.catalogue_prices
        WHERE catalogue_variant_id=$1 AND effective_until IS NULL`,
      [created.catalogue_variant_id],
    );
    check(price.rows[0]?.price_minor === '24000', 'Product creation did not open a current price');

    // 2. A duplicate product reference inside one location is refused.
    await rejects(
      () =>
        catalogue.createProduct({
          context: context(),
          vendor_location_id: locationA,
          product_reference: 'SYNTH-PROD-TOMATO',
          title: 'SYNTH Tomato Crate Duplicate',
          category: 'FRUIT_VEGETABLE',
          unit_label: 'CRATE',
          tax_basis: 'EXEMPT',
          variable_weight: false,
          sku: 'SYNTH-SKU-TOMATO-TWO',
          variant_title: 'SYNTH Tomato Crate Duplicate Variant',
          price_minor: 25000,
          now,
        }),
      CatalogueImportConflictError,
      'A duplicate product reference was accepted inside one vendor location',
    );

    // 3. A variable-weight product must carry a bounded variance; a packaged one must not.
    await rejects(
      () =>
        catalogue.createProduct({
          context: context(),
          vendor_location_id: locationA,
          product_reference: 'SYNTH-PROD-LOOSE',
          title: 'SYNTH Loose Spinach',
          category: 'FRUIT_VEGETABLE',
          unit_label: 'GRAM',
          tax_basis: 'EXEMPT',
          variable_weight: true,
          permitted_weight_variance_bps: 20000,
          sku: 'SYNTH-SKU-LOOSE',
          variant_title: 'SYNTH Loose Spinach Portion',
          price_minor: 4000,
          now,
        }),
      CatalogueImportInputError,
      'An out-of-range weight variance was accepted',
    );
    await rejects(
      () =>
        catalogue.createProduct({
          context: context(),
          vendor_location_id: locationA,
          product_reference: 'SYNTH-PROD-PACKED',
          title: 'SYNTH Packed Rice',
          category: 'FRUIT_VEGETABLE',
          unit_label: 'PACK',
          tax_basis: 'EXEMPT',
          variable_weight: false,
          permitted_weight_variance_bps: 100,
          sku: 'SYNTH-SKU-PACKED',
          variant_title: 'SYNTH Packed Rice Pack',
          price_minor: 9000,
          now,
        }),
      CatalogueImportInputError,
      'A packaged product was allowed to carry a weight variance',
    );

    // 4. Lifecycle transitions are optimistic; a stale version cannot win.
    const deactivated = await catalogue.setLifecycle({
      context: context(),
      vendor_location_id: locationA,
      catalogue_product_id: created.catalogue_product_id,
      expected_version: 1,
      lifecycle_state: 'INACTIVE',
      now,
    });
    check(
      deactivated?.lifecycle_state === 'INACTIVE' && deactivated.version === 2,
      'Deactivation did not advance the product version',
    );
    await rejects(
      () =>
        catalogue.setLifecycle({
          context: context(),
          vendor_location_id: locationA,
          catalogue_product_id: created.catalogue_product_id,
          expected_version: 1,
          lifecycle_state: 'ACTIVE',
          now,
        }),
      Error,
      'A stale expected version was allowed to change lifecycle state',
    );

    // 5. Another vendor location cannot reach this product.
    await rejects(
      () =>
        catalogue.setLifecycle({
          context: context(),
          vendor_location_id: locationB,
          catalogue_product_id: created.catalogue_product_id,
          expected_version: 2,
          lifecycle_state: 'ACTIVE',
          now,
        }),
      Error,
      'A rival vendor location changed another location product',
    );
    const rivalProducts = await catalogue.listProducts({
      context: context(),
      vendor_location_id: locationB,
    });
    check(rivalProducts.length === 0, 'A rival vendor location could read another catalogue');

    // 6. A staged import never changes the live catalogue and is idempotent.
    const csv =
      header +
      'SYNTH-PROD-ONION,SYNTH Onion Sack,FRUIT_VEGETABLE,SACK,EXEMPT,SYNTH-SKU-ONION,SYNTH Onion Sack Ten Kilogram,31000,COUNTED,12,3,false,\n' +
      'SYNTH-PROD-BAD,,FRUIT_VEGETABLE,SACK,EXEMPT,SYNTH-SKU-BAD,SYNTH Bad Variant,-5,COUNTED,1,0,false,\n';
    const staged = await catalogue.stageImport({
      context: context(),
      vendor_location_id: locationA,
      source_filename: 'SYNTH-CATALOGUE.csv',
      csv_content: csv,
      idempotency_key: 'SYNTH-IMPORT-FIRST',
      now,
    });
    check(
      staged.import_state === 'STAGED' && staged.total_rows === 2 && staged.invalid_rows === 1,
      'Staging did not report row-level validation',
    );
    const liveAfterStage = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.catalogue_products
        WHERE vendor_location_id=$1 AND product_reference='SYNTH-PROD-ONION'`,
      [locationA],
    );
    check(liveAfterStage.rows[0]?.count === '0', 'Staging an import changed the live catalogue');
    const restaged = await catalogue.stageImport({
      context: context(),
      vendor_location_id: locationA,
      source_filename: 'SYNTH-CATALOGUE.csv',
      csv_content: csv,
      idempotency_key: 'SYNTH-IMPORT-FIRST',
      now,
    });
    check(
      restaged.catalogue_import_id === staged.catalogue_import_id,
      'Replaying one idempotency key created a second import',
    );

    // 7. An import holding any invalid row cannot commit.
    await rejects(
      () =>
        catalogue.commitImport({
          context: context(),
          catalogue_import_id: staged.catalogue_import_id,
          vendor_location_id: locationA,
          now,
        }),
      CatalogueImportConflictError,
      'An import with invalid rows was allowed to commit',
    );

    // 8. A fully valid import commits once and replays without duplicating.
    const validCsv =
      header +
      'SYNTH-PROD-ONION,SYNTH Onion Sack,FRUIT_VEGETABLE,SACK,EXEMPT,SYNTH-SKU-ONION,SYNTH Onion Sack Ten Kilogram,31000,COUNTED,12,3,false,\n';
    const clean = await catalogue.stageImport({
      context: context(),
      vendor_location_id: locationA,
      source_filename: 'SYNTH-CATALOGUE.csv',
      csv_content: validCsv,
      idempotency_key: 'SYNTH-IMPORT-SECOND',
      now,
    });
    const committed = await catalogue.commitImport({
      context: context(),
      catalogue_import_id: clean.catalogue_import_id,
      vendor_location_id: locationA,
      now,
    });
    check(
      committed.import_state === 'COMMITTED' && committed.committed_rows === 1,
      'A valid import did not report its committed rows',
    );
    const replay = await catalogue.commitImport({
      context: context(),
      catalogue_import_id: clean.catalogue_import_id,
      vendor_location_id: locationA,
      now,
    });
    check(
      replay.import_state === 'COMMITTED' && replay.committed_rows === 1,
      'Replaying a commit changed the import result',
    );
    const onion = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.catalogue_products
        WHERE vendor_location_id=$1 AND product_reference='SYNTH-PROD-ONION'`,
      [locationA],
    );
    check(onion.rows[0]?.count === '1', 'Replaying a commit duplicated the imported product');

    // 9. A malformed header is refused before any row is staged.
    await rejects(
      () =>
        catalogue.stageImport({
          context: context(),
          vendor_location_id: locationA,
          source_filename: 'SYNTH-BROKEN.csv',
          csv_content: 'wrong,header\n1,2\n',
          idempotency_key: 'SYNTH-IMPORT-THIRD',
          now,
        }),
      CatalogueImportInputError,
      'A CSV with the wrong header was staged',
    );

    // 10. Substitution suggestions are location-contained and reversible.
    const listed = await catalogue.listProducts({
      context: context(),
      vendor_location_id: locationA,
    });
    const onionProduct = listed.find((row) => row.product_reference === 'SYNTH-PROD-ONION');
    check(onionProduct !== undefined, 'The imported product was not listed for its vendor');
    const onionVariant = onionProduct.variants[0]?.['catalogue_variant_id'];
    check(typeof onionVariant === 'string', 'The imported product carries no variant');
    const substitution = await catalogue.setSubstitution({
      context: context(),
      vendor_location_id: locationA,
      catalogue_variant_id: created.catalogue_variant_id,
      replacement_variant_id: onionVariant as typeof created.catalogue_variant_id,
      reason: 'SYNTH Seasonal replacement',
      active: true,
      now,
    });
    check(substitution?.lifecycle_state === 'ACTIVE', 'An active substitution was not recorded');
    const deactivatedSubstitution = await catalogue.setSubstitution({
      context: context(),
      vendor_location_id: locationA,
      catalogue_variant_id: created.catalogue_variant_id,
      replacement_variant_id: onionVariant as typeof created.catalogue_variant_id,
      reason: 'SYNTH Seasonal replacement',
      active: false,
      now,
    });
    check(
      deactivatedSubstitution?.lifecycle_state === 'INACTIVE' &&
        deactivatedSubstitution.catalogue_substitution_id ===
          substitution.catalogue_substitution_id,
      'Deactivating a substitution created a second row',
    );
    await rejects(
      () =>
        catalogue.setSubstitution({
          context: context(),
          vendor_location_id: locationB,
          catalogue_variant_id: created.catalogue_variant_id,
          replacement_variant_id: onionVariant as typeof created.catalogue_variant_id,
          reason: 'SYNTH Cross vendor attempt',
          active: true,
          now,
        }),
      Error,
      'A rival vendor location created a substitution across catalogues',
    );

    // 11. An unauthenticated caller reaches nothing.
    await rejects(
      () =>
        catalogue.listProducts({
          context: createRequestContext({}),
          vendor_location_id: locationA,
        }),
      Error,
      'An unauthenticated caller read a vendor catalogue',
    );
  } finally {
    await catalogue.close();
    await pool.end();
  }
}
