DELETE FROM marketplace.role_capabilities WHERE role_key='CUSTOMER' AND capability_key='customer.checkout.manage';
DELETE FROM marketplace.capabilities WHERE capability_key='customer.checkout.manage';
DROP TABLE marketplace.provider_webhook_receipts;
DROP TABLE marketplace.vendor_orders;
DROP TABLE marketplace.checkout_groups;
DROP TABLE marketplace.checkout_quote_groups;
DROP TABLE marketplace.checkout_quotes;
