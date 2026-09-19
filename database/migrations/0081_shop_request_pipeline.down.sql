DROP INDEX marketplace.customer_shop_requests_queue;
-- The ASCII-only name check is not recreated, for the reason 0062 gives:
-- names that were accepted since may not satisfy it.
ALTER TABLE marketplace.customer_shop_requests
  DROP CONSTRAINT IF EXISTS customer_shop_request_name_runtime_shape;
-- A request that was triaged or closed cannot keep that state without the
-- columns that justify it; it returns to the queue rather than being deleted.
UPDATE marketplace.customer_shop_requests
   SET lifecycle_state = 'OPEN', updated_at = clock_timestamp()
 WHERE lifecycle_state <> 'OPEN';
ALTER TABLE marketplace.customer_shop_requests
  DROP CONSTRAINT customer_shop_request_resolution_when_closed,
  DROP CONSTRAINT customer_shop_request_resolution_shape,
  DROP CONSTRAINT customer_shop_request_case_when_triaged,
  DROP CONSTRAINT customer_shop_request_handled_when_moved,
  DROP COLUMN resolution,
  DROP COLUMN onboarding_case_id,
  DROP COLUMN handled_by_user_id;
