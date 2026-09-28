-- 11.3: a support case has a participant, a subject, a version, a deadline
-- that moves with whose turn it is, a recorded resolution and one quality
-- review per resolution.
--
-- Until audit run 75 a case opened by operations or the worker was invisible
-- to the customer it was about (the customer read only cases they opened),
-- so a "participant-visible" message reached nobody. Nothing stopped a
-- customer opening the same case twice, a resolved case being resolved
-- again, a merged case being reopened, or a reviewer grading their own
-- resolution; and there was no way to ask the customer a question.

ALTER TABLE marketplace.support_cases
  ADD COLUMN customer_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ADD COLUMN delivery_assignment_id uuid
    REFERENCES marketplace.delivery_assignments (delivery_assignment_id) ON DELETE RESTRICT,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN awaiting text NOT NULL DEFAULT 'OPERATIONS',
  ADD COLUMN response_clock_started_at timestamptz,
  ADD COLUMN first_responded_at timestamptz,
  ADD COLUMN resolution_code text,
  ADD COLUMN resolution_refund_id uuid REFERENCES marketplace.refunds (refund_id) ON DELETE RESTRICT,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ADD COLUMN reopen_count integer NOT NULL DEFAULT 0,
  ADD COLUMN quality_review_outcome text,
  ADD COLUMN quality_reviewed_by_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ADD COLUMN quality_reviewed_at timestamptz;

-- The participant is the order's customer, whoever opened the case.
UPDATE marketplace.support_cases c
   SET customer_user_id = grouping.customer_user_id
  FROM marketplace.vendor_orders o
  JOIN marketplace.checkout_groups grouping USING (checkout_group_id)
 WHERE o.vendor_order_id = c.vendor_order_id;
ALTER TABLE marketplace.support_cases ALTER COLUMN customer_user_id SET NOT NULL;

-- A merged case is history. Before this migration a merged case could still
-- be resolved or reopened; it is put back where the merge left it.
UPDATE marketplace.support_cases SET lifecycle_state = 'WITHDRAWN'
 WHERE merged_into_case_id IS NOT NULL AND lifecycle_state <> 'WITHDRAWN';

-- Cases already closed wait on nobody; a resolution recorded before this
-- migration carries no code, and says so.
UPDATE marketplace.support_cases SET awaiting = 'NONE'
 WHERE lifecycle_state IN ('RESOLVED', 'WITHDRAWN');
UPDATE marketplace.support_cases c
   SET resolution_code = 'NOT_RECORDED',
       resolved_at = c.updated_at,
       resolved_by_user_id = COALESCE(
         (SELECT e.actor_id FROM marketplace.support_case_events e
           WHERE e.support_case_id = c.support_case_id AND e.event_type = 'RESOLVED'
           ORDER BY e.occurred_at DESC LIMIT 1),
         '01900000-0000-7000-8000-00000000c0de'::uuid)
 WHERE c.lifecycle_state = 'RESOLVED';
UPDATE marketplace.support_cases
   SET response_due_at = COALESCE(response_due_at, created_at + interval '4 hours'),
       response_clock_started_at = LEAST(created_at, COALESCE(response_due_at, created_at))
 WHERE lifecycle_state IN ('OPEN', 'IN_PROGRESS');
UPDATE marketplace.support_cases c
   SET first_responded_at = (
     SELECT min(m.created_at) FROM marketplace.support_case_messages m
      WHERE m.support_case_id = c.support_case_id AND m.audience = 'PARTICIPANT'
        AND m.author_user_id <> c.customer_user_id);

-- One open case per order, category and item. Duplicates opened before this
-- migration are merged into the oldest, on the record, by the platform.
WITH ranked AS (
  SELECT support_case_id,
         first_value(support_case_id) OVER subject AS keeper,
         row_number() OVER subject AS position
    FROM marketplace.support_cases
   WHERE lifecycle_state IN ('OPEN', 'IN_PROGRESS')
  WINDOW subject AS (
    PARTITION BY vendor_order_id, category,
                 COALESCE(vendor_order_line_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY created_at, support_case_id)
), merged AS (
  UPDATE marketplace.support_cases c
     SET lifecycle_state = 'WITHDRAWN', merged_into_case_id = ranked.keeper,
         awaiting = 'NONE', updated_at = clock_timestamp()
    FROM ranked
   WHERE ranked.support_case_id = c.support_case_id AND ranked.position > 1
  RETURNING c.support_case_id, ranked.keeper
)
INSERT INTO marketplace.support_case_events
  (support_case_event_id, support_case_id, event_type, actor_id, reason_code, payload,
   request_id, correlation_id)
SELECT gen_random_uuid(), merged.support_case_id, 'MERGED',
       '01900000-0000-7000-8000-00000000c0de'::uuid, 'DUPLICATE_ON_UPGRADE',
       jsonb_build_object('target_case_id', merged.keeper), gen_random_uuid(), gen_random_uuid()
  FROM merged;

ALTER TABLE marketplace.support_cases
  ADD CONSTRAINT support_case_version CHECK (version >= 1),
  ADD CONSTRAINT support_case_reopen_count CHECK (reopen_count >= 0),
  ADD CONSTRAINT support_case_awaiting CHECK (awaiting IN ('OPERATIONS', 'PARTICIPANT', 'NONE')),
  ADD CONSTRAINT support_case_awaiting_shape CHECK
    ((lifecycle_state IN ('OPEN', 'IN_PROGRESS')) = (awaiting <> 'NONE')),
  ADD CONSTRAINT support_case_open_deadline CHECK
    (lifecycle_state NOT IN ('OPEN', 'IN_PROGRESS')
     OR (response_due_at IS NOT NULL AND response_clock_started_at IS NOT NULL
         AND response_due_at >= response_clock_started_at)),
  ADD CONSTRAINT support_case_merge_shape CHECK
    (merged_into_case_id IS NULL
     OR (lifecycle_state = 'WITHDRAWN' AND merged_into_case_id <> support_case_id)),
  ADD CONSTRAINT support_case_resolution_code CHECK (resolution_code IN
    ('REFUNDED', 'REPLACED', 'EXPLAINED', 'FIXED_BY_STORE', 'FIXED_BY_DELIVERY',
     'NO_FAULT_FOUND', 'CUSTOMER_UNRESPONSIVE', 'NOT_RECORDED')),
  ADD CONSTRAINT support_case_resolution_shape CHECK
    ((lifecycle_state = 'RESOLVED')
     = (resolution_code IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL)),
  ADD CONSTRAINT support_case_refund_resolution CHECK
    ((resolution_code = 'REFUNDED') = (resolution_refund_id IS NOT NULL)),
  ADD CONSTRAINT support_case_quality_outcome CHECK
    (quality_review_outcome IN ('PASS', 'NEEDS_COACHING', 'FAIL')),
  ADD CONSTRAINT support_case_quality_shape CHECK
    (quality_review_outcome IS NULL
     OR (lifecycle_state = 'RESOLVED' AND quality_reviewed_by_user_id IS NOT NULL
         AND quality_reviewed_at IS NOT NULL
         AND quality_reviewed_by_user_id <> resolved_by_user_id));

CREATE UNIQUE INDEX support_cases_one_open_per_subject ON marketplace.support_cases
  (vendor_order_id, category,
   COALESCE(vendor_order_line_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE lifecycle_state IN ('OPEN', 'IN_PROGRESS');
CREATE INDEX support_cases_participant ON marketplace.support_cases (customer_user_id, created_at DESC);

-- The case history names the new steps; a message says what it is.
ALTER TABLE marketplace.support_case_events DROP CONSTRAINT support_case_events_event_type_check;
ALTER TABLE marketplace.support_case_events ADD CONSTRAINT support_case_events_event_type_check
  CHECK (event_type IN ('OPENED', 'ASSIGNED', 'NOTE_ADDED', 'MESSAGE_SENT', 'EVIDENCE_ATTACHED',
    'RESOLVED', 'REOPENED', 'MERGED', 'ESCALATED', 'QUALITY_REVIEWED', 'RESPONSE_REQUESTED',
    'DUPLICATE_REPORTED', 'MERGE_RECEIVED'));
ALTER TABLE marketplace.support_case_messages
  ADD COLUMN message_kind text NOT NULL DEFAULT 'MESSAGE',
  ADD CONSTRAINT support_case_message_kind CHECK
    (message_kind IN ('MESSAGE', 'RESPONSE_REQUEST', 'RESOLUTION', 'DUPLICATE_REPORT')),
  ADD CONSTRAINT support_case_message_kind_audience CHECK
    (message_kind NOT IN ('RESPONSE_REQUEST', 'RESOLUTION') OR audience = 'PARTICIPANT');

-- Critical cases belong to the incident commander (D-09), who could not work
-- one; closed cases are sampled for quality review by someone who did not
-- resolve them.
INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description) VALUES
  ('admin.support.quality_review', 'ADMIN', 'ADMIN_SCOPE', 'Review the quality of a resolved support case')
ON CONFLICT (capability_key) DO NOTHING;
INSERT INTO marketplace.role_capabilities (role_key, capability_key) VALUES
  ('INCIDENT_COMMANDER', 'admin.support.case_manage'),
  ('INCIDENT_COMMANDER', 'admin.support.quality_review'),
  ('SUPPORT_AGENT', 'admin.support.quality_review')
ON CONFLICT DO NOTHING;

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.notification.support_replied', 'customer', 'CUSTOMER', 'Customer copy: support replied on a case'),
  ('customer.notification.support_response_requested', 'customer', 'CUSTOMER', 'Customer copy: support asked the customer a question'),
  ('customer.notification.support_resolved', 'customer', 'CUSTOMER', 'Customer copy: a support case was resolved'),
  ('customer.support.added_to_case', 'customer', 'CUSTOMER', 'Customer copy: a report added to the case already open')
ON CONFLICT (locale_key) DO NOTHING;
INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.notification.support_replied', 'en', 'Support replied on your case.'),
  ('customer.notification.support_response_requested', 'en', 'Support needs an answer from you to continue with your case.'),
  ('customer.notification.support_resolved', 'en', 'Your support case is resolved. Reply on it if something is still wrong.'),
  ('customer.support.added_to_case', 'en', 'You already have an open case about this. We added what you wrote to it.'),
  ('customer.notification.support_replied', 'hi', 'सहायता टीम ने आपके मामले पर जवाब दिया है।'),
  ('customer.notification.support_response_requested', 'hi', 'आपके मामले को आगे बढ़ाने के लिए सहायता टीम को आपसे जवाब चाहिए।'),
  ('customer.notification.support_resolved', 'hi', 'आपका सहायता मामला सुलझा दिया गया है। अगर अब भी कुछ गलत है तो उसी पर जवाब दें।'),
  ('customer.support.added_to_case', 'hi', 'इस बारे में आपका एक मामला पहले से खुला है। आपने जो लिखा, वह उसी में जोड़ दिया गया है।')
ON CONFLICT (locale_key, language_code) DO NOTHING;
