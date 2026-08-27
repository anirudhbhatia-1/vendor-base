DROP INDEX IF EXISTS marketplace.catalogue_products_title_trigram;
DROP INDEX IF EXISTS marketplace.catalogue_products_search_document;
ALTER TABLE marketplace.catalogue_products DROP COLUMN IF EXISTS search_document;
