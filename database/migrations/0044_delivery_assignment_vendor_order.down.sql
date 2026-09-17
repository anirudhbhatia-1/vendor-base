DROP INDEX IF EXISTS marketplace.delivery_assignments_by_vendor_order;

ALTER TABLE marketplace.delivery_assignments
  DROP CONSTRAINT IF EXISTS delivery_assignment_vendor_order_fk,
  DROP COLUMN IF EXISTS vendor_order_id;
