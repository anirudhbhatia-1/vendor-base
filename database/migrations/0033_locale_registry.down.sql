DELETE FROM marketplace.role_capabilities WHERE capability_key = 'admin.locale.manage';
DELETE FROM marketplace.capabilities WHERE capability_key = 'admin.locale.manage';
DROP TABLE IF EXISTS marketplace.locale_translations;
DROP TABLE IF EXISTS marketplace.locale_keys;
