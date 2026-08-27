CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE marketplace.catalogue_products
  ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' ||
      coalesce(category, '') || ' ' || coalesce(description, '') || ' ' ||
      coalesce(product_reference, ''))
  ) STORED;

CREATE INDEX catalogue_products_search_document
  ON marketplace.catalogue_products USING gin (search_document);
CREATE INDEX catalogue_products_title_trigram
  ON marketplace.catalogue_products USING gin (lower(title) gin_trgm_ops);
