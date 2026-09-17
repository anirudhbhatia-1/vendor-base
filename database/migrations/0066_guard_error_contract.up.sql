-- Two append-only guards raised the wrong error.
--
-- `protect_job_history` guards both `job_attempts` and `scheduled_jobs`, and
-- `protect_messaging_history` guards both `inbox_receipts` and `outbox_events`. Each
-- reads columns that exist only on its first table -- `OLD.outcome`, `NEW.consumer_scope`
-- -- from inside a single IF condition. PL/pgSQL resolves every field reference in that
-- condition regardless of which branch of the AND would decide it, so firing on the
-- second table raised `42703 record "old" has no field "outcome"` instead of the
-- intended `55000 job history is append-only`.
--
-- The write was still refused, so nothing was permitted that should not have been. What
-- broke was the contract: every verifier that checks for `55000` would see an
-- unexplained internal error instead, and the two tests covering these paths used a bare
-- catch that accepted any failure, which is why it went unnoticed.
--
-- Gating the field access behind the table check fixes it. The permitted transitions are
-- unchanged.

CREATE OR REPLACE FUNCTION marketplace.protect_job_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'job_attempts' AND TG_OP = 'UPDATE' THEN
    IF OLD.outcome = 'RUNNING'
       AND NEW.outcome IN ('SUCCEEDED', 'RETRY_SCHEDULED', 'DEAD_LETTER', 'LEASE_EXPIRED')
       AND NEW.attempt_id = OLD.attempt_id
       AND NEW.job_id = OLD.job_id
       AND NEW.attempt_number = OLD.attempt_number
       AND NEW.worker_id = OLD.worker_id
       AND NEW.started_at = OLD.started_at
       AND NEW.finished_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'job history is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION marketplace.protect_messaging_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'inbox_receipts' AND TG_OP = 'UPDATE' THEN
    IF OLD.status = 'PROCESSING'
       AND NEW.status = 'PROCESSED'
       AND NEW.consumer_scope = OLD.consumer_scope
       AND NEW.event_id = OLD.event_id
       AND NEW.request_id = OLD.request_id
       AND NEW.correlation_id = OLD.correlation_id
       AND NEW.received_at = OLD.received_at
       AND NEW.processed_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'messaging history is append-only'
    USING ERRCODE = '55000';
END;
$$;
