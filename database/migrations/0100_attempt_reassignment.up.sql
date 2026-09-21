-- Phase 9.3: a manual reassignment keeps its history, and the displaced
-- partner's compensation is on record.
--
-- Ending an attempt as REASSIGNED left the order with no attempt at all --
-- nothing created another -- and nothing recorded what the displaced partner
-- was owed for the road already travelled. The attempt now returns to the
-- pool with a REASSIGNED event naming the partner it was taken from, and the
-- compensation decided for them is a row here, append-only.
CREATE TABLE marketplace.partner_attempt_compensations (
  partner_attempt_compensation_id uuid PRIMARY KEY,
  delivery_assignment_id uuid NOT NULL
    REFERENCES marketplace.delivery_assignments (delivery_assignment_id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  decided_by_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  /** The state the partner was displaced from: OFFERED, ASSIGNED or AT_VENDOR. */
  displaced_from text NOT NULL CHECK (displaced_from IN ('OFFERED', 'ASSIGNED', 'AT_VENDOR')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0 AND amount_minor <= 100000),
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  note text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 500),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX partner_attempt_compensations_partner
  ON marketplace.partner_attempt_compensations (partner_user_id, created_at DESC);
CREATE INDEX partner_attempt_compensations_attempt
  ON marketplace.partner_attempt_compensations (delivery_assignment_id);

CREATE FUNCTION marketplace.protect_partner_attempt_compensations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'partner attempt compensations are append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER partner_attempt_compensations_append_only
BEFORE UPDATE OR DELETE ON marketplace.partner_attempt_compensations
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_partner_attempt_compensations();
