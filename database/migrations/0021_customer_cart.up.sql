-- Phase 6.6-6.7: vendor-grouped cart, per-group fulfilment preference and
-- substitution preference, and cart validation/recovery state.

CREATE TABLE marketplace.carts (
  cart_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  customer_address_id uuid REFERENCES marketplace.customer_addresses (customer_address_id)
    ON DELETE RESTRICT,
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cart_lifecycle_allowed
    CHECK (lifecycle_state IN ('ACTIVE', 'CHECKED_OUT', 'ABANDONED')),
  CONSTRAINT cart_version_positive CHECK (version >= 1)
);
-- One active cart per customer; it is found rather than chosen, so a customer
-- never juggles cart identifiers.
CREATE UNIQUE INDEX one_active_cart_per_customer
  ON marketplace.carts (user_id) WHERE lifecycle_state = 'ACTIVE';

CREATE TABLE marketplace.cart_vendor_groups (
  cart_vendor_group_id uuid PRIMARY KEY,
  cart_id uuid NOT NULL REFERENCES marketplace.carts (cart_id) ON DELETE RESTRICT,
  vendor_location_id uuid NOT NULL
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  fulfilment_method text NOT NULL DEFAULT 'PLATFORM_DELIVERY',
  customer_note text,
  tip_minor bigint NOT NULL DEFAULT 0,
  -- INVALID marks a group a revalidation pass could not confirm (closed store,
  -- unserviceable address, below minimum); it stays until the customer acts.
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cart_vendor_group_unique UNIQUE (cart_id, vendor_location_id),
  CONSTRAINT cart_vendor_group_fulfilment_allowed
    CHECK (fulfilment_method IN ('CUSTOMER_PICKUP', 'VENDOR_DELIVERY', 'PLATFORM_DELIVERY')),
  CONSTRAINT cart_vendor_group_note_shape
    CHECK (customer_note IS NULL OR length(customer_note) BETWEEN 1 AND 240),
  CONSTRAINT cart_vendor_group_tip CHECK (tip_minor BETWEEN 0 AND 100000),
  CONSTRAINT cart_vendor_group_lifecycle_allowed
    CHECK (lifecycle_state IN ('ACTIVE', 'INVALID', 'REMOVED')),
  CONSTRAINT cart_vendor_group_version_positive CHECK (version >= 1)
);
CREATE INDEX cart_vendor_groups_cart_active
  ON marketplace.cart_vendor_groups (cart_id, lifecycle_state, vendor_location_id);

CREATE TABLE marketplace.cart_lines (
  cart_line_id uuid PRIMARY KEY,
  cart_vendor_group_id uuid NOT NULL
    REFERENCES marketplace.cart_vendor_groups (cart_vendor_group_id) ON DELETE RESTRICT,
  catalogue_variant_id uuid NOT NULL
    REFERENCES marketplace.catalogue_product_variants (catalogue_variant_id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  substitution_preference text NOT NULL DEFAULT 'ASK_CUSTOMER',
  -- A stale-line flag set by revalidation (price/availability/publication
  -- changed since the line was added). It never removes the line by itself.
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cart_line_variant_unique UNIQUE (cart_vendor_group_id, catalogue_variant_id),
  CONSTRAINT cart_line_quantity CHECK (quantity BETWEEN 1 AND 1000),
  CONSTRAINT cart_line_substitution_allowed CHECK
    (substitution_preference IN ('NO_SUBSTITUTION', 'ASK_CUSTOMER', 'ALLOW_SAME_STORE')),
  CONSTRAINT cart_line_lifecycle_allowed CHECK (lifecycle_state IN ('ACTIVE', 'STALE', 'REMOVED')),
  CONSTRAINT cart_line_version_positive CHECK (version >= 1)
);
CREATE INDEX cart_lines_group_active
  ON marketplace.cart_lines (cart_vendor_group_id, lifecycle_state, catalogue_variant_id);

-- Every add/remove/quantity-change is recorded so "cart items are never
-- reserved inventory" and the recovery outcomes below are auditable.
CREATE TABLE marketplace.cart_events (
  event_id uuid PRIMARY KEY,
  cart_id uuid NOT NULL REFERENCES marketplace.carts (cart_id) ON DELETE RESTRICT,
  cart_vendor_group_id uuid,
  cart_line_id uuid,
  event_type text NOT NULL,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT cart_event_type_allowed CHECK (event_type IN
    ('CART_CREATED', 'GROUP_ADDED', 'GROUP_INVALIDATED', 'GROUP_REMOVED',
     'LINE_ADDED', 'LINE_QUANTITY_CHANGED', 'LINE_MARKED_STALE', 'LINE_REMOVED',
     'ADDRESS_CHANGED', 'FULFILMENT_METHOD_CHANGED')),
  CONSTRAINT cart_event_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);
CREATE INDEX cart_events_cart_history ON marketplace.cart_events (cart_id, occurred_at DESC);

CREATE FUNCTION marketplace.protect_cart_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'cart history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER cart_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.cart_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_cart_history();

INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description)
VALUES ('customer.cart.manage', 'CUSTOMER', 'ACCOUNT',
  'Manage the authenticated customer vendor-grouped cart')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES ('CUSTOMER', 'customer.cart.manage')
ON CONFLICT DO NOTHING;
