CREATE TABLE marketplace.checkout_quote_blocked_groups (
  checkout_quote_blocked_group_id uuid PRIMARY KEY,
  checkout_quote_id uuid NOT NULL REFERENCES marketplace.checkout_quotes (checkout_quote_id) ON DELETE RESTRICT,
  cart_vendor_group_id uuid NOT NULL REFERENCES marketplace.cart_vendor_groups (cart_vendor_group_id) ON DELETE RESTRICT,
  vendor_location_id uuid NOT NULL REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code IN ('MINIMUM_NOT_MET','INVENTORY_UNAVAILABLE','STORE_UNAVAILABLE')),
  UNIQUE (checkout_quote_id, vendor_location_id)
);

ALTER TABLE marketplace.checkout_groups
  ADD COLUMN idempotency_key text,
  ADD CONSTRAINT checkout_idempotency_key_shape
    CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  ADD CONSTRAINT checkout_customer_idempotency_unique UNIQUE (customer_user_id, idempotency_key);

