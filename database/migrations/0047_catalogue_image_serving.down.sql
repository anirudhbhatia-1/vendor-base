ALTER TABLE marketplace.catalogue_product_images
  DROP CONSTRAINT IF EXISTS catalogue_image_storage_facts_complete,
  DROP CONSTRAINT IF EXISTS catalogue_image_length_positive,
  DROP CONSTRAINT IF EXISTS catalogue_image_checksum_shape,
  DROP CONSTRAINT IF EXISTS catalogue_image_media_type_allowed;

ALTER TABLE marketplace.catalogue_product_images
  DROP COLUMN IF EXISTS content_length,
  DROP COLUMN IF EXISTS content_sha256,
  DROP COLUMN IF EXISTS media_type;

ALTER TABLE marketplace.catalogue_product_images
  DROP CONSTRAINT IF EXISTS catalogue_image_object_reference_shape;

ALTER TABLE marketplace.catalogue_product_images
  ADD CONSTRAINT catalogue_product_images_object_reference_check
    CHECK (object_reference ~ '^SYNTH-OBJECT-[A-Z0-9-]{4,64}$');
