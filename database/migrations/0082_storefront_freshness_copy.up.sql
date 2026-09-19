-- Phase 6.5 requirement 3: the store page shows availability freshness and
-- the variable-weight bound. The storefront now carries the same freshness
-- tier the 5.7 availability read computes, and the product sheet says it in
-- words. Keys the customer PWA reads; en and hi as 0048 established.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.product.freshness', 'customer', 'CUSTOMER', 'Customer copy: product sheet label for the stock check'),
  ('customer.product.freshness.fresh', 'customer', 'CUSTOMER', 'Customer copy: stock confirmed within fifteen minutes'),
  ('customer.product.freshness.stale', 'customer', 'CUSTOMER', 'Customer copy: stock confirmed within the hour'),
  ('customer.product.freshness.expired', 'customer', 'CUSTOMER', 'Customer copy: stock last confirmed over an hour ago'),
  ('customer.product.weight.variance', 'customer', 'CUSTOMER', 'Customer copy: permitted weight variance, with {percent}');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.product.freshness', 'en', 'Stock check'),
  ('customer.product.freshness.fresh', 'en', 'Stock confirmed by the store in the last 15 minutes.'),
  ('customer.product.freshness.stale', 'en', 'Stock confirmed by the store within the last hour.'),
  ('customer.product.freshness.expired', 'en',
    'The store last confirmed stock over an hour ago. It reconfirms when it accepts your order.'),
  ('customer.product.weight.variance', 'en',
    'The final weight may differ from what you order by up to {percent}%.'),
  -- Hindi copy carried forward for native-speaker review with the customer
  -- strings added in 0048.
  ('customer.product.freshness', 'hi', 'स्टॉक की जाँच'),
  ('customer.product.freshness.fresh', 'hi', 'दुकान ने पिछले 15 मिनट में स्टॉक की पुष्टि की है।'),
  ('customer.product.freshness.stale', 'hi', 'दुकान ने पिछले एक घंटे में स्टॉक की पुष्टि की है।'),
  ('customer.product.freshness.expired', 'hi',
    'दुकान ने एक घंटे से पहले स्टॉक की पुष्टि की थी। ऑर्डर स्वीकार करते समय वह दोबारा पुष्टि करती है।'),
  ('customer.product.weight.variance', 'hi',
    'अंतिम वज़न आपके ऑर्डर से अधिकतम {percent}% तक अलग हो सकता है।');
