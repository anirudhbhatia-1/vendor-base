-- Phase 6.4 requirement 4: a nearby-shop request is submitted "into the
-- admin/vendor pipeline". The request was stored with a lifecycle of
-- OPEN/TRIAGED/CLOSED, but nothing read it and nothing could move it, so
-- TRIAGED and CLOSED were unreachable. These columns record who handled a
-- request, the onboarding lead it became, and why it was closed.
ALTER TABLE marketplace.customer_shop_requests
  ADD COLUMN handled_by_user_id uuid REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  ADD COLUMN onboarding_case_id uuid
    REFERENCES marketplace.vendor_onboarding_cases (onboarding_case_id) ON DELETE RESTRICT,
  ADD COLUMN resolution text,
  ADD CONSTRAINT customer_shop_request_handled_when_moved
    CHECK ((lifecycle_state = 'OPEN') = (handled_by_user_id IS NULL)),
  ADD CONSTRAINT customer_shop_request_case_when_triaged
    CHECK (onboarding_case_id IS NULL OR lifecycle_state <> 'OPEN'),
  ADD CONSTRAINT customer_shop_request_resolution_shape
    CHECK (resolution IS NULL OR length(resolution) BETWEEN 1 AND 240),
  ADD CONSTRAINT customer_shop_request_resolution_when_closed
    CHECK ((lifecycle_state = 'CLOSED') = (resolution IS NOT NULL));

-- The queue an operator reads: open first, oldest first.
CREATE INDEX customer_shop_requests_queue
  ON marketplace.customer_shop_requests (lifecycle_state, created_at);

-- The name check admitted ASCII only, while the service accepts any letter:
-- a shop named in Hindi passed validation and failed the row insert as a
-- server fault. As 0062 did for the other runtime names, the database keeps a
-- length bound and the service keeps the character rules.
ALTER TABLE marketplace.customer_shop_requests
  DROP CONSTRAINT IF EXISTS customer_shop_request_name_shape,
  ADD CONSTRAINT customer_shop_request_name_runtime_shape
    CHECK (length(btrim(store_name)) BETWEEN 2 AND 120);
