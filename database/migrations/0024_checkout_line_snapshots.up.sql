CREATE TABLE marketplace.checkout_quote_lines (
  checkout_quote_line_id uuid PRIMARY KEY,
  checkout_quote_group_id uuid NOT NULL REFERENCES marketplace.checkout_quote_groups (checkout_quote_group_id) ON DELETE RESTRICT,
  cart_line_id uuid NOT NULL REFERENCES marketplace.cart_lines (cart_line_id) ON DELETE RESTRICT,
  catalogue_variant_id uuid NOT NULL REFERENCES marketplace.catalogue_product_variants (catalogue_variant_id) ON DELETE RESTRICT,
  inventory_reservation_id uuid NOT NULL REFERENCES marketplace.inventory_reservations (reservation_id) ON DELETE RESTRICT,
  product_title_snapshot text NOT NULL,
  variant_title_snapshot text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  product_version integer NOT NULL CHECK (product_version >= 1),
  variant_version integer NOT NULL CHECK (variant_version >= 1),
  UNIQUE (checkout_quote_group_id, cart_line_id)
);

CREATE TABLE marketplace.vendor_order_lines (
  vendor_order_line_id uuid PRIMARY KEY,
  vendor_order_id uuid NOT NULL REFERENCES marketplace.vendor_orders (vendor_order_id) ON DELETE RESTRICT,
  catalogue_variant_id uuid NOT NULL REFERENCES marketplace.catalogue_product_variants (catalogue_variant_id) ON DELETE RESTRICT,
  inventory_reservation_id uuid NOT NULL UNIQUE REFERENCES marketplace.inventory_reservations (reservation_id) ON DELETE RESTRICT,
  product_title_snapshot text NOT NULL,
  variant_title_snapshot text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0)
);

CREATE TABLE marketplace.checkout_events (
  checkout_event_id uuid PRIMARY KEY,
  checkout_group_id uuid REFERENCES marketplace.checkout_groups (checkout_group_id) ON DELETE RESTRICT,
  checkout_quote_id uuid NOT NULL REFERENCES marketplace.checkout_quotes (checkout_quote_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('QUOTE_CREATED','PAYMENT_AUTHORIZED','PAYMENT_DECLINED','PAYMENT_UNKNOWN','CHECKOUT_PLACED','WEBHOOK_ACCEPTED')),
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION marketplace.protect_checkout_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'checkout history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER checkout_events_append_only BEFORE UPDATE OR DELETE ON marketplace.checkout_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_checkout_history();
