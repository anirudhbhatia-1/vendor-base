-- 11.5: every finance exception sits in one of eleven owned queues, carries
-- what was expected and what happened, can be assigned, retried where safe,
-- linked to a correction and resolved with a reason, and keeps its history.
--
-- Until audit run 77 an exception could only be read: nothing assigned,
-- retried, annotated or resolved one, six code paths closed them with no
-- record of who or why, nothing linked one to a correction, and several
-- queues were not detected at all (a capture its allocations do not cover,
-- a conflicting webhook, a declined refund, a shop's refused payout, and
-- the conservation breaches the ledger audit found and forgot).

-- The queue an exception belongs to, from its kind and the action it asks for.
CREATE FUNCTION marketplace.finance_queue(p_kind text, p_next_action text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_kind = 'PAYMENT_UNKNOWN'
         AND (p_next_action LIKE 'VOID%' OR p_next_action IN
              ('RECONCILE_VOID_SAME_OPERATION', 'RECONCILE_ABANDONED_AUTHORIZATION'))
      THEN 'AUTHORIZATION_WITHOUT_CHECKOUT'
    WHEN p_kind = 'PAYMENT_UNKNOWN' THEN 'PAYMENT_UNKNOWN'
    WHEN p_kind = 'CAPTURE_ALLOCATION_MISMATCH' THEN 'CAPTURE_ALLOCATION_MISMATCH'
    WHEN p_kind = 'WEBHOOK_CONFLICT'
         OR (p_kind = 'STATUS_MISMATCH' AND p_next_action = 'REVIEW_PROVIDER_CONFLICT')
      THEN 'WEBHOOK_DUPLICATION'
    WHEN p_kind IN ('REFUND_UNKNOWN', 'REFUND_FAILED') THEN 'REFUND_FAILURE'
    WHEN p_kind IN ('LEDGER_UNBALANCED', 'CORRECTION_REVIEW') THEN 'LEDGER_UNBALANCED'
    WHEN p_kind = 'PARTNER_EARNING_MISMATCH'
         OR (p_kind = 'POSTING_FAILED' AND p_next_action IN
             ('INVESTIGATE_EARNING_POSTING', 'INVESTIGATE_COMPENSATION_POSTING'))
      THEN 'PARTNER_EARNING_MISMATCH'
    WHEN p_kind IN ('SETTLEMENT_MISMATCH', 'POSTING_FAILED') THEN 'VENDOR_SETTLEMENT_MISMATCH'
    WHEN p_kind IN ('PAYOUT_UNKNOWN', 'PAYOUT_FAILED', 'PAYOUT_DUPLICATE_RISK') THEN 'PAYOUT_FAILURE'
    ELSE 'STATEMENT_UNMATCHED'
  END
$$;

ALTER TABLE marketplace.finance_exceptions DROP CONSTRAINT finance_exception_kind_allowed;
ALTER TABLE marketplace.finance_exceptions ADD CONSTRAINT finance_exception_kind_allowed CHECK (exception_kind IN
  ('PAYMENT_UNKNOWN','REFUND_UNKNOWN','PAYOUT_UNKNOWN','STATEMENT_MISSING','STATEMENT_CONFLICT',
   'STATEMENT_UNMATCHED','STATEMENT_DUPLICATE','AMOUNT_MISMATCH','STATUS_MISMATCH',
   'LEDGER_UNBALANCED','PAYOUT_DUPLICATE_RISK','CORRECTION_REVIEW',
   'SETTLEMENT_MISMATCH','POSTING_FAILED','PAYOUT_FAILED',
   'CAPTURE_ALLOCATION_MISMATCH','WEBHOOK_CONFLICT','REFUND_FAILED','PARTNER_EARNING_MISMATCH'));

ALTER TABLE marketplace.finance_exceptions
  ADD COLUMN queue text GENERATED ALWAYS AS
    (marketplace.finance_queue(exception_kind, next_action_code)) STORED,
  ADD COLUMN expected_minor bigint,
  ADD COLUMN actual_minor bigint,
  ADD COLUMN business_reference text,
  ADD COLUMN assigned_to_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN last_retry_at timestamptz,
  ADD COLUMN financial_correction_id uuid
    REFERENCES marketplace.financial_corrections (financial_correction_id) ON DELETE RESTRICT,
  ADD COLUMN resolution_code text,
  ADD COLUMN resolved_by_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN version integer NOT NULL DEFAULT 1;

-- A resolution recorded before this migration was made by the operation
-- that settled it; it says so.
UPDATE marketplace.finance_exceptions
   SET resolution_code = 'RESOLVED_BY_OPERATION', resolved_at = updated_at
 WHERE exception_state = 'RESOLVED';
-- ASSIGNED was allowed and never written; none exists to backfill.
UPDATE marketplace.finance_exceptions SET exception_state = 'OPEN'
 WHERE exception_state = 'ASSIGNED' AND assigned_to_user_id IS NULL;

ALTER TABLE marketplace.finance_exceptions
  ADD CONSTRAINT finance_exception_attempts CHECK (attempts >= 0),
  ADD CONSTRAINT finance_exception_version CHECK (version >= 1),
  ADD CONSTRAINT finance_exception_values CHECK
    ((expected_minor IS NULL OR expected_minor >= 0) AND (actual_minor IS NULL OR actual_minor >= 0)),
  ADD CONSTRAINT finance_exception_assignment_shape CHECK
    (exception_state <> 'ASSIGNED' OR assigned_to_user_id IS NOT NULL),
  ADD CONSTRAINT finance_exception_resolution_code CHECK
    (resolution_code IS NULL OR resolution_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  ADD CONSTRAINT finance_exception_resolution_shape CHECK
    -- No resolver names the money flow itself: the operation that settled it.
    ((exception_state = 'RESOLVED' AND resolution_code IS NOT NULL AND resolved_at IS NOT NULL)
     OR (exception_state <> 'RESOLVED' AND resolution_code IS NULL
         AND resolved_by_user_id IS NULL AND resolved_at IS NULL));
CREATE INDEX finance_exceptions_by_queue ON marketplace.finance_exceptions (queue, created_at)
  WHERE exception_state <> 'RESOLVED';

-- The history: every exception opened, assigned, noted, retried, linked,
-- resolved or reopened, by whom and why.
CREATE TABLE marketplace.finance_exception_events (
  finance_exception_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_exception_id uuid NOT NULL
    REFERENCES marketplace.finance_exceptions (finance_exception_id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  -- Null when no operator acted: the money flow that changed it.
  actor_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  reason_code text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT finance_exception_event_type CHECK (event_type IN
    ('OPENED', 'ASSIGNED', 'REOPENED', 'RESOLVED', 'NOTE', 'EVIDENCE', 'RETRIED', 'CORRECTION_LINKED',
     'WRITE_OFF_PROPOSED')),
  CONSTRAINT finance_exception_event_reason CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$')
);
CREATE INDEX finance_exception_events_exception
  ON marketplace.finance_exception_events (finance_exception_id, occurred_at);
CREATE TRIGGER finance_exception_events_append_only
  BEFORE UPDATE OR DELETE ON marketplace.finance_exception_events
  FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();

-- Every writer, old or new, leaves the same record. A state change stamps
-- who resolved it (the operator a command named in app.finance_actor, or no
-- one when the money flow settled it) and appends the event; a reopening
-- clears the resolution.
CREATE FUNCTION marketplace.finance_exception_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor uuid := NULLIF(current_setting('app.finance_actor', true), '')::uuid;
  reason text := COALESCE(NULLIF(current_setting('app.finance_reason', true), ''), 'STATE_CHANGED');
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.exception_state = 'RESOLVED' AND OLD.exception_state <> 'RESOLVED' THEN
      NEW.resolution_code := COALESCE(NEW.resolution_code, 'RESOLVED_BY_OPERATION');
      NEW.resolved_by_user_id := COALESCE(NEW.resolved_by_user_id, actor);
      NEW.resolved_at := COALESCE(NEW.resolved_at, NEW.updated_at);
      NEW.assigned_to_user_id := NULL;
    ELSIF NEW.exception_state <> 'RESOLVED' AND OLD.exception_state = 'RESOLVED' THEN
      NEW.resolution_code := NULL;
      NEW.resolved_by_user_id := NULL;
      NEW.resolved_at := NULL;
    END IF;
    IF NEW.version = OLD.version THEN
      NEW.version := OLD.version + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finance_exception_record BEFORE UPDATE ON marketplace.finance_exceptions
  FOR EACH ROW EXECUTE FUNCTION marketplace.finance_exception_record();

CREATE FUNCTION marketplace.finance_exception_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor uuid := NULLIF(current_setting('app.finance_actor', true), '')::uuid;
  reason text := COALESCE(NULLIF(current_setting('app.finance_reason', true), ''), 'STATE_CHANGED');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO marketplace.finance_exception_events
      (finance_exception_id, event_type, actor_id, reason_code, payload, occurred_at)
    VALUES (NEW.finance_exception_id, 'OPENED', actor, NEW.next_action_code,
            jsonb_build_object('kind', NEW.exception_kind, 'amount_at_risk_minor', NEW.amount_at_risk_minor),
            NEW.created_at);
  ELSIF NEW.exception_state IS DISTINCT FROM OLD.exception_state THEN
    INSERT INTO marketplace.finance_exception_events
      (finance_exception_id, event_type, actor_id, reason_code, payload, occurred_at)
    VALUES (NEW.finance_exception_id,
            CASE WHEN NEW.exception_state = 'RESOLVED' THEN 'RESOLVED'
                 WHEN NEW.exception_state = 'ASSIGNED' THEN 'ASSIGNED'
                 ELSE 'REOPENED' END,
            actor,
            CASE WHEN NEW.exception_state = 'RESOLVED' THEN NEW.resolution_code ELSE reason END,
            jsonb_build_object('assigned_to_user_id', NEW.assigned_to_user_id, 'version', NEW.version),
            NEW.updated_at);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER finance_exception_history AFTER INSERT OR UPDATE ON marketplace.finance_exceptions
  FOR EACH ROW EXECUTE FUNCTION marketplace.finance_exception_history();

-- The history of exceptions opened before this migration starts with them.
INSERT INTO marketplace.finance_exception_events
  (finance_exception_id, event_type, actor_id, reason_code, payload, occurred_at)
SELECT finance_exception_id, 'OPENED', NULL, next_action_code, jsonb_build_object('kind', exception_kind), created_at
  FROM marketplace.finance_exceptions;
INSERT INTO marketplace.finance_exception_events
  (finance_exception_id, event_type, actor_id, reason_code, occurred_at)
SELECT finance_exception_id, 'RESOLVED', resolved_by_user_id, resolution_code, resolved_at
  FROM marketplace.finance_exceptions WHERE exception_state = 'RESOLVED';
