DELETE FROM marketplace.locale_translations WHERE locale_key IN (
  'customer.receipt.ordered', 'customer.receipt.charged', 'customer.receipt.not_supplied',
  'customer.receipt.replaced_with', 'customer.receipt.adjustment.lines',
  'customer.receipt.adjustment.decision', 'customer.receipt.adjustment.ended',
  'customer.support.item', 'customer.support.item.any');
DELETE FROM marketplace.locale_keys WHERE locale_key IN (
  'customer.receipt.ordered', 'customer.receipt.charged', 'customer.receipt.not_supplied',
  'customer.receipt.replaced_with', 'customer.receipt.adjustment.lines',
  'customer.receipt.adjustment.decision', 'customer.receipt.adjustment.ended',
  'customer.support.item', 'customer.support.item.any');
ALTER TABLE marketplace.support_cases DROP COLUMN vendor_order_line_id;
