-- Catalogue images have never worked end to end.
--
-- `CatalogueProductService.uploadImage` puts the bytes in object storage under
-- `catalogue-images/<location>/<image>/object` and then writes that same key
-- into `object_reference` — which this table's CHECK constraint rejects,
-- because it only ever admitted the `SYNTH-OBJECT-…` fixture form. Every real
-- upload therefore failed on insert, which is why the table is empty and why no
-- surface has ever rendered a product photograph.
--
-- Two changes, both additive:
--
-- 1. The reference may now also be a storage object key, so the upload path can
--    complete. The fixture form stays valid; existing rows are untouched.
-- 2. The row records what serving an image actually requires. `readGranted`
--    verifies the content against an expected checksum before returning bytes,
--    so without a stored checksum there is no way to read an object back out
--    at all, and the media type has to be known to set a correct
--    `Content-Type` rather than sniffing the bytes at request time.

ALTER TABLE marketplace.catalogue_product_images
  DROP CONSTRAINT catalogue_product_images_object_reference_check;

ALTER TABLE marketplace.catalogue_product_images
  ADD CONSTRAINT catalogue_image_object_reference_shape
    CHECK (
      object_reference ~ '^SYNTH-OBJECT-[A-Z0-9-]{4,64}$'
      OR object_reference ~ '^catalogue-images/[0-9a-f-]{36}/[0-9a-f-]{36}/object$'
    );

ALTER TABLE marketplace.catalogue_product_images
  ADD COLUMN media_type text,
  ADD COLUMN content_sha256 text,
  ADD COLUMN content_length integer;

ALTER TABLE marketplace.catalogue_product_images
  ADD CONSTRAINT catalogue_image_media_type_allowed
    CHECK (media_type IS NULL OR media_type IN ('image/jpeg', 'image/png'));

ALTER TABLE marketplace.catalogue_product_images
  ADD CONSTRAINT catalogue_image_checksum_shape
    CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE marketplace.catalogue_product_images
  ADD CONSTRAINT catalogue_image_length_positive
    CHECK (content_length IS NULL OR content_length > 0);

-- An image row is servable only when it carries all three. A fixture row that
-- names no real object stays valid and simply renders the category placeholder.
ALTER TABLE marketplace.catalogue_product_images
  ADD CONSTRAINT catalogue_image_storage_facts_complete
    CHECK (
      (media_type IS NULL AND content_sha256 IS NULL AND content_length IS NULL)
      OR (media_type IS NOT NULL AND content_sha256 IS NOT NULL AND content_length IS NOT NULL)
    );

COMMENT ON COLUMN marketplace.catalogue_product_images.content_sha256 IS
  'Checksum the protected object store verifies before returning the bytes. Null for fixture rows that reference no stored object.';
