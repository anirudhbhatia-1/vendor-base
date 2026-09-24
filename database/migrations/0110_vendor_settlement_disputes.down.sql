DELETE FROM marketplace.role_capabilities
 WHERE capability_key IN ('vendor.finance.dispute','admin.vendor_settlement.resolve');
DELETE FROM marketplace.capabilities
 WHERE capability_key IN ('vendor.finance.dispute','admin.vendor_settlement.resolve');
DROP TRIGGER vendor_settlement_adjustments_append_only ON marketplace.vendor_settlement_adjustments;
DROP FUNCTION marketplace.protect_vendor_settlement_adjustments();
DROP TABLE marketplace.vendor_settlement_adjustments;
DROP TABLE marketplace.vendor_settlement_disputes;
ALTER TABLE marketplace.settlements
  DROP COLUMN redivided_item_refunds_minor,
  DROP COLUMN redivided_refunds_minor;
