CREATE TABLE marketplace.partner_availability (
  partner_user_id uuid PRIMARY KEY REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  availability_state text NOT NULL DEFAULT 'OFFLINE' CHECK (availability_state IN ('OFFLINE','ONLINE','PAUSED')),
  current_coordinates geography(Point,4326),
  location_accuracy_meters integer CHECK (location_accuracy_meters IS NULL OR location_accuracy_meters BETWEEN 0 AND 10000),
  battery_percent integer CHECK (battery_percent IS NULL OR battery_percent BETWEEN 0 AND 100),
  online_since timestamptz,
  accumulated_online_seconds bigint NOT NULL DEFAULT 0 CHECK (accumulated_online_seconds >= 0),
  warning_codes text[] NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((availability_state='ONLINE')=(online_since IS NOT NULL))
);
CREATE INDEX partner_availability_dispatch ON marketplace.partner_availability USING gist(current_coordinates) WHERE availability_state='ONLINE';
CREATE TABLE marketplace.partner_availability_events (
  event_id uuid PRIMARY KEY, partner_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  previous_state text, resulting_state text NOT NULL, warning_codes text[] NOT NULL DEFAULT '{}',
  actor_id uuid NOT NULL, reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  request_id uuid NOT NULL, correlation_id uuid NOT NULL, occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION marketplace.protect_partner_availability_events() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'partner availability events are append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER partner_availability_events_append_only BEFORE UPDATE OR DELETE ON marketplace.partner_availability_events FOR EACH ROW EXECUTE FUNCTION marketplace.protect_partner_availability_events();
INSERT INTO marketplace.capabilities(capability_key,actor_kind,resource_rule,description) VALUES
('partner.availability.manage','PARTNER','PARTNER_SELF','Manage own dispatch availability and device health'),
('admin.delivery.partner_dispatch','ADMIN','ADMIN_SCOPE','Find eligible nearby partners for dispatch') ON CONFLICT DO NOTHING;
INSERT INTO marketplace.role_capabilities(role_key,capability_key) VALUES
('DELIVERY_PARTNER','partner.availability.manage'),('DELIVERY_OPERATOR','admin.delivery.partner_dispatch') ON CONFLICT DO NOTHING;
