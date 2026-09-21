-- 9.9: a return says where it goes in words, and how it was received.
--
-- Until audit run 64 a return's destination was a reference nobody could
-- read, its completion recorded a proof reference the app invented and
-- nothing else -- no recipient, no count, no condition -- and a store that
-- was closed or refused the goods had no path: the authorisation could not
-- be moved to another safe point once given.

ALTER TABLE marketplace.return_tasks
  ADD COLUMN destination_note text,
  ADD COLUMN received_by text,
  ADD COLUMN returned_package_count integer,
  ADD COLUMN condition_note text,
  ADD COLUMN returned_at timestamptz,
  ADD CONSTRAINT return_task_destination_note_shape CHECK
    (destination_note IS NULL OR length(destination_note) BETWEEN 2 AND 240),
  ADD CONSTRAINT return_task_received_by_shape CHECK
    (received_by IS NULL OR length(received_by) BETWEEN 2 AND 120),
  ADD CONSTRAINT return_task_returned_count CHECK
    (returned_package_count IS NULL OR returned_package_count BETWEEN 0 AND 100),
  ADD CONSTRAINT return_task_condition_shape CHECK
    (condition_note IS NULL OR length(condition_note) BETWEEN 1 AND 240);

-- A completed return names who received it and how many came back. NOT
-- VALID: returns completed before this migration stand as they are.
ALTER TABLE marketplace.return_tasks
  ADD CONSTRAINT return_task_receipt_shape CHECK
    (return_state <> 'RETURNED'
     OR (received_by IS NOT NULL AND returned_package_count IS NOT NULL AND returned_at IS NOT NULL))
  NOT VALID;

-- The store closed, or would not take the goods back: a report of its own kind.
ALTER TABLE marketplace.partner_exception_events
  DROP CONSTRAINT partner_exception_kind_allowed,
  ADD CONSTRAINT partner_exception_kind_allowed CHECK (exception_kind IN
    ('VENDOR_DELAY','MISSING_PACKAGE','DAMAGED_PACKAGE','UNREACHABLE_CUSTOMER',
     'WRONG_ADDRESS','UNSAFE_LOCATION','ACCIDENT','MEDICAL_EMERGENCY',
     'THREAT','VEHICLE_FAILURE','PROHIBITED_GOODS','PROOF_SYNC_FAILED','RETURN_REFUSED'));
