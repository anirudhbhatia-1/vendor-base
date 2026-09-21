-- Phase 9.1: documents that expire, and the standing they decide.
--
-- The application recorded a reference for each document and nothing else:
-- no expiry, no renewal, so nothing could expire and nothing was ever
-- reverified -- while the partner's profile carried copy for "a document
-- has expired" that nothing emitted. The identity document, the vehicle
-- registration and the insurance now carry their expiries; a renewal is
-- submitted by the partner and reviewed like the application was.
ALTER TABLE marketplace.partner_applications
  ADD COLUMN identity_expires_at timestamptz,
  ADD COLUMN vehicle_expires_at timestamptz,
  ADD COLUMN insurance_expires_at timestamptz;

-- The application's history records what happened to its documents too.
ALTER TABLE marketplace.partner_application_events
  DROP CONSTRAINT partner_application_event_type_allowed,
  ADD CONSTRAINT partner_application_event_type_allowed CHECK (event_type IN
    ('CREATED','SUBMITTED','REVIEW_STARTED','CHANGES_REQUESTED','APPROVED','REJECTED','APPEAL_OPENED',
     'DOCUMENT_EXPIRED','DOCUMENT_RENEWAL_SUBMITTED','DOCUMENT_RENEWED','DOCUMENT_RENEWAL_REJECTED'));

CREATE TABLE marketplace.partner_document_renewals (
  partner_document_renewal_id uuid PRIMARY KEY,
  partner_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  document_kind text NOT NULL CHECK (document_kind IN ('IDENTITY', 'VEHICLE', 'INSURANCE')),
  document_reference text NOT NULL CHECK (document_reference ~ '^[A-Z0-9][A-Z0-9._:/-]{3,127}$'),
  expires_at timestamptz NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (lifecycle_state IN ('SUBMITTED', 'APPROVED', 'REJECTED')),
  reviewer_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  reason_code text CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  note text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at timestamptz,
  CONSTRAINT partner_document_renewal_decision_shape
    CHECK ((lifecycle_state = 'SUBMITTED') = (decided_at IS NULL AND reviewer_user_id IS NULL))
);
-- One renewal in review per document at a time.
CREATE UNIQUE INDEX partner_document_renewal_open
  ON marketplace.partner_document_renewals (partner_user_id, document_kind)
  WHERE lifecycle_state = 'SUBMITTED';
CREATE INDEX partner_document_renewals_queue
  ON marketplace.partner_document_renewals (lifecycle_state, created_at);

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('partner.not_eligible', 'error', 'PARTNER',
    'Stable error PARTNER_NOT_ELIGIBLE: the partner cannot go online; the profile lists the blockers');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('partner.not_eligible', 'en',
    'You cannot go online yet. Open your profile to see what is stopping you and what to do.'),
  -- Hindi copy carried forward for native-speaker review with 0073.
  ('partner.not_eligible', 'hi',
    'आप अभी ऑनलाइन नहीं जा सकते। क्या रोक रहा है और क्या करना है, यह देखने के लिए अपनी प्रोफ़ाइल खोलें।');
