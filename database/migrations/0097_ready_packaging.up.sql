-- Phase 8.5: what the shop records when the bag is ready.
--
-- The package count was recorded; the condition note could be recorded but
-- no screen sent it; the handling needs had nowhere to go at all, and the
-- delivery assignment carried a package count guessed from the line count at
-- placement -- which the partner then had to type back exactly at the
-- counter. The order carries its handling needs now, and ready passes the
-- shop's own count and needs to the assignment.
ALTER TABLE marketplace.vendor_orders
  ADD COLUMN handling_flags text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT vendor_order_handling_flags_allowed
    CHECK (handling_flags <@ ARRAY['FRAGILE','KEEP_COLD','KEEP_FROZEN','KEEP_UPRIGHT','HEAVY',
                                   'LEAK_RISK']::text[]
           AND cardinality(handling_flags) <= 6);

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.order.promise.collect', 'customer', 'CUSTOMER', 'Order card: ready to collect since {time}'),
  ('customer.order.promise.arrives', 'customer', 'CUSTOMER', 'Order card: delivery expected around {time}');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.order.promise.collect', 'en', 'Ready to collect since {time}.'),
  ('customer.order.promise.arrives', 'en', 'Expected around {time}.'),
  -- Hindi copy carried forward for native-speaker review with 0085.
  ('customer.order.promise.collect', 'hi', '{time} से लेने के लिए तैयार।'),
  ('customer.order.promise.arrives', 'hi', 'लगभग {time} तक पहुँचने की उम्मीद।');
