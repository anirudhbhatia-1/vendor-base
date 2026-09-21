-- 9.7: a proof held offline completes the handover it was captured for.
--
-- Until audit run 62 an offline proof was a digest registered on the server
-- and later marked SYNCED -- and nothing else happened: the delivery it stood
-- for was never completed by it. Now the held completion (the customer's
-- code, captured at the door without signal) is replayed when signal returns,
-- and the proof row records which completion consumed it.

ALTER TABLE marketplace.partner_offline_proofs
  ADD COLUMN consumed_by_command_reference text,
  ADD CONSTRAINT partner_offline_proof_consumed_shape CHECK
    (consumed_by_command_reference IS NULL
     OR consumed_by_command_reference ~ '^SYNTH-CMD-[A-Z0-9-]{4,64}$'),
  -- A consumed proof is a synced one.
  ADD CONSTRAINT partner_offline_proof_consumed_is_synced CHECK
    (consumed_by_command_reference IS NULL OR sync_state = 'SYNCED');

-- A held proof the server refused is a report of its own kind (DLP-34): the
-- partner escalates it in one tap with the refusal as its reason, and
-- operations close the delivery with them.
ALTER TABLE marketplace.partner_exception_events
  DROP CONSTRAINT partner_exception_kind_allowed,
  ADD CONSTRAINT partner_exception_kind_allowed CHECK (exception_kind IN
    ('VENDOR_DELAY','MISSING_PACKAGE','DAMAGED_PACKAGE','UNREACHABLE_CUSTOMER',
     'WRONG_ADDRESS','UNSAFE_LOCATION','ACCIDENT','MEDICAL_EMERGENCY',
     'THREAT','VEHICLE_FAILURE','PROHIBITED_GOODS','PROOF_SYNC_FAILED'));
