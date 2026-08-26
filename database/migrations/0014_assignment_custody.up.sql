INSERT INTO marketplace.capabilities
  (capability_key, actor_kind, resource_rule, description)
VALUES
  ('admin.delivery.assignment_manage', 'ADMIN', 'ADMIN_SCOPE',
   'Manage synthetic delivery assignments within an operations scope');

INSERT INTO marketplace.roles (role_key, actor_kind, assignment_scope, description)
VALUES ('DELIVERY_OPERATOR', 'ADMIN', 'ADMIN_SCOPE', 'Scoped delivery operations user');

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES ('DELIVERY_OPERATOR', 'admin.delivery.assignment_manage');

CREATE TABLE marketplace.delivery_assignments (
  delivery_assignment_id uuid PRIMARY KEY,
  source_order_reference text NOT NULL,
  vendor_location_id uuid NOT NULL,
  partner_user_id uuid,
  assignment_state text NOT NULL,
  custody_state text NOT NULL DEFAULT 'NONE',
  package_count integer NOT NULL,
  handling_flags text[] NOT NULL DEFAULT '{}',
  approximate_pickup_area text NOT NULL,
  approximate_drop_area text NOT NULL,
  offer_expires_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT delivery_assignment_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_assignment_partner_fk FOREIGN KEY (partner_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT delivery_assignment_order_reference_shape CHECK
    (source_order_reference ~ '^SYNTH-ORDER-[A-Z0-9-]{4,64}$'),
  CONSTRAINT delivery_assignment_state_allowed CHECK (assignment_state IN
    ('UNASSIGNED', 'OFFERED', 'ASSIGNED', 'AT_VENDOR', 'PICKED_UP',
     'EN_ROUTE_TO_CUSTOMER', 'ARRIVED', 'DELIVERED', 'DECLINED',
     'OFFER_EXPIRED', 'FAILED_PICKUP', 'REASSIGNED', 'CANCELLED',
     'DELIVERY_FAILED', 'RETURN_REQUIRED', 'RETURN_AUTHORIZED',
     'RETURNING', 'RETURNED')),
  CONSTRAINT delivery_assignment_custody_state_allowed CHECK
    (custody_state IN ('NONE', 'PICKUP_VERIFIED', 'IN_CUSTODY',
                       'DELIVERED', 'RETURNED', 'TRANSFERRED')),
  CONSTRAINT delivery_assignment_package_count CHECK (package_count BETWEEN 1 AND 100),
  CONSTRAINT delivery_assignment_areas_synthetic CHECK
    (approximate_pickup_area ~ '^SYNTH [A-Za-z0-9 .,&''()-]{2,95}$'
     AND approximate_drop_area ~ '^SYNTH [A-Za-z0-9 .,&''()-]{2,95}$'),
  CONSTRAINT delivery_assignment_offer_shape CHECK
    ((assignment_state = 'OFFERED' AND partner_user_id IS NOT NULL AND offer_expires_at IS NOT NULL)
     OR assignment_state <> 'OFFERED'),
  CONSTRAINT delivery_assignment_partner_shape CHECK
    ((assignment_state = 'UNASSIGNED' AND partner_user_id IS NULL)
     OR (assignment_state <> 'UNASSIGNED' AND partner_user_id IS NOT NULL)),
  CONSTRAINT delivery_assignment_custody_shape CHECK
    ((assignment_state IN ('UNASSIGNED', 'OFFERED', 'ASSIGNED', 'AT_VENDOR',
                           'DECLINED', 'OFFER_EXPIRED', 'FAILED_PICKUP',
                           'REASSIGNED', 'CANCELLED') AND custody_state = 'NONE')
     OR (assignment_state = 'PICKED_UP' AND custody_state = 'IN_CUSTODY')
     OR (assignment_state IN ('EN_ROUTE_TO_CUSTOMER', 'ARRIVED', 'DELIVERY_FAILED',
                              'RETURN_REQUIRED', 'RETURN_AUTHORIZED', 'RETURNING')
         AND custody_state = 'IN_CUSTODY')
     OR (assignment_state = 'DELIVERED' AND custody_state = 'DELIVERED')
     OR (assignment_state = 'RETURNED' AND custody_state = 'RETURNED')),
  CONSTRAINT delivery_assignment_version_positive CHECK (version >= 1)
);

CREATE UNIQUE INDEX one_active_attempt_per_synthetic_order
  ON marketplace.delivery_assignments (source_order_reference)
  WHERE assignment_state IN
    ('UNASSIGNED', 'OFFERED', 'ASSIGNED', 'AT_VENDOR', 'PICKED_UP',
     'EN_ROUTE_TO_CUSTOMER', 'ARRIVED', 'DELIVERY_FAILED', 'RETURN_REQUIRED',
     'RETURN_AUTHORIZED', 'RETURNING');
CREATE INDEX delivery_assignments_partner_active
  ON marketplace.delivery_assignments (partner_user_id, updated_at DESC, delivery_assignment_id)
  WHERE assignment_state IN
    ('OFFERED', 'ASSIGNED', 'AT_VENDOR', 'PICKED_UP', 'EN_ROUTE_TO_CUSTOMER',
     'ARRIVED', 'DELIVERY_FAILED', 'RETURN_REQUIRED', 'RETURN_AUTHORIZED', 'RETURNING');
CREATE INDEX delivery_assignments_offer_expiry
  ON marketplace.delivery_assignments (offer_expires_at, delivery_assignment_id)
  WHERE assignment_state = 'OFFERED';

CREATE TABLE marketplace.assignment_events (
  assignment_event_id uuid PRIMARY KEY,
  delivery_assignment_id uuid NOT NULL,
  assignment_version integer NOT NULL,
  event_type text NOT NULL,
  previous_state text,
  resulting_state text NOT NULL,
  previous_custody_state text,
  resulting_custody_state text NOT NULL,
  actor_id uuid NOT NULL,
  actor_kind text NOT NULL,
  reason_code text NOT NULL,
  command_reference text NOT NULL UNIQUE,
  proof_reference text,
  package_count integer,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT assignment_event_assignment_fk FOREIGN KEY (delivery_assignment_id)
    REFERENCES marketplace.delivery_assignments (delivery_assignment_id) ON DELETE RESTRICT,
  CONSTRAINT assignment_event_type_allowed CHECK (event_type IN
    ('ASSIGNMENT_CREATED', 'OFFERED', 'ACCEPTED', 'AT_VENDOR', 'PICKUP_CONFIRMED',
     'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'DECLINED', 'OFFER_EXPIRED',
     'FAILED_PICKUP', 'REASSIGNED', 'CANCELLED', 'DELIVERY_FAILED',
     'RETURN_REQUIRED', 'RETURN_AUTHORIZED', 'RETURNING', 'RETURNED')),
  CONSTRAINT assignment_event_actor_kind_allowed CHECK
    (actor_kind IN ('admin', 'delivery_partner', 'system', 'vendor_staff')),
  CONSTRAINT assignment_event_reason_shape CHECK
    (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT assignment_event_command_shape CHECK
    (command_reference ~ '^SYNTH-CMD-[A-Z0-9-]{4,64}$'),
  CONSTRAINT assignment_event_proof_shape CHECK
    (proof_reference IS NULL OR proof_reference ~ '^SYNTH-PROOF-[A-Z0-9-]{4,64}$'),
  CONSTRAINT assignment_event_version_unique UNIQUE
    (delivery_assignment_id, assignment_version)
);

CREATE INDEX assignment_events_history
  ON marketplace.assignment_events
    (delivery_assignment_id, assignment_version, occurred_at);

CREATE TABLE marketplace.custody_events (
  custody_event_id uuid PRIMARY KEY,
  delivery_assignment_id uuid NOT NULL,
  sequence integer NOT NULL,
  custody_state text NOT NULL,
  partner_user_id uuid NOT NULL,
  package_count integer NOT NULL,
  proof_reference text NOT NULL,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT custody_event_assignment_fk FOREIGN KEY (delivery_assignment_id)
    REFERENCES marketplace.delivery_assignments (delivery_assignment_id) ON DELETE RESTRICT,
  CONSTRAINT custody_event_partner_fk FOREIGN KEY (partner_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT custody_event_state_allowed CHECK
    (custody_state IN ('PICKUP_VERIFIED', 'IN_CUSTODY', 'DELIVERED', 'RETURNED', 'TRANSFERRED')),
  CONSTRAINT custody_event_package_count CHECK (package_count BETWEEN 1 AND 100),
  CONSTRAINT custody_event_proof_shape CHECK
    (proof_reference ~ '^SYNTH-PROOF-[A-Z0-9-]{4,64}$'),
  CONSTRAINT custody_event_reason_shape CHECK
    (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT custody_event_sequence_unique UNIQUE (delivery_assignment_id, sequence)
);

CREATE TABLE marketplace.return_tasks (
  return_task_id uuid PRIMARY KEY,
  delivery_assignment_id uuid NOT NULL UNIQUE,
  return_state text NOT NULL,
  return_reason_code text NOT NULL,
  destination_reference text,
  expected_package_count integer NOT NULL,
  proof_reference text,
  authorized_by_user_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT return_task_assignment_fk FOREIGN KEY (delivery_assignment_id)
    REFERENCES marketplace.delivery_assignments (delivery_assignment_id) ON DELETE RESTRICT,
  CONSTRAINT return_task_authorizer_fk FOREIGN KEY (authorized_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT return_task_state_allowed CHECK
    (return_state IN ('REQUIRED', 'AUTHORIZED', 'RETURNING', 'RETURNED')),
  CONSTRAINT return_task_reason_shape CHECK
    (return_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT return_task_destination_shape CHECK
    (destination_reference IS NULL OR destination_reference ~ '^SYNTH-RETURN-[A-Z0-9-]{4,64}$'),
  CONSTRAINT return_task_proof_shape CHECK
    (proof_reference IS NULL OR proof_reference ~ '^SYNTH-PROOF-[A-Z0-9-]{4,64}$'),
  CONSTRAINT return_task_package_count CHECK (expected_package_count BETWEEN 1 AND 100),
  CONSTRAINT return_task_authorization_shape CHECK
    ((return_state = 'REQUIRED' AND authorized_by_user_id IS NULL AND destination_reference IS NULL)
     OR (return_state <> 'REQUIRED' AND authorized_by_user_id IS NOT NULL
         AND destination_reference IS NOT NULL)),
  CONSTRAINT return_task_version_positive CHECK (version >= 1)
);

CREATE FUNCTION marketplace.protect_assignment_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'assignment and custody history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER assignment_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.assignment_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_assignment_history();

CREATE TRIGGER custody_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.custody_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_assignment_history();

COMMENT ON TABLE marketplace.delivery_assignments IS
  'Synthetic company-test delivery attempts; no real order, address, GPS, OTP, or money authority.';
COMMENT ON TABLE marketplace.assignment_events IS
  'Append-only assignment transition evidence with retry-safe synthetic command references.';
COMMENT ON TABLE marketplace.custody_events IS
  'Append-only package-custody evidence; proof references never contain proof secrets.';
COMMENT ON TABLE marketplace.return_tasks IS
  'Controlled post-pickup return lifecycle. Financial treatment belongs to Phase 5.6.';
