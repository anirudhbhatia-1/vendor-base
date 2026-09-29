-- 11.7: an incident control pauses one named flow in a scope it can act on,
-- is approved by a second person where it is broad or touches money, keeps
-- every engagement as its own record with its history, carries the banner
-- people see and the checklist that must be worked before it is lifted.
--
-- Until audit run 79 a control was one row per key and scope, re-engaged by
-- overwriting the last one (its owner, reason and times gone); any scope was
-- accepted, including ones no code could act on; only dispatch read three of
-- the ten keys, so the other seven paused nothing; and engaging one was not
-- audited.

-- Live controls whose scope their pause cannot act on are closed rather than
-- left looking engaged. Promotions do not exist, so a promotion pause is one.
UPDATE marketplace.incident_controls
   SET lifecycle_state = 'EXPIRED', updated_at = clock_timestamp()
 WHERE lifecycle_state = 'ACTIVE'
   AND NOT (
     (control_key = 'VENDOR_PAUSE' AND scope_kind = 'VENDOR_LOCATION')
     OR (control_key = 'CATEGORY_PAUSE' AND scope_kind = 'CATEGORY')
     OR (control_key = 'ZONE_PAUSE' AND scope_kind = 'ZONE')
     OR (control_key IN ('DELIVERY_PAUSE', 'PARTNER_ASSIGNMENT_PAUSE', 'SUBSTITUTION_PAUSE')
         AND scope_kind IN ('GLOBAL', 'ZONE', 'VENDOR_LOCATION'))
     OR (control_key = 'PAYMENT_PAUSE' AND scope_kind IN ('GLOBAL', 'PAYMENT_METHOD'))
     OR (control_key = 'GROUPED_CHECKOUT_PAUSE' AND scope_kind = 'GLOBAL')
     OR (control_key = 'PAYOUT_PAUSE' AND scope_kind IN ('GLOBAL', 'PAYOUT_BENEFICIARY')));

ALTER TABLE marketplace.incident_controls
  DROP CONSTRAINT incident_controls_control_key_scope_kind_scope_reference_key,
  DROP CONSTRAINT incident_controls_lifecycle_state_check,
  -- Actor ids like the rest of the register: no foreign key, so a control is
  -- never swept up by a cascade from the people tables.
  ADD COLUMN proposed_by uuid,
  ADD COLUMN approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN closed_by uuid,
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closing_reason_code text,
  ADD COLUMN banner text,
  ADD COLUMN impact jsonb,
  ADD COLUMN recovery_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN version integer NOT NULL DEFAULT 1;

-- What earlier engagements already were.
UPDATE marketplace.incident_controls
   SET proposed_by = owner_user_id,
       activated_at = created_at,
       closed_at = CASE WHEN lifecycle_state IN ('REVOKED', 'EXPIRED') THEN updated_at END,
       closed_by = CASE WHEN lifecycle_state = 'REVOKED' THEN owner_user_id END,
       closing_reason_code = CASE WHEN lifecycle_state = 'REVOKED' THEN 'RECORDED_BEFORE_0121' END;

ALTER TABLE marketplace.incident_controls
  ALTER COLUMN proposed_by SET NOT NULL,
  ADD CONSTRAINT incident_control_state_allowed CHECK
    (lifecycle_state IN ('PENDING_APPROVAL', 'ACTIVE', 'REVOKED', 'EXPIRED', 'REJECTED')),
  ADD CONSTRAINT incident_control_scope_kind_allowed CHECK (scope_kind IN
    ('GLOBAL', 'ZONE', 'VENDOR_LOCATION', 'CATEGORY', 'PAYMENT_METHOD', 'PAYOUT_BENEFICIARY')),
  -- Each pause in the scopes the code that honours it can see. Closed
  -- controls from before 0121 keep whatever they recorded.
  ADD CONSTRAINT incident_control_scope_fits CHECK (
    lifecycle_state NOT IN ('PENDING_APPROVAL', 'ACTIVE')
    OR (control_key = 'VENDOR_PAUSE' AND scope_kind = 'VENDOR_LOCATION')
    OR (control_key = 'CATEGORY_PAUSE' AND scope_kind = 'CATEGORY')
    OR (control_key = 'ZONE_PAUSE' AND scope_kind = 'ZONE')
    OR (control_key IN ('DELIVERY_PAUSE', 'PARTNER_ASSIGNMENT_PAUSE', 'SUBSTITUTION_PAUSE')
        AND scope_kind IN ('GLOBAL', 'ZONE', 'VENDOR_LOCATION'))
    OR (control_key = 'PAYMENT_PAUSE' AND scope_kind IN ('GLOBAL', 'PAYMENT_METHOD')
        AND (scope_kind <> 'PAYMENT_METHOD' OR scope_reference IN ('UPI', 'CARD', 'WALLET')))
    OR (control_key = 'GROUPED_CHECKOUT_PAUSE' AND scope_kind = 'GLOBAL')
    OR (control_key = 'PAYOUT_PAUSE' AND scope_kind IN ('GLOBAL', 'PAYOUT_BENEFICIARY')
        AND (scope_kind <> 'PAYOUT_BENEFICIARY' OR scope_reference IN ('PARTNER', 'VENDOR')))),
  ADD CONSTRAINT incident_control_lifecycle_shape CHECK (
    (lifecycle_state = 'PENDING_APPROVAL'
      AND approval_required AND approved_by IS NULL AND activated_at IS NULL AND closed_at IS NULL)
    OR (lifecycle_state = 'ACTIVE' AND activated_at IS NOT NULL AND closed_at IS NULL)
    OR (lifecycle_state IN ('REVOKED', 'REJECTED')
      AND closed_by IS NOT NULL AND closed_at IS NOT NULL AND closing_reason_code IS NOT NULL)
    OR (lifecycle_state = 'EXPIRED' AND closed_at IS NOT NULL)),
  -- Approved by a second person, before it took force.
  ADD CONSTRAINT incident_control_approval_shape CHECK (
    (approved_by IS NULL) = (approved_at IS NULL)
    AND (approved_by IS NULL OR approved_by <> proposed_by)
    AND (NOT approval_required OR lifecycle_state IN ('PENDING_APPROVAL', 'REJECTED', 'EXPIRED')
         OR approved_by IS NOT NULL)),
  ADD CONSTRAINT incident_control_closing_reason CHECK
    (closing_reason_code IS NULL OR closing_reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  ADD CONSTRAINT incident_control_banner_shape CHECK
    (banner IS NULL OR char_length(banner) BETWEEN 8 AND 200),
  ADD CONSTRAINT incident_control_checklist_shape CHECK
    (jsonb_typeof(recovery_checklist) = 'array'),
  ADD CONSTRAINT incident_control_version_positive CHECK (version > 0);

-- One live control per pause and scope; a new engagement is a new record.
CREATE UNIQUE INDEX incident_control_one_live
  ON marketplace.incident_controls (control_key, scope_kind, scope_reference)
  WHERE lifecycle_state IN ('PENDING_APPROVAL', 'ACTIVE');

CREATE TABLE marketplace.incident_control_events (
  incident_control_event_id uuid PRIMARY KEY,
  incident_control_id uuid NOT NULL
    REFERENCES marketplace.incident_controls (incident_control_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  from_state text,
  to_state text NOT NULL,
  -- No operator when the expiry sweep closes a control.
  actor_id uuid,
  reason_code text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT incident_control_event_type_allowed CHECK (event_type IN
    ('PROPOSED', 'APPROVED', 'REJECTED', 'ACTIVATED', 'REVIEWED', 'CHECKLIST_ITEM_DONE',
     'REVOKED', 'EXPIRED')),
  CONSTRAINT incident_control_event_reason CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);
CREATE INDEX incident_control_events_control
  ON marketplace.incident_control_events (incident_control_id, occurred_at);
CREATE TRIGGER incident_control_events_append_only
  BEFORE UPDATE OR DELETE ON marketplace.incident_control_events
  FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();

-- Whether a pause in force at an instant reaches a store, a category at it,
-- or a named method or beneficiary. Every consumer asks this one question.
CREATE FUNCTION marketplace.incident_pauses(
  p_control_key text,
  p_vendor_location_id uuid,
  p_category text,
  p_reference text,
  p_at timestamptz
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM marketplace.incident_controls c
     WHERE c.control_key = p_control_key
       AND c.lifecycle_state = 'ACTIVE'
       AND c.activated_at <= p_at
       AND c.expires_at > p_at
       AND (c.scope_kind = 'GLOBAL'
            OR (c.scope_kind = 'VENDOR_LOCATION' AND c.scope_reference = p_vendor_location_id::text)
            OR (c.scope_kind = 'CATEGORY' AND c.scope_reference = p_category)
            OR (c.scope_kind IN ('PAYMENT_METHOD', 'PAYOUT_BENEFICIARY')
                AND c.scope_reference = p_reference)
            OR (c.scope_kind = 'ZONE' AND EXISTS (
                  SELECT 1 FROM marketplace.vendor_service_zones z
                   WHERE z.vendor_location_id = p_vendor_location_id
                     AND z.lifecycle_state = 'ACTIVE'
                     AND (z.service_zone_id::text = c.scope_reference
                          OR z.zone_name = c.scope_reference)))))
$$;

-- A quote records a group a pause stopped.
ALTER TABLE marketplace.checkout_quote_blocked_groups
  DROP CONSTRAINT checkout_quote_blocked_groups_reason_code_check,
  ADD CONSTRAINT checkout_quote_blocked_groups_reason_code_check CHECK
    (reason_code IN ('CUSTOMER_RESTRICTED', 'INCIDENT_PAUSED', 'STORE_UNAVAILABLE',
                     'FULFILMENT_METHOD_UNAVAILABLE', 'LINE_UNAVAILABLE', 'MINIMUM_NOT_MET',
                     'INVENTORY_UNAVAILABLE'));

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.checkout.blocked.incident_paused', 'customer', 'CUSTOMER',
    'Checkout: new orders from this store are paused for now by operations'),
  ('checkout.grouped_checkout_paused', 'error', 'CUSTOMER',
    'Stable error GROUPED_CHECKOUT_PAUSED: ordering from more than one store at once is paused'),
  ('checkout.payment_paused', 'error', 'CUSTOMER',
    'Stable error PAYMENT_PAUSED: this way of paying is paused for now')
ON CONFLICT (locale_key) DO NOTHING;

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.checkout.blocked.incident_paused', 'en',
    'New orders from this store are paused for now. Orders already placed are not affected.'),
  ('customer.checkout.blocked.incident_paused', 'hi',
    'इस दुकान से नए ऑर्डर अभी रुके हुए हैं। पहले से दिए गए ऑर्डर पर इसका असर नहीं है।'),
  ('checkout.grouped_checkout_paused', 'en',
    'Ordering from more than one store at once is paused for now. Check out one store at a time.'),
  ('checkout.grouped_checkout_paused', 'hi',
    'एक साथ कई दुकानों से ऑर्डर अभी रुका हुआ है। एक बार में एक दुकान से ऑर्डर करें।'),
  ('checkout.payment_paused', 'en',
    'This way of paying is paused for now. Choose another, or try again later.'),
  ('checkout.payment_paused', 'hi',
    'भुगतान का यह तरीका अभी रुका हुआ है। कोई दूसरा तरीका चुनें या बाद में कोशिश करें।')
ON CONFLICT (locale_key, language_code) DO NOTHING;
