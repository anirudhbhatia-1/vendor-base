DELETE FROM marketplace.locale_translations
  WHERE locale_key IN ('validation.invalid_request_id', 'validation.invalid_traceparent');
DELETE FROM marketplace.locale_keys
  WHERE locale_key IN ('validation.invalid_request_id', 'validation.invalid_traceparent');
