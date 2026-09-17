-- A stable code for "that name is taken".
--
-- A vendor adding a service zone whose name already exists received a 409, which
-- the API reported as VERSION_CONFLICT because that was the only 409 code any
-- controller could reach. Clients render VERSION_CONFLICT as "Something changed
-- while you were working. Refresh and try again." -- so the vendor refreshed,
-- retyped the same name and hit the same wall. The observed session shows two
-- attempts before they stopped.
--
-- A uniqueness clash is not a conflict the user waits out; it is a value they can
-- change. This registers the key so the code can carry that meaning.
--
-- Audience SHARED: uniqueness clashes are not specific to one role.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('common.resource_already_exists', 'error', 'SHARED',
    'Stable error RESOURCE_ALREADY_EXISTS: a resource with that name or reference already exists');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('common.resource_already_exists', 'en', 'Something with that name already exists. Choose a different one.'),
  -- Hindi copy carried forward for native-speaker review with the rest of the
  -- error strings added in 0064 and 0065.
  ('common.resource_already_exists', 'hi', 'इस नाम से पहले से कुछ मौजूद है। कृपया दूसरा नाम चुनें।');
