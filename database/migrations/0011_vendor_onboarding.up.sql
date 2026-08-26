INSERT INTO marketplace.capabilities
  (capability_key, actor_kind, resource_rule, description)
VALUES
  ('admin.vendor_onboarding.manage', 'ADMIN', 'ADMIN_SCOPE',
   'Create invitations and manage vendor onboarding workflow within scope'),
  ('admin.vendor_onboarding.review', 'ADMIN', 'ADMIN_SCOPE',
   'Review vendor onboarding evidence and approve or reject within scope');

INSERT INTO marketplace.roles (role_key, actor_kind, assignment_scope, description)
VALUES
  ('VENDOR_ONBOARDING_OPERATOR', 'ADMIN', 'ADMIN_SCOPE',
   'Scoped vendor onboarding workflow operator'),
  ('VENDOR_ONBOARDING_REVIEWER', 'ADMIN', 'ADMIN_SCOPE',
   'Scoped vendor onboarding evidence reviewer');

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES
  ('VENDOR_ONBOARDING_OPERATOR', 'admin.vendor_onboarding.manage'),
  ('VENDOR_ONBOARDING_REVIEWER', 'admin.vendor_onboarding.review');

INSERT INTO marketplace.role_separation_rules
  (first_role_key, second_role_key, reason_code)
VALUES
  ('VENDOR_ONBOARDING_OPERATOR', 'VENDOR_ONBOARDING_REVIEWER',
   'ONBOARDING_MAKER_CHECKER');

CREATE TABLE marketplace.vendor_onboarding_cases (
  onboarding_case_id uuid PRIMARY KEY,
  entry_kind text NOT NULL,
  lifecycle_state text NOT NULL,
  applicant_user_id uuid,
  created_by_user_id uuid,
  invitation_reference text,
  business_profile_reference text,
  payout_profile_reference text,
  proposed_business_name text,
  proposed_location_name text,
  proposed_profile_description text,
  proposed_operating_timezone text,
  proposed_coordinates geography(Point, 4326),
  proposed_category text,
  proposed_minimum_order_minor bigint,
  proposed_currency text,
  proposed_preparation_seconds integer,
  vendor_id uuid,
  vendor_location_id uuid,
  current_reason_code text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  data_classification text NOT NULL DEFAULT 'CONFIDENTIAL',
  retention_class text NOT NULL DEFAULT 'ONBOARDING_EVIDENCE',
  retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '730 days'),
  submitted_at timestamptz,
  review_started_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT onboarding_applicant_fk FOREIGN KEY (applicant_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT onboarding_creator_fk FOREIGN KEY (created_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT onboarding_vendor_fk FOREIGN KEY (vendor_id)
    REFERENCES marketplace.vendors (vendor_id) ON DELETE RESTRICT,
  CONSTRAINT onboarding_location_fk FOREIGN KEY (vendor_location_id)
    REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  CONSTRAINT onboarding_entry_kind_allowed CHECK
    (entry_kind IN ('LEAD', 'INVITATION', 'APPLICATION')),
  CONSTRAINT onboarding_state_allowed CHECK
    (lifecycle_state IN ('LEAD', 'INVITED', 'PENDING', 'UNDER_REVIEW', 'APPROVED',
                         'REJECTED', 'EXPIRING', 'GRACE', 'REVERIFICATION')),
  CONSTRAINT onboarding_applicant_shape CHECK
    ((entry_kind = 'APPLICATION' AND applicant_user_id IS NOT NULL)
     OR entry_kind <> 'APPLICATION'),
  CONSTRAINT onboarding_invitation_shape CHECK
    ((entry_kind = 'INVITATION' AND invitation_reference IS NOT NULL)
     OR entry_kind <> 'INVITATION'),
  CONSTRAINT onboarding_invitation_reference_shape CHECK
    (invitation_reference IS NULL OR invitation_reference ~ '^SYNTH-INV-[A-Z0-9-]{6,64}$'),
  CONSTRAINT onboarding_business_reference_shape CHECK
    (business_profile_reference IS NULL
     OR business_profile_reference ~ '^SYNTH-BIZ-[A-Z0-9-]{6,64}$'),
  CONSTRAINT onboarding_payout_reference_shape CHECK
    (payout_profile_reference IS NULL
     OR payout_profile_reference ~ '^SYNTH-PAYOUT-[A-Z0-9-]{6,64}$'),
  CONSTRAINT onboarding_business_name_shape CHECK
    (proposed_business_name IS NULL
     OR proposed_business_name ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().-]{1,118}$'),
  CONSTRAINT onboarding_location_name_shape CHECK
    (proposed_location_name IS NULL
     OR proposed_location_name ~ '^SYNTH [A-Za-z0-9][A-Za-z0-9 &''().-]{1,118}$'),
  CONSTRAINT onboarding_description_shape CHECK
    (proposed_profile_description IS NULL
     OR length(proposed_profile_description) BETWEEN 1 AND 500),
  CONSTRAINT onboarding_category_allowed CHECK
    (proposed_category IS NULL OR proposed_category = 'FRUIT_VEGETABLE'),
  CONSTRAINT onboarding_money_shape CHECK
    ((proposed_minimum_order_minor IS NULL AND proposed_currency IS NULL)
     OR (proposed_minimum_order_minor BETWEEN 0 AND 10000000
         AND proposed_currency = 'INR')),
  CONSTRAINT onboarding_preparation_shape CHECK
    (proposed_preparation_seconds IS NULL
     OR proposed_preparation_seconds BETWEEN 300 AND 14400),
  CONSTRAINT onboarding_approved_shape CHECK
    ((lifecycle_state = 'APPROVED' AND vendor_id IS NOT NULL
      AND vendor_location_id IS NOT NULL AND approved_at IS NOT NULL)
     OR lifecycle_state <> 'APPROVED'),
  CONSTRAINT onboarding_vendor_pair_shape CHECK
    ((vendor_id IS NULL AND vendor_location_id IS NULL)
     OR (vendor_id IS NOT NULL AND vendor_location_id IS NOT NULL)),
  CONSTRAINT onboarding_reason_shape CHECK
    (current_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT onboarding_version_positive CHECK (version >= 1),
  CONSTRAINT onboarding_classification CHECK (data_classification = 'CONFIDENTIAL'),
  CONSTRAINT onboarding_retention CHECK (retention_class = 'ONBOARDING_EVIDENCE'),
  CONSTRAINT onboarding_invitation_unique UNIQUE (invitation_reference),
  CONSTRAINT onboarding_vendor_unique UNIQUE (vendor_id),
  CONSTRAINT onboarding_location_unique UNIQUE (vendor_location_id)
);

CREATE INDEX vendor_onboarding_pipeline
  ON marketplace.vendor_onboarding_cases
    (lifecycle_state, updated_at, onboarding_case_id);
CREATE INDEX vendor_onboarding_applicant
  ON marketplace.vendor_onboarding_cases
    (applicant_user_id, updated_at, onboarding_case_id);
CREATE INDEX vendor_onboarding_coordinates
  ON marketplace.vendor_onboarding_cases USING gist (proposed_coordinates);

CREATE TABLE marketplace.vendor_verification_documents (
  verification_document_id uuid PRIMARY KEY,
  onboarding_case_id uuid NOT NULL,
  document_kind text NOT NULL,
  document_version integer NOT NULL,
  lifecycle_state text NOT NULL,
  object_key text NOT NULL,
  content_sha256 text NOT NULL,
  content_length integer NOT NULL,
  media_type text NOT NULL,
  scan_state text NOT NULL,
  expires_on date,
  grace_until date,
  affected_capability text NOT NULL,
  replaces_document_id uuid,
  uploaded_by_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  data_classification text NOT NULL DEFAULT 'CONFIDENTIAL',
  retention_class text NOT NULL DEFAULT 'VERIFICATION_DOCUMENT',
  retention_review_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '730 days'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT vendor_document_case_fk FOREIGN KEY (onboarding_case_id)
    REFERENCES marketplace.vendor_onboarding_cases (onboarding_case_id) ON DELETE RESTRICT,
  CONSTRAINT vendor_document_replacement_fk FOREIGN KEY (replaces_document_id)
    REFERENCES marketplace.vendor_verification_documents (verification_document_id)
    ON DELETE RESTRICT,
  CONSTRAINT vendor_document_uploader_fk FOREIGN KEY (uploaded_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT vendor_document_kind_allowed CHECK
    (document_kind IN ('BUSINESS_REGISTRATION', 'FOOD_SAFETY_DECLARATION',
                       'PAYOUT_ACCOUNT_PROOF')),
  CONSTRAINT vendor_document_state_allowed CHECK
    (lifecycle_state IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED',
                         'EXPIRING', 'GRACE', 'REVERIFICATION', 'SUPERSEDED')),
  CONSTRAINT vendor_document_object_key_shape CHECK
    (object_key ~ '^vendor-onboarding/[0-9a-f-]{36}/[0-9a-f-]{36}/object$'),
  CONSTRAINT vendor_document_checksum_shape CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT vendor_document_content_length CHECK (content_length BETWEEN 1 AND 5242880),
  CONSTRAINT vendor_document_media_type_allowed CHECK
    (media_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  CONSTRAINT vendor_document_scan_state CHECK (scan_state = 'CLEAN'),
  CONSTRAINT vendor_document_expiry_shape CHECK
    (grace_until IS NULL OR (expires_on IS NOT NULL AND grace_until >= expires_on)),
  CONSTRAINT vendor_document_capability_allowed CHECK
    (affected_capability IN ('VENDOR_PUBLICATION', 'VENDOR_PAYOUT')),
  CONSTRAINT vendor_document_version_positive CHECK (document_version >= 1),
  CONSTRAINT vendor_document_classification CHECK (data_classification = 'CONFIDENTIAL'),
  CONSTRAINT vendor_document_retention CHECK (retention_class = 'VERIFICATION_DOCUMENT'),
  CONSTRAINT vendor_document_object_unique UNIQUE (object_key),
  CONSTRAINT vendor_document_version_unique
    UNIQUE (onboarding_case_id, document_kind, document_version)
);

CREATE INDEX vendor_documents_case_state
  ON marketplace.vendor_verification_documents
    (onboarding_case_id, lifecycle_state, document_kind, document_version);
CREATE INDEX vendor_documents_expiry
  ON marketplace.vendor_verification_documents
    (expires_on, lifecycle_state, onboarding_case_id)
  WHERE expires_on IS NOT NULL AND lifecycle_state IN ('APPROVED', 'EXPIRING', 'GRACE');

CREATE TABLE marketplace.vendor_document_reviews (
  document_review_id uuid PRIMARY KEY,
  verification_document_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL,
  previous_state text NOT NULL,
  resulting_state text NOT NULL,
  decision text NOT NULL,
  reason_code text NOT NULL,
  reviewer_note text NOT NULL,
  evidence_reference text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT vendor_document_review_document_fk FOREIGN KEY (verification_document_id)
    REFERENCES marketplace.vendor_verification_documents (verification_document_id)
    ON DELETE RESTRICT,
  CONSTRAINT vendor_document_review_reviewer_fk FOREIGN KEY (reviewer_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT vendor_document_review_state_allowed CHECK
    (previous_state IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED',
                        'EXPIRING', 'GRACE', 'REVERIFICATION', 'SUPERSEDED')
     AND resulting_state IN ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED',
                             'EXPIRING', 'GRACE', 'REVERIFICATION', 'SUPERSEDED')),
  CONSTRAINT vendor_document_review_decision_allowed CHECK
    (decision IN ('REVIEW_STARTED', 'APPROVED', 'REJECTED', 'EXPIRING_MARKED',
                  'GRACE_GRANTED', 'REVERIFICATION_REQUIRED')),
  CONSTRAINT vendor_document_review_reason_shape CHECK
    (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT vendor_document_review_note_shape CHECK
    (length(reviewer_note) BETWEEN 3 AND 1000),
  CONSTRAINT vendor_document_review_evidence_shape CHECK
    (evidence_reference ~ '^SYNTH-EVIDENCE-[A-Z0-9-]{6,64}$')
);

CREATE INDEX vendor_document_review_history
  ON marketplace.vendor_document_reviews
    (verification_document_id, occurred_at, document_review_id);

CREATE TABLE marketplace.vendor_onboarding_appeals (
  onboarding_appeal_id uuid PRIMARY KEY,
  onboarding_case_id uuid NOT NULL,
  verification_document_id uuid,
  submitted_by_user_id uuid NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'SUBMITTED',
  reason_code text NOT NULL,
  appeal_note text NOT NULL,
  evidence_reference text,
  reviewer_user_id uuid,
  review_reason_code text,
  reviewer_note text,
  reviewed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT onboarding_appeal_case_fk FOREIGN KEY (onboarding_case_id)
    REFERENCES marketplace.vendor_onboarding_cases (onboarding_case_id) ON DELETE RESTRICT,
  CONSTRAINT onboarding_appeal_document_fk FOREIGN KEY (verification_document_id)
    REFERENCES marketplace.vendor_verification_documents (verification_document_id)
    ON DELETE RESTRICT,
  CONSTRAINT onboarding_appeal_submitter_fk FOREIGN KEY (submitted_by_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT onboarding_appeal_reviewer_fk FOREIGN KEY (reviewer_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT onboarding_appeal_state_allowed CHECK
    (lifecycle_state IN ('SUBMITTED', 'UPHELD', 'OVERTURNED')),
  CONSTRAINT onboarding_appeal_reason_shape CHECK
    (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
     AND (review_reason_code IS NULL OR review_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')),
  CONSTRAINT onboarding_appeal_note_shape CHECK
    (length(appeal_note) BETWEEN 3 AND 1000
     AND (reviewer_note IS NULL OR length(reviewer_note) BETWEEN 3 AND 1000)),
  CONSTRAINT onboarding_appeal_evidence_shape CHECK
    (evidence_reference IS NULL
     OR evidence_reference ~ '^SYNTH-EVIDENCE-[A-Z0-9-]{6,64}$'),
  CONSTRAINT onboarding_appeal_review_shape CHECK
    ((lifecycle_state = 'SUBMITTED' AND reviewer_user_id IS NULL
      AND review_reason_code IS NULL AND reviewer_note IS NULL AND reviewed_at IS NULL)
     OR (lifecycle_state IN ('UPHELD', 'OVERTURNED') AND reviewer_user_id IS NOT NULL
         AND review_reason_code IS NOT NULL AND reviewer_note IS NOT NULL
         AND reviewed_at IS NOT NULL)),
  CONSTRAINT onboarding_appeal_version_positive CHECK (version >= 1)
);

CREATE INDEX onboarding_appeals_case_state
  ON marketplace.vendor_onboarding_appeals
    (onboarding_case_id, lifecycle_state, created_at, onboarding_appeal_id);

CREATE TABLE marketplace.vendor_onboarding_events (
  onboarding_event_id uuid PRIMARY KEY,
  onboarding_case_id uuid NOT NULL,
  case_version integer NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid,
  reason_code text NOT NULL,
  note text,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT onboarding_event_case_fk FOREIGN KEY (onboarding_case_id)
    REFERENCES marketplace.vendor_onboarding_cases (onboarding_case_id) ON DELETE RESTRICT,
  CONSTRAINT onboarding_event_actor_fk FOREIGN KEY (actor_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT onboarding_event_version_positive CHECK (case_version >= 1),
  CONSTRAINT onboarding_event_type_allowed CHECK
    (event_type IN ('LEAD_CREATED', 'INVITATION_CREATED', 'APPLICATION_CREATED',
                    'APPLICATION_SUBMITTED', 'DOCUMENT_UPLOADED', 'REVIEW_STARTED',
                    'DOCUMENT_REVIEWED',
                    'APPROVED', 'REJECTED', 'EXPIRING', 'GRACE_GRANTED',
                    'REVERIFICATION_REQUIRED', 'APPEAL_SUBMITTED', 'APPEAL_REVIEWED')),
  CONSTRAINT onboarding_event_reason_shape CHECK
    (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT onboarding_event_note_shape CHECK (note IS NULL OR length(note) BETWEEN 3 AND 1000),
  CONSTRAINT onboarding_event_version_unique UNIQUE (onboarding_case_id, case_version)
);

CREATE INDEX vendor_onboarding_event_history
  ON marketplace.vendor_onboarding_events
    (onboarding_case_id, case_version, occurred_at);

CREATE FUNCTION marketplace.protect_vendor_onboarding_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'vendor onboarding evidence is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER vendor_document_reviews_append_only
BEFORE UPDATE OR DELETE ON marketplace.vendor_document_reviews
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_vendor_onboarding_history();
CREATE TRIGGER vendor_onboarding_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.vendor_onboarding_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_vendor_onboarding_history();
