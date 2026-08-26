DROP TRIGGER IF EXISTS catalogue_moderation_events_append_only ON marketplace.catalogue_moderation_events;
DROP TABLE IF EXISTS marketplace.catalogue_moderation_events;
DROP TABLE IF EXISTS marketplace.catalogue_moderation_cases;
DELETE FROM marketplace.role_capabilities WHERE capability_key = 'admin.catalogue.moderate';
DELETE FROM marketplace.roles WHERE role_key = 'CATALOGUE_MODERATOR';
DELETE FROM marketplace.capabilities WHERE capability_key = 'admin.catalogue.moderate';
