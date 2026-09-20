-- Phase 8.2: a customer may cancel an order the shop has accepted.
--
-- `cancelByCustomer` allows PLACED, ACCEPTED and PICKING, but the shape
-- constraint from 0026 required a CANCELLED order to carry no accepted_at,
-- so every cancellation after acceptance failed on the constraint (a 500 to
-- the customer) and no accepted order was ever cancelled by its customer.
-- A cancelled order keeps the time it was accepted: that is what happened.
ALTER TABLE marketplace.vendor_orders
  DROP CONSTRAINT vendor_order_accepted_after_placed,
  ADD CONSTRAINT vendor_order_accepted_after_placed
    CHECK (lifecycle_state IN ('CANCELLED','EXPIRED')
        OR (lifecycle_state <> 'PLACED') = (accepted_at IS NOT NULL));
