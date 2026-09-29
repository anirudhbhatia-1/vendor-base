-- 11.4: signals feed a review, a restriction rests on real evidence about a
-- real subject, restricts only new work, and carries its review and appeal.
--
-- Until audit run 76 nothing collected a signal; a restriction named its
-- subject by a free SYNTH reference, so the partner restrictions dispatch
-- enforced (by user id) could not be proposed through the API at all; a
-- customer, shop or category restriction was stored and enforced nowhere;
-- the review date was never acted on; and there was no appeal.

-- Signals: facts already in the marketplace, read about one subject. A
-- signal restricts nothing; it is evidence for a person to weigh.
CREATE TABLE marketplace.trust_signals (
  trust_signal_id uuid PRIMARY KEY,
  subject_kind text NOT NULL,
  subject_reference text NOT NULL,
  signal_kind text NOT NULL,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  reporter_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  weight smallint NOT NULL,
  observed_at timestamptz NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT trust_signal_subject_kind CHECK
    (subject_kind IN ('CUSTOMER', 'VENDOR_LOCATION', 'PARTNER', 'CATEGORY')),
  CONSTRAINT trust_signal_subject_reference CHECK (length(subject_reference) BETWEEN 1 AND 128),
  CONSTRAINT trust_signal_kind CHECK (signal_kind IN
    ('LOW_DELIVERY_RATING', 'LOW_ORDER_RATING', 'PARTNER_REPORTED_THREAT',
     'PARTNER_REPORTED_PROHIBITED_GOODS', 'PARTNER_REPORTED_VENDOR_DELAY',
     'PARTNER_REPORTED_UNREACHABLE_CUSTOMER', 'PARTNER_CONDUCT_CASE', 'ITEM_COMPLAINT_CASE')),
  CONSTRAINT trust_signal_source_kind CHECK
    (source_kind IN ('DELIVERY_RATING', 'ORDER_RATING', 'PARTNER_EXCEPTION', 'SUPPORT_CASE')),
  CONSTRAINT trust_signal_weight CHECK (weight BETWEEN 1 AND 3),
  CONSTRAINT trust_signal_once UNIQUE (source_kind, source_id, signal_kind)
);
CREATE INDEX trust_signals_subject
  ON marketplace.trust_signals (subject_kind, subject_reference, observed_at DESC);
CREATE TRIGGER trust_signals_append_only BEFORE UPDATE OR DELETE ON marketplace.trust_signals
  FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();

-- A reviewer may set a signal aside as not credible; the signal stays.
CREATE TABLE marketplace.trust_signal_dismissals (
  trust_signal_id uuid PRIMARY KEY
    REFERENCES marketplace.trust_signals (trust_signal_id) ON DELETE RESTRICT,
  dismissed_by_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER trust_signal_dismissals_append_only
  BEFORE UPDATE OR DELETE ON marketplace.trust_signal_dismissals
  FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();

-- A restriction: the signals it rests on, how good that evidence is, who
-- decided and why, and its last review.
ALTER TABLE marketplace.trust_restriction_cases
  ALTER COLUMN evidence_reference DROP NOT NULL,
  ADD COLUMN evidence_quality text,
  ADD COLUMN proposal_note text,
  ADD COLUMN decided_by_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ADD COLUMN decision_reason_code text,
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN last_review_outcome text,
  ADD COLUMN last_reviewed_by_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ADD COLUMN last_reviewed_at timestamptz;
UPDATE marketplace.trust_restriction_cases SET evidence_quality = 'NONE';
UPDATE marketplace.trust_restriction_cases
   SET decided_by_user_id = COALESCE(approved_by_user_id, proposed_by_user_id),
       decision_reason_code = 'NOT_RECORDED', decided_at = updated_at
 WHERE lifecycle_state IN ('ACTIVE', 'REJECTED', 'REVOKED', 'EXPIRED');
ALTER TABLE marketplace.trust_restriction_cases
  ALTER COLUMN evidence_quality SET NOT NULL,
  ALTER COLUMN evidence_quality SET DEFAULT 'NONE',
  ADD CONSTRAINT trust_restriction_evidence_quality CHECK
    (evidence_quality IN ('NONE', 'SINGLE_SIGNAL', 'UNCORROBORATED', 'CORROBORATED', 'STRONG')),
  ADD CONSTRAINT trust_restriction_proposal_note CHECK
    (proposal_note IS NULL OR length(proposal_note) BETWEEN 1 AND 1000),
  ADD CONSTRAINT trust_restriction_decision_shape CHECK
    ((lifecycle_state = 'PROPOSED'
      AND decided_by_user_id IS NULL AND decision_reason_code IS NULL AND decided_at IS NULL)
     OR (lifecycle_state <> 'PROPOSED' AND decided_by_user_id IS NOT NULL
         AND decision_reason_code IS NOT NULL AND decided_at IS NOT NULL)),
  ADD CONSTRAINT trust_restriction_decision_reason CHECK
    (decision_reason_code IS NULL OR decision_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  ADD CONSTRAINT trust_restriction_review_outcome CHECK
    (last_review_outcome IS NULL OR last_review_outcome IN ('KEEP', 'SHORTEN', 'LIFT')),
  ADD CONSTRAINT trust_restriction_review_shape CHECK
    ((last_review_outcome IS NULL AND last_reviewed_by_user_id IS NULL AND last_reviewed_at IS NULL)
     OR (last_review_outcome IS NOT NULL AND last_reviewed_by_user_id IS NOT NULL
         AND last_reviewed_at IS NOT NULL));
CREATE INDEX trust_restriction_in_force ON marketplace.trust_restriction_cases
  (subject_kind, subject_reference) WHERE lifecycle_state = 'ACTIVE';

CREATE TABLE marketplace.trust_restriction_signals (
  trust_restriction_case_id uuid NOT NULL
    REFERENCES marketplace.trust_restriction_cases (trust_restriction_case_id) ON DELETE RESTRICT,
  trust_signal_id uuid NOT NULL
    REFERENCES marketplace.trust_signals (trust_signal_id) ON DELETE RESTRICT,
  PRIMARY KEY (trust_restriction_case_id, trust_signal_id)
);
CREATE TRIGGER trust_restriction_signals_append_only
  BEFORE UPDATE OR DELETE ON marketplace.trust_restriction_signals
  FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();

-- The case history: every step, with the version it moved from.
CREATE TABLE marketplace.trust_case_events (
  trust_case_event_id uuid PRIMARY KEY,
  trust_restriction_case_id uuid NOT NULL
    REFERENCES marketplace.trust_restriction_cases (trust_restriction_case_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  case_version integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT trust_case_event_type CHECK (event_type IN
    ('PROPOSED', 'APPROVED', 'REJECTED', 'REVOKED', 'REVIEWED', 'EXPIRED',
     'APPEAL_FILED', 'APPEAL_UPHELD', 'APPEAL_OVERTURNED')),
  CONSTRAINT trust_case_event_reason CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT trust_case_event_version CHECK (case_version >= 1)
);
CREATE INDEX trust_case_events_case ON marketplace.trust_case_events
  (trust_restriction_case_id, occurred_at);
CREATE TRIGGER trust_case_events_append_only BEFORE UPDATE OR DELETE ON marketplace.trust_case_events
  FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();

-- An appeal, by the person restricted, against the case as it stood.
CREATE TABLE marketplace.trust_appeals (
  trust_appeal_id uuid PRIMARY KEY,
  trust_restriction_case_id uuid NOT NULL
    REFERENCES marketplace.trust_restriction_cases (trust_restriction_case_id) ON DELETE RESTRICT,
  case_version integer NOT NULL CHECK (case_version >= 1),
  appellant_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  statement text NOT NULL CHECK (length(statement) BETWEEN 1 AND 2000),
  lifecycle_state text NOT NULL DEFAULT 'OPEN'
    CHECK (lifecycle_state IN ('OPEN', 'UPHELD', 'OVERTURNED')),
  decided_by_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  decision_reason_code text CHECK
    (decision_reason_code IS NULL OR decision_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  decided_at timestamptz,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT trust_appeal_decision_shape CHECK
    ((lifecycle_state = 'OPEN'
      AND decided_by_user_id IS NULL AND decision_reason_code IS NULL AND decided_at IS NULL)
     OR (lifecycle_state <> 'OPEN' AND decided_by_user_id IS NOT NULL
         AND decision_reason_code IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT trust_appeal_not_self_decided CHECK
    (decided_by_user_id IS NULL OR decided_by_user_id <> appellant_user_id)
);
CREATE UNIQUE INDEX trust_appeals_one_open ON marketplace.trust_appeals (trust_restriction_case_id)
  WHERE lifecycle_state = 'OPEN';

-- One rule for what a restriction in force stops, read wherever new work
-- starts: going online and being offered a delivery, placing an order, and
-- selling a category. Work already under way is never read against it.
CREATE FUNCTION marketplace.trust_restricts(
  p_subject_kind text,
  p_subject_reference text,
  p_vendor_location_id uuid,
  p_category text,
  p_at timestamptz
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM marketplace.trust_restriction_cases r
     WHERE r.subject_kind = p_subject_kind
       AND r.subject_reference = p_subject_reference
       AND r.lifecycle_state = 'ACTIVE'
       AND r.effective_until > p_at
       AND (r.scope_kind = 'GLOBAL'
            OR (r.scope_kind = 'VENDOR_LOCATION' AND r.scope_reference = p_vendor_location_id::text)
            OR (r.scope_kind = 'CATEGORY' AND r.scope_reference = p_category)
            OR (r.scope_kind = 'ZONE' AND EXISTS (
                  SELECT 1 FROM marketplace.vendor_service_zones z
                   WHERE z.vendor_location_id = p_vendor_location_id
                     AND z.lifecycle_state = 'ACTIVE'
                     AND (z.service_zone_id::text = r.scope_reference
                          OR z.zone_name = r.scope_reference)))))
$$;

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.checkout.blocked.customer_restricted', 'customer', 'CUSTOMER',
    'Checkout: the customer account may not place new orders here for now'),
  ('customer.restriction.heading', 'customer', 'CUSTOMER', 'Restrictions on the customer account'),
  ('customer.restriction.appeal', 'customer', 'CUSTOMER', 'Action: appeal a restriction')
ON CONFLICT (locale_key) DO NOTHING;
INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.checkout.blocked.customer_restricted', 'en',
    'Your account cannot place new orders here for now. Your existing orders are not affected.'),
  ('customer.restriction.heading', 'en', 'Restrictions on your account'),
  ('customer.restriction.appeal', 'en', 'Appeal this restriction'),
  ('customer.checkout.blocked.customer_restricted', 'hi',
    'आपका खाता अभी यहाँ से नए ऑर्डर नहीं दे सकता। आपके मौजूदा ऑर्डर पर इसका असर नहीं है।'),
  ('customer.restriction.heading', 'hi', 'आपके खाते पर लगी पाबंदियाँ'),
  ('customer.restriction.appeal', 'hi', 'इस पाबंदी के खिलाफ अपील करें')
ON CONFLICT (locale_key, language_code) DO NOTHING;

-- A quote records a group blocked because its customer is restricted there.
ALTER TABLE marketplace.checkout_quote_blocked_groups
  DROP CONSTRAINT checkout_quote_blocked_groups_reason_code_check,
  ADD CONSTRAINT checkout_quote_blocked_groups_reason_code_check CHECK
    (reason_code IN ('CUSTOMER_RESTRICTED', 'STORE_UNAVAILABLE', 'FULFILMENT_METHOD_UNAVAILABLE',
                     'LINE_UNAVAILABLE', 'MINIMUM_NOT_MET', 'INVENTORY_UNAVAILABLE'));
