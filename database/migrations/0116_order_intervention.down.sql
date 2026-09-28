DELETE FROM marketplace.locale_translations WHERE locale_key IN
  ('customer.notification.operations_under_review','customer.notification.operations_delay_acknowledged',
   'customer.notification.operations_will_contact');
DELETE FROM marketplace.locale_keys WHERE locale_key IN
  ('customer.notification.operations_under_review','customer.notification.operations_delay_acknowledged',
   'customer.notification.operations_will_contact');
-- An order ended by operations cannot be represented before this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.vendor_order_events WHERE actor_kind = 'admin') THEN
    RAISE EXCEPTION 'operator order events exist; 0116 cannot be rolled back' USING ERRCODE = '55000';
  END IF;
END;
$$;
ALTER TABLE marketplace.vendor_order_events
  DROP CONSTRAINT vendor_order_events_actor_kind_check;
ALTER TABLE marketplace.vendor_order_events
  ADD CONSTRAINT vendor_order_events_actor_kind_check
    CHECK (actor_kind IN ('customer','delivery_partner','system','vendor_staff'));
