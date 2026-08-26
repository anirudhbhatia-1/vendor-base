CREATE TABLE marketplace.catalogue_product_substitutions (
  catalogue_substitution_id uuid PRIMARY KEY,
  catalogue_variant_id uuid NOT NULL REFERENCES marketplace.catalogue_product_variants (catalogue_variant_id) ON DELETE RESTRICT,
  replacement_variant_id uuid NOT NULL REFERENCES marketplace.catalogue_product_variants (catalogue_variant_id) ON DELETE RESTRICT,
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_state IN ('ACTIVE','INACTIVE')),
  reason text NOT NULL CHECK (reason ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().,-]{1,118}$'),
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT catalogue_substitution_not_self CHECK (catalogue_variant_id <> replacement_variant_id),
  CONSTRAINT catalogue_substitution_unique UNIQUE (catalogue_variant_id, replacement_variant_id)
);
CREATE INDEX catalogue_substitutions_active ON marketplace.catalogue_product_substitutions (catalogue_variant_id, lifecycle_state);
