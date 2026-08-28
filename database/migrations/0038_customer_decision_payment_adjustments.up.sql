CREATE TABLE marketplace.payment_authorization_adjustments (
  payment_authorization_adjustment_id uuid PRIMARY KEY,
  decision_id uuid NOT NULL UNIQUE
    REFERENCES marketplace.vendor_order_customer_decisions(decision_id) ON DELETE RESTRICT,
  payment_transaction_id uuid NOT NULL
    REFERENCES marketplace.payment_transactions(payment_transaction_id) ON DELETE RESTRICT,
  vendor_order_id uuid NOT NULL REFERENCES marketplace.vendor_orders(vendor_order_id) ON DELETE RESTRICT,
  delta_minor bigint NOT NULL,
  previous_authorized_minor bigint NOT NULL CHECK (previous_authorized_minor > 0),
  resulting_authorized_minor bigint NOT NULL CHECK (resulting_authorized_minor > 0),
  provider_scenario text NOT NULL CHECK (provider_scenario='SUCCESS'),
  provider_reference text NOT NULL UNIQUE,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (resulting_authorized_minor=previous_authorized_minor+delta_minor)
);
CREATE FUNCTION marketplace.protect_payment_authorization_adjustments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'payment authorization adjustments are append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER payment_authorization_adjustments_append_only BEFORE UPDATE OR DELETE ON marketplace.payment_authorization_adjustments FOR EACH ROW EXECUTE FUNCTION marketplace.protect_payment_authorization_adjustments();
