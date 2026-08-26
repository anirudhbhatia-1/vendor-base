-- Phase 6.2-6.5: customer store discovery, search, favourites, preferred store,
-- shop requests, and privacy-safe discovery funnel measurement.

CREATE TABLE marketplace.customer_favourite_stores (
  customer_favourite_store_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  vendor_location_id uuid NOT NULL
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT customer_favourite_unique UNIQUE (user_id, vendor_location_id)
);
CREATE INDEX customer_favourite_stores_owner
  ON marketplace.customer_favourite_stores (user_id, created_at DESC);

-- A customer keeps at most one preferred store; eligibility changes never delete
-- the preference, so serviceability is derived at read time, not stored here.
CREATE TABLE marketplace.customer_preferred_store (
  user_id uuid PRIMARY KEY REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  vendor_location_id uuid NOT NULL
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE marketplace.customer_shop_requests (
  customer_shop_request_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  pin_code text NOT NULL,
  coordinates geography(Point, 4326) NOT NULL,
  store_name text NOT NULL,
  note text,
  lifecycle_state text NOT NULL DEFAULT 'OPEN',
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT customer_shop_request_pin_shape CHECK (pin_code ~ '^[1-9][0-9]{5}$'),
  CONSTRAINT customer_shop_request_name_shape
    CHECK (store_name ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().,-]{1,118}$'),
  CONSTRAINT customer_shop_request_note_shape
    CHECK (note IS NULL OR length(note) BETWEEN 1 AND 240),
  CONSTRAINT customer_shop_request_lifecycle
    CHECK (lifecycle_state IN ('OPEN', 'TRIAGED', 'CLOSED'))
);
-- One open request per customer and pin keeps a customer from spamming the pipeline.
CREATE UNIQUE INDEX one_open_shop_request_per_area
  ON marketplace.customer_shop_requests (user_id, pin_code)
  WHERE lifecycle_state = 'OPEN';

CREATE TABLE marketplace.customer_recent_searches (
  customer_recent_search_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  normalized_term text NOT NULL,
  display_term text NOT NULL,
  last_searched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT customer_recent_search_term_shape
    CHECK (length(normalized_term) BETWEEN 1 AND 80 AND length(display_term) BETWEEN 1 AND 120),
  CONSTRAINT customer_recent_search_unique UNIQUE (user_id, normalized_term)
);
CREATE INDEX customer_recent_searches_owner
  ON marketplace.customer_recent_searches (user_id, last_searched_at DESC);

-- Privacy-safe discovery funnel. No free-text search term, address, or coordinate
-- is stored here; only the outcome shape needed to measure the funnel.
CREATE TABLE marketplace.customer_discovery_events (
  event_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  result_count integer NOT NULL DEFAULT 0,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT customer_discovery_event_type_allowed CHECK (event_type IN
    ('STORE_DISCOVERY', 'STORE_VIEWED', 'SEARCH_RUN', 'SEARCH_ZERO_RESULT',
     'SEARCH_TO_CART', 'FAVOURITE_ADDED', 'SHOP_REQUESTED')),
  CONSTRAINT customer_discovery_event_count CHECK (result_count BETWEEN 0 AND 100000)
);
CREATE INDEX customer_discovery_events_funnel
  ON marketplace.customer_discovery_events (event_type, occurred_at DESC);

CREATE FUNCTION marketplace.protect_customer_discovery_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer discovery history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER customer_discovery_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.customer_discovery_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_customer_discovery_history();

INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description)
VALUES ('customer.discovery.use', 'CUSTOMER', 'ACCOUNT',
  'Discover stores, search, browse storefronts, and manage favourites and requests')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES ('CUSTOMER', 'customer.discovery.use')
ON CONFLICT DO NOTHING;
