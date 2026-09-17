DELETE FROM marketplace.locale_translations WHERE locale_key IN (
  'customer.notification.declined',
  'customer.notification.timed_out',
  'customer.notification.weight_decision',
  'customer.notification.picked_up',
  'customer.notification.returned',
  'customer.notification.support_opened',
  'customer.order.rate_delivery',
  'customer.order.rated_delivery'
);

DELETE FROM marketplace.locale_keys WHERE locale_key IN (
  'customer.notification.declined',
  'customer.notification.timed_out',
  'customer.notification.weight_decision',
  'customer.notification.picked_up',
  'customer.notification.returned',
  'customer.notification.support_opened',
  'customer.order.rate_delivery',
  'customer.order.rated_delivery'
);
