CREATE TABLE marketplace.customer_addresses (
  customer_address_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  address_reference text NOT NULL UNIQUE,
  label text NOT NULL,
  pin_code text NOT NULL,
  coordinates geography(Point, 4326) NOT NULL,
  coordinate_source text NOT NULL DEFAULT 'MANUAL_PIN',
  landmark text,
  delivery_instructions text,
  is_selected boolean NOT NULL DEFAULT false,
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT customer_address_reference_shape
    CHECK (address_reference ~ '^SYNTH-ADDRESS-[A-Z0-9-]{4,64}$'),
  CONSTRAINT customer_address_label_shape
    CHECK (label ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().,-]{1,80}$'),
  CONSTRAINT customer_address_pin_shape CHECK (pin_code ~ '^[1-9][0-9]{5}$'),
  CONSTRAINT customer_address_coordinate_source_allowed
    CHECK (coordinate_source IN ('MANUAL_PIN', 'DEVICE_LOCATION')),
  CONSTRAINT customer_address_landmark_shape
    CHECK (landmark IS NULL OR length(landmark) BETWEEN 1 AND 160),
  CONSTRAINT customer_address_instructions_shape
    CHECK (delivery_instructions IS NULL OR length(delivery_instructions) BETWEEN 1 AND 240),
  CONSTRAINT customer_address_lifecycle_allowed
    CHECK (lifecycle_state IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT customer_address_version_positive CHECK (version >= 1),
  -- An archived address can never remain the selected one.
  CONSTRAINT customer_address_selection_requires_active
    CHECK (NOT is_selected OR lifecycle_state = 'ACTIVE')
);

CREATE INDEX customer_addresses_owner_active
  ON marketplace.customer_addresses (user_id, lifecycle_state, created_at DESC);

-- A customer may keep several saved addresses but orders exactly one of them.
CREATE UNIQUE INDEX one_selected_address_per_customer
  ON marketplace.customer_addresses (user_id)
  WHERE is_selected AND lifecycle_state = 'ACTIVE';

CREATE TABLE marketplace.customer_address_events (
  event_id uuid PRIMARY KEY,
  customer_address_id uuid NOT NULL
    REFERENCES marketplace.customer_addresses (customer_address_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  resulting_version integer NOT NULL,
  event_type text NOT NULL,
  actor_id uuid,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT customer_address_event_version_positive CHECK (resulting_version >= 1),
  CONSTRAINT customer_address_event_type_allowed CHECK (event_type IN
    ('CREATED', 'UPDATED', 'SELECTED', 'DESELECTED', 'ARCHIVED')),
  CONSTRAINT customer_address_event_reason_shape
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE INDEX customer_address_events_history
  ON marketplace.customer_address_events (customer_address_id, occurred_at DESC);

CREATE FUNCTION marketplace.protect_customer_address_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer address history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER customer_address_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.customer_address_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_customer_address_history();

INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description)
VALUES ('customer.address.manage', 'CUSTOMER', 'ACCOUNT',
  'Manage the authenticated customer saved delivery addresses')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES ('CUSTOMER', 'customer.address.manage')
ON CONFLICT DO NOTHING;
