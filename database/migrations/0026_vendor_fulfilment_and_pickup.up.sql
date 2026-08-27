-- Phase 8: vendor fulfilment, customer decisions, pickup, and light history.
-- Extends the vendor_orders aggregate created in migration 0023 with the full
-- accept -> picking -> ready -> picked-up lifecycle, per-line picking state,
-- customer-decision proposals for substitution or weight/price changes, an
-- append-only fulfilment audit trail, a hashed and rate-limited pickup OTP,
-- pickup-proof evidence, and light order-history projections (rating and
-- support entry).

-- 8.1/8.2/8.5/8.6 -- lifecycle expansion. PLACED and ACCEPTED already existed
-- (0023); this adds PICKING, READY, and PICKED_UP so the whole vertical
-- transaction can be represented on the same aggregate. CANCELLED and EXPIRED
-- stay for decline / auto-timeout.
ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_orders_lifecycle_state_check;
ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_orders_lifecycle_state_check
    CHECK (lifecycle_state IN ('PLACED','ACCEPTED','PICKING','READY','PICKED_UP','CANCELLED','EXPIRED'));

-- Response deadline (8.1), preparation estimate (8.2), decline reason (8.2),
-- picking start (8.3), ready timestamp with package details (8.5), pickup OTP
-- and pickup completion (8.6).
ALTER TABLE marketplace.vendor_orders
  ADD COLUMN accept_by timestamptz,
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN preparation_estimate_seconds integer,
  ADD COLUMN decline_reason_code text,
  ADD COLUMN decline_note text,
  ADD COLUMN picking_started_at timestamptz,
  ADD COLUMN ready_at timestamptz,
  ADD COLUMN package_count integer,
  ADD COLUMN package_condition_note text,
  ADD COLUMN pickup_promise_at timestamptz,
  ADD COLUMN pickup_otp_hash text,
  ADD COLUMN pickup_otp_expires_at timestamptz,
  ADD COLUMN pickup_otp_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN picked_up_at timestamptz,
  ADD CONSTRAINT vendor_order_prep_estimate_positive
    CHECK (preparation_estimate_seconds IS NULL OR preparation_estimate_seconds BETWEEN 60 AND 14400),
  ADD CONSTRAINT vendor_order_decline_reason_shape
    CHECK (decline_reason_code IS NULL OR decline_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  ADD CONSTRAINT vendor_order_decline_note_shape
    CHECK (decline_note IS NULL OR length(decline_note) BETWEEN 1 AND 240),
  ADD CONSTRAINT vendor_order_package_count_positive
    CHECK (package_count IS NULL OR package_count BETWEEN 1 AND 40),
  ADD CONSTRAINT vendor_order_package_note_shape
    CHECK (package_condition_note IS NULL OR length(package_condition_note) BETWEEN 1 AND 240),
  ADD CONSTRAINT vendor_order_pickup_otp_hash_shape
    CHECK (pickup_otp_hash IS NULL OR pickup_otp_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT vendor_order_pickup_otp_attempts_bounded
    CHECK (pickup_otp_attempts BETWEEN 0 AND 5),
  -- OTP is issued only after READY, and every OTP field lives together.
  ADD CONSTRAINT vendor_order_pickup_otp_shape
    CHECK ((pickup_otp_hash IS NULL AND pickup_otp_expires_at IS NULL)
        OR (pickup_otp_hash IS NOT NULL AND pickup_otp_expires_at IS NOT NULL)),
  ADD CONSTRAINT vendor_order_ready_snapshot_shape
    CHECK ((lifecycle_state IN ('READY','PICKED_UP'))
             = (ready_at IS NOT NULL AND package_count IS NOT NULL)),
  ADD CONSTRAINT vendor_order_pickup_completes_once
    CHECK ((lifecycle_state = 'PICKED_UP') = (picked_up_at IS NOT NULL)),
  ADD CONSTRAINT vendor_order_accepted_after_placed
    CHECK ((lifecycle_state NOT IN ('PLACED','CANCELLED')) = (accepted_at IS NOT NULL)
        OR lifecycle_state = 'EXPIRED');

-- Fast lookup: vendor watching their own pending queue with deadlines.
CREATE INDEX vendor_orders_pending
  ON marketplace.vendor_orders (vendor_location_id, lifecycle_state, accept_by);

-- 8.3 -- per-line picking state. One row per vendor_order_line, created lazily
-- when the picker first touches the line. PENDING is the implicit state before
-- a pick row exists; the row-level state tracks what the picker did.
CREATE TABLE marketplace.vendor_order_line_picks (
  pick_id uuid PRIMARY KEY,
  vendor_order_line_id uuid NOT NULL UNIQUE
    REFERENCES marketplace.vendor_order_lines (vendor_order_line_id) ON DELETE RESTRICT,
  vendor_order_id uuid NOT NULL
    REFERENCES marketplace.vendor_orders (vendor_order_id) ON DELETE RESTRICT,
  pick_state text NOT NULL,
  actual_quantity integer,
  actual_unit_price_minor bigint,
  substitution_variant_id uuid
    REFERENCES marketplace.catalogue_product_variants (catalogue_variant_id) ON DELETE RESTRICT,
  picker_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pick_state_allowed CHECK (pick_state IN
    ('FOUND','MISSING','PROPOSED_SUBSTITUTION','PROPOSED_WEIGHT','SUBSTITUTION_APPROVED',
     'SUBSTITUTION_REJECTED','WEIGHT_APPROVED','WEIGHT_REJECTED')),
  CONSTRAINT pick_actual_quantity_range
    CHECK (actual_quantity IS NULL OR actual_quantity BETWEEN 0 AND 1000),
  CONSTRAINT pick_actual_price_positive
    CHECK (actual_unit_price_minor IS NULL OR actual_unit_price_minor >= 0),
  -- FOUND lines carry a concrete quantity/price; MISSING lines carry neither;
  -- substitution or weight proposals require a proposed value.
  CONSTRAINT pick_state_value_shape CHECK (
    (pick_state = 'FOUND' AND actual_quantity IS NOT NULL AND actual_unit_price_minor IS NOT NULL
      AND substitution_variant_id IS NULL)
    OR (pick_state = 'MISSING' AND actual_quantity IS NULL AND actual_unit_price_minor IS NULL
      AND substitution_variant_id IS NULL)
    OR (pick_state = 'PROPOSED_SUBSTITUTION' AND substitution_variant_id IS NOT NULL
      AND actual_quantity IS NOT NULL AND actual_unit_price_minor IS NOT NULL)
    OR (pick_state = 'PROPOSED_WEIGHT' AND substitution_variant_id IS NULL
      AND actual_quantity IS NOT NULL AND actual_unit_price_minor IS NOT NULL)
    OR (pick_state IN ('SUBSTITUTION_APPROVED','WEIGHT_APPROVED')
      AND actual_quantity IS NOT NULL AND actual_unit_price_minor IS NOT NULL)
    OR (pick_state IN ('SUBSTITUTION_REJECTED','WEIGHT_REJECTED'))
  )
);
CREATE INDEX vendor_order_picks_order ON marketplace.vendor_order_line_picks (vendor_order_id, pick_state);

-- 8.4 -- customer decision proposals. Every unresolved proposal has a
-- decision_deadline_at; only one open proposal per pick row at a time.
CREATE TABLE marketplace.vendor_order_customer_decisions (
  decision_id uuid PRIMARY KEY,
  vendor_order_id uuid NOT NULL
    REFERENCES marketplace.vendor_orders (vendor_order_id) ON DELETE RESTRICT,
  pick_id uuid NOT NULL
    REFERENCES marketplace.vendor_order_line_picks (pick_id) ON DELETE RESTRICT,
  proposal_kind text NOT NULL CHECK (proposal_kind IN ('SUBSTITUTION','WEIGHT')),
  proposed_variant_id uuid
    REFERENCES marketplace.catalogue_product_variants (catalogue_variant_id) ON DELETE RESTRICT,
  proposed_quantity integer NOT NULL CHECK (proposed_quantity BETWEEN 0 AND 1000),
  proposed_unit_price_minor bigint NOT NULL CHECK (proposed_unit_price_minor >= 0),
  authorization_delta_minor bigint NOT NULL,
  reason_note text NOT NULL CHECK (length(reason_note) BETWEEN 1 AND 240),
  decision_deadline_at timestamptz NOT NULL,
  answer text NOT NULL DEFAULT 'PENDING'
    CHECK (answer IN ('PENDING','APPROVED','REJECTED','TIMED_OUT')),
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT decision_answer_shape
    CHECK ((answer = 'PENDING') = (answered_at IS NULL)),
  CONSTRAINT decision_kind_shape
    CHECK ((proposal_kind = 'SUBSTITUTION') = (proposed_variant_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_decision_per_pick
  ON marketplace.vendor_order_customer_decisions (pick_id) WHERE answer = 'PENDING';
CREATE INDEX vendor_order_decisions_order
  ON marketplace.vendor_order_customer_decisions (vendor_order_id, answer);

-- 8.1/8.2/8.3/8.5/8.6 -- append-only fulfilment audit. Kept separate from
-- checkout_events (0024) so each aggregate's history is self-contained.
CREATE TABLE marketplace.vendor_order_events (
  event_id uuid PRIMARY KEY,
  vendor_order_id uuid NOT NULL
    REFERENCES marketplace.vendor_orders (vendor_order_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('customer','vendor_staff','system')),
  previous_state text,
  resulting_state text,
  reason_code text NOT NULL,
  note text,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT vendor_order_event_type_allowed CHECK (event_type IN
    ('PLACED','ACCEPTED','DECLINED','TIMED_OUT','PICKING_STARTED','LINE_PICKED','LINE_MISSING',
     'SUBSTITUTION_PROPOSED','WEIGHT_PROPOSED','SUBSTITUTION_APPROVED','SUBSTITUTION_REJECTED',
     'WEIGHT_APPROVED','WEIGHT_REJECTED','READY','PICKUP_OTP_ISSUED','PICKUP_OTP_ATTEMPTED',
     'PICKED_UP','RATING_SUBMITTED','SUPPORT_CASE_OPENED')),
  CONSTRAINT vendor_order_event_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT vendor_order_event_note_shape CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500)
);
CREATE INDEX vendor_order_events_order ON marketplace.vendor_order_events (vendor_order_id, occurred_at);

CREATE FUNCTION marketplace.protect_vendor_order_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'vendor order history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER vendor_order_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.vendor_order_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_vendor_order_history();

-- 8.7 -- rating (once per completed vendor_order) and support cases (opened
-- against the smallest affected object: currently the vendor_order).
CREATE TABLE marketplace.vendor_order_ratings (
  vendor_order_id uuid PRIMARY KEY
    REFERENCES marketplace.vendor_orders (vendor_order_id) ON DELETE RESTRICT,
  customer_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  review_note text CHECK (review_note IS NULL OR length(review_note) BETWEEN 1 AND 500),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE marketplace.support_cases (
  support_case_id uuid PRIMARY KEY,
  vendor_order_id uuid NOT NULL
    REFERENCES marketplace.vendor_orders (vendor_order_id) ON DELETE RESTRICT,
  opened_by_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
  lifecycle_state text NOT NULL DEFAULT 'OPEN'
    CHECK (lifecycle_state IN ('OPEN','IN_PROGRESS','RESOLVED','WITHDRAWN')),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX support_cases_open ON marketplace.support_cases (lifecycle_state, created_at DESC);

-- Capabilities. Vendor staff at the owning location handle fulfilment; the
-- customer answers proposals, rates their order, and opens support cases.
INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description)
VALUES
  ('vendor.order.fulfil', 'VENDOR_STAFF', 'VENDOR_LOCATION',
    'Accept, decline, pick, and complete pickup for orders at an owned vendor location'),
  ('customer.order.decide', 'CUSTOMER', 'ACCOUNT',
    'Approve or reject substitution and weight/price proposals on the customer own orders'),
  ('customer.order.read', 'CUSTOMER', 'ACCOUNT',
    'Read the customer own order history, receipts, and status'),
  ('customer.order.rate', 'CUSTOMER', 'ACCOUNT',
    'Rate a completed vendor order the customer owns'),
  ('customer.support.open', 'CUSTOMER', 'ACCOUNT',
    'Open a support case scoped to one of the customer own vendor orders')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES
  ('VENDOR_OWNER', 'vendor.order.fulfil'),
  ('VENDOR_MANAGER', 'vendor.order.fulfil'),
  ('VENDOR_PICKER', 'vendor.order.fulfil'),
  ('CUSTOMER', 'customer.order.decide'),
  ('CUSTOMER', 'customer.order.read'),
  ('CUSTOMER', 'customer.order.rate'),
  ('CUSTOMER', 'customer.support.open')
ON CONFLICT DO NOTHING;
