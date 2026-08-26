DROP TRIGGER IF EXISTS custody_events_append_only ON marketplace.custody_events;
DROP TRIGGER IF EXISTS assignment_events_append_only ON marketplace.assignment_events;
DROP FUNCTION IF EXISTS marketplace.protect_assignment_history();
DROP TABLE IF EXISTS marketplace.return_tasks;
DROP TABLE IF EXISTS marketplace.custody_events;
DROP TABLE IF EXISTS marketplace.assignment_events;
DROP TABLE IF EXISTS marketplace.delivery_assignments;
DELETE FROM marketplace.role_capabilities
 WHERE role_key = 'DELIVERY_OPERATOR'
   AND capability_key = 'admin.delivery.assignment_manage';
DELETE FROM marketplace.roles WHERE role_key = 'DELIVERY_OPERATOR';
DELETE FROM marketplace.capabilities
 WHERE capability_key = 'admin.delivery.assignment_manage';
