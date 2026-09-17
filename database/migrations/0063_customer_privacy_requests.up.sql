CREATE TABLE marketplace.customer_privacy_requests (
  customer_privacy_request_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  request_kind text NOT NULL CHECK (request_kind IN ('DATA_EXPORT','ACCOUNT_DELETION')),
  lifecycle_state text NOT NULL DEFAULT 'REQUESTED'
    CHECK (lifecycle_state IN ('REQUESTED','PROCESSING','READY','COMPLETED','CANCELLED','FAILED')),
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  export_expires_at timestamptz,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX one_open_customer_privacy_request
  ON marketplace.customer_privacy_requests(user_id, request_kind)
  WHERE lifecycle_state IN ('REQUESTED','PROCESSING','READY');

INSERT INTO marketplace.capabilities(capability_key,actor_kind,resource_rule,description)
VALUES ('customer.privacy.manage','CUSTOMER','ACCOUNT','Create and read personal privacy requests')
ON CONFLICT (capability_key) DO NOTHING;
INSERT INTO marketplace.role_capabilities(role_key,capability_key)
VALUES ('CUSTOMER','customer.privacy.manage')
ON CONFLICT DO NOTHING;
