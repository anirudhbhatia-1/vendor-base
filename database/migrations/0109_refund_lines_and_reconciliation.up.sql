-- 10.2: a refund names the exact lines it returns, and is bounded by the
-- order it returns them from.
--
-- Until audit run 67 a refund was a set of components against an order
-- reference: nothing said which lines, and the only cap was the payment's
-- captured total, so one order's refund could be paid from a sibling's money
-- and two pending proposals could both pass the cap and both succeed.

CREATE TABLE marketplace.refund_lines (
  refund_line_id uuid PRIMARY KEY,
  refund_id uuid NOT NULL REFERENCES marketplace.refunds (refund_id) ON DELETE RESTRICT,
  vendor_order_line_id uuid NOT NULL
    REFERENCES marketplace.vendor_order_lines (vendor_order_line_id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT refund_line_once UNIQUE (refund_id, vendor_order_line_id)
);
CREATE INDEX refund_lines_order_line ON marketplace.refund_lines (vendor_order_line_id);

CREATE FUNCTION marketplace.protect_refund_lines()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'refund lines are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER refund_lines_append_only BEFORE UPDATE OR DELETE ON marketplace.refund_lines
FOR EACH ROW EXECUTE FUNCTION marketplace.protect_refund_lines();

-- When a refund names lines, they are its item amount exactly: checked at
-- commit from the lines' side, so a refund proposed with lines cannot say
-- one figure on the line and another on the record.
CREATE FUNCTION marketplace.ensure_refund_lines_sum()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lined bigint;
DECLARE item bigint;
BEGIN
  SELECT COALESCE(sum(amount_minor),0) INTO lined FROM marketplace.refund_lines
   WHERE refund_id = NEW.refund_id;
  SELECT item_minor INTO item FROM marketplace.refunds WHERE refund_id = NEW.refund_id;
  IF lined <> item THEN
    RAISE EXCEPTION 'refund lines sum to % against an item amount of %', lined, item
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER refund_lines_sum_to_item
AFTER INSERT ON marketplace.refund_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION marketplace.ensure_refund_lines_sum();

COMMENT ON TABLE marketplace.refund_lines IS
  'The order lines a refund returns, with the quantity and amount per line; their sum is the refund''s item amount.';

-- A customer may call an order off until someone is carrying it (PRD:
-- cancellation after custody becomes a controlled return), packed or not.
-- The shape from 0055 required a CANCELLED order to carry no ready snapshot,
-- so a cancellation of a packed order failed on the constraint. A cancelled
-- order keeps the time it was packed and how many packages: that is what
-- happened, and the refund it is owed is filed from it.
ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_ready_snapshot_shape,
  ADD CONSTRAINT vendor_order_ready_snapshot_shape
    CHECK (lifecycle_state = 'CANCELLED'
        OR (lifecycle_state IN ('READY','PICKED_UP','DELIVERED','RETURNED'))
             = (ready_at IS NOT NULL AND package_count IS NOT NULL));
