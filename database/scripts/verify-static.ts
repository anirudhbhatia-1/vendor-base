import { readdir, readFile } from 'node:fs/promises';
import { loadDatabaseConfig, requireOnlineTestMigrationConfirmation } from '../src/config.js';
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
    ONLINE_TEST_DATABASE_URL: `postgresql://postgres:synthetic@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    ONLINE_TEST_SUPABASE_PROJECT_REF: projectRef,
    ONLINE_TEST_MIGRATION_CONFIRM: `apply-${projectRef}-online-test`,
  },
  () => {
    const online = loadDatabaseConfig('online-test');
    assert(online.target === 'online-test', 'Safe Supabase online-test target was rejected');
    requireOnlineTestMigrationConfirmation('online-test');
  },
);

withOnlineEnvironment(
  {
    ONLINE_TEST_DATABASE_URL:
      'postgresql://postgres:synthetic@database.example.com:5432/postgres?sslmode=require',
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
    ONLINE_TEST_DATABASE_URL: `postgresql://postgres:synthetic@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`,
    ONLINE_TEST_SUPABASE_PROJECT_REF: projectRef,
    ONLINE_TEST_MIGRATION_CONFIRM: undefined,
  },
  () => {
    let rejected = false;
    try {
      requireOnlineTestMigrationConfirmation('online-test');
    } catch {
      rejected = true;
    }
    assert(rejected, 'Remote migration confirmation was not required');
  },
);

writeEvent('database.static_controls.verified', {
  compose_services: 2,
  migration_pairs: upNames.length,
});
