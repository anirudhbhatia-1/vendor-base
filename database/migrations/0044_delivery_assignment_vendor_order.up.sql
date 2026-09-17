-- Links a delivery assignment to the vendor order it carries.
--
-- The two custody chains were independent: the vendor completed a pickup on
-- marketplace.vendor_orders while the partner confirmed a pickup on
-- marketplace.delivery_assignments, with only a free-text order reference in
-- common. Nothing could verify that the vendor had actually handed the packages
-- over, so a partner could self-assert custody of an order that was never
-- released.
--
-- The column is nullable: assignments created directly through the admin
-- dispatch surface carry only a synthetic order reference.

ALTER TABLE marketplace.delivery_assignments
  ADD COLUMN vendor_order_id uuid,
  ADD CONSTRAINT delivery_assignment_vendor_order_fk FOREIGN KEY (vendor_order_id)
    REFERENCES marketplace.vendor_orders (vendor_order_id) ON DELETE RESTRICT;

-- Existing rows already carry the order reference, which is unique per order.
UPDATE marketplace.delivery_assignments assignment
   SET vendor_order_id = vendor_order.vendor_order_id
  FROM marketplace.vendor_orders vendor_order
 WHERE vendor_order.order_reference = assignment.source_order_reference
   AND assignment.vendor_order_id IS NULL;

CREATE INDEX delivery_assignments_by_vendor_order
  ON marketplace.delivery_assignments (vendor_order_id)
  WHERE vendor_order_id IS NOT NULL;
