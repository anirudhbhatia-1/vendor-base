-- Restores the 0026 shape. A database that has recorded a cancellation after
-- acceptance fails on the narrower constraint, which is the honest outcome.
ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_accepted_after_placed,
  ADD CONSTRAINT vendor_order_accepted_after_placed
    CHECK ((lifecycle_state NOT IN ('PLACED','CANCELLED')) = (accepted_at IS NOT NULL)
        OR lifecycle_state = 'EXPIRED');
