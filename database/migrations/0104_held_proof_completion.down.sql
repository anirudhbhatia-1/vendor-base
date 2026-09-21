ALTER TABLE marketplace.partner_exception_events
  DROP CONSTRAINT partner_exception_kind_allowed,
  ADD CONSTRAINT partner_exception_kind_allowed CHECK (exception_kind IN
    ('VENDOR_DELAY','MISSING_PACKAGE','DAMAGED_PACKAGE','UNREACHABLE_CUSTOMER',
     'WRONG_ADDRESS','UNSAFE_LOCATION','ACCIDENT','MEDICAL_EMERGENCY',
     'THREAT','VEHICLE_FAILURE','PROHIBITED_GOODS'));

ALTER TABLE marketplace.partner_offline_proofs
  DROP CONSTRAINT partner_offline_proof_consumed_is_synced,
  DROP CONSTRAINT partner_offline_proof_consumed_shape,
  DROP COLUMN consumed_by_command_reference;
