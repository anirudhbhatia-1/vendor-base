-- Phase 12.3 -- English/Hindi localization. Every user-visible string keeps a
-- stable server code (locale_key) plus a translation per supported language.
-- Server codes never change once shipped; UIs and receipts render the label,
-- not the code, so a translation edit does not require a code change.

CREATE TABLE marketplace.locale_keys (
  locale_key text PRIMARY KEY,
  namespace text NOT NULL,
  audience text NOT NULL,
  description text NOT NULL,
  classification text NOT NULL DEFAULT 'INTERNAL',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT locale_key_shape
    CHECK (locale_key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$' AND length(locale_key) <= 120),
  CONSTRAINT locale_namespace_allowed
    CHECK (namespace IN
      ('customer','vendor','partner','admin','receipt','notification','error','support')),
  CONSTRAINT locale_audience_allowed
    CHECK (audience IN ('CUSTOMER','VENDOR','PARTNER','ADMIN','SHARED')),
  CONSTRAINT locale_description_shape CHECK (length(description) BETWEEN 4 AND 240),
  CONSTRAINT locale_classification_allowed
    CHECK (classification IN ('INTERNAL','RESTRICTED'))
);
CREATE INDEX locale_keys_by_namespace ON marketplace.locale_keys (namespace, locale_key);

CREATE TABLE marketplace.locale_translations (
  locale_key text NOT NULL REFERENCES marketplace.locale_keys (locale_key) ON DELETE RESTRICT,
  language_code text NOT NULL,
  translation text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (locale_key, language_code),
  CONSTRAINT locale_language_allowed CHECK (language_code IN ('en','hi')),
  CONSTRAINT locale_translation_shape CHECK (length(translation) BETWEEN 1 AND 500)
);

-- Every locale key ships with an English translation on introduction; Hindi
-- translations may lag temporarily but must land before a Phase 13 launch. The
-- verify script enforces that neither language is missing.

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.checkout.blocked_group_reason.inventory_unavailable', 'customer', 'CUSTOMER',
    'Reason shown to a customer when a store group is blocked because of stock'),
  ('customer.checkout.blocked_group_reason.address_out_of_zone', 'customer', 'CUSTOMER',
    'Reason shown to a customer when a store group is outside their address serviceable zone'),
  ('customer.pickup.otp_prompt', 'customer', 'CUSTOMER',
    'Instruction text asking the customer to share the pickup OTP'),
  ('customer.support.category.missing_item', 'customer', 'CUSTOMER',
    'Support category label shown to a customer when an item did not arrive'),
  ('customer.order.status.placed', 'customer', 'CUSTOMER', 'Order status label for PLACED state'),
  ('customer.order.status.accepted', 'customer', 'CUSTOMER', 'Order status label for ACCEPTED state'),
  ('customer.order.status.picking', 'customer', 'CUSTOMER', 'Order status label for PICKING state'),
  ('customer.order.status.ready', 'customer', 'CUSTOMER', 'Order status label for READY state'),
  ('customer.order.status.picked_up', 'customer', 'CUSTOMER', 'Order status label for PICKED_UP state'),
  ('vendor.order.action.accept', 'vendor', 'VENDOR', 'Button label vendor sees to accept an incoming order'),
  ('vendor.order.action.decline', 'vendor', 'VENDOR', 'Button label vendor sees to decline an incoming order'),
  ('vendor.picking.action.propose_substitution', 'vendor', 'VENDOR',
    'Button label to propose a substitution during picking'),
  ('vendor.picking.action.mark_missing', 'vendor', 'VENDOR',
    'Button label to mark a line missing during picking'),
  ('partner.assignment.action.accept', 'partner', 'PARTNER',
    'Button label a partner sees to accept an offered assignment'),
  ('partner.assignment.action.decline', 'partner', 'PARTNER',
    'Button label a partner sees to decline an offered assignment'),
  ('partner.exception.kind.unreachable_customer', 'partner', 'PARTNER',
    'Guided exception label when a customer cannot be reached'),
  ('partner.exception.kind.wrong_address', 'partner', 'PARTNER',
    'Guided exception label when an address is wrong'),
  ('partner.exception.kind.unsafe_location', 'partner', 'PARTNER',
    'Guided exception label when the drop location is unsafe'),
  ('admin.trust.action.propose_restriction', 'admin', 'ADMIN',
    'Admin action label to propose a trust restriction'),
  ('admin.trust.action.approve_restriction', 'admin', 'ADMIN',
    'Admin action label to approve a proposed trust restriction'),
  ('receipt.header.title', 'receipt', 'CUSTOMER', 'Title text at the top of a customer receipt'),
  ('receipt.section.items', 'receipt', 'CUSTOMER', 'Section heading for the itemized list on a receipt'),
  ('receipt.section.totals', 'receipt', 'CUSTOMER', 'Section heading for the totals block on a receipt'),
  ('notification.pickup_ready.title', 'notification', 'CUSTOMER',
    'Push notification title when a vendor order is ready for pickup'),
  ('notification.pickup_ready.body', 'notification', 'CUSTOMER',
    'Push notification body when a vendor order is ready for pickup'),
  ('error.checkout.quote_expired', 'error', 'CUSTOMER',
    'Error message shown when the customer submits an expired quote'),
  ('error.checkout.payment_declined', 'error', 'CUSTOMER',
    'Error message shown when the payment provider declined the authorization'),
  ('error.pickup.otp_mismatch', 'error', 'SHARED',
    'Error message shown when a pickup OTP does not match'),
  ('support.case.status.open', 'support', 'CUSTOMER', 'Support case status label for OPEN'),
  ('support.case.status.resolved', 'support', 'CUSTOMER', 'Support case status label for RESOLVED')
ON CONFLICT (locale_key) DO NOTHING;

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.checkout.blocked_group_reason.inventory_unavailable', 'en', 'Some items in this store are out of stock right now.'),
  ('customer.checkout.blocked_group_reason.inventory_unavailable', 'hi', 'इस स्टोर में कुछ सामान अभी उपलब्ध नहीं हैं।'),
  ('customer.checkout.blocked_group_reason.address_out_of_zone', 'en', 'This store does not deliver to your selected address.'),
  ('customer.checkout.blocked_group_reason.address_out_of_zone', 'hi', 'यह स्टोर आपके चुने हुए पते पर डिलीवरी नहीं करता।'),
  ('customer.pickup.otp_prompt', 'en', 'Share this OTP with the store when you pick up your order.'),
  ('customer.pickup.otp_prompt', 'hi', 'ऑर्डर लेने पर स्टोर के साथ यह OTP साझा करें।'),
  ('customer.support.category.missing_item', 'en', 'Missing item'),
  ('customer.support.category.missing_item', 'hi', 'सामान गायब है'),
  ('customer.order.status.placed', 'en', 'Placed'),
  ('customer.order.status.placed', 'hi', 'भेजा गया'),
  ('customer.order.status.accepted', 'en', 'Accepted'),
  ('customer.order.status.accepted', 'hi', 'स्वीकार किया'),
  ('customer.order.status.picking', 'en', 'Being prepared'),
  ('customer.order.status.picking', 'hi', 'तैयार हो रहा है'),
  ('customer.order.status.ready', 'en', 'Ready for pickup'),
  ('customer.order.status.ready', 'hi', 'लेने के लिए तैयार'),
  ('customer.order.status.picked_up', 'en', 'Picked up'),
  ('customer.order.status.picked_up', 'hi', 'ले लिया गया'),
  ('vendor.order.action.accept', 'en', 'Accept'),
  ('vendor.order.action.accept', 'hi', 'स्वीकार करें'),
  ('vendor.order.action.decline', 'en', 'Decline'),
  ('vendor.order.action.decline', 'hi', 'अस्वीकार करें'),
  ('vendor.picking.action.propose_substitution', 'en', 'Propose substitute'),
  ('vendor.picking.action.propose_substitution', 'hi', 'विकल्प सुझाएँ'),
  ('vendor.picking.action.mark_missing', 'en', 'Mark missing'),
  ('vendor.picking.action.mark_missing', 'hi', 'गायब के रूप में चिह्नित करें'),
  ('partner.assignment.action.accept', 'en', 'Accept job'),
  ('partner.assignment.action.accept', 'hi', 'काम स्वीकार करें'),
  ('partner.assignment.action.decline', 'en', 'Decline job'),
  ('partner.assignment.action.decline', 'hi', 'काम मना करें'),
  ('partner.exception.kind.unreachable_customer', 'en', 'Customer not reachable'),
  ('partner.exception.kind.unreachable_customer', 'hi', 'ग्राहक से संपर्क नहीं हो सका'),
  ('partner.exception.kind.wrong_address', 'en', 'Wrong address'),
  ('partner.exception.kind.wrong_address', 'hi', 'गलत पता'),
  ('partner.exception.kind.unsafe_location', 'en', 'Unsafe location'),
  ('partner.exception.kind.unsafe_location', 'hi', 'असुरक्षित स्थान'),
  ('admin.trust.action.propose_restriction', 'en', 'Propose restriction'),
  ('admin.trust.action.propose_restriction', 'hi', 'प्रतिबंध प्रस्तावित करें'),
  ('admin.trust.action.approve_restriction', 'en', 'Approve restriction'),
  ('admin.trust.action.approve_restriction', 'hi', 'प्रतिबंध स्वीकृत करें'),
  ('receipt.header.title', 'en', 'Order receipt'),
  ('receipt.header.title', 'hi', 'ऑर्डर रसीद'),
  ('receipt.section.items', 'en', 'Items'),
  ('receipt.section.items', 'hi', 'सामान'),
  ('receipt.section.totals', 'en', 'Totals'),
  ('receipt.section.totals', 'hi', 'कुल राशि'),
  ('notification.pickup_ready.title', 'en', 'Your order is ready'),
  ('notification.pickup_ready.title', 'hi', 'आपका ऑर्डर तैयार है'),
  ('notification.pickup_ready.body', 'en', 'Show your pickup OTP at the store to collect your order.'),
  ('notification.pickup_ready.body', 'hi', 'ऑर्डर लेने के लिए स्टोर पर अपना पिकअप OTP दिखाएँ।'),
  ('error.checkout.quote_expired', 'en', 'Your checkout quote expired. Please refresh and try again.'),
  ('error.checkout.quote_expired', 'hi', 'आपका चेकआउट कोट समाप्त हो गया। कृपया ताज़ा करें और पुनः प्रयास करें।'),
  ('error.checkout.payment_declined', 'en', 'Your payment could not be authorized. Please try another method.'),
  ('error.checkout.payment_declined', 'hi', 'आपका भुगतान अधिकृत नहीं हो सका। कृपया कोई अन्य तरीका आज़माएँ।'),
  ('error.pickup.otp_mismatch', 'en', 'The pickup OTP does not match. Please check with the customer.'),
  ('error.pickup.otp_mismatch', 'hi', 'पिकअप OTP मेल नहीं खा रहा। कृपया ग्राहक से जाँच करें।'),
  ('support.case.status.open', 'en', 'Open'),
  ('support.case.status.open', 'hi', 'खुला'),
  ('support.case.status.resolved', 'en', 'Resolved'),
  ('support.case.status.resolved', 'hi', 'हल हो गया')
ON CONFLICT (locale_key, language_code) DO NOTHING;

INSERT INTO marketplace.capabilities (capability_key, actor_kind, resource_rule, description) VALUES
  ('admin.locale.manage', 'ADMIN', 'ADMIN_SCOPE',
    'Add locale keys and edit English/Hindi translations for user-visible strings')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO marketplace.role_capabilities (role_key, capability_key) VALUES
  ('SUPPORT_AGENT', 'admin.locale.manage')
ON CONFLICT DO NOTHING;
