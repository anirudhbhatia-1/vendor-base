import { readdir, readFile } from 'node:fs/promises';
import { loadDatabaseConfig, requireRemoteMigrationConfirmation } from '../src/config.js';
import { writeEvent } from '../src/output.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectConfigRejection(url: string): Promise<void> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  try {
    let rejected = false;
    try {
      loadDatabaseConfig('local');
    } catch {
      rejected = true;
    }
    assert(rejected, 'Unsafe database URL was accepted');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

function withOnlineEnvironment<T>(
  values: Record<string, string | undefined>,
  callback: () => T,
): T {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
}

const compose = await readFile(new URL('../../compose.yaml', import.meta.url), 'utf8');
assert(compose.includes('postgis/postgis:18-3.6@sha256:'), 'Compose image is not immutable');
assert(compose.includes("'127.0.0.1:5432:5432'"), 'Local database is not loopback-bound');
assert(compose.includes("'127.0.0.1:5433:5432'"), 'Test database is not loopback-bound');
assert(compose.includes('/var/lib/postgresql'), 'PostgreSQL 18 volume path is incorrect');
assert(compose.includes("profiles: ['test']"), 'Test database profile is missing');
assert(
  (compose.match(/test "\$\$\(cat \/proc\/1\/comm\)" = postgres/g) ?? []).length === 2,
  'Health checks can accept the temporary PostGIS initialization server',
);
assert(
  (compose.match(/platform: linux\/amd64/g) ?? []).length === 2,
  'PostGIS services must declare the image platform explicitly',
);
assert(!compose.includes('0.0.0.0'), 'Compose exposes a database on all interfaces');

const migrationFiles = (await readdir(new URL('../migrations/', import.meta.url))).sort();
const upNames = migrationFiles
  .filter((name) => name.endsWith('.up.sql'))
  .map((name) => name.replace('.up.sql', ''));
const downNames = migrationFiles
  .filter((name) => name.endsWith('.down.sql'))
  .map((name) => name.replace('.down.sql', ''));
assert(
  JSON.stringify(upNames) === JSON.stringify(downNames),
  'Migration up/down files are unpaired',
);
assert(
  JSON.stringify(upNames) ===
    JSON.stringify([
      '0000_baseline',
      '0001_idempotent_commands',
      '0002_aggregate_versions',
      '0003_transactional_messaging',
      '0004_durable_jobs',
      '0005_versioned_configuration',
      '0006_otp_identity',
      '0007_identity_sessions',
      '0008_identity_roles',
      '0009_identity_preferences',
      '0010_vendor_network',
      '0011_vendor_onboarding',
      '0012_vendor_publication',
      '0013_inventory_reservations',
      '0014_assignment_custody',
      '0015_money_lifecycle',
      '0016_catalogue_freshness_moderation',
      '0017_catalogue_products_and_imports',
      '0018_catalogue_substitutions',
      '0019_customer_addresses',
      '0020_customer_discovery_and_preferences',
      '0021_customer_cart',
      '0022_vendor_staff_settings',
      '0023_grouped_checkout',
      '0024_checkout_line_snapshots',
      '0025_checkout_resilience',
      '0026_vendor_fulfilment_and_pickup',
      '0027_partner_lifecycle_and_earnings',
      '0028_complete_money_lifecycle',
      '0029_durable_ledger_account_catalogue',
      '0030_admin_control_plane',
      '0031_admin_control_completion',
      '0032_discovery_search_index',
      '0033_locale_registry',
      '0034_partner_availability',
      '0035_partner_wait_policy',
      '0036_admin_access_provisioning',
      '0037_local_notifications',
      '0038_customer_decision_payment_adjustments',
      '0039_password_credentials',
      '0040_production_access_baseline',
      '0041_supabase_identities',
      '0042_supabase_sessions',
      '0043_admin_provisioning_commands',
      '0044_delivery_assignment_vendor_order',
      '0045_gated_capabilities',
      '0046_payment_method_selection',
      '0047_catalogue_image_serving',
      '0048_customer_locale_copy',
      '0049_lifecycle_state_labels',
      '0050_delivery_completion_otp',
      '0051_handoff_code_copy',
      '0052_partner_self_scoped_capabilities',
      '0053_pickup_otp_provenance',
      '0054_product_first_browsing_copy',
      '0055_vendor_order_delivery_completion',
      '0056_in_app_notification_channel_policy',
      '0057_ended_order_authorization_adjustments',
      '0058_financial_policy_configuration',
      '0059_admin_operational_controls',
      '0060_delivery_ratings',
      '0061_delivery_notification_copy',
      '0062_remove_synthetic_runtime_constraints',
      '0063_customer_privacy_requests',
      '0064_kernel_error_locale_keys',
      '0065_field_error_locale_keys',
      '0066_guard_error_contract',
      '0067_retention_classification_sweep',
      '0068_invitation_expiry',
      '0069_price_history_guard',
      '0070_role_assignment_single_active',
      '0071_worker_liveness',
      '0072_resource_already_exists_error',
      '0073_picking_incomplete_error',
      '0074_unprocessable_detail_errors',
      '0075_pickup_otp_partner_issuer',
      '0076_handover_error_codes',
      '0077_assignment_event_partner',
      '0078_partner_presence',
      '0079_fulfilment_method_unavailable',
      '0080_vendor_self_delivery',
      '0081_shop_request_pipeline',
      '0082_storefront_freshness_copy',
      '0083_cart_recovery',
      '0084_quote_content_binding',
      '0085_road_routing',
      '0086_payment_intake_outcomes',
      '0087_checkout_submission',
      '0088_checkout_decisions_and_answers',
      '0089_platform_system_user',
      '0090_configuration_read',
      '0091_vendor_onboarding_read',
    ]),
  'Unexpected reviewed migrations',
);

for (const filename of migrationFiles) {
  const sql = await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
  assert(
    !/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql),
    `${filename} contains transaction control`,
  );
}

const idempotencyMigration = await readFile(
  new URL('../migrations/0001_idempotent_commands.up.sql', import.meta.url),
  'utf8',
);
assert(
  idempotencyMigration.includes('UNIQUE INDEX unique_idempotent_command'),
  'Idempotent command uniqueness is missing',
);
assert(
  idempotencyMigration.includes("status = 'UNCERTAIN'") &&
    idempotencyMigration.includes('idempotency_uncertain_retention'),
  'Uncertain command retention controls are missing',
);

const aggregateMigration = await readFile(
  new URL('../migrations/0002_aggregate_versions.up.sql', import.meta.url),
  'utf8',
);
assert(
  aggregateMigration.includes('resulting_version = previous_version + 1') &&
    aggregateMigration.includes('aggregate_transitions_append_only'),
  'Aggregate version or append-only transition controls are missing',
);

const messagingMigration = await readFile(
  new URL('../migrations/0003_transactional_messaging.up.sql', import.meta.url),
  'utf8',
);
assert(
  messagingMigration.includes('DEFERRABLE INITIALLY DEFERRED') &&
    messagingMigration.includes('inbox_receipts_controlled_update') &&
    messagingMigration.includes('outbox_events_no_delete') &&
    messagingMigration.includes('outbox_recoveries_append_only'),
  'Transactional messaging schema controls are incomplete',
);

const jobsMigration = await readFile(
  new URL('../migrations/0004_durable_jobs.up.sql', import.meta.url),
  'utf8',
);
assert(
  jobsMigration.includes('job_attempts_controlled_update') &&
    jobsMigration.includes('scheduled_jobs_no_delete') &&
    jobsMigration.includes("'LEASE_EXPIRED'") &&
    jobsMigration.includes('job_recoveries_append_only'),
  'Durable job ownership, attempt, or recovery controls are incomplete',
);

const configurationMigration = await readFile(
  new URL('../migrations/0005_versioned_configuration.up.sql', import.meta.url),
  'utf8',
);
assert(
  configurationMigration.includes('one_active_configuration_per_scope') &&
    configurationMigration.includes('one_scheduled_configuration_per_scope') &&
    configurationMigration.includes('configuration_maker_checker') &&
    configurationMigration.includes('configuration_version_controlled_lifecycle') &&
    configurationMigration.includes('business_configuration_snapshots_append_only'),
  'Versioned configuration lifecycle, overlap, or snapshot controls are incomplete',
);

const otpMigration = await readFile(
  new URL('../migrations/0006_otp_identity.up.sql', import.meta.url),
  'utf8',
);
assert(
  otpMigration.includes('otp_request_identity') &&
    otpMigration.includes('otp_challenges_phone_rate') &&
    otpMigration.includes('otp_protected_test_outbox') &&
    otpMigration.includes('otp_provider_events') &&
    otpMigration.includes('otp_verification_attempts_append_only') &&
    !otpMigration.includes('phone_identifier'),
  'OTP hashing, abuse-control, protected-outbox, or callback controls are incomplete',
);

const sessionMigration = await readFile(
  new URL('../migrations/0007_identity_sessions.up.sql', import.meta.url),
  'utf8',
);
assert(
  sessionMigration.includes('one_active_refresh_token_per_session') &&
    sessionMigration.includes('session_events_append_only') &&
    sessionMigration.includes('session_revocation_shape') &&
    sessionMigration.includes('notification_token_hash') &&
    !sessionMigration.includes('access_token text') &&
    !sessionMigration.includes('refresh_token text'),
  'Session hashing, rotation, replay, device, or append-only controls are incomplete',
);

const accessMigration = await readFile(
  new URL('../migrations/0008_identity_roles.up.sql', import.meta.url),
  'utf8',
);
assert(
  accessMigration.includes('role_capabilities') &&
    accessMigration.includes('staff_memberships') &&
    accessMigration.includes('partner_eligibilities') &&
    accessMigration.includes('one_active_assignment_per_partner') &&
    accessMigration.includes('admin_membership_scopes') &&
    accessMigration.includes('role_separation_rules') &&
    accessMigration.includes('role_assignment_separation') &&
    accessMigration.includes('access_membership_events_append_only'),
  'Role, capability, scoped membership, separation, or event controls are incomplete',
);
const accessService = await readFile(new URL('../src/identity-access.ts', import.meta.url), 'utf8');
assert(
  accessService.includes("reason: 'DENY_BY_DEFAULT'") &&
    !accessService.includes('defaultRole') &&
    !accessService.includes('default_role'),
  'Identity access does not preserve explicit default-deny behavior',
);

const preferenceMigration = await readFile(
  new URL('../migrations/0009_identity_preferences.up.sql', import.meta.url),
  'utf8',
);

const vendorNetworkMigration = await readFile(
  new URL('../migrations/0010_vendor_network.up.sql', import.meta.url),
  'utf8',
);
const vendorOnboardingMigration = await readFile(
  new URL('../migrations/0011_vendor_onboarding.up.sql', import.meta.url),
  'utf8',
);
const vendorPublicationMigration = await readFile(
  new URL('../migrations/0012_vendor_publication.up.sql', import.meta.url),
  'utf8',
);
const inventoryReservationMigration = await readFile(
  new URL('../migrations/0013_inventory_reservations.up.sql', import.meta.url),
  'utf8',
);
const assignmentCustodyMigration = await readFile(
  new URL('../migrations/0014_assignment_custody.up.sql', import.meta.url),
  'utf8',
);
const moneyLifecycleMigration = await readFile(
  new URL('../migrations/0015_money_lifecycle.up.sql', import.meta.url),
  'utf8',
);
assert(
  moneyLifecycleMigration.includes('ensure_ledger_transaction_balanced') &&
    moneyLifecycleMigration.includes('DEFERRABLE INITIALLY DEFERRED') &&
    moneyLifecycleMigration.includes('settlement_balance') &&
    moneyLifecycleMigration.includes('refund_maker_checker') &&
    moneyLifecycleMigration.includes('provider_statement_rows') &&
    moneyLifecycleMigration.includes('finance_exceptions') &&
    !moneyLifecycleMigration.includes('card_number') &&
    !moneyLifecycleMigration.includes('upi_id'),
  'Money balance, approval, reconciliation, exception, or data-minimization controls are incomplete',
);
assert(
  assignmentCustodyMigration.includes('one_active_attempt_per_synthetic_order') &&
    assignmentCustodyMigration.includes('delivery_assignment_custody_shape') &&
    assignmentCustodyMigration.includes('assignment_events_append_only') &&
    assignmentCustodyMigration.includes('custody_events_append_only') &&
    assignmentCustodyMigration.includes('return_task_authorization_shape') &&
    assignmentCustodyMigration.includes('admin.delivery.assignment_manage'),
  'Assignment uniqueness, custody, return, append-only, or authorization controls are incomplete',
);
assert(
  inventoryReservationMigration.includes('inventory_reservations_expiry') &&
    inventoryReservationMigration.includes('inventory_events_append_only') &&
    inventoryReservationMigration.includes("quantity_basis IN ('COUNTED', 'VENDOR_CONFIRMS')") &&
    inventoryReservationMigration.includes('counted_stock_applied boolean NOT NULL') &&
    inventoryReservationMigration.includes('inventory_item_location_product_unique'),
  'Inventory atomicity, expiry, quantity-basis, or append-only controls are incomplete',
);
assert(
  vendorPublicationMigration.includes('vendor_publication_cases') &&
    vendorPublicationMigration.includes('vendor_publication_events_append_only') &&
    vendorPublicationMigration.includes('PUBLICATION_MAKER_CHECKER') &&
    vendorPublicationMigration.includes('readiness_snapshot jsonb') &&
    vendorPublicationMigration.includes('publication_maker_checker'),
  'Vendor publication readiness, maker-checker, or append-only evidence controls are incomplete',
);
assert(
  vendorOnboardingMigration.includes('vendor_onboarding_cases') &&
    vendorOnboardingMigration.includes('vendor_verification_documents') &&
    vendorOnboardingMigration.includes('vendor_document_reviews_append_only') &&
    vendorOnboardingMigration.includes('vendor_onboarding_events_append_only') &&
    vendorOnboardingMigration.includes('vendor_onboarding_appeals') &&
    vendorOnboardingMigration.includes('ONBOARDING_MAKER_CHECKER') &&
    vendorOnboardingMigration.includes(
      "data_classification text NOT NULL DEFAULT 'CONFIDENTIAL'",
    ) &&
    vendorOnboardingMigration.includes("scan_state = 'CLEAN'") &&
    !vendorOnboardingMigration.includes('bank_account'),
  'Vendor onboarding, document protection, appeal, maker-checker, or evidence controls are incomplete',
);
assert(
  vendorNetworkMigration.includes('geography(Point, 4326)') &&
    vendorNetworkMigration.includes('geography(MultiPolygon, 4326)') &&
    vendorNetworkMigration.includes('prevent_operating_hour_overlap') &&
    vendorNetworkMigration.includes('vendor_location_calendar_exceptions') &&
    vendorNetworkMigration.includes('vendor_location_temporary_closures') &&
    vendorNetworkMigration.includes('vendor_location_fulfilment_modes') &&
    vendorNetworkMigration.includes('staff_membership_vendor_location_fk') &&
    vendorNetworkMigration.includes('vendor_network_events_append_only') &&
    vendorNetworkMigration.includes("category = 'FRUIT_VEGETABLE'") &&
    vendorNetworkMigration.includes("currency = 'INR'"),
  'Vendor profile, PostGIS, schedule, fulfilment, isolation, or history controls are incomplete',
);
assert(
  preferenceMigration.includes('customer_profiles') &&
    preferenceMigration.includes('customer_profile_language_allowed') &&
    preferenceMigration.includes('consent_version_unique') &&
    preferenceMigration.includes('consents_append_only') &&
    preferenceMigration.includes('notification_channel_policies') &&
    preferenceMigration.includes('notification_preference_required_channel') &&
    preferenceMigration.includes('notification_preference_events_append_only') &&
    preferenceMigration.includes('retention_review_at') &&
    preferenceMigration.includes('HIGHLY_RESTRICTED'),
  'Profile, consent, language, notification, or retention controls are incomplete',
);

await expectConfigRejection(
  'postgresql://example:example@database.example.com:5432/neighbourhood_store_local',
);
await expectConfigRejection(
  'postgresql://example:example@127.0.0.1:5432/neighbourhood_store_production',
);

const projectRef = 'abcdefghijklmnopqrst';
withOnlineEnvironment(
  {
    ONLINE_TEST_DATABASE_URL: `postgresql://postgres:synthetic@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
    ONLINE_TEST_SUPABASE_PROJECT_REF: projectRef,
    ONLINE_TEST_MIGRATION_CONFIRM: `apply-${projectRef}-online-test`,
  },
  () => {
    const online = loadDatabaseConfig('online-test');
    assert(online.target === 'online-test', 'Safe Supabase online-test target was rejected');
    requireRemoteMigrationConfirmation('online-test');
  },
);

withOnlineEnvironment(
  {
    SUPABASE_PRODUCTION_MIGRATION_URL: `postgresql://postgres.${projectRef}:synthetic@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/run/secrets/supabase-ca.crt`,
    SUPABASE_PRODUCTION_PROJECT_REF: projectRef,
    SUPABASE_PRODUCTION_MIGRATION_CONFIRM: `apply-${projectRef}-supabase-production`,
  },
  () => {
    const production = loadDatabaseConfig('supabase-production');
    assert(
      production.target === 'supabase-production',
      'Safe Supabase production target was rejected',
    );
    requireRemoteMigrationConfirmation('supabase-production');
  },
);

withOnlineEnvironment(
  {
    SUPABASE_PRODUCTION_MIGRATION_URL: `postgresql://postgres.${projectRef}:synthetic@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    SUPABASE_PRODUCTION_PROJECT_REF: projectRef,
  },
  () => {
    let rejected = false;
    try {
      loadDatabaseConfig('supabase-production');
    } catch {
      rejected = true;
    }
    assert(rejected, 'Production connection without a Supabase CA path was accepted');
  },
);

withOnlineEnvironment(
  {
    ONLINE_TEST_DATABASE_URL:
      'postgresql://postgres:synthetic@database.example.com:5432/postgres?sslmode=verify-full',
    ONLINE_TEST_SUPABASE_PROJECT_REF: projectRef,
  },
  () => {
    let rejected = false;
    try {
      loadDatabaseConfig('online-test');
    } catch {
      rejected = true;
    }
    assert(rejected, 'Non-Supabase online-test host was accepted');
  },
);

withOnlineEnvironment(
  {
    ONLINE_TEST_DATABASE_URL: `postgresql://postgres:synthetic@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
    ONLINE_TEST_SUPABASE_PROJECT_REF: projectRef,
    ONLINE_TEST_MIGRATION_CONFIRM: undefined,
  },
  () => {
    let rejected = false;
    try {
      requireRemoteMigrationConfirmation('online-test');
    } catch {
      rejected = true;
    }
    assert(rejected, 'Remote migration confirmation was not required');
  },
);

withOnlineEnvironment(
  {
    SUPABASE_DATABASE_URL: `postgresql://postgres.${projectRef}:synthetic@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
    SUPABASE_PROJECT_REF: projectRef,
    SUPABASE_MIGRATION_CONFIRM: `apply-${projectRef}-supabase-dev`,
  },
  () => {
    const supabase = loadDatabaseConfig('supabase-dev');
    assert(supabase.target === 'supabase-dev', 'Safe Supabase development target was rejected');
    requireRemoteMigrationConfirmation('supabase-dev');
  },
);

withOnlineEnvironment(
  {
    SUPABASE_DATABASE_URL: `postgresql://postgres.${projectRef}:synthetic@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
    SUPABASE_PROJECT_REF: projectRef,
  },
  () => {
    const supabase = loadDatabaseConfig('supabase-dev');
    assert(
      new URL(supabase.connectionString).searchParams.get('sslmode') === 'require' &&
        new URL(supabase.connectionString).searchParams.get('uselibpqcompat') === 'true',
      'Supabase development URL did not normalize to encrypted libpq-compatible TLS',
    );
  },
);

withOnlineEnvironment(
  {
    SUPABASE_DATABASE_URL: `postgresql://postgres.${projectRef}:synthetic@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`,
    SUPABASE_PROJECT_REF: projectRef,
  },
  () => {
    let rejected = false;
    try {
      loadDatabaseConfig('supabase-dev');
    } catch {
      rejected = true;
    }
    assert(rejected, 'Transaction pooler was accepted for Supabase development migrations');
  },
);

/**
 * Drizzle schema drift control.
 *
 * `CLAUDE.md` names `database/schema.ts` the schema record of truth, but
 * nothing enforced it and nothing imports it — every service uses raw SQL
 * through `pg`. Unwatched, it fell 78 tables behind: whole domains (carts,
 * checkout, catalogue, payments, the ledger, vendor orders) were never
 * declared at all.
 *
 * This is a ratchet, not a clean bill of health. The existing debt is recorded
 * below and permitted; a table added by any *new* migration must be declared,
 * so the gap can only shrink. Removing a name from this list once its table is
 * declared is the intended way to pay the debt down.
 */
const UNDECLARED_TABLE_DEBT: ReadonlySet<string> = new Set([
  'cart_events',
  'cart_lines',
  'cart_vendor_groups',
  'carts',
  'catalogue_import_rows',
  'catalogue_imports',
  'catalogue_moderation_cases',
  'catalogue_moderation_events',
  'catalogue_prices',
  'catalogue_product_images',
  'catalogue_product_substitutions',
  'catalogue_product_variants',
  'catalogue_products',
  'checkout_events',
  'checkout_groups',
  'checkout_quote_blocked_groups',
  'checkout_quote_groups',
  'checkout_quote_lines',
  'checkout_quotes',
  'customer_address_events',
  'customer_addresses',
  'customer_discovery_events',
  'customer_favourite_stores',
  'customer_preferred_store',
  'customer_recent_searches',
  'customer_shop_requests',
  'finance_exceptions',
  'financial_correction_events',
  'financial_corrections',
  'gated_capabilities',
  'gated_capability_approvals',
  'in_app_notifications',
  'incident_controls',
  'ledger_accounts',
  'ledger_entries',
  'ledger_transactions',
  'locale_keys',
  'locale_translations',
  'notification_attempts',
  'notification_intents',
  'operational_audit_events',
  'partner_application_events',
  'partner_applications',
  'partner_availability',
  'partner_availability_events',
  'partner_dispute_cases',
  'partner_earnings_records',
  'partner_exception_events',
  'partner_offline_proofs',
  'partner_wait_earning_adjustments',
  'partner_wait_timer_events',
  'partner_wait_timers',
  'payment_allocations',
  'payment_authorization_adjustments',
  'payment_events',
  'payment_transactions',
  'payout_batches',
  'payouts',
  'provider_statement_imports',
  'provider_statement_rows',
  'provider_webhook_receipts',
  'refund_events',
  'refunds',
  'report_exports',
  'settlement_lines',
  'settlements',
  'support_case_events',
  'support_case_evidence',
  'support_case_messages',
  'support_cases',
  'trust_restriction_cases',
  'vendor_order_customer_decisions',
  'vendor_order_events',
  'vendor_order_line_picks',
  'vendor_order_lines',
  'vendor_order_ratings',
  'vendor_orders',
  'vendor_staff_events',
]);

const migrationTables = new Set<string>();
for (const filename of migrationFiles) {
  const sql = await readFile(new URL(`../migrations/${filename}`, import.meta.url), 'utf8');
  for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?marketplace\.([a-z0-9_]+)/gi)) {
    migrationTables.add((match[1] as string).toLowerCase());
  }
  for (const match of sql.matchAll(/DROP TABLE (?:IF EXISTS )?marketplace\.([a-z0-9_]+)/gi)) {
    migrationTables.delete((match[1] as string).toLowerCase());
  }
}

const schemaSource = await readFile(new URL('../schema.ts', import.meta.url), 'utf8');
const declaredTables = new Set(
  [...schemaSource.matchAll(/marketplaceSchema\.table\(\s*'([a-z0-9_]+)'/g)].map(
    (match) => match[1] as string,
  ),
);

const undeclared = [...migrationTables].filter(
  (table) => !declaredTables.has(table) && !UNDECLARED_TABLE_DEBT.has(table),
);
assert(
  undeclared.length === 0,
  `Migrations create tables that database/schema.ts does not declare: ${undeclared.sort().join(', ')}. ` +
    'Add the Drizzle declaration alongside the migration (never `drizzle-kit push`).',
);

// A name left in the debt list after its table is declared would quietly keep
// the exemption alive for a table someone later removed from the schema.
const staleDebt = [...UNDECLARED_TABLE_DEBT].filter(
  (table) => declaredTables.has(table) || !migrationTables.has(table),
);
assert(
  staleDebt.length === 0,
  `These tables no longer need an exemption in UNDECLARED_TABLE_DEBT: ${staleDebt.sort().join(', ')}`,
);

writeEvent('database.static_controls.verified', {
  compose_services: 2,
  migration_pairs: upNames.length,
  schema_tables_declared: declaredTables.size,
  schema_tables_undeclared: UNDECLARED_TABLE_DEBT.size,
});
