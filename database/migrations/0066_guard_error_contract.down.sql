-- Restores the single-condition form from migrations 0003 and 0004, which refuses the
-- same writes but reports 42703 rather than 55000 when firing on the second table.
CREATE OR REPLACE FUNCTION marketplace.protect_job_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'job_attempts'
     AND TG_OP = 'UPDATE'
     AND OLD.outcome = 'RUNNING'
     AND NEW.outcome IN ('SUCCEEDED', 'RETRY_SCHEDULED', 'DEAD_LETTER', 'LEASE_EXPIRED')
     AND NEW.attempt_id = OLD.attempt_id
     AND NEW.job_id = OLD.job_id
     AND NEW.attempt_number = OLD.attempt_number
     AND NEW.worker_id = OLD.worker_id
     AND NEW.started_at = OLD.started_at
     AND NEW.finished_at IS NOT NULL THEN
    RETURN NEW;
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
  IF TG_TABLE_NAME = 'inbox_receipts'
     AND TG_OP = 'UPDATE'
     AND OLD.status = 'PROCESSING'
     AND NEW.status = 'PROCESSED'
     AND NEW.consumer_scope = OLD.consumer_scope
     AND NEW.event_id = OLD.event_id
     AND NEW.request_id = OLD.request_id
     AND NEW.correlation_id = OLD.correlation_id
     AND NEW.received_at = OLD.received_at
     AND NEW.processed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'messaging history is append-only'
    USING ERRCODE = '55000';
END;
$$;
