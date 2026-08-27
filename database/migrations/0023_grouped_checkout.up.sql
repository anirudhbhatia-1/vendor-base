CREATE TABLE marketplace.checkout_quotes (
  checkout_quote_id uuid PRIMARY KEY,
  customer_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  cart_id uuid NOT NULL REFERENCES marketplace.carts (cart_id) ON DELETE RESTRICT,
  customer_address_id uuid NOT NULL REFERENCES marketplace.customer_addresses (customer_address_id) ON DELETE RESTRICT,
  quote_digest text NOT NULL UNIQUE CHECK (quote_digest ~ '^[a-f0-9]{64}$'),
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
  policy_version_reference text NOT NULL CHECK (policy_version_reference ~ '^SYNTH-POLICY-[A-Z0-9-]{4,64}$'),
  expires_at timestamptz NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle_state IN ('ACTIVE','EXPIRED','CONSUMED','INVALID')),
  request_id uuid NOT NULL, correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE marketplace.checkout_quote_groups (
  checkout_quote_group_id uuid PRIMARY KEY,
  checkout_quote_id uuid NOT NULL REFERENCES marketplace.checkout_quotes (checkout_quote_id) ON DELETE RESTRICT,
  cart_vendor_group_id uuid NOT NULL REFERENCES marketplace.cart_vendor_groups (cart_vendor_group_id) ON DELETE RESTRICT,
  vendor_location_id uuid NOT NULL REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  item_minor bigint NOT NULL CHECK (item_minor >= 0), delivery_minor bigint NOT NULL CHECK (delivery_minor >= 0), tip_minor bigint NOT NULL CHECK (tip_minor >= 0), total_minor bigint NOT NULL CHECK (total_minor > 0),
  reservation_reference text NOT NULL UNIQUE CHECK (reservation_reference ~ '^SYNTH-CHECKOUT-[A-Z0-9-]{4,64}$'),
  UNIQUE (checkout_quote_id, vendor_location_id)
);
CREATE TABLE marketplace.checkout_groups (
  checkout_group_id uuid PRIMARY KEY,
  checkout_reference text NOT NULL UNIQUE CHECK (checkout_reference ~ '^SYNTH-CHECKOUT-[A-Z0-9-]{4,64}$'),
  checkout_quote_id uuid NOT NULL UNIQUE REFERENCES marketplace.checkout_quotes (checkout_quote_id) ON DELETE RESTRICT,
  customer_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  payment_transaction_id uuid REFERENCES marketplace.payment_transactions (payment_transaction_id) ON DELETE RESTRICT,
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('PROCESSING','ACTIVE','PARTIALLY_CANCELLED','COMPLETED','CANCELLED','PAYMENT_UNKNOWN')),
  total_minor bigint NOT NULL CHECK (total_minor > 0), currency char(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'), version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_id uuid NOT NULL, correlation_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE marketplace.vendor_orders (
  vendor_order_id uuid PRIMARY KEY,
  order_reference text NOT NULL UNIQUE CHECK (order_reference ~ '^SYNTH-ORDER-[A-Z0-9-]{4,64}$'),
  checkout_group_id uuid NOT NULL REFERENCES marketplace.checkout_groups (checkout_group_id) ON DELETE RESTRICT,
  vendor_location_id uuid NOT NULL REFERENCES marketplace.vendor_locations (vendor_location_id) ON DELETE RESTRICT,
  lifecycle_state text NOT NULL DEFAULT 'PLACED' CHECK (lifecycle_state IN ('PLACED','ACCEPTED','CANCELLED','EXPIRED')),
  total_minor bigint NOT NULL CHECK (total_minor > 0), version integer NOT NULL DEFAULT 1 CHECK (version >= 1), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (checkout_group_id, vendor_location_id)
);
CREATE TABLE marketplace.provider_webhook_receipts (
  provider_receipt_id uuid PRIMARY KEY, provider_event_id text NOT NULL UNIQUE, provider_operation_reference text NOT NULL, payload_digest text NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'), received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO marketplace.capabilities (capability_key,actor_kind,resource_rule,description) VALUES ('customer.checkout.manage','CUSTOMER','ACCOUNT','Create local synthetic quotes and grouped checkout') ON CONFLICT DO NOTHING;
INSERT INTO marketplace.role_capabilities (role_key,capability_key) VALUES ('CUSTOMER','customer.checkout.manage') ON CONFLICT DO NOTHING;
