-- Phase 9 remainder: partner onboarding (9.1), offline proof recovery (9.7),
-- guided exceptions and safety (9.8), and earnings + disputes (9.10). Custody,
-- offer/accept, waiting, pickup, delivery, and return are already provided by
-- migration 0014 (assignment-custody) and its service; this migration completes
-- the phase without disturbing that aggregate.

-- 9.1 -- partner application. One current application per user; the reviewed
-- lifecycle drives whether identity_access grants the PARTNER role and sets
-- partner_eligibilities to ELIGIBLE.
CREATE TABLE marketplace.partner_applications (
  partner_application_id uuid PRIMARY KEY,
  applicant_user_id uuid NOT NULL UNIQUE REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  identity_reference text NOT NULL,
  vehicle_reference text NOT NULL,
  vehicle_kind text NOT NULL,
  bank_account_reference text NOT NULL,
  insurance_reference text NOT NULL,
  emergency_contact_reference text NOT NULL,
  training_reference text NOT NULL,
  home_zone_name text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'DRAFT',
  reviewer_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  reason_code text,
  reason_note text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT partner_application_state_allowed CHECK (lifecycle_state IN
    ('DRAFT','SUBMITTED','UNDER_REVIEW','CHANGES_REQUIRED','APPROVED','REJECTED')),
  CONSTRAINT partner_application_identity_shape
    CHECK (identity_reference ~ '^SYNTH-PARTNER-IDENTITY-[A-Z0-9-]{4,64}$'),
  CONSTRAINT partner_application_vehicle_shape
    CHECK (vehicle_reference ~ '^SYNTH-PARTNER-VEHICLE-[A-Z0-9-]{4,64}$'),
  CONSTRAINT partner_application_vehicle_kind CHECK
    (vehicle_kind IN ('BICYCLE','MOTORCYCLE','SCOOTER','SMALL_VEHICLE')),
  CONSTRAINT partner_application_bank_shape
    CHECK (bank_account_reference ~ '^SYNTH-PARTNER-BANK-[A-Z0-9-]{4,64}$'),
  CONSTRAINT partner_application_insurance_shape
    CHECK (insurance_reference ~ '^SYNTH-PARTNER-INSURANCE-[A-Z0-9-]{4,64}$'),
  CONSTRAINT partner_application_emergency_shape
    CHECK (emergency_contact_reference ~ '^SYNTH-PARTNER-EMERGENCY-[A-Z0-9-]{4,64}$'),
  CONSTRAINT partner_application_training_shape
    CHECK (training_reference ~ '^SYNTH-PARTNER-TRAINING-[A-Z0-9-]{4,64}$'),
  CONSTRAINT partner_application_zone_shape
    CHECK (home_zone_name ~ '^SYNTH [A-Za-z0-9 &''().,-]{2,95}$'),
  CONSTRAINT partner_application_reason_shape
    CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT partner_application_note_shape
    CHECK (reason_note IS NULL OR length(reason_note) BETWEEN 1 AND 500),
  CONSTRAINT partner_application_submission_shape
    CHECK ((lifecycle_state = 'DRAFT') = (submitted_at IS NULL)),
  CONSTRAINT partner_application_decision_shape
    CHECK ((lifecycle_state IN ('APPROVED','REJECTED')) = (decided_at IS NOT NULL AND reviewer_user_id IS NOT NULL))
);
CREATE INDEX partner_applications_review_queue
  ON marketplace.partner_applications (lifecycle_state, submitted_at NULLS FIRST, partner_application_id);

CREATE TABLE marketplace.partner_application_events (
  event_id uuid PRIMARY KEY,
  partner_application_id uuid NOT NULL
    REFERENCES marketplace.partner_applications (partner_application_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  previous_state text,
  resulting_state text,
  reason_code text NOT NULL,
  note text,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT partner_application_event_type_allowed CHECK (event_type IN
    ('CREATED','SUBMITTED','REVIEW_STARTED','CHANGES_REQUESTED','APPROVED','REJECTED','APPEAL_OPENED')),
  CONSTRAINT partner_application_event_reason_shape
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);
CREATE INDEX partner_application_events_history
  ON marketplace.partner_application_events (partner_application_id, occurred_at);

CREATE FUNCTION marketplace.protect_partner_application_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'partner application history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER partner_application_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.partner_application_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_partner_application_history();

-- 9.7 -- offline proof recovery. When the partner is offline (no server access
-- at the exact moment of pickup or delivery), the app stores the proof
-- locally (encrypted), then syncs it here on reconnect. This table keeps
-- track of pending recoveries so a partner cannot pick up a second job while
-- an unresolved offline proof is outstanding.
CREATE TABLE marketplace.partner_offline_proofs (
  partner_offline_proof_id uuid PRIMARY KEY,
  delivery_assignment_id uuid NOT NULL
    REFERENCES marketplace.delivery_assignments (delivery_assignment_id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  proof_kind text NOT NULL CHECK (proof_kind IN ('PICKUP','DELIVERY','RETURN')),
  encrypted_payload_digest text NOT NULL,
  encryption_key_reference text NOT NULL,
  captured_at timestamptz NOT NULL,
  sync_state text NOT NULL DEFAULT 'PENDING',
  synced_at timestamptz,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT partner_offline_proof_digest_shape
    CHECK (encrypted_payload_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT partner_offline_proof_key_shape
    CHECK (encryption_key_reference ~ '^SYNTH-PARTNER-KEY-[A-Z0-9-]{4,64}$'),
  CONSTRAINT partner_offline_proof_sync_state CHECK (sync_state IN ('PENDING','SYNCED','EXPIRED')),
  CONSTRAINT partner_offline_proof_reason_shape
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  -- SYNCED requires synced_at; PENDING and EXPIRED must leave it NULL.
  CONSTRAINT partner_offline_proof_sync_shape
    CHECK ((sync_state = 'SYNCED') = (synced_at IS NOT NULL))
);
-- At most one PENDING recovery per partner: a partner with unsynchronised
-- proof cannot begin a new active assignment.
CREATE UNIQUE INDEX one_pending_offline_proof_per_partner
  ON marketplace.partner_offline_proofs (partner_user_id) WHERE sync_state = 'PENDING';
CREATE INDEX partner_offline_proofs_by_assignment
  ON marketplace.partner_offline_proofs (delivery_assignment_id, sync_state, captured_at);

-- 9.8 -- guided exception catalog. Every exception path ends in a named
-- resolution rather than a free-text field, so operations can enumerate what
-- happened and route to the right recovery. Kept append-only via the
-- delivery_assignments audit trail.
CREATE TABLE marketplace.partner_exception_events (
  partner_exception_event_id uuid PRIMARY KEY,
  delivery_assignment_id uuid NOT NULL
    REFERENCES marketplace.delivery_assignments (delivery_assignment_id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  exception_kind text NOT NULL,
  resolution_state text NOT NULL,
  evidence_note text,
  reason_code text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT partner_exception_kind_allowed CHECK (exception_kind IN
    ('VENDOR_DELAY','MISSING_PACKAGE','DAMAGED_PACKAGE','UNREACHABLE_CUSTOMER',
     'WRONG_ADDRESS','UNSAFE_LOCATION','ACCIDENT','MEDICAL_EMERGENCY',
     'THREAT','VEHICLE_FAILURE','PROHIBITED_GOODS')),
  CONSTRAINT partner_exception_resolution_allowed CHECK (resolution_state IN
    ('OPEN','RETRY','CONTINUE','RETURN_TO_VENDOR','CANCEL','REASSIGN','SUPPORT')),
  CONSTRAINT partner_exception_evidence_shape
    CHECK (evidence_note IS NULL OR length(evidence_note) BETWEEN 1 AND 500),
  CONSTRAINT partner_exception_reason_shape
    CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);
CREATE INDEX partner_exception_events_open
  ON marketplace.partner_exception_events (delivery_assignment_id, resolution_state, occurred_at);

CREATE FUNCTION marketplace.protect_partner_exception_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'partner exception history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER partner_exception_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.partner_exception_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_partner_exception_history();

-- 9.10 -- earnings and disputes. One earnings record per completed delivery
-- (DELIVERED or RETURNED). Every minor-unit field is separately explainable so
-- the partner-facing statement matches what an admin can reconcile.
CREATE TABLE marketplace.partner_earnings_records (
  partner_earnings_record_id uuid PRIMARY KEY,
  delivery_assignment_id uuid NOT NULL UNIQUE
    REFERENCES marketplace.delivery_assignments (delivery_assignment_id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  outcome text NOT NULL,
  base_minor bigint NOT NULL CHECK (base_minor >= 0),
  distance_minor bigint NOT NULL DEFAULT 0 CHECK (distance_minor >= 0),
  time_minor bigint NOT NULL DEFAULT 0 CHECK (time_minor >= 0),
  wait_minor bigint NOT NULL DEFAULT 0 CHECK (wait_minor >= 0),
  return_minor bigint NOT NULL DEFAULT 0 CHECK (return_minor >= 0),
  incentive_minor bigint NOT NULL DEFAULT 0 CHECK (incentive_minor >= 0),
  tip_minor bigint NOT NULL DEFAULT 0 CHECK (tip_minor >= 0),
  adjustment_minor bigint NOT NULL DEFAULT 0,
  net_minor bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT partner_earnings_outcome_allowed CHECK (outcome IN ('DELIVERED','RETURNED','CANCELLED_POST_PICKUP')),
  -- Net is the sum of every explainable component; guard against silent drift.
  CONSTRAINT partner_earnings_net_shape CHECK (
    net_minor = base_minor + distance_minor + time_minor + wait_minor
             + return_minor + incentive_minor + tip_minor + adjustment_minor
  )
);
CREATE INDEX partner_earnings_by_partner
  ON marketplace.partner_earnings_records (partner_user_id, created_at DESC);

CREATE TABLE marketplace.partner_dispute_cases (
  partner_dispute_case_id uuid PRIMARY KEY,
  partner_earnings_record_id uuid NOT NULL
    REFERENCES marketplace.partner_earnings_records (partner_earnings_record_id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  disputed_component text NOT NULL,
  disputed_amount_minor bigint NOT NULL,
  proposed_amount_minor bigint NOT NULL,
  evidence_note text NOT NULL CHECK (length(evidence_note) BETWEEN 1 AND 500),
  lifecycle_state text NOT NULL DEFAULT 'OPEN',
  resolver_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  resolution_reason_code text,
  resolved_amount_minor bigint,
  deadline_at timestamptz NOT NULL,
  resolved_at timestamptz,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT partner_dispute_component_allowed CHECK (disputed_component IN
    ('BASE','DISTANCE','TIME','WAIT','RETURN','INCENTIVE','TIP','ADJUSTMENT')),
  CONSTRAINT partner_dispute_state_allowed CHECK (lifecycle_state IN ('OPEN','RESOLVED','WITHDRAWN')),
  CONSTRAINT partner_dispute_resolution_shape CHECK (
    (lifecycle_state IN ('RESOLVED','WITHDRAWN')) = (resolved_at IS NOT NULL AND resolver_user_id IS NOT NULL)
    AND ((lifecycle_state = 'RESOLVED') = (resolution_reason_code IS NOT NULL AND resolved_amount_minor IS NOT NULL))
  ),
  CONSTRAINT partner_dispute_reason_shape
    CHECK (resolution_reason_code IS NULL OR resolution_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);
-- One open dispute per (record, component) at a time.
CREATE UNIQUE INDEX one_open_dispute_per_component
  ON marketplace.partner_dispute_cases (partner_earnings_record_id, disputed_component)
  WHERE lifecycle_state = 'OPEN';

-- New capabilities. partner.assignment.act already exists (migration 0008) and
-- is reused for offline proof + guided exceptions rather than duplicated.
INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description)
VALUES
  ('partner.application.manage', 'PARTNER', 'PARTNER_SELF',
    'Draft, edit, and submit the partner own application for review'),
  ('partner.earnings.read', 'PARTNER', 'PARTNER_SELF',
    'Read the partner own earnings and dispute history'),
  ('partner.earnings.dispute', 'PARTNER', 'PARTNER_SELF',
    'Open a dispute on the partner own earnings component'),
  ('admin.partner_application.review', 'ADMIN', 'ADMIN_SCOPE',
    'Review and decide partner applications'),
  ('admin.partner_earnings.resolve', 'ADMIN', 'ADMIN_SCOPE',
    'Resolve partner earnings disputes')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES
  ('DELIVERY_PARTNER', 'partner.application.manage'),
  ('DELIVERY_PARTNER', 'partner.earnings.read'),
  ('DELIVERY_PARTNER', 'partner.earnings.dispute'),
  ('SUPPORT_AGENT', 'admin.partner_application.review'),
  ('SUPPORT_AGENT', 'admin.partner_earnings.resolve')
ON CONFLICT DO NOTHING;
