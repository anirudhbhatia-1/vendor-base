CREATE TABLE marketplace.vendors (
  vendor_id uuid PRIMARY KEY,
  business_name text NOT NULL,
  profile_description text,
  lifecycle_state text NOT NULL DEFAULT 'DRAFT',
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  data_classification text NOT NULL DEFAULT 'INTERNAL',
  retention_class text NOT NULL DEFAULT 'BUSINESS_RECORD',
  retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '730 days'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT vendor_business_name_shape CHECK
    (business_name ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().-]{1,118}$'),
  CONSTRAINT vendor_profile_description_shape CHECK
    (profile_description IS NULL OR length(profile_description) BETWEEN 1 AND 500),
  CONSTRAINT vendor_lifecycle_state_allowed CHECK
    (lifecycle_state IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  CONSTRAINT vendor_version_positive CHECK (version >= 1),
  CONSTRAINT vendor_classification CHECK (data_classification = 'INTERNAL'),
  CONSTRAINT vendor_retention_class CHECK (retention_class = 'BUSINESS_RECORD')
);

CREATE TABLE marketplace.vendor_locations (
  vendor_location_id uuid PRIMARY KEY,
  vendor_id uuid NOT NULL,
  location_name text NOT NULL,
  profile_description text,
  operating_timezone text NOT NULL,
  coordinates geography(Point, 4326) NOT NULL,
  category text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'DRAFT',
  minimum_order_minor bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  preparation_seconds integer NOT NULL DEFAULT 1200,
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  data_classification text NOT NULL DEFAULT 'INTERNAL',
  retention_class text NOT NULL DEFAULT 'BUSINESS_RECORD',
  retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '730 days'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT vendor_location_vendor_fk FOREIGN KEY (vendor_id)
    REFERENCES marketplace.vendors (vendor_id) ON DELETE RESTRICT,
  CONSTRAINT vendor_location_name_shape CHECK
    (location_name ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().-]{1,118}$'),
  CONSTRAINT vendor_location_profile_description_shape CHECK
    (profile_description IS NULL OR length(profile_description) BETWEEN 1 AND 500),
  CONSTRAINT vendor_location_timezone_shape CHECK
    (operating_timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+$'),
  CONSTRAINT vendor_location_category_allowed CHECK (category = 'FRUIT_VEGETABLE'),
  CONSTRAINT vendor_location_lifecycle_state_allowed CHECK
    (lifecycle_state IN ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED')),
  CONSTRAINT vendor_location_money CHECK
    (minimum_order_minor >= 0 AND minimum_order_minor <= 10000000 AND currency = 'INR'),
  CONSTRAINT vendor_location_preparation_seconds CHECK
    (preparation_seconds BETWEEN 300 AND 14400),
  CONSTRAINT vendor_location_version_positive CHECK (version >= 1),
  CONSTRAINT vendor_location_coordinate_bounds CHECK
    (ST_X(coordinates::geometry) BETWEEN -180 AND 180
     AND ST_Y(coordinates::geometry) BETWEEN -90 AND 90),
  CONSTRAINT vendor_location_classification CHECK (data_classification = 'INTERNAL'),
  CONSTRAINT vendor_location_retention_class CHECK (retention_class = 'BUSINESS_RECORD'),
  CONSTRAINT vendor_location_name_unique UNIQUE (vendor_id, location_name)
);

CREATE INDEX vendor_locations_vendor_state
  ON marketplace.vendor_locations (vendor_id, lifecycle_state, vendor_location_id);
CREATE INDEX vendor_locations_coordinates
  ON marketplace.vendor_locations USING gist (coordinates);

ALTER TABLE marketplace.staff_memberships
  ADD CONSTRAINT staff_membership_vendor_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT;

CREATE TABLE marketplace.vendor_location_operating_hours (
  operating_hour_id uuid PRIMARY KEY,
  vendor_location_id uuid NOT NULL,
  weekday smallint NOT NULL,
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT operating_hour_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT operating_hour_weekday CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT operating_hour_same_day CHECK (closes_at > opens_at),
  CONSTRAINT operating_hour_unique UNIQUE (vendor_location_id, weekday, opens_at, closes_at)
);

CREATE INDEX operating_hours_location_day
  ON marketplace.vendor_location_operating_hours (vendor_location_id, weekday, opens_at);

CREATE FUNCTION marketplace.prevent_operating_hour_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM marketplace.vendor_location_operating_hours existing
     WHERE existing.vendor_location_id = NEW.vendor_location_id
       AND existing.weekday = NEW.weekday
       AND existing.operating_hour_id <> NEW.operating_hour_id
       AND existing.opens_at < NEW.closes_at
       AND NEW.opens_at < existing.closes_at
  ) THEN
    RAISE EXCEPTION 'operating hours overlap' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER operating_hours_no_overlap
BEFORE INSERT OR UPDATE ON marketplace.vendor_location_operating_hours
FOR EACH ROW EXECUTE FUNCTION marketplace.prevent_operating_hour_overlap();

CREATE TABLE marketplace.vendor_location_calendar_exceptions (
  calendar_exception_id uuid PRIMARY KEY,
  vendor_location_id uuid NOT NULL,
  local_date date NOT NULL,
  exception_kind text NOT NULL,
  opens_at time,
  closes_at time,
  reason_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT calendar_exception_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT calendar_exception_kind_allowed CHECK
    (exception_kind IN ('CLOSED', 'SPECIAL_HOURS')),
  CONSTRAINT calendar_exception_shape CHECK
    ((exception_kind = 'CLOSED' AND opens_at IS NULL AND closes_at IS NULL)
     OR (exception_kind = 'SPECIAL_HOURS' AND opens_at IS NOT NULL
         AND closes_at IS NOT NULL AND closes_at > opens_at)),
  CONSTRAINT calendar_exception_reason_shape CHECK
    (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT calendar_exception_unique UNIQUE (vendor_location_id, local_date)
);

CREATE TABLE marketplace.vendor_location_temporary_closures (
  temporary_closure_id uuid PRIMARY KEY,
  vendor_location_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT temporary_closure_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT temporary_closure_window CHECK (ends_at > starts_at),
  CONSTRAINT temporary_closure_reason_shape CHECK
    (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);

CREATE INDEX temporary_closures_active
  ON marketplace.vendor_location_temporary_closures
    (vendor_location_id, starts_at, ends_at);

CREATE TABLE marketplace.vendor_service_zones (
  service_zone_id uuid PRIMARY KEY,
  vendor_location_id uuid NOT NULL,
  zone_name text NOT NULL,
  operating_timezone text NOT NULL,
  boundary geography(MultiPolygon, 4326) NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT service_zone_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT service_zone_name_shape CHECK (length(zone_name) BETWEEN 3 AND 100),
  CONSTRAINT service_zone_timezone_shape CHECK
    (operating_timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+$'),
  CONSTRAINT service_zone_state_allowed CHECK (lifecycle_state IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT service_zone_boundary_valid CHECK
    (ST_IsValid(boundary::geometry) AND NOT ST_IsEmpty(boundary::geometry)),
  CONSTRAINT service_zone_version_positive CHECK (version >= 1),
  CONSTRAINT service_zone_name_unique UNIQUE (vendor_location_id, zone_name)
);

CREATE INDEX vendor_service_zones_boundary
  ON marketplace.vendor_service_zones USING gist (boundary);
CREATE INDEX vendor_service_zones_location_state
  ON marketplace.vendor_service_zones (vendor_location_id, lifecycle_state, service_zone_id);

CREATE TABLE marketplace.vendor_location_fulfilment_modes (
  vendor_location_id uuid NOT NULL,
  fulfilment_mode text NOT NULL,
  approval_state text NOT NULL DEFAULT 'APPROVED',
  approved_by_user_id uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  PRIMARY KEY (vendor_location_id, fulfilment_mode),
  CONSTRAINT fulfilment_mode_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT fulfilment_mode_approver_fk FOREIGN KEY (approved_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT fulfilment_mode_allowed CHECK
    (fulfilment_mode IN ('CUSTOMER_PICKUP', 'VENDOR_DELIVERY', 'PLATFORM_DELIVERY')),
  CONSTRAINT fulfilment_mode_approval_state CHECK (approval_state = 'APPROVED')
);

CREATE TABLE marketplace.vendor_network_events (
  event_id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  resulting_version integer NOT NULL,
  event_type text NOT NULL,
  actor_id uuid,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT vendor_event_aggregate_type CHECK
    (aggregate_type IN ('VENDOR', 'VENDOR_LOCATION')),
  CONSTRAINT vendor_event_version_positive CHECK (resulting_version >= 1),
  CONSTRAINT vendor_event_type_allowed CHECK (event_type IN
    ('CREATED', 'PROFILE_UPDATED', 'LIFECYCLE_CHANGED', 'OPERATING_HOURS_REPLACED',
     'CALENDAR_EXCEPTION_SET', 'TEMPORARY_CLOSURE_ADDED', 'SERVICE_ZONE_ADDED',
     'FULFILMENT_MODES_REPLACED')),
  CONSTRAINT vendor_event_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT vendor_event_unique UNIQUE (aggregate_type, aggregate_id, resulting_version)
);

CREATE INDEX vendor_network_events_history
  ON marketplace.vendor_network_events
    (aggregate_type, aggregate_id, resulting_version, occurred_at);

CREATE FUNCTION marketplace.protect_vendor_network_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'vendor network history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER vendor_network_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.vendor_network_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_vendor_network_history();
