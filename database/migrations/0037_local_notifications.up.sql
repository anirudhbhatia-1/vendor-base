CREATE TABLE marketplace.notification_intents (
  notification_intent_id uuid PRIMARY KEY,
  recipient_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  notification_kind text NOT NULL CHECK (notification_kind IN ('ORDER_STATUS','SECURITY','SUPPORT','OPERATIONS')),
  template_key text NOT NULL CHECK (template_key ~ '^[a-z][a-z0-9_.]{2,119}$'),
  template_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(template_payload)='object'),
  channels text[] NOT NULL CHECK (channels <@ ARRAY['IN_APP','PUSH','SMS']::text[] AND cardinality(channels)>0),
  delivery_state text NOT NULL DEFAULT 'PENDING' CHECK (delivery_state IN ('PENDING','DELIVERED','PARTIAL','FAILED')),
  provider_scenario text NOT NULL DEFAULT 'SUCCESS' CHECK (provider_scenario IN ('SUCCESS','TRANSIENT_FAILURE','PERMANENT_FAILURE')),
  source_kind text NOT NULL CHECK (source_kind ~ '^[a-z][a-z0-9_]{1,63}$'),
  source_id uuid NOT NULL,
  source_event_type text NOT NULL CHECK (source_event_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  deduplication_key text NOT NULL UNIQUE CHECK (length(deduplication_key) BETWEEN 8 AND 200),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX notification_intents_delivery ON marketplace.notification_intents(delivery_state,created_at,notification_intent_id) WHERE delivery_state='PENDING';

CREATE TABLE marketplace.notification_attempts (
  notification_attempt_id uuid PRIMARY KEY,
  notification_intent_id uuid NOT NULL REFERENCES marketplace.notification_intents(notification_intent_id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('IN_APP','PUSH','SMS')),
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 8),
  adapter_key text NOT NULL CHECK (adapter_key='LOCAL_FAKE'),
  delivery_state text NOT NULL CHECK (delivery_state IN ('DELIVERED','FAILED','SKIPPED')),
  provider_reference text,
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  attempted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(notification_intent_id,channel,attempt_number)
);

CREATE TABLE marketplace.in_app_notifications (
  in_app_notification_id uuid PRIMARY KEY,
  notification_intent_id uuid NOT NULL UNIQUE REFERENCES marketplace.notification_intents(notification_intent_id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES marketplace.users(user_id) ON DELETE RESTRICT,
  template_key text NOT NULL,
  template_payload jsonb NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX in_app_notifications_inbox ON marketplace.in_app_notifications(recipient_user_id,read_at,created_at DESC);

CREATE FUNCTION marketplace.protect_notification_attempts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'notification delivery history is append-only' USING ERRCODE='55000'; END;
$$;
CREATE TRIGGER notification_attempts_append_only BEFORE UPDATE OR DELETE ON marketplace.notification_attempts FOR EACH ROW EXECUTE FUNCTION marketplace.protect_notification_attempts();
