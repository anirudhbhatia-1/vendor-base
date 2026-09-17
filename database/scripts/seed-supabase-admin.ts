/**
 * Bootstrap the first admin against Supabase Auth.
 *
 * Reads:
 *   SUPABASE_URL                  Supabase project URL, e.g. https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     Service-role key (server-side only)
 *   SUPABASE_PRODUCTION_DATABASE_URL  Runtime marketplace DB URL (from prod .env)
 *   SUPABASE_PRODUCTION_RUNTIME_PASSWORD (optional — will be substituted into the URL if absent)
 *   ADMIN_EMAIL                   Required
 *   ADMIN_PASSWORD                Required (>= 8 chars)
 *
 * Creates:
 *   1. auth.users row via Supabase Admin API (email_confirmed=true)
 *   2. marketplace.users row
 *   3. marketplace.supabase_identities linking the two
 *   4. Admin role assignments (all global scope): SUPPORT_AGENT, CONFIG_APPROVER,
 *      CATALOGUE_MODERATOR, DELIVERY_OPERATOR, plus one side of each maker/checker
 *      pair. marketplace.role_separation_rules forbids holding both sides, so each
 *      pair defaults to the side the admin console's list and queue routes read
 *      through, and the other side is opt-in:
 *        FINANCE_ROLE=OPERATOR      -> FINANCE_OPERATOR      (default FINANCE_APPROVER)
 *        ONBOARDING_ROLE=REVIEWER   -> VENDOR_ONBOARDING_REVIEWER
 *                                      (default VENDOR_ONBOARDING_OPERATOR)
 *        PUBLICATION_ROLE=REVIEWER  -> VENDOR_PUBLICATION_REVIEWER
 *                                      (default VENDOR_PUBLICATION_OPERATOR)
 *      Routes behind the opposite side stay denied on purpose: separation of duty
 *      is the point, and a second account is how you exercise both halves.
 *
 * Idempotent: safe to re-run. Won't create duplicate auth users or role rows.
 *
 * Usage:
 *   ADMIN_EMAIL=admin@gmail.com ADMIN_PASSWORD=password \
 *     node --env-file=../infrastructure/supabase-production/.env \
 *     --import tsx database/scripts/seed-supabase-admin.ts
 */
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { createUuidV7, createRequestContext } from '@neighbourhood-store/domain-types';
import { loadProductionRuntimeDatabaseConfig } from '../src/config.js';

const supabaseUrl = process.env['SUPABASE_URL'];
const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const email = process.env['ADMIN_EMAIL'];
const password = process.env['ADMIN_PASSWORD'];
const financeRole =
  process.env['FINANCE_ROLE'] === 'OPERATOR' ? 'FINANCE_OPERATOR' : 'FINANCE_APPROVER';
// The console's GET /admin/vendor-onboarding/queue and GET /admin/vendor-publications
// read through the *manage* capabilities, which live on the operator side of each pair.
const onboardingRole =
  process.env['ONBOARDING_ROLE'] === 'REVIEWER'
    ? 'VENDOR_ONBOARDING_REVIEWER'
    : 'VENDOR_ONBOARDING_OPERATOR';
const publicationRole =
  process.env['PUBLICATION_ROLE'] === 'REVIEWER'
    ? 'VENDOR_PUBLICATION_REVIEWER'
    : 'VENDOR_PUBLICATION_OPERATOR';

if (!supabaseUrl) {
  console.error('SUPABASE_URL is required');
  process.exit(1);
}
if (!serviceRoleKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
if (!email) {
  console.error('ADMIN_EMAIL is required');
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error('ADMIN_PASSWORD must be at least 8 characters');
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1. Create the auth user (or look up the existing one on repeat runs).
console.log(`Ensuring Supabase auth user for ${email}...`);
let supabaseUserId: string;
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (created.error) {
  // If the user already exists, look them up via listUsers (pagination).
  if (
    typeof created.error.message === 'string' &&
    /already been registered|already exists/i.test(created.error.message)
  ) {
    let page = 1;
    let found: { id: string } | undefined;
    while (!found) {
      const list = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (list.error) {
        console.error('Failed to list Supabase users:', list.error.message);
        process.exit(1);
      }
      found = list.data.users.find((u) => u.email === email);
      if (!found && list.data.users.length < 200) break;
      page += 1;
    }
    if (!found) {
      console.error(`Could not resolve existing Supabase user for ${email}`);
      process.exit(1);
    }
    supabaseUserId = found.id;
    const updated = await admin.auth.admin.updateUserById(supabaseUserId, {
      email,
      password,
      email_confirm: true,
    });
    if (updated.error) {
      console.error('Failed to synchronize existing Supabase auth user:', updated.error.message);
      process.exit(1);
    }
    console.log(`Synchronized existing auth user ${supabaseUserId}`);
  } else {
    console.error('Failed to create Supabase auth user:', created.error.message);
    process.exit(1);
  }
} else {
  supabaseUserId = created.data.user.id;
  console.log(`Created auth user ${supabaseUserId}`);
}

// 2. Marketplace DB — link the auth user + grant admin roles.
const runtimeConfig = loadProductionRuntimeDatabaseConfig();
const client = new Client({ connectionString: runtimeConfig.connectionString });
await client.connect();

const context = createRequestContext();
const requestId = context.request_id;
const correlationId = context.correlation_id;
const now = new Date();
const oneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000);

try {
  await client.query('BEGIN');

  const existingLink = await client.query<{ user_id: string }>(
    'SELECT user_id FROM marketplace.supabase_identities WHERE supabase_user_id = $1',
    [supabaseUserId],
  );
  let userId: string;
  if (existingLink.rows[0]) {
    userId = existingLink.rows[0].user_id;
    console.log(`Existing marketplace user ${userId}`);
  } else {
    userId = createUuidV7({ now_ms: now.getTime() });
    await client.query(
      `INSERT INTO marketplace.users (user_id, retention_review_at, created_at, updated_at)
       VALUES ($1, $2, $3, $3)`,
      [userId, oneYear, now],
    );
    await client.query(
      `INSERT INTO marketplace.supabase_identities
         (supabase_user_id, user_id, email, retention_review_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)`,
      [supabaseUserId, userId, email, oneYear, now],
    );
    console.log(`Created marketplace user ${userId} linked to Supabase auth`);
  }

  // 3. Admin role assignments. CATALOGUE_MODERATOR and DELIVERY_OPERATOR carry no
  // separation rule; the other three are one side of a maker/checker pair each.
  const targetRoles = [
    'SUPPORT_AGENT',
    'CONFIG_APPROVER',
    'CATALOGUE_MODERATOR',
    'DELIVERY_OPERATOR',
    financeRole,
    onboardingRole,
    publicationRole,
  ] as const;
  for (const role of targetRoles) {
    const existing = await client.query<{ role_assignment_id: string }>(
      `SELECT role_assignment_id FROM marketplace.role_assignments
        WHERE user_id = $1 AND role_key = $2 AND state = 'ACTIVE'`,
      [userId, role],
    );
    if (existing.rows[0]) {
      console.log(`Role ${role} already granted (${existing.rows[0].role_assignment_id})`);
      continue;
    }
    const roleAssignmentId = createUuidV7({ now_ms: now.getTime() });
    await client.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, granted_by_user_id,
          request_id, correlation_id, retention_review_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $4, $4)`,
      [roleAssignmentId, userId, role, now, requestId, correlationId, oneYear],
    );
    await client.query(
      `INSERT INTO marketplace.admin_membership_scopes
         (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
       VALUES ($1, $2, $3, 'GLOBAL', NULL, $4)`,
      [createUuidV7({ now_ms: now.getTime() }), roleAssignmentId, userId, now],
    );
    await client.query(
      `INSERT INTO marketplace.access_membership_events
         (event_id, user_id, role_assignment_id, event_type, reason_code,
          request_id, correlation_id, occurred_at)
       VALUES ($1, $2, $3, 'ROLE_GRANTED', 'BOOTSTRAP_ADMIN', $4, $5, $6)`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        userId,
        roleAssignmentId,
        requestId,
        correlationId,
        now,
      ],
    );
    console.log(`Granted ${role}`);
  }

  await client.query('COMMIT');
  console.log('\nBootstrap complete. Sign in at any PWA /login page with:');
  console.log(`  Email:    ${email}`);
  console.log(`  Password: (the value you passed via ADMIN_PASSWORD)`);
  console.log(`  User id:  ${userId}`);
  console.log(`  Roles:    ${targetRoles.join(', ')} (all global)`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error('Bootstrap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end();
}
