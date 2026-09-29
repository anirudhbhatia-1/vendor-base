-- Approvals, rejections, repeated engagements and their history cannot be
-- represented before this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.incident_control_events)
     OR EXISTS (SELECT 1 FROM marketplace.incident_controls
                 WHERE lifecycle_state IN ('PENDING_APPROVAL', 'REJECTED')
                    OR scope_kind IN ('CATEGORY', 'PAYMENT_METHOD', 'PAYOUT_BENEFICIARY'))
     OR EXISTS (SELECT 1 FROM marketplace.incident_controls
                 GROUP BY control_key, scope_kind, scope_reference HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM marketplace.checkout_quote_blocked_groups
                 WHERE reason_code = 'INCIDENT_PAUSED') THEN
    RAISE EXCEPTION 'incident control history exists; 0121 cannot be rolled back'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DELETE FROM marketplace.locale_translations WHERE locale_key IN
  ('customer.checkout.blocked.incident_paused', 'checkout.grouped_checkout_paused',
   'checkout.payment_paused');
DELETE FROM marketplace.locale_keys WHERE locale_key IN
  ('customer.checkout.blocked.incident_paused', 'checkout.grouped_checkout_paused',
   'checkout.payment_paused');

ALTER TABLE marketplace.checkout_quote_blocked_groups
  DROP CONSTRAINT checkout_quote_blocked_groups_reason_code_check,
  ADD CONSTRAINT checkout_quote_blocked_groups_reason_code_check CHECK
    (reason_code IN ('CUSTOMER_RESTRICTED', 'STORE_UNAVAILABLE', 'FULFILMENT_METHOD_UNAVAILABLE',
                     'LINE_UNAVAILABLE', 'MINIMUM_NOT_MET', 'INVENTORY_UNAVAILABLE'));

DROP FUNCTION marketplace.incident_pauses(text, uuid, text, text, timestamptz);
DROP TABLE marketplace.incident_control_events;
DROP INDEX marketplace.incident_control_one_live;

ALTER TABLE marketplace.incident_controls
  DROP CONSTRAINT incident_control_state_allowed,
  DROP CONSTRAINT incident_control_scope_kind_allowed,
  DROP CONSTRAINT incident_control_scope_fits,
  DROP CONSTRAINT incident_control_lifecycle_shape,
  DROP CONSTRAINT incident_control_approval_shape,
  DROP CONSTRAINT incident_control_closing_reason,
  DROP CONSTRAINT incident_control_banner_shape,
  DROP CONSTRAINT incident_control_checklist_shape,
  DROP CONSTRAINT incident_control_version_positive,
  DROP COLUMN proposed_by,
  DROP COLUMN approval_required,
  DROP COLUMN approved_by,
  DROP COLUMN approved_at,
  DROP COLUMN activated_at,
  DROP COLUMN closed_by,
  DROP COLUMN closed_at,
  DROP COLUMN closing_reason_code,
  DROP COLUMN banner,
  DROP COLUMN impact,
  DROP COLUMN recovery_checklist,
  DROP COLUMN version,
  ADD CONSTRAINT incident_controls_lifecycle_state_check CHECK
    (lifecycle_state IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
  ADD CONSTRAINT incident_controls_control_key_scope_kind_scope_reference_key
    UNIQUE (control_key, scope_kind, scope_reference);
