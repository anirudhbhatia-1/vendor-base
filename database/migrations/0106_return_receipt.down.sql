ALTER TABLE marketplace.partner_exception_events
  DROP CONSTRAINT partner_exception_kind_allowed,
  ADD CONSTRAINT partner_exception_kind_allowed CHECK (exception_kind IN
    ('VENDOR_DELAY','MISSING_PACKAGE','DAMAGED_PACKAGE','UNREACHABLE_CUSTOMER',
     'WRONG_ADDRESS','UNSAFE_LOCATION','ACCIDENT','MEDICAL_EMERGENCY',
     'THREAT','VEHICLE_FAILURE','PROHIBITED_GOODS','PROOF_SYNC_FAILED'));

ALTER TABLE marketplace.return_tasks
  DROP CONSTRAINT return_task_receipt_shape,
  DROP CONSTRAINT return_task_condition_shape,
  DROP CONSTRAINT return_task_returned_count,
  DROP CONSTRAINT return_task_received_by_shape,
  DROP CONSTRAINT return_task_destination_note_shape,
  DROP COLUMN returned_at,
  DROP COLUMN condition_note,
  DROP COLUMN returned_package_count,
  DROP COLUMN received_by,
  DROP COLUMN destination_note;
