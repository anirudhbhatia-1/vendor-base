CREATE TABLE marketplace.catalogue_products (
  catalogue_product_id uuid PRIMARY KEY,
  vendor_location_id uuid NOT NULL REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  product_reference text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  brand text,
  description text,
  unit_label text NOT NULL,
  tax_basis text NOT NULL,
  variable_weight boolean NOT NULL DEFAULT false,
  permitted_weight_variance_bps integer,
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT catalogue_product_reference_shape CHECK (product_reference ~ '^SYNTH-PROD-[A-Z0-9-]{4,64}$'),
  CONSTRAINT catalogue_product_title_shape CHECK (title ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().,-]{1,118}$'),
  CONSTRAINT catalogue_product_category_shape CHECK (category ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT catalogue_product_unit_shape CHECK (unit_label ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  CONSTRAINT catalogue_product_tax_basis CHECK (tax_basis IN ('INCLUSIVE','EXCLUSIVE','EXEMPT')),
  CONSTRAINT catalogue_product_lifecycle CHECK (lifecycle_state IN ('ACTIVE','INACTIVE')),
  CONSTRAINT catalogue_product_weight_shape CHECK
    ((variable_weight AND permitted_weight_variance_bps BETWEEN 0 AND 10000)
     OR (NOT variable_weight AND permitted_weight_variance_bps IS NULL)),
  CONSTRAINT catalogue_product_version_positive CHECK (version >= 1),
  CONSTRAINT catalogue_product_vendor_reference_unique UNIQUE (vendor_location_id, product_reference)
);
CREATE INDEX catalogue_products_location_active ON marketplace.catalogue_products (vendor_location_id, lifecycle_state, title, catalogue_product_id);

CREATE TABLE marketplace.catalogue_product_variants (
  catalogue_variant_id uuid PRIMARY KEY,
  catalogue_product_id uuid NOT NULL REFERENCES marketplace.catalogue_products (catalogue_product_id) ON DELETE RESTRICT,
  sku text NOT NULL,
  variant_title text NOT NULL,
  pack_quantity integer,
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT catalogue_variant_sku_shape CHECK (sku ~ '^SYNTH-SKU-[A-Z0-9-]{4,64}$'),
  CONSTRAINT catalogue_variant_title_shape CHECK (variant_title ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().,-]{1,118}$'),
  CONSTRAINT catalogue_variant_pack_quantity CHECK (pack_quantity IS NULL OR pack_quantity BETWEEN 1 AND 1000000),
  CONSTRAINT catalogue_variant_lifecycle CHECK (lifecycle_state IN ('ACTIVE','INACTIVE')),
  CONSTRAINT catalogue_variant_version_positive CHECK (version >= 1),
  CONSTRAINT catalogue_variant_product_sku_unique UNIQUE (catalogue_product_id, sku)
);

CREATE TABLE marketplace.catalogue_prices (
  catalogue_price_id uuid PRIMARY KEY,
  catalogue_variant_id uuid NOT NULL REFERENCES marketplace.catalogue_product_variants (catalogue_variant_id) ON DELETE RESTRICT,
  price_minor bigint NOT NULL CHECK (price_minor BETWEEN 0 AND 1000000000),
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT catalogue_price_interval CHECK (effective_until IS NULL OR effective_until > effective_from)
);
CREATE UNIQUE INDEX one_active_catalogue_price ON marketplace.catalogue_prices (catalogue_variant_id) WHERE effective_until IS NULL;

CREATE TABLE marketplace.catalogue_product_images (
  catalogue_image_id uuid PRIMARY KEY,
  catalogue_product_id uuid NOT NULL REFERENCES marketplace.catalogue_products (catalogue_product_id) ON DELETE RESTRICT,
  object_reference text NOT NULL CHECK (object_reference ~ '^SYNTH-OBJECT-[A-Z0-9-]{4,64}$'),
  alt_text text NOT NULL CHECK (alt_text ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().,-]{1,118}$'),
  position integer NOT NULL DEFAULT 1 CHECK (position BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT catalogue_image_position_unique UNIQUE (catalogue_product_id, position)
);

CREATE TABLE marketplace.catalogue_imports (
  catalogue_import_id uuid PRIMARY KEY,
  vendor_location_id uuid NOT NULL REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  template_version text NOT NULL CHECK (template_version = 'CATALOGUE_CSV_V1'),
  source_filename text NOT NULL CHECK (source_filename ~ '^SYNTH-[A-Z0-9._-]{4,120}\.csv$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^SYNTH-IMPORT-[A-Z0-9-]{4,64}$'),
  import_state text NOT NULL CHECK (import_state IN ('STAGED','COMMITTED','REJECTED')),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows BETWEEN 0 AND 10000),
  valid_rows integer NOT NULL DEFAULT 0 CHECK (valid_rows BETWEEN 0 AND 10000),
  invalid_rows integer NOT NULL DEFAULT 0 CHECK (invalid_rows BETWEEN 0 AND 10000),
  committed_rows integer NOT NULL DEFAULT 0 CHECK (committed_rows BETWEEN 0 AND 10000),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  committed_at timestamptz,
  CONSTRAINT catalogue_import_count_shape CHECK (valid_rows + invalid_rows = total_rows),
  CONSTRAINT catalogue_import_commit_shape CHECK ((import_state = 'COMMITTED' AND committed_at IS NOT NULL) OR (import_state <> 'COMMITTED' AND committed_at IS NULL)),
  CONSTRAINT catalogue_import_idempotency_unique UNIQUE (vendor_location_id, idempotency_key)
);

CREATE TABLE marketplace.catalogue_import_rows (
  catalogue_import_row_id uuid PRIMARY KEY,
  catalogue_import_id uuid NOT NULL REFERENCES marketplace.catalogue_imports (catalogue_import_id) ON DELETE RESTRICT,
  row_number integer NOT NULL CHECK (row_number BETWEEN 2 AND 10001),
  row_state text NOT NULL CHECK (row_state IN ('VALID','INVALID','COMMITTED')),
  raw_row jsonb NOT NULL,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_reference text,
  committed_product_id uuid REFERENCES marketplace.catalogue_products (catalogue_product_id) ON DELETE RESTRICT,
  committed_at timestamptz,
  CONSTRAINT catalogue_import_row_number_unique UNIQUE (catalogue_import_id, row_number),
  CONSTRAINT catalogue_import_row_commit_shape CHECK ((row_state = 'COMMITTED' AND committed_product_id IS NOT NULL AND committed_at IS NOT NULL) OR (row_state <> 'COMMITTED' AND committed_product_id IS NULL AND committed_at IS NULL))
);
CREATE INDEX catalogue_import_rows_review ON marketplace.catalogue_import_rows (catalogue_import_id, row_state, row_number);
