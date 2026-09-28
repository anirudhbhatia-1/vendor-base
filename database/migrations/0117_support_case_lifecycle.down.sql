-- The steps this migration added cannot be represented before it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.support_case_events
              WHERE event_type IN ('RESPONSE_REQUESTED', 'DUPLICATE_REPORTED', 'MERGE_RECEIVED'))
     OR EXISTS (SELECT 1 FROM marketplace.support_case_messages WHERE message_kind <> 'MESSAGE') THEN
    RAISE EXCEPTION 'support case lifecycle history exists; 0117 cannot be rolled back'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DELETE FROM marketplace.locale_translations WHERE locale_key IN
  ('customer.notification.support_replied', 'customer.notification.support_response_requested',
   'customer.notification.support_resolved', 'customer.support.added_to_case');
DELETE FROM marketplace.locale_keys WHERE locale_key IN
  ('customer.notification.support_replied', 'customer.notification.support_response_requested',
   'customer.notification.support_resolved', 'customer.support.added_to_case');
DELETE FROM marketplace.role_capabilities WHERE (role_key, capability_key) IN
  (('INCIDENT_COMMANDER', 'admin.support.case_manage'),
   ('INCIDENT_COMMANDER', 'admin.support.quality_review'),
   ('SUPPORT_AGENT', 'admin.support.quality_review'));
DELETE FROM marketplace.capabilities WHERE capability_key = 'admin.support.quality_review';

ALTER TABLE marketplace.support_case_messages
  DROP CONSTRAINT support_case_message_kind_audience,
  DROP CONSTRAINT support_case_message_kind,
  DROP COLUMN message_kind;
ALTER TABLE marketplace.support_case_events DROP CONSTRAINT support_case_events_event_type_check;
ALTER TABLE marketplace.support_case_events ADD CONSTRAINT support_case_events_event_type_check
  CHECK (event_type IN ('OPENED', 'ASSIGNED', 'NOTE_ADDED', 'MESSAGE_SENT', 'EVIDENCE_ATTACHED',
    'RESOLVED', 'REOPENED', 'MERGED', 'ESCALATED', 'QUALITY_REVIEWED'));

DROP INDEX marketplace.support_cases_participant;
DROP INDEX marketplace.support_cases_one_open_per_subject;
ALTER TABLE marketplace.support_cases
  DROP CONSTRAINT support_case_quality_shape,
  DROP CONSTRAINT support_case_quality_outcome,
  DROP CONSTRAINT support_case_refund_resolution,
  DROP CONSTRAINT support_case_resolution_shape,
  DROP CONSTRAINT support_case_resolution_code,
  DROP CONSTRAINT support_case_merge_shape,
  DROP CONSTRAINT support_case_open_deadline,
  DROP CONSTRAINT support_case_awaiting_shape,
  DROP CONSTRAINT support_case_awaiting,
  DROP CONSTRAINT support_case_reopen_count,
  DROP CONSTRAINT support_case_version,
  DROP COLUMN quality_reviewed_at,
  DROP COLUMN quality_reviewed_by_user_id,
  DROP COLUMN quality_review_outcome,
  DROP COLUMN reopen_count,
  DROP COLUMN resolved_by_user_id,
  DROP COLUMN resolved_at,
  DROP COLUMN resolution_refund_id,
  DROP COLUMN resolution_code,
  DROP COLUMN first_responded_at,
  DROP COLUMN response_clock_started_at,
  DROP COLUMN awaiting,
  DROP COLUMN version,
  DROP COLUMN delivery_assignment_id,
  DROP COLUMN customer_user_id;
