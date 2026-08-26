-- Phase 5.4: vendor staff invitation and vendor-facing store settings.
-- Completes phases.md Phase 5 alongside the 5.3 admin-pipeline restore/impact
-- additions made in the application layer of this same step.

-- Append-only activity history for vendor-self-service actions, distinct from
-- marketplace.vendor_network_events (which records admin-authored changes to
-- the same underlying rows). Keeping them separate preserves the existing
-- meaning of vendor_network_events as "what admin did to this vendor."
CREATE TABLE marketplace.vendor_staff_events (
  event_id uuid PRIMARY KEY,
  vendor_location_id uuid NOT NULL
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  target_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT vendor_staff_event_type_allowed CHECK (event_type IN
    ('STAFF_INVITED', 'STAFF_REVOKED', 'SETTINGS_UPDATED')),
  CONSTRAINT vendor_staff_event_reason_shape CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT vendor_staff_event_target_shape
    CHECK ((event_type = 'STAFF_INVITED' OR event_type = 'STAFF_REVOKED') = (target_user_id IS NOT NULL))
);
CREATE INDEX vendor_staff_events_location_history
  ON marketplace.vendor_staff_events (vendor_location_id, occurred_at DESC);

CREATE FUNCTION marketplace.protect_vendor_staff_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'vendor staff history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER vendor_staff_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.vendor_staff_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_vendor_staff_history();

INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description)
VALUES
  ('vendor.staff.manage', 'VENDOR_STAFF', 'VENDOR_LOCATION',
   'Invite and revoke manager/picker staff at an owned vendor location'),
  ('vendor.settings.manage', 'VENDOR_STAFF', 'VENDOR_LOCATION',
   'Manage store profile, hours, closures, zones, minimum order, and prep time')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES
  ('VENDOR_OWNER', 'vendor.staff.manage'),
  ('VENDOR_OWNER', 'vendor.settings.manage'),
  ('VENDOR_MANAGER', 'vendor.settings.manage')
ON CONFLICT DO NOTHING;
