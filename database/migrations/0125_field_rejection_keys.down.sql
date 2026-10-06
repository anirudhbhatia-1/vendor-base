DELETE FROM marketplace.locale_translations WHERE locale_key IN
  ('validation.invalid_field', 'validation.password_rejected', 'validation.email_rejected');
DELETE FROM marketplace.locale_keys WHERE locale_key IN
  ('validation.invalid_field', 'validation.password_rejected', 'validation.email_rejected');
