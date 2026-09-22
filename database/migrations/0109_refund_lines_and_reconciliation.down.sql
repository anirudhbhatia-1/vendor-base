-- Restores the 0055 shape. A database that has recorded a cancellation of a
-- packed order fails on the narrower constraint, which is the honest outcome.
ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_ready_snapshot_shape,
  ADD CONSTRAINT vendor_order_ready_snapshot_shape
    CHECK ((lifecycle_state IN ('READY','PICKED_UP','DELIVERED','RETURNED'))
             = (ready_at IS NOT NULL AND package_count IS NOT NULL));
DROP TRIGGER refund_lines_sum_to_item ON marketplace.refund_lines;
DROP FUNCTION marketplace.ensure_refund_lines_sum();
DROP TRIGGER refund_lines_append_only ON marketplace.refund_lines;
DROP FUNCTION marketplace.protect_refund_lines();
DROP TABLE marketplace.refund_lines;
