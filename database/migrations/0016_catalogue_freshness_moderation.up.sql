CREATE TABLE marketplace.catalogue_moderation_cases (
  moderation_case_id uuid PRIMARY KEY,
  inventory_item_id uuid NOT NULL REFERENCES marketplace.inventory_items (inventory_item_id) ON DELETE RESTRICT,
  vendor_location_id uuid NOT NULL REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  moderation_state text NOT NULL,
  reason_code text NOT NULL,
  correction_reason text,
  opened_by_actor_id uuid NOT NULL,
  reviewed_by_actor_id uuid,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT catalogue_moderation_state_allowed CHECK
    (moderation_state IN ('PENDING','CLEARED','CORRECTION_REQUIRED','RESTRICTED')),
  CONSTRAINT catalogue_moderation_reason_shape CHECK
    (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT catalogue_moderation_correction_shape CHECK
    ((moderation_state IN ('CORRECTION_REQUIRED','RESTRICTED') AND length(trim(correction_reason)) BETWEEN 3 AND 500)
     OR (moderation_state IN ('PENDING','CLEARED') AND correction_reason IS NULL)),
  CONSTRAINT catalogue_moderation_review_shape CHECK
    ((moderation_state = 'PENDING' AND reviewed_by_actor_id IS NULL AND reviewed_at IS NULL)
     OR (moderation_state <> 'PENDING' AND reviewed_by_actor_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CONSTRAINT catalogue_moderation_version_positive CHECK (version >= 1)
);

CREATE UNIQUE INDEX one_open_catalogue_moderation_case
  ON marketplace.catalogue_moderation_cases (inventory_item_id)
  WHERE moderation_state = 'PENDING';
CREATE INDEX catalogue_moderation_queue
  ON marketplace.catalogue_moderation_cases (moderation_state, created_at, moderation_case_id);
CREATE INDEX catalogue_moderation_vendor_history
  ON marketplace.catalogue_moderation_cases (vendor_location_id, created_at DESC, moderation_case_id);

CREATE TABLE marketplace.catalogue_moderation_events (
  moderation_event_id uuid PRIMARY KEY,
  moderation_case_id uuid NOT NULL REFERENCES marketplace.catalogue_moderation_cases (moderation_case_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('CASE_OPENED','CASE_CLEARED','CORRECTION_REQUIRED','ITEM_RESTRICTED')),
  previous_state text,
  resulting_state text NOT NULL,
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT catalogue_moderation_event_state_allowed CHECK
    ((previous_state IS NULL OR previous_state IN ('PENDING','CLEARED','CORRECTION_REQUIRED','RESTRICTED'))
     AND resulting_state IN ('PENDING','CLEARED','CORRECTION_REQUIRED','RESTRICTED'))
);
CREATE INDEX catalogue_moderation_events_history
  ON marketplace.catalogue_moderation_events (moderation_case_id, occurred_at, moderation_event_id);
CREATE TRIGGER catalogue_moderation_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.catalogue_moderation_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_inventory_history();

INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description)
VALUES ('admin.catalogue.moderate', 'ADMIN', 'ADMIN_SCOPE', 'Moderate restricted or invalid catalogue products');
INSERT INTO marketplace.roles (role_key, actor_kind, assignment_scope, description)
VALUES ('CATALOGUE_MODERATOR', 'ADMIN', 'ADMIN_SCOPE', 'Scoped catalogue moderation operator');
INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES ('CATALOGUE_MODERATOR', 'admin.catalogue.moderate');

COMMENT ON TABLE marketplace.catalogue_moderation_cases IS
  'Audited company-test catalogue moderation. Restricted and correction-required products are excluded from customer availability reads.';
