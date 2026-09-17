ALTER TABLE marketplace.vendor_network_events
  DROP CONSTRAINT vendor_event_type_allowed;
ALTER TABLE marketplace.vendor_network_events
  ADD CONSTRAINT vendor_event_type_allowed CHECK (event_type IN
    ('CREATED', 'PROFILE_UPDATED', 'LIFECYCLE_CHANGED', 'OPERATING_HOURS_REPLACED',
     'CALENDAR_EXCEPTION_SET', 'TEMPORARY_CLOSURE_ADDED', 'SERVICE_ZONE_ADDED',
     'FULFILMENT_MODES_REPLACED'));

DELETE FROM marketplace.role_capabilities WHERE capability_key IN
 ('admin.messaging.deadletter_read','admin.messaging.deadletter_recover','admin.zone.operate');
DELETE FROM marketplace.capabilities WHERE capability_key IN
 ('admin.messaging.deadletter_read','admin.messaging.deadletter_recover','admin.zone.operate');
