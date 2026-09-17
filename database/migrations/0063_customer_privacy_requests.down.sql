DELETE FROM marketplace.role_capabilities WHERE capability_key='customer.privacy.manage';
DELETE FROM marketplace.capabilities WHERE capability_key='customer.privacy.manage';
DROP TABLE IF EXISTS marketplace.customer_privacy_requests;
