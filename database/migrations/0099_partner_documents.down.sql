DELETE FROM marketplace.locale_translations WHERE locale_key = 'partner.not_eligible';
DELETE FROM marketplace.locale_keys WHERE locale_key = 'partner.not_eligible';
DROP TABLE marketplace.partner_document_renewals;
-- The history is append-only; a database that recorded a document event fails
-- on the narrower constraint, which is the honest outcome.
ALTER TABLE marketplace.partner_application_events
  DROP CONSTRAINT partner_application_event_type_allowed,
  ADD CONSTRAINT partner_application_event_type_allowed CHECK (event_type IN
    ('CREATED','SUBMITTED','REVIEW_STARTED','CHANGES_REQUESTED','APPROVED','REJECTED','APPEAL_OPENED'));
ALTER TABLE marketplace.partner_applications
  DROP COLUMN identity_expires_at,
  DROP COLUMN vehicle_expires_at,
  DROP COLUMN insurance_expires_at;
