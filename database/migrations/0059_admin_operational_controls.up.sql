-- The admin console could watch, but not operate.
--
-- Three things an operator cannot run a launch day without, and none of them
-- had a way in. A dead-lettered domain event — a side effect that failed every
-- retry — was visible to nobody, even though the machinery to list and recover
-- one has existed since 0003. A service zone could not be suspended when a
-- storm, a festival or a road closure makes a neighbourhood undeliverable; the
-- zones route was a single read. And a zone's lifecycle change had no event
-- type, so the history could not record who closed a neighbourhood or why.
--
-- Recovery is separated from reading: seeing a stuck event is a support-desk
-- concern, re-running one moves real state and belongs to the incident role.

INSERT INTO marketplace.capabilities (capability_key,actor_kind,resource_rule,description) VALUES
 ('admin.messaging.deadletter_read','ADMIN','ADMIN_SCOPE','Read domain events that exhausted their retries'),
 ('admin.messaging.deadletter_recover','ADMIN','ADMIN_SCOPE','Return a dead-lettered domain event for redelivery'),
 ('admin.zone.operate','ADMIN','ADMIN_SCOPE','Suspend and resume a vendor service zone')
ON CONFLICT (capability_key) DO NOTHING;

INSERT INTO marketplace.role_capabilities (role_key,capability_key) VALUES
 ('SUPPORT_AGENT','admin.messaging.deadletter_read'),
 ('INCIDENT_COMMANDER','admin.messaging.deadletter_read'),
 ('INCIDENT_COMMANDER','admin.messaging.deadletter_recover'),
 ('INCIDENT_COMMANDER','admin.zone.operate')
ON CONFLICT (role_key,capability_key) DO NOTHING;

ALTER TABLE marketplace.vendor_network_events
  DROP CONSTRAINT vendor_event_type_allowed;
ALTER TABLE marketplace.vendor_network_events
  ADD CONSTRAINT vendor_event_type_allowed CHECK (event_type IN
    ('CREATED', 'PROFILE_UPDATED', 'LIFECYCLE_CHANGED', 'OPERATING_HOURS_REPLACED',
     'CALENDAR_EXCEPTION_SET', 'TEMPORARY_CLOSURE_ADDED', 'SERVICE_ZONE_ADDED',
     'SERVICE_ZONE_LIFECYCLE_CHANGED', 'FULFILMENT_MODES_REPLACED'));
