import { releaseServicePool, resolveServicePool } from './database-pool.js';
import { createHmac } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { IdentityPasswordService } from './identity-password.js';
import { transaction } from './transaction.js';
import { grantRoleAssignment } from './role-grants.js';

/** The reason code every admin-provisioned grant and eligibility carries. */
const ADMIN_PROVISIONED_REASON = 'ADMIN_PROVISIONED';

const PHONE_PATTERN = /^(?:\+[1-9][0-9]{7,14}|SYNTH-PHONE-[A-Z0-9][A-Z0-9-]{2,47})$/;
const REASON_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;
const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_CATEGORY = 'FRUIT_VEGETABLE';
/**
 * The shop categories the network takes (vendor_location_category_allowed,
 * 0010): fruit and vegetables only, for the internal-test cohort (D-01).
 * Checked here so an unknown category is refused by name, not by the table.
 */
export const VENDOR_CATEGORIES = ['FRUIT_VEGETABLE'] as const;

function requireCategory(value: string | undefined): string {
  const category = value ?? DEFAULT_CATEGORY;
  if (!(VENDOR_CATEGORIES as readonly string[]).includes(category))
    throw new AdminOnboardingInputError(
      `category must be one of ${VENDOR_CATEGORIES.join(', ')}`,
      'category',
    );
  return category;
}
const DEFAULT_MIN_ORDER_MINOR = 5_000;
const ZONE_HALF_SIZE_DEGREES = 0.2;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

export class AdminOnboardingInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
  /** The request field the refusal is about, so the console can say which. */
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export class AdminOnboardingConflictError extends Error {
  readonly code = 'CONFLICT';
}

export class AdminOnboardingActiveObligationsError extends AdminOnboardingConflictError {
  readonly obligation_codes: readonly string[];

  constructor(codes: readonly string[]) {
    super('ACTIVE_OBLIGATIONS');
    this.name = 'AdminOnboardingActiveObligationsError';
    this.obligation_codes = Object.freeze([...codes]);
  }
}

export interface ProvisionVendorInput {
  readonly context: RequestContext;
  readonly actor_user_id: UuidV7;
  readonly phone_identifier: string;
  readonly business_name: string;
  readonly location_name: string;
  readonly profile_description?: string;
  readonly category?: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone?: string;
  readonly minimum_order_minor?: number;
  readonly fulfilment_modes?: readonly (
    'CUSTOMER_PICKUP' | 'PLATFORM_DELIVERY' | 'VENDOR_DELIVERY'
  )[];
  readonly password?: string;
  readonly now?: Date;
}

export interface ProvisionVendorResult {
  readonly user_id: UuidV7;
  readonly vendor_id: UuidV7;
  readonly vendor_location_id: UuidV7;
  readonly role_assignment_id: UuidV7;
  readonly password_set: boolean;
}

export interface ProvisionPartnerInput {
  readonly context: RequestContext;
  readonly actor_user_id: UuidV7;
  readonly phone_identifier: string;
  readonly display_name: string;
  readonly password?: string;
  readonly now?: Date;
}

export interface ProvisionPartnerResult {
  readonly user_id: UuidV7;
  readonly role_assignment_id: UuidV7;
  readonly password_set: boolean;
}

export interface ProvisionVendorFromSupabaseInput extends Omit<
  ProvisionVendorInput,
  'phone_identifier' | 'password'
> {
  readonly supabase_user_id: string;
  readonly email: string;
}

export interface ProvisionPartnerFromSupabaseInput extends Omit<
  ProvisionPartnerInput,
  'phone_identifier' | 'password'
> {
  readonly supabase_user_id: string;
  readonly email: string;
}

export interface AdminLifecycleInput {
  readonly actor_user_id: UuidV7;
  readonly context: RequestContext;
  readonly expected_version: number;
  readonly now?: Date;
  readonly reason_code: string;
}

export interface AdminVendorLifecycleInput extends AdminLifecycleInput {
  readonly vendor_id: UuidV7;
}

export interface AdminPartnerLifecycleInput extends AdminLifecycleInput {
  readonly user_id: UuidV7;
}

export interface AdminLifecycleResult {
  readonly lifecycle_state: 'ACTIVE' | 'ELIGIBLE' | 'SUSPENDED';
  readonly version: number;
}

function requirePhone(value: string): string {
  if (typeof value !== 'string') {
    throw new AdminOnboardingInputError(
      'Phone number must use international E.164 format',
      'phone_identifier',
    );
  }
  const trimmed = value.trim().toUpperCase();
  // Separators are stripped for E.164 only. Stripping them from a
  // `SYNTH-PHONE-…` identifier destroys the very form the pattern admits, so a
  // synthetic vendor or partner could never be provisioned by phone.
  const normalized = trimmed.startsWith('SYNTH-PHONE-')
    ? trimmed.replace(/[\s()]/g, '')
    : trimmed.replace(/[\s()-]/g, '');
  if (!PHONE_PATTERN.test(normalized)) {
    throw new AdminOnboardingInputError(
      'Phone number must use international E.164 format',
      'phone_identifier',
    );
  }
  return normalized;
}

function requireFiniteCoordinate(value: number, label: string, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new AdminOnboardingInputError(
      `${label} must be a finite number in [${min},${max}]`,
      label,
    );
  }
  return value;
}

function requireLabel(value: string, label: string, min = 2, max = 120): string {
  if (typeof value !== 'string')
    throw new AdminOnboardingInputError(`${label} must be a string`, label);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new AdminOnboardingInputError(`${label} length must be between ${min} and ${max}`, label);
  }
  return trimmed;
}

function digest(hashKey: string, value: string): string {
  return createHmac('sha256', hashKey).update(value).digest('hex');
}

async function upsertUserWithPhone(
  client: PoolClient,
  input: {
    readonly phone_lookup_hash: string;
    readonly now: Date;
  },
): Promise<UuidV7> {
  const existing = await client.query<{ user_id: string }>(
    'SELECT user_id FROM marketplace.phone_identities WHERE phone_lookup_hash = $1',
    [input.phone_lookup_hash],
  );
  if (existing.rows[0]) {
    const userId = parseUuidV7(existing.rows[0].user_id);
    const active = await client.query<{ active: boolean }>(
      "SELECT state = 'ACTIVE' AS active FROM marketplace.users WHERE user_id = $1",
      [userId],
    );
    if (!active.rows[0]?.active) {
      throw new AdminOnboardingConflictError('Existing account for this phone is disabled');
    }
    await client.query(
      'UPDATE marketplace.phone_identities SET verified_at = $2, updated_at = $2 WHERE phone_lookup_hash = $1',
      [input.phone_lookup_hash, input.now],
    );
    return userId;
  }
  const userId = createUuidV7({ now_ms: input.now.getTime() });
  const retentionReviewAt = new Date(input.now.getTime() + ONE_YEAR_MS);
  await client.query(
    `INSERT INTO marketplace.users
       (user_id, retention_review_at, created_at, updated_at)
     VALUES ($1, $2, $3, $3)`,
    [userId, retentionReviewAt, input.now],
  );
  await client.query(
    `INSERT INTO marketplace.phone_identities
       (phone_identity_id, user_id, phone_lookup_hash, retention_review_at,
        verified_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5, $5)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      userId,
      input.phone_lookup_hash,
      retentionReviewAt,
      input.now,
    ],
  );
  return userId;
}

async function upsertUserWithSupabase(
  client: PoolClient,
  input: {
    readonly supabase_user_id: string;
    readonly email: string;
    readonly now: Date;
  },
): Promise<UuidV7> {
  const existing = await client.query<{ user_id: string }>(
    'SELECT user_id FROM marketplace.supabase_identities WHERE supabase_user_id = $1',
    [input.supabase_user_id],
  );
  if (existing.rows[0]) {
    const userId = parseUuidV7(existing.rows[0].user_id);
    const active = await client.query<{ active: boolean }>(
      "SELECT state = 'ACTIVE' AS active FROM marketplace.users WHERE user_id = $1",
      [userId],
    );
    if (!active.rows[0]?.active) {
      throw new AdminOnboardingConflictError('Existing account for this email is disabled');
    }
    return userId;
  }
  const userId = createUuidV7({ now_ms: input.now.getTime() });
  const retentionReviewAt = new Date(input.now.getTime() + ONE_YEAR_MS);
  await client.query(
    `INSERT INTO marketplace.users
       (user_id, retention_review_at, created_at, updated_at)
     VALUES ($1, $2, $3, $3)`,
    [userId, retentionReviewAt, input.now],
  );
  await client.query(
    `INSERT INTO marketplace.supabase_identities
       (supabase_user_id, user_id, email, retention_review_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [input.supabase_user_id, userId, input.email, retentionReviewAt, input.now],
  );
  return userId;
}

async function insertRoleAssignment(
  client: PoolClient,
  input: {
    readonly role_key: string;
    readonly user_id: UuidV7;
    readonly granted_by_user_id: UuidV7;
    readonly now: Date;
    readonly request_id: string;
    readonly correlation_id: string;
  },
): Promise<UuidV7> {
  return grantRoleAssignment(client, { ...input, reason_code: ADMIN_PROVISIONED_REASON });
}

/**
 * The eligibility an admin-provisioned partner starts with, and the access
 * event that records it. Written twice before, once per identity source.
 */
async function provisionPartnerEligibility(
  client: PoolClient,
  input: {
    readonly role_assignment_id: UuidV7;
    readonly user_id: UuidV7;
    readonly now: Date;
    readonly request_id: string;
    readonly correlation_id: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO marketplace.partner_eligibilities
       (partner_eligibility_id, role_assignment_id, user_id, state, eligible_from,
        reason_code, updated_at)
     VALUES ($1, $2, $3, 'ELIGIBLE', $4, '${ADMIN_PROVISIONED_REASON}', $4)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.role_assignment_id,
      input.user_id,
      input.now,
    ],
  );
  await client.query(
    `INSERT INTO marketplace.access_membership_events
       (event_id, user_id, role_assignment_id, event_type, reason_code,
        request_id, correlation_id, occurred_at)
     VALUES ($1, $2, $3, 'PARTNER_ELIGIBILITY_CHANGED', '${ADMIN_PROVISIONED_REASON}', $4, $5, $6)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.user_id,
      input.role_assignment_id,
      input.request_id,
      input.correlation_id,
      input.now,
    ],
  );
}

function requireExpectedVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new AdminOnboardingInputError('expected_version must be a positive integer');
  }
  return value;
}

function requireReason(value: string): string {
  if (!REASON_PATTERN.test(value)) {
    throw new AdminOnboardingInputError('reason_code is invalid');
  }
  return value;
}

async function revokeUserAccess(
  client: PoolClient,
  input: {
    readonly correlation_id: string;
    readonly now: Date;
    readonly reason_code: string;
    readonly request_id: string;
    readonly user_id: UuidV7;
  },
): Promise<void> {
  const roles = await client.query<{ role_assignment_id: string }>(
    `UPDATE marketplace.role_assignments
        SET state='REVOKED', revoked_at=$2, revoke_reason=$3, updated_at=$2
      WHERE user_id=$1 AND state='ACTIVE'
      RETURNING role_assignment_id`,
    [input.user_id, input.now, input.reason_code],
  );
  for (const role of roles.rows) {
    await client.query(
      `INSERT INTO marketplace.access_membership_events
         (event_id,user_id,role_assignment_id,event_type,reason_code,request_id,correlation_id,occurred_at)
       VALUES ($1,$2,$3,'ROLE_REVOKED',$4,$5,$6,$7)`,
      [
        createUuidV7({ now_ms: input.now.getTime() }),
        input.user_id,
        role.role_assignment_id,
        input.reason_code,
        input.request_id,
        input.correlation_id,
        input.now,
      ],
    );
  }
  const sessions = await client.query<{ session_id: string; version: number }>(
    `SELECT session_id,version FROM marketplace.sessions
      WHERE user_id=$1 AND state='ACTIVE' FOR UPDATE`,
    [input.user_id],
  );
  for (const session of sessions.rows) {
    const version = session.version + 1;
    await client.query(
      `UPDATE marketplace.sessions
          SET state='REVOKED',version=$2,revoked_at=$3,revoke_reason='ACCOUNT_SUSPENDED',updated_at=$3
        WHERE session_id=$1`,
      [session.session_id, version, input.now],
    );
    await client.query(
      `UPDATE marketplace.session_refresh_tokens SET status='REVOKED',revoked_at=$2
        WHERE session_id=$1 AND status='ACTIVE'`,
      [session.session_id, input.now],
    );
    await client.query(
      `INSERT INTO marketplace.session_events
         (event_id,session_id,session_version,event_type,request_id,correlation_id,occurred_at)
       VALUES ($1,$2,$3,'REVOKED',$4,$5,$6)`,
      [
        createUuidV7({ now_ms: input.now.getTime() }),
        session.session_id,
        version,
        input.request_id,
        input.correlation_id,
        input.now,
      ],
    );
  }
  await client.query(
    `UPDATE marketplace.devices
        SET notification_token_hash=NULL,notification_state='REVOKED',updated_at=$2
      WHERE user_id=$1`,
    [input.user_id, input.now],
  );
  await client.query(
    `UPDATE marketplace.users SET state='DISABLED',updated_at=$2 WHERE user_id=$1`,
    [input.user_id, input.now],
  );
}

async function recordLifecycleTransition(
  client: PoolClient,
  input: {
    readonly actor_id: UuidV7;
    readonly aggregate_id: UuidV7;
    readonly aggregate_type: 'partner_account' | 'vendor';
    readonly correlation_id: string;
    readonly event_type: string;
    readonly from_state: string;
    readonly now: Date;
    readonly reason_code: string;
    readonly request_id: string;
    readonly resulting_version: number;
    readonly to_state: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO marketplace.aggregate_heads
       (aggregate_type,aggregate_id,version,state,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$5)
     ON CONFLICT (aggregate_type,aggregate_id) DO NOTHING`,
    [
      input.aggregate_type,
      input.aggregate_id,
      input.resulting_version - 1,
      input.from_state,
      input.now,
    ],
  );
  const advanced = await client.query(
    `UPDATE marketplace.aggregate_heads SET version=$3,state=$4,updated_at=$5
      WHERE aggregate_type=$1 AND aggregate_id=$2 AND version=($3::integer - 1)`,
    [input.aggregate_type, input.aggregate_id, input.resulting_version, input.to_state, input.now],
  );
  if (advanced.rowCount !== 1) {
    throw new AdminOnboardingConflictError('Lifecycle aggregate version is stale');
  }
  await client.query(
    `INSERT INTO marketplace.aggregate_transitions
       (transition_id,aggregate_type,aggregate_id,previous_version,resulting_version,
        from_state,to_state,actor_id,actor_kind,reason_code,evidence,request_id,correlation_id,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'admin',$9,'{}'::jsonb,$10,$11,$12)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.aggregate_type,
      input.aggregate_id,
      input.resulting_version - 1,
      input.resulting_version,
      input.from_state,
      input.to_state,
      input.actor_id,
      input.reason_code,
      input.request_id,
      input.correlation_id,
      input.now,
    ],
  );
  await client.query(
    `INSERT INTO marketplace.outbox_events
       (event_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,
        request_id,correlation_id,max_attempts,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,8,$9,$9)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.aggregate_type,
      input.aggregate_id,
      input.resulting_version,
      input.event_type,
      JSON.stringify({ reason_code: input.reason_code }),
      input.request_id,
      input.correlation_id,
      input.now,
    ],
  );
}

export class AdminOnboardingService {
  readonly #pool: Pool;
  readonly #hashKey: string;
  readonly #passwords: IdentityPasswordService;

  constructor(input: {
    readonly connection_string: string;
    readonly pool?: Pool;
    readonly hash_key: string;
    readonly password_service: IdentityPasswordService;
  }) {
    if (input.hash_key.length < 32) {
      throw new AdminOnboardingInputError('Hash key must contain at least 32 characters');
    }
    this.#hashKey = input.hash_key;
    this.#passwords = input.password_service;
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-admin-onboarding',
      connectionTimeoutMillis: 5_000,
      max: 4,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }

  async close(): Promise<void> {
    await releaseServicePool(this.#pool);
  }

  async provisionVendor(input: ProvisionVendorInput): Promise<ProvisionVendorResult> {
    const phone = requirePhone(input.phone_identifier);
    const businessName = requireLabel(input.business_name, 'business_name');
    const locationName = requireLabel(input.location_name, 'location_name');
    const timezone = input.timezone ?? DEFAULT_TIMEZONE;
    const category = requireCategory(input.category);
    const latitude = requireFiniteCoordinate(input.latitude, 'latitude', -85, 85);
    const longitude = requireFiniteCoordinate(input.longitude, 'longitude', -180, 180);
    const minimumOrderMinor = input.minimum_order_minor ?? DEFAULT_MIN_ORDER_MINOR;
    if (!Number.isInteger(minimumOrderMinor) || minimumOrderMinor < 0) {
      throw new AdminOnboardingInputError(
        'minimum_order_minor must be a non-negative integer',
        'minimum_order_minor',
      );
    }
    const fulfilmentModes =
      input.fulfilment_modes && input.fulfilment_modes.length > 0
        ? input.fulfilment_modes
        : (['CUSTOMER_PICKUP', 'PLATFORM_DELIVERY'] as const);
    const now = input.now ?? new Date();
    const phoneHash = digest(this.#hashKey, `phone:${phone}`);
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const actor = parseUuidV7(input.actor_user_id);

    return transaction(this.#pool, async (client) => {
      const userId = await upsertUserWithPhone(client, { phone_lookup_hash: phoneHash, now });
      if (input.password) {
        await this.#passwords.setInitialPassword(
          {
            context: input.context,
            user_id: userId,
            actor_user_id: input.actor_user_id,
            password: input.password,
            reason_code: ADMIN_PROVISIONED_REASON,
            now,
          },
          client,
        );
      }

      // Prevent double-provision at the same phone → vendor scope.
      const existingRole = await client.query<{ role_assignment_id: string }>(
        `SELECT ra.role_assignment_id
           FROM marketplace.role_assignments ra
          WHERE ra.user_id = $1 AND ra.role_key = 'VENDOR_OWNER' AND ra.state = 'ACTIVE'`,
        [userId],
      );
      if (existingRole.rows[0]) {
        throw new AdminOnboardingConflictError('User already owns an active vendor');
      }

      const vendorId = createUuidV7({ now_ms: now.getTime() });
      const vendorLocationId = createUuidV7({ now_ms: now.getTime() });
      const retentionReviewAt = new Date(now.getTime() + ONE_YEAR_MS);
      await client.query(
        `INSERT INTO marketplace.vendors
           (vendor_id, business_name, profile_description, lifecycle_state, version,
            request_id, correlation_id, retention_review_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', 1, $4, $5, $6, $7, $7)`,
        [
          vendorId,
          businessName,
          input.profile_description ?? null,
          requestId,
          correlationId,
          retentionReviewAt,
          now,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.vendor_locations
           (vendor_location_id, vendor_id, location_name, profile_description,
            operating_timezone, coordinates, category, lifecycle_state, minimum_order_minor,
            currency, preparation_seconds, version, request_id, correlation_id,
            retention_review_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5,
                 ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
                 $8, 'ACTIVE', $9, 'INR', 1200, 1, $10, $11, $12, $13, $13)`,
        [
          vendorLocationId,
          vendorId,
          locationName,
          input.profile_description ?? null,
          timezone,
          longitude,
          latitude,
          category,
          minimumOrderMinor,
          requestId,
          correlationId,
          retentionReviewAt,
          now,
        ],
      );
      // Wide default service zone around the provided coordinates.
      const west = longitude - ZONE_HALF_SIZE_DEGREES;
      const east = longitude + ZONE_HALF_SIZE_DEGREES;
      const south = latitude - ZONE_HALF_SIZE_DEGREES;
      const north = latitude + ZONE_HALF_SIZE_DEGREES;
      const boundaryWkt = `MULTIPOLYGON(((${west} ${south}, ${east} ${south}, ${east} ${north}, ${west} ${north}, ${west} ${south})))`;
      await client.query(
        `INSERT INTO marketplace.vendor_service_zones
           (service_zone_id, vendor_location_id, zone_name, operating_timezone, boundary,
            lifecycle_state, version, request_id, correlation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4,
                 ST_SetSRID(ST_GeomFromText($5), 4326)::geography,
                 'ACTIVE', 1, $6, $7, $8, $8)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          vendorLocationId,
          `${locationName} service area`,
          timezone,
          boundaryWkt,
          requestId,
          correlationId,
          now,
        ],
      );
      for (let weekday = 0; weekday <= 6; weekday++) {
        await client.query(
          `INSERT INTO marketplace.vendor_location_operating_hours
             (operating_hour_id, vendor_location_id, weekday, opens_at, closes_at)
           VALUES ($1, $2, $3, '00:00:00', '23:59:00')`,
          [createUuidV7({ now_ms: now.getTime() }), vendorLocationId, weekday],
        );
      }
      for (const mode of fulfilmentModes) {
        await client.query(
          `INSERT INTO marketplace.vendor_location_fulfilment_modes
             (vendor_location_id, fulfilment_mode, approved_by_user_id, approved_at,
              request_id, correlation_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [vendorLocationId, mode, actor, now, requestId, correlationId],
        );
      }

      const onboardingCaseId = createUuidV7({ now_ms: now.getTime() });
      await client.query(
        `INSERT INTO marketplace.vendor_onboarding_cases
           (onboarding_case_id, entry_kind, lifecycle_state, applicant_user_id,
            created_by_user_id, vendor_id, vendor_location_id, proposed_business_name,
            proposed_location_name, proposed_operating_timezone,
            proposed_coordinates, proposed_category, proposed_minimum_order_minor,
            proposed_currency, proposed_preparation_seconds, current_reason_code,
            version, request_id, correlation_id, retention_review_at, approved_at,
            created_at, updated_at)
         VALUES ($1, 'LEAD', 'APPROVED', $2, $2, $3, $4, $5, $6, $7,
                 ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
                 $10, $11, 'INR', 1200, '${ADMIN_PROVISIONED_REASON}',
                 1, $12, $13, $14, $15, $15, $15)`,
        [
          onboardingCaseId,
          actor,
          vendorId,
          vendorLocationId,
          businessName,
          locationName,
          timezone,
          longitude,
          latitude,
          category,
          minimumOrderMinor,
          requestId,
          correlationId,
          retentionReviewAt,
          now,
        ],
      );

      const publicationCaseId = createUuidV7({ now_ms: now.getTime() });
      await client.query(
        `INSERT INTO marketplace.vendor_publication_cases
           (publication_case_id, onboarding_case_id, vendor_id, vendor_location_id,
            lifecycle_state, proposed_by_user_id, approved_by_user_id, current_reason_code,
            current_note, version, request_id, correlation_id, approved_at, published_at,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'PUBLISHED', $5, $6, '${ADMIN_PROVISIONED_REASON}',
                 'Admin-provisioned publication', 1, $7, $8, $9, $9, $10, $10)`,
        [
          publicationCaseId,
          onboardingCaseId,
          vendorId,
          vendorLocationId,
          userId,
          actor,
          requestId,
          correlationId,
          now,
          now,
        ],
      );

      const roleAssignmentId = await insertRoleAssignment(client, {
        role_key: 'VENDOR_OWNER',
        user_id: userId,
        granted_by_user_id: actor,
        now,
        request_id: requestId,
        correlation_id: correlationId,
      });
      await client.query(
        `INSERT INTO marketplace.staff_memberships
           (staff_membership_id, role_assignment_id, user_id, vendor_location_id, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [createUuidV7({ now_ms: now.getTime() }), roleAssignmentId, userId, vendorLocationId, now],
      );

      return Object.freeze({
        user_id: userId,
        vendor_id: vendorId,
        vendor_location_id: vendorLocationId,
        role_assignment_id: roleAssignmentId,
        password_set: Boolean(input.password),
      });
    });
  }

  async provisionPartner(input: ProvisionPartnerInput): Promise<ProvisionPartnerResult> {
    const phone = requirePhone(input.phone_identifier);
    requireLabel(input.display_name, 'display_name');
    const now = input.now ?? new Date();
    const phoneHash = digest(this.#hashKey, `phone:${phone}`);
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const actor = parseUuidV7(input.actor_user_id);

    return transaction(this.#pool, async (client) => {
      const userId = await upsertUserWithPhone(client, { phone_lookup_hash: phoneHash, now });
      if (input.password) {
        await this.#passwords.setInitialPassword(
          {
            context: input.context,
            user_id: userId,
            actor_user_id: input.actor_user_id,
            password: input.password,
            reason_code: ADMIN_PROVISIONED_REASON,
            now,
          },
          client,
        );
      }

      const existingRole = await client.query<{ role_assignment_id: string }>(
        `SELECT role_assignment_id FROM marketplace.role_assignments
          WHERE user_id = $1 AND role_key = 'DELIVERY_PARTNER' AND state = 'ACTIVE'`,
        [userId],
      );
      if (existingRole.rows[0]) {
        throw new AdminOnboardingConflictError('User is already an active delivery partner');
      }

      const roleAssignmentId = await insertRoleAssignment(client, {
        role_key: 'DELIVERY_PARTNER',
        user_id: userId,
        granted_by_user_id: actor,
        now,
        request_id: requestId,
        correlation_id: correlationId,
      });
      await provisionPartnerEligibility(client, {
        role_assignment_id: roleAssignmentId,
        user_id: userId,
        now,
        request_id: requestId,
        correlation_id: correlationId,
      });

      return Object.freeze({
        user_id: userId,
        role_assignment_id: roleAssignmentId,
        password_set: Boolean(input.password),
      });
    });
  }

  /**
   * Provision a vendor whose identity is an existing Supabase auth user. The
   * caller (API layer) must have created the auth.users row via the Supabase
   * Admin API and passed the resulting supabase_user_id + email.
   */
  async provisionVendorFromSupabase(
    input: ProvisionVendorFromSupabaseInput,
  ): Promise<Omit<ProvisionVendorResult, 'password_set'>> {
    const businessName = requireLabel(input.business_name, 'business_name');
    const locationName = requireLabel(input.location_name, 'location_name');
    const timezone = input.timezone ?? DEFAULT_TIMEZONE;
    const category = requireCategory(input.category);
    const latitude = requireFiniteCoordinate(input.latitude, 'latitude', -85, 85);
    const longitude = requireFiniteCoordinate(input.longitude, 'longitude', -180, 180);
    const minimumOrderMinor = input.minimum_order_minor ?? DEFAULT_MIN_ORDER_MINOR;
    if (!Number.isInteger(minimumOrderMinor) || minimumOrderMinor < 0) {
      throw new AdminOnboardingInputError(
        'minimum_order_minor must be a non-negative integer',
        'minimum_order_minor',
      );
    }
    const fulfilmentModes =
      input.fulfilment_modes && input.fulfilment_modes.length > 0
        ? input.fulfilment_modes
        : (['CUSTOMER_PICKUP', 'PLATFORM_DELIVERY'] as const);
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const actor = parseUuidV7(input.actor_user_id);

    return transaction(this.#pool, async (client) => {
      const userId = await upsertUserWithSupabase(client, {
        supabase_user_id: input.supabase_user_id,
        email: input.email,
        now,
      });
      const existingRole = await client.query<{ role_assignment_id: string }>(
        `SELECT ra.role_assignment_id
           FROM marketplace.role_assignments ra
          WHERE ra.user_id = $1 AND ra.role_key = 'VENDOR_OWNER' AND ra.state = 'ACTIVE'`,
        [userId],
      );
      if (existingRole.rows[0]) {
        throw new AdminOnboardingConflictError('User already owns an active vendor');
      }

      const vendorId = createUuidV7({ now_ms: now.getTime() });
      const vendorLocationId = createUuidV7({ now_ms: now.getTime() });
      const retentionReviewAt = new Date(now.getTime() + ONE_YEAR_MS);
      await client.query(
        `INSERT INTO marketplace.vendors
           (vendor_id, business_name, profile_description, lifecycle_state, version,
            request_id, correlation_id, retention_review_at, created_at, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', 1, $4, $5, $6, $7, $7)`,
        [
          vendorId,
          businessName,
          input.profile_description ?? null,
          requestId,
          correlationId,
          retentionReviewAt,
          now,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.vendor_locations
           (vendor_location_id, vendor_id, location_name, profile_description,
            operating_timezone, coordinates, category, lifecycle_state, minimum_order_minor,
            currency, preparation_seconds, version, request_id, correlation_id,
            retention_review_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5,
                 ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
                 $8, 'ACTIVE', $9, 'INR', 1200, 1, $10, $11, $12, $13, $13)`,
        [
          vendorLocationId,
          vendorId,
          locationName,
          input.profile_description ?? null,
          timezone,
          longitude,
          latitude,
          category,
          minimumOrderMinor,
          requestId,
          correlationId,
          retentionReviewAt,
          now,
        ],
      );
      const west = longitude - ZONE_HALF_SIZE_DEGREES;
      const east = longitude + ZONE_HALF_SIZE_DEGREES;
      const south = latitude - ZONE_HALF_SIZE_DEGREES;
      const north = latitude + ZONE_HALF_SIZE_DEGREES;
      const boundaryWkt = `MULTIPOLYGON(((${west} ${south}, ${east} ${south}, ${east} ${north}, ${west} ${north}, ${west} ${south})))`;
      await client.query(
        `INSERT INTO marketplace.vendor_service_zones
           (service_zone_id, vendor_location_id, zone_name, operating_timezone, boundary,
            lifecycle_state, version, request_id, correlation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromText($5), 4326)::geography,
                 'ACTIVE', 1, $6, $7, $8, $8)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          vendorLocationId,
          `${locationName} service area`,
          timezone,
          boundaryWkt,
          requestId,
          correlationId,
          now,
        ],
      );
      for (let weekday = 0; weekday <= 6; weekday++) {
        await client.query(
          `INSERT INTO marketplace.vendor_location_operating_hours
             (operating_hour_id, vendor_location_id, weekday, opens_at, closes_at)
           VALUES ($1, $2, $3, '00:00:00', '23:59:00')`,
          [createUuidV7({ now_ms: now.getTime() }), vendorLocationId, weekday],
        );
      }
      for (const mode of fulfilmentModes) {
        await client.query(
          `INSERT INTO marketplace.vendor_location_fulfilment_modes
             (vendor_location_id, fulfilment_mode, approved_by_user_id, approved_at,
              request_id, correlation_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [vendorLocationId, mode, actor, now, requestId, correlationId],
        );
      }

      const onboardingCaseId = createUuidV7({ now_ms: now.getTime() });
      await client.query(
        `INSERT INTO marketplace.vendor_onboarding_cases
           (onboarding_case_id, entry_kind, lifecycle_state, applicant_user_id,
            created_by_user_id, vendor_id, vendor_location_id, proposed_business_name,
            proposed_location_name, proposed_operating_timezone,
            proposed_coordinates, proposed_category, proposed_minimum_order_minor,
            proposed_currency, proposed_preparation_seconds, current_reason_code,
            version, request_id, correlation_id, retention_review_at, approved_at,
            created_at, updated_at)
         VALUES ($1, 'LEAD', 'APPROVED', $2, $2, $3, $4, $5, $6, $7,
                 ST_SetSRID(ST_MakePoint($8, $9), 4326)::geography,
                 $10, $11, 'INR', 1200, '${ADMIN_PROVISIONED_REASON}',
                 1, $12, $13, $14, $15, $15, $15)`,
        [
          onboardingCaseId,
          actor,
          vendorId,
          vendorLocationId,
          businessName,
          locationName,
          timezone,
          longitude,
          latitude,
          category,
          minimumOrderMinor,
          requestId,
          correlationId,
          retentionReviewAt,
          now,
        ],
      );

      const publicationCaseId = createUuidV7({ now_ms: now.getTime() });
      await client.query(
        `INSERT INTO marketplace.vendor_publication_cases
           (publication_case_id, onboarding_case_id, vendor_id, vendor_location_id,
            lifecycle_state, proposed_by_user_id, approved_by_user_id, current_reason_code,
            current_note, version, request_id, correlation_id, approved_at, published_at,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'PUBLISHED', $5, $6, '${ADMIN_PROVISIONED_REASON}',
                 'Admin-provisioned publication', 1, $7, $8, $9, $9, $10, $10)`,
        [
          publicationCaseId,
          onboardingCaseId,
          vendorId,
          vendorLocationId,
          userId,
          actor,
          requestId,
          correlationId,
          now,
          now,
        ],
      );

      const roleAssignmentId = await insertRoleAssignment(client, {
        role_key: 'VENDOR_OWNER',
        user_id: userId,
        granted_by_user_id: actor,
        now,
        request_id: requestId,
        correlation_id: correlationId,
      });
      await client.query(
        `INSERT INTO marketplace.staff_memberships
           (staff_membership_id, role_assignment_id, user_id, vendor_location_id, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [createUuidV7({ now_ms: now.getTime() }), roleAssignmentId, userId, vendorLocationId, now],
      );

      return Object.freeze({
        user_id: userId,
        vendor_id: vendorId,
        vendor_location_id: vendorLocationId,
        role_assignment_id: roleAssignmentId,
      });
    });
  }

  async provisionPartnerFromSupabase(
    input: ProvisionPartnerFromSupabaseInput,
  ): Promise<Omit<ProvisionPartnerResult, 'password_set'>> {
    requireLabel(input.display_name, 'display_name');
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const actor = parseUuidV7(input.actor_user_id);

    return transaction(this.#pool, async (client) => {
      const userId = await upsertUserWithSupabase(client, {
        supabase_user_id: input.supabase_user_id,
        email: input.email,
        now,
      });
      const existingRole = await client.query<{ role_assignment_id: string }>(
        `SELECT role_assignment_id FROM marketplace.role_assignments
          WHERE user_id = $1 AND role_key = 'DELIVERY_PARTNER' AND state = 'ACTIVE'`,
        [userId],
      );
      if (existingRole.rows[0]) {
        throw new AdminOnboardingConflictError('User is already an active delivery partner');
      }
      const roleAssignmentId = await insertRoleAssignment(client, {
        role_key: 'DELIVERY_PARTNER',
        user_id: userId,
        granted_by_user_id: actor,
        now,
        request_id: requestId,
        correlation_id: correlationId,
      });
      await provisionPartnerEligibility(client, {
        role_assignment_id: roleAssignmentId,
        user_id: userId,
        now,
        request_id: requestId,
        correlation_id: correlationId,
      });
      return Object.freeze({
        user_id: userId,
        role_assignment_id: roleAssignmentId,
      });
    });
  }

  async suspendVendor(input: AdminVendorLifecycleInput): Promise<AdminLifecycleResult> {
    const vendorId = parseUuidV7(input.vendor_id);
    const actor = parseUuidV7(input.actor_user_id);
    const expectedVersion = requireExpectedVersion(input.expected_version);
    const reason = requireReason(input.reason_code);
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<{
        lifecycle_state: 'ACTIVE' | 'CLOSED' | 'DRAFT' | 'SUSPENDED';
        user_id: string;
        version: number;
      }>(
        `SELECT v.lifecycle_state,v.version,ra.user_id
           FROM marketplace.vendors v
           JOIN marketplace.vendor_locations vl USING (vendor_id)
           JOIN marketplace.staff_memberships sm USING (vendor_location_id)
           JOIN marketplace.role_assignments ra USING (role_assignment_id)
          WHERE v.vendor_id=$1 AND ra.role_key='VENDOR_OWNER'
          ORDER BY ra.created_at DESC LIMIT 1 FOR UPDATE OF v`,
        [vendorId],
      );
      const vendor = found.rows[0];
      if (!vendor) throw new AdminOnboardingInputError('Vendor was not found');
      if (vendor.version !== expectedVersion) {
        throw new AdminOnboardingConflictError('Vendor version is stale');
      }
      if (vendor.lifecycle_state === 'SUSPENDED') {
        return Object.freeze({ lifecycle_state: 'SUSPENDED' as const, version: vendor.version });
      }
      if (vendor.lifecycle_state !== 'ACTIVE') {
        throw new AdminOnboardingConflictError('Only an active vendor can be suspended');
      }
      const obligations = await client.query<{
        active_assignments: boolean;
        active_orders: boolean;
        active_reservations: boolean;
        unresolved_finance: boolean;
      }>(
        `SELECT
           EXISTS(SELECT 1 FROM marketplace.inventory_reservations r
             JOIN marketplace.vendor_locations l USING(vendor_location_id)
             WHERE l.vendor_id=$1 AND r.reservation_state IN ('SOFT_HELD','PROVISIONAL','COMMITTED')) AS active_reservations,
           EXISTS(SELECT 1 FROM marketplace.vendor_orders o
             JOIN marketplace.vendor_locations l USING(vendor_location_id)
             WHERE l.vendor_id=$1 AND o.lifecycle_state NOT IN
               ('PICKED_UP','DELIVERED','RETURNED','CANCELLED','EXPIRED')) AS active_orders,
           EXISTS(SELECT 1 FROM marketplace.delivery_assignments a
             JOIN marketplace.vendor_locations l USING(vendor_location_id)
             WHERE l.vendor_id=$1 AND a.assignment_state IN
               ('OFFERED','ASSIGNED','AT_VENDOR','PICKED_UP','EN_ROUTE_TO_CUSTOMER','ARRIVED',
                'DELIVERY_FAILED','RETURN_REQUIRED','RETURN_AUTHORIZED','RETURNING')) AS active_assignments,
           EXISTS(SELECT 1 FROM marketplace.settlements s
             JOIN marketplace.vendor_locations l USING(vendor_location_id)
             WHERE l.vendor_id=$1 AND s.settlement_state <> 'PAID')
           OR EXISTS(SELECT 1 FROM marketplace.refunds r
             JOIN marketplace.vendor_orders o ON o.order_reference=r.source_order_reference
             JOIN marketplace.vendor_locations l USING(vendor_location_id)
             WHERE l.vendor_id=$1 AND r.refund_state <> 'SUCCEEDED') AS unresolved_finance`,
        [vendorId],
      );
      const state = obligations.rows[0];
      const codes = [
        ...(state?.active_reservations ? ['ACTIVE_RESERVATIONS'] : []),
        ...(state?.active_orders ? ['ACTIVE_ORDERS'] : []),
        ...(state?.active_assignments ? ['ACTIVE_CUSTODY'] : []),
        ...(state?.unresolved_finance ? ['UNRESOLVED_FINANCE'] : []),
      ];
      if (codes.length) throw new AdminOnboardingActiveObligationsError(codes);
      const version = vendor.version + 1;
      await client.query(
        `UPDATE marketplace.vendors SET lifecycle_state='SUSPENDED',version=$2,updated_at=$3
          WHERE vendor_id=$1`,
        [vendorId, version, now],
      );
      await client.query(
        `UPDATE marketplace.vendor_locations
            SET lifecycle_state='PAUSED',version=version+1,updated_at=$2
          WHERE vendor_id=$1 AND lifecycle_state='ACTIVE'`,
        [vendorId, now],
      );
      const userId = parseUuidV7(vendor.user_id);
      await revokeUserAccess(client, {
        correlation_id: correlationId,
        now,
        reason_code: reason,
        request_id: requestId,
        user_id: userId,
      });
      await recordLifecycleTransition(client, {
        actor_id: actor,
        aggregate_id: vendorId,
        aggregate_type: 'vendor',
        correlation_id: correlationId,
        event_type: 'vendor.suspended',
        from_state: 'ACTIVE',
        now,
        reason_code: reason,
        request_id: requestId,
        resulting_version: version,
        to_state: 'SUSPENDED',
      });
      return Object.freeze({ lifecycle_state: 'SUSPENDED' as const, version });
    });
  }

  async reinstateVendor(input: AdminVendorLifecycleInput): Promise<AdminLifecycleResult> {
    const vendorId = parseUuidV7(input.vendor_id);
    const actor = parseUuidV7(input.actor_user_id);
    const expectedVersion = requireExpectedVersion(input.expected_version);
    const reason = requireReason(input.reason_code);
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<{
        lifecycle_state: string;
        user_id: string;
        version: number;
      }>(
        `SELECT v.lifecycle_state,v.version,ra.user_id
           FROM marketplace.vendors v
           JOIN marketplace.vendor_locations vl USING(vendor_id)
           JOIN marketplace.staff_memberships sm USING(vendor_location_id)
           JOIN marketplace.role_assignments ra USING(role_assignment_id)
          WHERE v.vendor_id=$1 AND ra.role_key='VENDOR_OWNER'
          ORDER BY ra.created_at DESC LIMIT 1 FOR UPDATE OF v`,
        [vendorId],
      );
      const vendor = found.rows[0];
      if (!vendor) throw new AdminOnboardingInputError('Vendor was not found');
      if (vendor.version !== expectedVersion)
        throw new AdminOnboardingConflictError('Vendor version is stale');
      if (vendor.lifecycle_state !== 'SUSPENDED') {
        throw new AdminOnboardingConflictError('Only a suspended vendor can be reinstated');
      }
      const userId = parseUuidV7(vendor.user_id);
      await client.query(
        `UPDATE marketplace.users SET state='ACTIVE',updated_at=$2 WHERE user_id=$1`,
        [userId, now],
      );
      const version = vendor.version + 1;
      await client.query(
        `UPDATE marketplace.vendors SET lifecycle_state='ACTIVE',version=$2,updated_at=$3 WHERE vendor_id=$1`,
        [vendorId, version, now],
      );
      const locations = await client.query<{ vendor_location_id: string }>(
        `UPDATE marketplace.vendor_locations SET lifecycle_state='ACTIVE',version=version+1,updated_at=$2
          WHERE vendor_id=$1 AND lifecycle_state='PAUSED' RETURNING vendor_location_id`,
        [vendorId, now],
      );
      for (const location of locations.rows) {
        const roleAssignmentId = await insertRoleAssignment(client, {
          correlation_id: correlationId,
          granted_by_user_id: actor,
          now,
          request_id: requestId,
          role_key: 'VENDOR_OWNER',
          user_id: userId,
        });
        await client.query(
          `INSERT INTO marketplace.staff_memberships
             (staff_membership_id,role_assignment_id,user_id,vendor_location_id,created_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            roleAssignmentId,
            userId,
            location.vendor_location_id,
            now,
          ],
        );
      }
      await recordLifecycleTransition(client, {
        actor_id: actor,
        aggregate_id: vendorId,
        aggregate_type: 'vendor',
        correlation_id: correlationId,
        event_type: 'vendor.reinstated',
        from_state: 'SUSPENDED',
        now,
        reason_code: reason,
        request_id: requestId,
        resulting_version: version,
        to_state: 'ACTIVE',
      });
      return Object.freeze({ lifecycle_state: 'ACTIVE' as const, version });
    });
  }

  async suspendPartner(input: AdminPartnerLifecycleInput): Promise<AdminLifecycleResult> {
    const userId = parseUuidV7(input.user_id);
    const actor = parseUuidV7(input.actor_user_id);
    const expectedVersion = requireExpectedVersion(input.expected_version);
    const reason = requireReason(input.reason_code);
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<{ state: string; version: number }>(
        `SELECT state,version FROM marketplace.partner_eligibilities WHERE user_id=$1 FOR UPDATE`,
        [userId],
      );
      const eligibility = found.rows[0];
      if (!eligibility) throw new AdminOnboardingInputError('Partner was not found');
      if (eligibility.version !== expectedVersion)
        throw new AdminOnboardingConflictError('Partner version is stale');
      if (eligibility.state === 'SUSPENDED') {
        return Object.freeze({
          lifecycle_state: 'SUSPENDED' as const,
          version: eligibility.version,
        });
      }
      if (eligibility.state !== 'ELIGIBLE')
        throw new AdminOnboardingConflictError('Only an eligible partner can be suspended');
      const obligations = await client.query<{
        active_assignment: boolean;
        unsettled_payout: boolean;
      }>(
        `SELECT
           EXISTS(SELECT 1 FROM marketplace.delivery_assignments
             WHERE partner_user_id=$1 AND assignment_state IN
               ('OFFERED','ASSIGNED','AT_VENDOR','PICKED_UP','EN_ROUTE_TO_CUSTOMER','ARRIVED',
                'DELIVERY_FAILED','RETURN_REQUIRED','RETURN_AUTHORIZED','RETURNING')) AS active_assignment,
           EXISTS(SELECT 1 FROM marketplace.settlements s JOIN marketplace.payouts p USING(settlement_id)
             WHERE s.partner_user_id=$1 AND p.payout_state <> 'PAID') AS unsettled_payout`,
        [userId],
      );
      const state = obligations.rows[0];
      const codes = [
        ...(state?.active_assignment ? ['ACTIVE_CUSTODY'] : []),
        ...(state?.unsettled_payout ? ['UNSETTLED_PAYOUT'] : []),
      ];
      if (codes.length) throw new AdminOnboardingActiveObligationsError(codes);
      const version = eligibility.version + 1;
      await client.query(
        `UPDATE marketplace.partner_eligibilities
            SET state='SUSPENDED',eligible_until=NULL,reason_code=$3,version=$4,updated_at=$2
          WHERE user_id=$1`,
        [userId, now, reason, version],
      );
      await revokeUserAccess(client, {
        correlation_id: correlationId,
        now,
        reason_code: reason,
        request_id: requestId,
        user_id: userId,
      });
      await recordLifecycleTransition(client, {
        actor_id: actor,
        aggregate_id: userId,
        aggregate_type: 'partner_account',
        correlation_id: correlationId,
        event_type: 'partner.suspended',
        from_state: 'ELIGIBLE',
        now,
        reason_code: reason,
        request_id: requestId,
        resulting_version: version,
        to_state: 'SUSPENDED',
      });
      return Object.freeze({ lifecycle_state: 'SUSPENDED' as const, version });
    });
  }

  async reinstatePartner(input: AdminPartnerLifecycleInput): Promise<AdminLifecycleResult> {
    const userId = parseUuidV7(input.user_id);
    const actor = parseUuidV7(input.actor_user_id);
    const expectedVersion = requireExpectedVersion(input.expected_version);
    const reason = requireReason(input.reason_code);
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<{ state: string; version: number }>(
        `SELECT state,version FROM marketplace.partner_eligibilities WHERE user_id=$1 FOR UPDATE`,
        [userId],
      );
      const eligibility = found.rows[0];
      if (!eligibility) throw new AdminOnboardingInputError('Partner was not found');
      if (eligibility.version !== expectedVersion)
        throw new AdminOnboardingConflictError('Partner version is stale');
      if (eligibility.state !== 'SUSPENDED')
        throw new AdminOnboardingConflictError('Only a suspended partner can be reinstated');
      await client.query(
        `UPDATE marketplace.users SET state='ACTIVE',updated_at=$2 WHERE user_id=$1`,
        [userId, now],
      );
      const roleAssignmentId = await insertRoleAssignment(client, {
        correlation_id: correlationId,
        granted_by_user_id: actor,
        now,
        request_id: requestId,
        role_key: 'DELIVERY_PARTNER',
        user_id: userId,
      });
      const version = eligibility.version + 1;
      await client.query(
        `UPDATE marketplace.partner_eligibilities
            SET role_assignment_id=$2,state='ELIGIBLE',eligible_from=$3,eligible_until=NULL,
                reason_code=$4,version=$5,updated_at=$3 WHERE user_id=$1`,
        [userId, roleAssignmentId, now, reason, version],
      );
      await client.query(
        `INSERT INTO marketplace.access_membership_events
           (event_id,user_id,role_assignment_id,event_type,reason_code,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,$3,'PARTNER_ELIGIBILITY_CHANGED',$4,$5,$6,$7)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          userId,
          roleAssignmentId,
          reason,
          requestId,
          correlationId,
          now,
        ],
      );
      await recordLifecycleTransition(client, {
        actor_id: actor,
        aggregate_id: userId,
        aggregate_type: 'partner_account',
        correlation_id: correlationId,
        event_type: 'partner.reinstated',
        from_state: 'SUSPENDED',
        now,
        reason_code: reason,
        request_id: requestId,
        resulting_version: version,
        to_state: 'ELIGIBLE',
      });
      return Object.freeze({ lifecycle_state: 'ELIGIBLE' as const, version });
    });
  }
}
