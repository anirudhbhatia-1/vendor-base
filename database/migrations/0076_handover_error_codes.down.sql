DELETE FROM marketplace.locale_translations
 WHERE locale_key IN ('orders.pickup_otp_missing', 'orders.pickup_otp_mismatch',
                      'orders.pickup_otp_expired', 'orders.pickup_otp_exhausted',
                      'orders.customer_otp_active', 'orders.partner_not_present',
                      'delivery.otp_mismatch', 'delivery.otp_expired', 'delivery.otp_exhausted');
DELETE FROM marketplace.locale_keys
 WHERE locale_key IN ('orders.pickup_otp_missing', 'orders.pickup_otp_mismatch',
                      'orders.pickup_otp_expired', 'orders.pickup_otp_exhausted',
                      'orders.customer_otp_active', 'orders.partner_not_present',
                      'delivery.otp_mismatch', 'delivery.otp_expired', 'delivery.otp_exhausted');
