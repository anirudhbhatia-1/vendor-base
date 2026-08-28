CREATE TABLE marketplace.partner_wait_timers (
  partner_wait_timer_id uuid PRIMARY KEY,
  delivery_assignment_id uuid NOT NULL UNIQUE
    REFERENCES marketplace.delivery_assignments(delivery_assignment_id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  wait_state text NOT NULL DEFAULT 'RUNNING'
    CHECK (wait_state IN ('RUNNING','THRESHOLD_ONE','THRESHOLD_TWO','LEFT_POLICY','RESOLVED')),
  started_at timestamptz NOT NULL,
  first_threshold_seconds integer NOT NULL CHECK (first_threshold_seconds BETWEEN 60 AND 3600),
  leave_threshold_seconds integer NOT NULL CHECK (leave_threshold_seconds > first_threshold_seconds),
  max_credit_seconds integer NOT NULL CHECK (max_credit_seconds >= leave_threshold_seconds),
  rate_minor_per_minute integer NOT NULL CHECK (rate_minor_per_minute BETWEEN 0 AND 10000),
  ended_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((wait_state IN ('LEFT_POLICY','RESOLVED')) = (ended_at IS NOT NULL))
);

CREATE INDEX partner_wait_timers_due
  ON marketplace.partner_wait_timers(started_at, partner_wait_timer_id)
  WHERE wait_state IN ('RUNNING','THRESHOLD_ONE');

CREATE TABLE marketplace.partner_wait_timer_events (
  partner_wait_timer_event_id uuid PRIMARY KEY,
  partner_wait_timer_id uuid NOT NULL
    REFERENCES marketplace.partner_wait_timers(partner_wait_timer_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('STARTED','THRESHOLD_ONE','THRESHOLD_TWO','LEFT_POLICY','RESOLVED')),
  elapsed_seconds integer NOT NULL CHECK (elapsed_seconds >= 0),
  actor_id uuid NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('delivery_partner','system','admin')),
  command_reference text UNIQUE,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(partner_wait_timer_id,event_type)
);

CREATE TABLE marketplace.partner_wait_earning_adjustments (
  partner_wait_earning_adjustment_id uuid PRIMARY KEY,
  partner_wait_timer_id uuid NOT NULL UNIQUE
    REFERENCES marketplace.partner_wait_timers(partner_wait_timer_id) ON DELETE RESTRICT,
  delivery_assignment_id uuid NOT NULL UNIQUE
    REFERENCES marketplace.delivery_assignments(delivery_assignment_id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  eligible_wait_seconds integer NOT NULL CHECK (eligible_wait_seconds >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION marketplace.protect_partner_wait_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'partner wait history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER partner_wait_timer_events_append_only
BEFORE UPDATE OR DELETE ON marketplace.partner_wait_timer_events
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_partner_wait_history();
CREATE TRIGGER partner_wait_earning_adjustments_append_only
BEFORE UPDATE OR DELETE ON marketplace.partner_wait_earning_adjustments
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_partner_wait_history();

