CREATE TABLE marketplace.inventory_items (
  inventory_item_id uuid PRIMARY KEY,
  vendor_location_id uuid NOT NULL,
  product_reference text NOT NULL,
  display_name text NOT NULL,
  quantity_basis text NOT NULL,
  availability_state text NOT NULL,
  exact_available_quantity bigint,
  low_stock_threshold bigint,
  last_confirmed_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_item_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_product_reference_shape CHECK
    (product_reference ~ '^SYNTH-PROD-[A-Z0-9-]{4,64}$'),
  CONSTRAINT inventory_display_name_shape CHECK
    (display_name ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().-]{1,118}$'),
  CONSTRAINT inventory_quantity_basis_allowed CHECK
    (quantity_basis IN ('COUNTED', 'VENDOR_CONFIRMS')),
  CONSTRAINT inventory_availability_state_allowed CHECK
    (availability_state IN ('AVAILABLE', 'LOW_STOCK', 'VENDOR_CONFIRMS', 'OUT_OF_STOCK')),
  CONSTRAINT inventory_quantity_shape CHECK (
    (quantity_basis = 'COUNTED'
      AND exact_available_quantity IS NOT NULL AND exact_available_quantity >= 0
      AND low_stock_threshold IS NOT NULL AND low_stock_threshold >= 0
      AND availability_state IN ('AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK'))
    OR
    (quantity_basis = 'VENDOR_CONFIRMS'
      AND exact_available_quantity IS NULL AND low_stock_threshold IS NULL
      AND availability_state = 'VENDOR_CONFIRMS')
  ),
  CONSTRAINT inventory_counted_state_shape CHECK
    (quantity_basis <> 'COUNTED'
     OR (exact_available_quantity = 0 AND availability_state = 'OUT_OF_STOCK')
     OR (exact_available_quantity > 0 AND availability_state <> 'OUT_OF_STOCK')),
  CONSTRAINT inventory_item_version_positive CHECK (version >= 1),
  CONSTRAINT inventory_item_location_product_unique UNIQUE
    (vendor_location_id, product_reference)
);

CREATE INDEX inventory_items_location_availability
  ON marketplace.inventory_items
    (vendor_location_id, availability_state, updated_at DESC, inventory_item_id);

CREATE TABLE marketplace.inventory_reservations (
  reservation_id uuid PRIMARY KEY,
  inventory_item_id uuid NOT NULL,
  vendor_location_id uuid NOT NULL,
  source_reference text NOT NULL,
  reservation_state text NOT NULL,
  quantity bigint NOT NULL,
  counted_stock_applied boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_reservation_item_fk FOREIGN KEY (inventory_item_id)
    REFERENCES marketplace.inventory_items (inventory_item_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_reservation_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_source_reference_shape CHECK
    (source_reference ~ '^SYNTH-(CHECKOUT|ORDER)-[A-Z0-9-]{4,64}$'),
  CONSTRAINT inventory_reservation_state_allowed CHECK
    (reservation_state IN ('SOFT_HELD', 'PROVISIONAL', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  CONSTRAINT inventory_reservation_quantity_positive CHECK
    (quantity BETWEEN 1 AND 1000000),
  CONSTRAINT inventory_reservation_version_positive CHECK (version >= 1),
  CONSTRAINT inventory_reservation_source_unique UNIQUE
    (inventory_item_id, source_reference)
);

CREATE INDEX inventory_reservations_location_state
  ON marketplace.inventory_reservations
    (vendor_location_id, reservation_state, updated_at DESC, reservation_id);
CREATE INDEX inventory_reservations_expiry
  ON marketplace.inventory_reservations
    (expires_at, reservation_id)
  WHERE reservation_state IN ('SOFT_HELD', 'PROVISIONAL');

CREATE TABLE marketplace.inventory_events (
  inventory_event_id uuid PRIMARY KEY,
  inventory_item_id uuid NOT NULL,
  item_version integer NOT NULL,
  reservation_id uuid,
  reservation_version integer,
  event_type text NOT NULL,
  previous_state text,
  resulting_state text,
  actor_id uuid NOT NULL,
  actor_kind text NOT NULL,
  reason_code text NOT NULL,
  quantity bigint,
  exact_available_quantity bigint,
  counted_stock_applied boolean,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inventory_event_item_fk FOREIGN KEY (inventory_item_id)
    REFERENCES marketplace.inventory_items (inventory_item_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_event_reservation_fk FOREIGN KEY (reservation_id)
    REFERENCES marketplace.inventory_reservations (reservation_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_event_type_allowed CHECK
    (event_type IN ('ITEM_CREATED', 'STOCK_SET', 'AVAILABILITY_CONFIRMED',
                    'SOFT_HELD', 'PROVISIONAL', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  CONSTRAINT inventory_event_state_allowed CHECK
    ((previous_state IS NULL OR previous_state IN
      ('SOFT_HELD', 'PROVISIONAL', 'COMMITTED', 'RELEASED', 'EXPIRED'))
     AND (resulting_state IS NULL OR resulting_state IN
      ('SOFT_HELD', 'PROVISIONAL', 'COMMITTED', 'RELEASED', 'EXPIRED'))),
  CONSTRAINT inventory_event_actor_kind_allowed CHECK
    (actor_kind IN ('admin', 'customer', 'system', 'vendor_staff')),
  CONSTRAINT inventory_event_reason_shape CHECK
    (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT inventory_event_item_version_positive CHECK (item_version >= 1),
  CONSTRAINT inventory_event_reservation_version_shape CHECK
    ((reservation_id IS NULL AND reservation_version IS NULL
       AND previous_state IS NULL AND resulting_state IS NULL)
     OR (reservation_id IS NOT NULL AND reservation_version IS NOT NULL
       AND reservation_version >= 1 AND resulting_state IS NOT NULL)),
  CONSTRAINT inventory_event_quantity_shape CHECK
    (quantity IS NULL OR quantity BETWEEN 1 AND 1000000),
  CONSTRAINT inventory_event_available_quantity_shape CHECK
    (exact_available_quantity IS NULL OR exact_available_quantity >= 0),
  CONSTRAINT inventory_event_item_version_unique UNIQUE (inventory_item_id, item_version),
  CONSTRAINT inventory_event_reservation_version_unique UNIQUE
    (reservation_id, reservation_version)
);

CREATE INDEX inventory_events_item_history
  ON marketplace.inventory_events (inventory_item_id, item_version, occurred_at);
CREATE INDEX inventory_events_reservation_history
  ON marketplace.inventory_events (reservation_id, reservation_version, occurred_at)
  WHERE reservation_id IS NOT NULL;

CREATE FUNCTION marketplace.protect_inventory_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'inventory history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER inventory_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.inventory_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_inventory_history();

COMMENT ON TABLE marketplace.inventory_items IS
  'Authoritative company-test stock records. VENDOR_CONFIRMS never stores or implies an exact count.';
COMMENT ON TABLE marketplace.inventory_reservations IS
  'Expiring stock intent and counted-stock reservation lifecycle; carts themselves never reserve.';
COMMENT ON TABLE marketplace.inventory_events IS
  'Append-only attributable inventory and reservation evidence.';
