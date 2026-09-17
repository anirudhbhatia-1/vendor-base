DELETE FROM marketplace.locale_translations WHERE locale_key IN (
  'common.invalid_argument','auth.unauthenticated','auth.forbidden','common.resource_not_found',
  'orders.state_conflict','common.version_conflict','common.idempotency_key_reused',
  'common.business_rule_violation','common.rate_limited','common.service_unavailable',
  'common.internal_error');
DELETE FROM marketplace.locale_keys WHERE locale_key IN (
  'common.invalid_argument','auth.unauthenticated','auth.forbidden','common.resource_not_found',
  'orders.state_conflict','common.version_conflict','common.idempotency_key_reused',
  'common.business_rule_violation','common.rate_limited','common.service_unavailable',
  'common.internal_error');
