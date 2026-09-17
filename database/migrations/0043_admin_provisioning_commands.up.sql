CREATE TABLE marketplace.admin_provisioning_commands (
  command_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  command_scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash character(64) NOT NULL,
  resource_kind text NOT NULL,
  email text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  supabase_user_id uuid,
  result_body jsonb,
  error_code text,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT admin_provisioning_scope_shape CHECK
    (command_scope IN ('admin.onboarding.vendor.provision','admin.onboarding.partner.provision')),
  CONSTRAINT admin_provisioning_key_shape CHECK
    (idempotency_key ~ '^[A-Za-z0-9._~:-]{8,200}$'),
  CONSTRAINT admin_provisioning_hash_shape CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT admin_provisioning_resource_kind CHECK (resource_kind IN ('VENDOR','PARTNER')),
  CONSTRAINT admin_provisioning_email_shape CHECK
    (length(email) BETWEEN 3 AND 254 AND email LIKE '%@%'),
  CONSTRAINT admin_provisioning_state_allowed CHECK
    (state IN ('PENDING','AUTH_CREATED','COMPLETED','COMPENSATED','RECONCILIATION_REQUIRED')),
  CONSTRAINT admin_provisioning_result_shape CHECK
    ((state = 'COMPLETED' AND supabase_user_id IS NOT NULL AND result_body IS NOT NULL AND error_code IS NULL)
      OR (state = 'AUTH_CREATED' AND supabase_user_id IS NOT NULL AND result_body IS NULL AND error_code IS NULL)
      OR (state = 'PENDING' AND result_body IS NULL AND error_code IS NULL)
      OR (state IN ('COMPENSATED','RECONCILIATION_REQUIRED') AND result_body IS NULL AND error_code IS NOT NULL)),
  CONSTRAINT admin_provisioning_error_shape CHECK
    (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT admin_provisioning_unique UNIQUE (actor_user_id, command_scope, idempotency_key)
);

CREATE UNIQUE INDEX admin_provisioning_supabase_user_unique
  ON marketplace.admin_provisioning_commands(supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

CREATE INDEX admin_provisioning_reconciliation
  ON marketplace.admin_provisioning_commands(updated_at, command_id)
  WHERE state = 'RECONCILIATION_REQUIRED';

COMMENT ON TABLE marketplace.admin_provisioning_commands IS
  'Crash-recoverable coordination records for Supabase Auth plus marketplace provisioning; passwords are never persisted.';
