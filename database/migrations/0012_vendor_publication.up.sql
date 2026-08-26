INSERT INTO marketplace.capabilities
  (capability_key, actor_kind, resource_rule, description)
VALUES
  ('admin.vendor_publication.manage', 'ADMIN', 'ADMIN_SCOPE',
   'Prepare publication readiness and operate published vendor locations within scope'),
  ('admin.vendor_publication.review', 'ADMIN', 'ADMIN_SCOPE',
   'Independently approve or return vendor publication proposals within scope');

INSERT INTO marketplace.roles (role_key, actor_kind, assignment_scope, description)
VALUES
  ('VENDOR_PUBLICATION_OPERATOR', 'ADMIN', 'ADMIN_SCOPE',
   'Scoped vendor publication preparation and operations'),
  ('VENDOR_PUBLICATION_REVIEWER', 'ADMIN', 'ADMIN_SCOPE',
   'Scoped independent vendor publication reviewer');

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES
  ('VENDOR_PUBLICATION_OPERATOR', 'admin.vendor_publication.manage'),
  ('VENDOR_PUBLICATION_REVIEWER', 'admin.vendor_publication.review');

INSERT INTO marketplace.role_separation_rules
  (first_role_key, second_role_key, reason_code)
VALUES
  ('VENDOR_PUBLICATION_OPERATOR', 'VENDOR_PUBLICATION_REVIEWER',
   'PUBLICATION_MAKER_CHECKER');

CREATE TABLE marketplace.vendor_publication_cases (
  publication_case_id uuid PRIMARY KEY,
  onboarding_case_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  vendor_location_id uuid NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'DRAFT',
  readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_by_user_id uuid NOT NULL,
  approved_by_user_id uuid,
  current_reason_code text NOT NULL,
  current_note text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  approved_at timestamptz,
  published_at timestamptz,
  paused_at timestamptz,
  unpublished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT publication_onboarding_fk FOREIGN KEY (onboarding_case_id)
    REFERENCES marketplace.vendor_onboarding_cases (onboarding_case_id) ON DELETE RESTRICT,
  CONSTRAINT publication_vendor_fk FOREIGN KEY (vendor_id)
    REFERENCES marketplace.vendors (vendor_id) ON DELETE RESTRICT,
  CONSTRAINT publication_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT publication_proposer_fk FOREIGN KEY (proposed_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT publication_approver_fk FOREIGN KEY (approved_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT publication_state_allowed CHECK
    (lifecycle_state IN ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUIRED', 'APPROVED',
                         'PUBLISHED', 'PAUSED', 'UNPUBLISHED')),
  CONSTRAINT publication_reason_shape CHECK
    (current_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT publication_note_shape CHECK (length(current_note) BETWEEN 3 AND 1000),
  CONSTRAINT publication_readiness_shape CHECK
    (jsonb_typeof(readiness_snapshot) = 'object'),
  CONSTRAINT publication_version_positive CHECK (version >= 1),
  CONSTRAINT publication_maker_checker CHECK
    (approved_by_user_id IS NULL OR approved_by_user_id <> proposed_by_user_id),
  CONSTRAINT publication_approval_shape CHECK
    ((lifecycle_state IN ('APPROVED', 'PUBLISHED', 'PAUSED', 'UNPUBLISHED')
      AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
     OR lifecycle_state NOT IN ('APPROVED', 'PUBLISHED', 'PAUSED', 'UNPUBLISHED')),
  CONSTRAINT publication_onboarding_unique UNIQUE (onboarding_case_id),
  CONSTRAINT publication_vendor_unique UNIQUE (vendor_id),
  CONSTRAINT publication_location_unique UNIQUE (vendor_location_id)
);

CREATE INDEX vendor_publication_pipeline
  ON marketplace.vendor_publication_cases
    (lifecycle_state, updated_at DESC, publication_case_id);

CREATE TABLE marketplace.vendor_publication_events (
  publication_event_id uuid PRIMARY KEY,
  publication_case_id uuid NOT NULL,
  case_version integer NOT NULL,
  event_type text NOT NULL,
  previous_state text,
  resulting_state text NOT NULL,
  actor_user_id uuid NOT NULL,
  reason_code text NOT NULL,
  note text NOT NULL,
  evidence_reference text,
  readiness_snapshot jsonb NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT publication_event_case_fk FOREIGN KEY (publication_case_id)
    REFERENCES marketplace.vendor_publication_cases (publication_case_id) ON DELETE RESTRICT,
  CONSTRAINT publication_event_actor_fk FOREIGN KEY (actor_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT publication_event_type_allowed CHECK
    (event_type IN ('CREATED', 'READINESS_EVALUATED', 'SUBMITTED', 'APPROVED',
                    'CHANGES_REQUESTED', 'PUBLISHED', 'PAUSED', 'UNPUBLISHED')),
  CONSTRAINT publication_event_state_allowed CHECK
    ((previous_state IS NULL OR previous_state IN
      ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUIRED', 'APPROVED',
       'PUBLISHED', 'PAUSED', 'UNPUBLISHED'))
     AND resulting_state IN
      ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUIRED', 'APPROVED',
       'PUBLISHED', 'PAUSED', 'UNPUBLISHED')),
  CONSTRAINT publication_event_version_positive CHECK (case_version >= 1),
  CONSTRAINT publication_event_reason_shape CHECK
    (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT publication_event_note_shape CHECK (length(note) BETWEEN 3 AND 1000),
  CONSTRAINT publication_event_evidence_shape CHECK
    (evidence_reference IS NULL
     OR evidence_reference ~ '^SYNTH-EVIDENCE-[A-Z0-9-]{6,64}$'),
  CONSTRAINT publication_event_readiness_shape CHECK
    (jsonb_typeof(readiness_snapshot) = 'object'),
  CONSTRAINT publication_event_version_unique UNIQUE (publication_case_id, case_version)
);

CREATE INDEX vendor_publication_event_history
  ON marketplace.vendor_publication_events
    (publication_case_id, case_version, occurred_at);

CREATE FUNCTION marketplace.protect_vendor_publication_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'vendor publication history is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER vendor_publication_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.vendor_publication_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_vendor_publication_history();
