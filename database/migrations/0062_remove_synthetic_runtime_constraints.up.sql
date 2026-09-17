-- Runtime data may be synthetic in automated tests, but production-shaped
-- schemas must not require test prefixes.
--
-- Every explicit DROP is guarded with IF EXISTS. The paired down migration
-- deliberately does not recreate the historical `*_shape` constraints (real
-- records could already violate them), so without the guard a down/up cycle
-- failed with `constraint "vendor_business_name_shape" does not exist` and
-- broke the rebuild-from-zero proof in verify-lifecycle.ts. The resulting
-- schema is unchanged on a fresh or already-migrated database. Application services continue to
-- validate typed input and these checks retain conservative database bounds.
DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE connamespace = 'marketplace'::regnamespace
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%SYNTH%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', item.table_name, item.conname);
    -- Preserve the rest of every check, including combined conditions, while
    -- making the historical fixture prefix optional.
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', item.table_name, item.conname,
      replace(replace(item.definition, '^SYNTH-', '^(SYNTH-)?'), '^SYNTH ', '^(SYNTH )?'));
  END LOOP;
END $$;

ALTER TABLE marketplace.customer_addresses
  DROP CONSTRAINT IF EXISTS customer_address_reference_shape,
  DROP CONSTRAINT IF EXISTS customer_address_label_shape,
  ADD CONSTRAINT customer_address_reference_runtime_shape
    CHECK (address_reference ~ '^[A-Z0-9][A-Z0-9._:/-]{3,127}$'),
  ADD CONSTRAINT customer_address_label_runtime_shape
    CHECK (length(btrim(label)) BETWEEN 2 AND 86);

ALTER TABLE marketplace.vendors
  DROP CONSTRAINT IF EXISTS vendor_business_name_shape,
  ADD CONSTRAINT vendor_business_name_runtime_shape
    CHECK (length(btrim(business_name)) BETWEEN 2 AND 125);

ALTER TABLE marketplace.vendor_locations
  DROP CONSTRAINT IF EXISTS vendor_location_name_shape,
  ADD CONSTRAINT vendor_location_name_runtime_shape
    CHECK (length(btrim(location_name)) BETWEEN 2 AND 125);

ALTER TABLE marketplace.catalogue_products
  DROP CONSTRAINT IF EXISTS catalogue_product_reference_shape,
  DROP CONSTRAINT IF EXISTS catalogue_product_title_shape,
  ADD CONSTRAINT catalogue_product_reference_runtime_shape
    CHECK (product_reference ~ '^[A-Z0-9][A-Z0-9._:/-]{3,127}$'),
  ADD CONSTRAINT catalogue_product_title_runtime_shape
    CHECK (length(btrim(title)) BETWEEN 2 AND 125);

ALTER TABLE marketplace.catalogue_product_variants
  DROP CONSTRAINT IF EXISTS catalogue_variant_sku_shape,
  DROP CONSTRAINT IF EXISTS catalogue_variant_title_shape,
  ADD CONSTRAINT catalogue_variant_sku_runtime_shape
    CHECK (sku ~ '^[A-Z0-9][A-Z0-9._:/-]{2,95}$'),
  ADD CONSTRAINT catalogue_variant_title_runtime_shape
    CHECK (length(btrim(variant_title)) BETWEEN 2 AND 125);

ALTER TABLE marketplace.catalogue_product_images
  ADD CONSTRAINT catalogue_image_object_runtime_shape
    CHECK (length(btrim(object_reference)) BETWEEN 4 AND 512),
  ADD CONSTRAINT catalogue_image_alt_runtime_shape
    CHECK (length(btrim(alt_text)) BETWEEN 2 AND 240);
