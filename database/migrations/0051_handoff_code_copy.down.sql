DELETE FROM marketplace.locale_translations WHERE locale_key IN (
  'customer.order.otp.expires',
  'customer.order.otp.hide',
  'customer.order.otp.hint',
  'customer.order.otp.label',
  'customer.order.otp.label_pickup',
  'customer.order.otp.show',
  'customer.order.otp.show_pickup'
);

DELETE FROM marketplace.locale_keys WHERE locale_key IN (
  'customer.order.otp.expires',
  'customer.order.otp.hide',
  'customer.order.otp.hint',
  'customer.order.otp.label',
  'customer.order.otp.label_pickup',
  'customer.order.otp.show',
  'customer.order.otp.show_pickup'
);
