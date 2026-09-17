ALTER TABLE marketplace.customer_addresses
  DROP CONSTRAINT IF EXISTS customer_address_reference_runtime_shape,
  DROP CONSTRAINT IF EXISTS customer_address_label_runtime_shape;
ALTER TABLE marketplace.vendors
  DROP CONSTRAINT IF EXISTS vendor_business_name_runtime_shape;
ALTER TABLE marketplace.vendor_locations
  DROP CONSTRAINT IF EXISTS vendor_location_name_runtime_shape;
ALTER TABLE marketplace.catalogue_products
  DROP CONSTRAINT IF EXISTS catalogue_product_reference_runtime_shape,
  DROP CONSTRAINT IF EXISTS catalogue_product_title_runtime_shape;
ALTER TABLE marketplace.catalogue_product_variants
  DROP CONSTRAINT IF EXISTS catalogue_variant_sku_runtime_shape,
  DROP CONSTRAINT IF EXISTS catalogue_variant_title_runtime_shape;
ALTER TABLE marketplace.catalogue_product_images
  DROP CONSTRAINT IF EXISTS catalogue_image_object_runtime_shape,
  DROP CONSTRAINT IF EXISTS catalogue_image_alt_runtime_shape;

-- Test-prefix constraints are intentionally not recreated: real records may
-- exist after this migration and would make such a rollback unsafe.
