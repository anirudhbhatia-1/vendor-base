import { createHmac } from 'node:crypto';
import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { IdentityAccessService, type VendorRole } from './identity-access.js';
import { parsePhoneIdentifier } from './otp-identity.js';
import { transaction as tx } from './transaction.js';

export class VendorStaffInputError extends Error {}
export class VendorStaffNotFoundError extends Error {}
/**
 * Carries which kind of conflict it is.
 *
 * One class covered three unrelated situations -- a disabled account, an owner who
 * already owns the store, and a name that is taken -- and the API mapped all of
 * them to a bare 409, which clients render as "Refresh and try again". Refreshing
 * fixes none of them. The code travels with the error so the transport can say
 * something true.
 */
export class VendorStaffConflictError extends Error {
  readonly code: 'ORDER_STATE_CONFLICT' | 'RESOURCE_ALREADY_EXISTS';

  constructor(
    message: string,
    code: 'ORDER_STATE_CONFLICT' | 'RESOURCE_ALREADY_EXISTS' = 'ORDER_STATE_CONFLICT',
  ) {
    super(message);
    this.code = code;
  }
}
export class VendorStaffAuthorizationError extends Error {}

export type ManagedVendorRole = 'VENDOR_MANAGER' | 'VENDOR_PICKER';

export interface StaffMember {
  readonly user_id: UuidV7;
  readonly role: VendorRole;
  readonly granted_at: Date;
}

export interface MyAccess {
  readonly vendor_location_id: UuidV7;
  readonly role: VendorRole;
  readonly capabilities: readonly string[];
  /** So a staff list can say which row is you without a second lookup. */
  readonly user_id: UuidV7;
}

export interface LocationSettings {
  readonly vendor_location_id: UuidV7;
  readonly profile_description: string | null;
  readonly minimum_order_minor: number;
  readonly preparation_seconds: number;
  readonly version: number;
}

/**
 * A zone as the shopkeeper needs to see it.
 *
 * The console could add zones and deactivate one by id, but never list them —
 * so the only way to remove a zone was to already know a UUID the product
 * never displays. An area you cannot see is an area you cannot correct, and
 * these decide who can discover the store at all.
 */
export interface ServiceZoneSummary {
  readonly service_zone_id: UuidV7;
  readonly zone_name: string;
  readonly lifecycle_state: string;
  readonly area_square_metres: number;
  readonly created_at: Date;
}

export interface TemporaryClosureSummary {
  readonly temporary_closure_id: UuidV7;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly reason_code: string;
}

export interface ActivityEntry {
  readonly event_type: 'SETTINGS_UPDATED' | 'STAFF_INVITED' | 'STAFF_REVOKED';
  readonly actor_user_id: UuidV7;
  readonly target_user_id: UuidV7 | null;
  readonly reason_code: string;
  readonly occurred_at: Date;
}

const reasonCode = /^[A-Z][A-Z0-9_]{2,63}$/;
const managedRoles: ReadonlySet<ManagedVendorRole> = new Set(['VENDOR_MANAGER', 'VENDOR_PICKER']);

interface MembershipRow {
  readonly role_assignment_id: string;
  readonly role_key: VendorRole;
}

/**
 * Resolves the caller's own active membership at a vendor location. Every
 * write in this service is scoped by the returned role rather than by admin
 * override, so a manager can never act with owner-only authority and a
 * picker can never reach a settings route at all.
 */
async function requireMembership(
  client: PoolClient,
  context: RequestContext,
  vendorLocationId: UuidV7,
  allowed: readonly VendorRole[],
): Promise<{ readonly userId: UuidV7; readonly role: VendorRole }> {
  if (context.actor?.actor_kind !== 'vendor_staff') throw new VendorStaffAuthorizationError();
  const userId = context.actor.actor_id;
  const result = await client.query<MembershipRow>(
    `SELECT ra.role_assignment_id, ra.role_key
       FROM marketplace.role_assignments ra
       JOIN marketplace.staff_memberships sm USING (role_assignment_id)
      WHERE ra.user_id = $1 AND sm.vendor_location_id = $2 AND ra.state = 'ACTIVE'
        AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
      LIMIT 1`,
    [userId, vendorLocationId],
  );
  const row = result.rows[0];
  if (!row || !allowed.includes(row.role_key)) throw new VendorStaffAuthorizationError();
  return { userId, role: row.role_key };
}

async function recordActivity(
  client: PoolClient,
  input: {
    readonly vendor_location_id: UuidV7;
    readonly actor_user_id: UuidV7;
    readonly target_user_id?: UuidV7 | null;
    readonly event_type: ActivityEntry['event_type'];
    readonly reason_code: string;
    readonly ids: { readonly request: string; readonly correlation: string };
    readonly now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO marketplace.vendor_staff_events
       (event_id, vendor_location_id, actor_user_id, target_user_id, event_type, reason_code,
        request_id, correlation_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.vendor_location_id,
      input.actor_user_id,
      input.target_user_id ?? null,
      input.event_type,
      input.reason_code,
      input.ids.request,
      input.ids.correlation,
      input.now,
    ],
  );
}

export class VendorStaffService {
  readonly #pool: Pool;
  readonly #access: IdentityAccessService;
  readonly #hashKey: string;

  constructor(input: {
    readonly connection_string: string;
    readonly access: IdentityAccessService;
    readonly hash_key: string;
  }) {
    if (!input.hash_key) throw new Error('VendorStaffService requires a hash key');
    this.#pool = createDatabasePool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-vendor-staff',
      max: 8,
    });
    this.#access = input.access;
    this.#hashKey = input.hash_key;
  }

  /**
   * Turns what an owner actually knows — a phone number — into a user id.
   *
   * Requiring the invitee's UUID made this route unusable: nothing in the
   * product ever shows one person another person's internal id, so every
   * invitation a shopkeeper could physically type was rejected as malformed.
   *
   * Resolution only, never creation. An owner must not be able to bring an
   * account into existence for an arbitrary number; the invitee signs in once
   * themselves first. That this reveals whether a number has an account is
   * accepted deliberately: the route is owner-only for one location and every
   * call is written to `vendor_staff_events`.
   */
  async #resolveInviteeByPhone(client: PoolClient, phone: string): Promise<UuidV7> {
    const lookupHash = createHmac('sha256', this.#hashKey)
      .update(`phone:${parsePhoneIdentifier(phone)}`)
      .digest('hex');
    const found = await client.query<{ user_id: string; active: boolean }>(
      `SELECT pi.user_id, u.state = 'ACTIVE' AS active
         FROM marketplace.phone_identities pi
         JOIN marketplace.users u USING (user_id)
        WHERE pi.phone_lookup_hash = $1`,
      [lookupHash],
    );
    const row = found.rows[0];
    if (!row) {
      throw new VendorStaffNotFoundError(
        'No account uses that number yet. Ask them to sign in to the app once, then invite them.',
      );
    }
    if (!row.active) throw new VendorStaffConflictError('That account is disabled');
    return parseUuidV7(row.user_id);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  /**
   * Owner-only. A location's owner is established when its onboarding case is
   * approved, not by another owner's invite, so this only grants manager or
   * picker — inviting a second owner is out of scope for this slice.
   */
  async inviteStaff(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    /** Either the invitee's phone identifier or, for system callers, their id. */
    readonly invitee_phone?: string;
    readonly invitee_user_id?: UuidV7;
    readonly role: ManagedVendorRole;
    readonly now?: Date;
  }): Promise<{ readonly invitee_user_id: UuidV7 }> {
    if (!managedRoles.has(input.role))
      throw new VendorStaffInputError('Only manager or picker may be invited');
    if (!input.invitee_phone && !input.invitee_user_id)
      throw new VendorStaffInputError('An invitation needs the invitee phone number');
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };
    return tx(this.#pool, async (client) => {
      const { userId: ownerId } = await requireMembership(
        client,
        input.context,
        input.vendor_location_id,
        ['VENDOR_OWNER'],
      );
      const inviteeUserId =
        input.invitee_user_id ??
        (await this.#resolveInviteeByPhone(client, input.invitee_phone as string));
      if (inviteeUserId === ownerId)
        throw new VendorStaffConflictError('You already own this store', 'RESOURCE_ALREADY_EXISTS');
      await this.#access.grantVendorMembership({
        context: input.context,
        granted_by_user_id: ownerId,
        role: input.role,
        user_id: inviteeUserId,
        vendor_location_id: input.vendor_location_id,
        now,
      });
      await recordActivity(client, {
        vendor_location_id: input.vendor_location_id,
        actor_user_id: ownerId,
        target_user_id: inviteeUserId,
        event_type: 'STAFF_INVITED',
        reason_code: `${input.role}_INVITED`,
        ids,
        now,
      });
      return Object.freeze({ invitee_user_id: inviteeUserId });
    });
  }

  /** Owner-only. The owner role itself is never revocable through this route. */
  async revokeStaff(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly target_user_id: UuidV7;
    readonly role: ManagedVendorRole;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<void> {
    if (!managedRoles.has(input.role))
      throw new VendorStaffInputError('Only manager or picker may be revoked here');
    if (!reasonCode.test(input.reason_code))
      throw new VendorStaffInputError('Reason code must be shouting-snake-case');
    const now = input.now ?? new Date();
    await tx(this.#pool, async (client) => {
      const { userId: ownerId } = await requireMembership(
        client,
        input.context,
        input.vendor_location_id,
        ['VENDOR_OWNER'],
      );
      const target = await client.query<{ role_assignment_id: string }>(
        `SELECT ra.role_assignment_id
           FROM marketplace.role_assignments ra
           JOIN marketplace.staff_memberships sm USING (role_assignment_id)
          WHERE ra.user_id = $1 AND sm.vendor_location_id = $2 AND ra.role_key = $3
            AND ra.state = 'ACTIVE'`,
        [input.target_user_id, input.vendor_location_id, input.role],
      );
      const row = target.rows[0];
      if (!row) throw new VendorStaffNotFoundError('Active membership was not found');
      await this.#access.revokeRole({
        context: input.context,
        role_assignment_id: parseUuidV7(row.role_assignment_id),
        user_id: input.target_user_id,
        reason_code: input.reason_code,
        now,
      });
      await recordActivity(client, {
        vendor_location_id: input.vendor_location_id,
        actor_user_id: ownerId,
        target_user_id: input.target_user_id,
        event_type: 'STAFF_REVOKED',
        reason_code: input.reason_code,
        ids: {
          request: parseRequestId(input.context.request_id),
          correlation: parseUuidV7(input.context.correlation_id),
        },
        now,
      });
    });
  }

  async listStaff(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }): Promise<readonly StaffMember[]> {
    return tx(this.#pool, async (client) => {
      await requireMembership(client, input.context, input.vendor_location_id, [
        'VENDOR_OWNER',
        'VENDOR_MANAGER',
      ]);
      const result = await client.query<{
        user_id: string;
        role_key: VendorRole;
        created_at: Date;
      }>(
        `SELECT sm.user_id, ra.role_key, sm.created_at
           FROM marketplace.staff_memberships sm
           JOIN marketplace.role_assignments ra USING (role_assignment_id)
          WHERE sm.vendor_location_id = $1 AND ra.state = 'ACTIVE'
          ORDER BY sm.created_at ASC`,
        [input.vendor_location_id],
      );
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            user_id: parseUuidV7(row.user_id),
            role: row.role_key,
            granted_at: row.created_at,
          }),
        ),
      );
    });
  }

  /** Every vendor_staff role — including picker — can read their own access summary. */
  async myAccess(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }): Promise<MyAccess> {
    return tx(this.#pool, async (client) => {
      const { role, userId } = await requireMembership(
        client,
        input.context,
        input.vendor_location_id,
        ['VENDOR_OWNER', 'VENDOR_MANAGER', 'VENDOR_PICKER'],
      );
      const capabilities = await client.query<{ capability_key: string }>(
        'SELECT capability_key FROM marketplace.role_capabilities WHERE role_key = $1 ORDER BY capability_key',
        [role],
      );
      return Object.freeze({
        vendor_location_id: input.vendor_location_id,
        role,
        capabilities: Object.freeze(capabilities.rows.map((row) => row.capability_key)),
        user_id: userId,
      });
    });
  }

  async updateProfile(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly profile_description: string;
    readonly now?: Date;
  }): Promise<LocationSettings> {
    if (input.profile_description.length < 1 || input.profile_description.length > 500) {
      throw new VendorStaffInputError('Profile description must be between 1 and 500 characters');
    }
    return this.#updateSettings(input, 'profile_description=$3', [input.profile_description]);
  }

  /**
   * `minimum_order_minor` and `preparation_seconds` are the store's own
   * ordering settings, never a platform fee, tax, or commission rate. This
   * service exposes no column, table, or route from `money_policy` or
   * `versioned-configuration`, so a vendor structurally cannot reach
   * platform-owned fee policy through it.
   */
  async updateOrderingSettings(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly minimum_order_minor: number;
    readonly preparation_seconds: number;
    readonly now?: Date;
  }): Promise<LocationSettings> {
    if (
      !Number.isSafeInteger(input.minimum_order_minor) ||
      input.minimum_order_minor < 0 ||
      input.minimum_order_minor > 10_000_000
    ) {
      throw new VendorStaffInputError('Minimum order must be between 0 and 10,000,000 minor units');
    }
    if (
      !Number.isSafeInteger(input.preparation_seconds) ||
      input.preparation_seconds < 300 ||
      input.preparation_seconds > 14_400
    ) {
      throw new VendorStaffInputError('Preparation time must be between 300 and 14,400 seconds');
    }
    return this.#updateSettings(input, 'minimum_order_minor=$3, preparation_seconds=$4', [
      input.minimum_order_minor,
      input.preparation_seconds,
    ]);
  }

  async #updateSettings(
    input: {
      readonly context: RequestContext;
      readonly vendor_location_id: UuidV7;
      readonly expected_version: number;
      readonly now?: Date;
    },
    setClause: string,
    values: readonly unknown[],
  ): Promise<LocationSettings> {
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1)
      throw new VendorStaffInputError('An expected version is required');
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireMembership(client, input.context, input.vendor_location_id, [
        'VENDOR_OWNER',
        'VENDOR_MANAGER',
      ]);
      const updated = await client.query<{
        vendor_location_id: string;
        profile_description: string | null;
        minimum_order_minor: string;
        preparation_seconds: number;
        version: number;
      }>(
        `UPDATE marketplace.vendor_locations
            SET ${setClause}, version=version+1, updated_at=$${values.length + 3}
          WHERE vendor_location_id=$1 AND version=$2
        RETURNING vendor_location_id, profile_description,
                  minimum_order_minor::text AS minimum_order_minor, preparation_seconds, version`,
        [input.vendor_location_id, input.expected_version, ...values, now],
      );
      const row = updated.rows[0];
      if (!row) throw new VendorStaffNotFoundError();
      await recordActivity(client, {
        vendor_location_id: input.vendor_location_id,
        actor_user_id: userId,
        event_type: 'SETTINGS_UPDATED',
        reason_code: 'STORE_SETTINGS_UPDATED',
        ids: {
          request: parseRequestId(input.context.request_id),
          correlation: parseUuidV7(input.context.correlation_id),
        },
        now,
      });
      return Object.freeze({
        vendor_location_id: parseUuidV7(row.vendor_location_id),
        profile_description: row.profile_description,
        minimum_order_minor: Number(row.minimum_order_minor),
        preparation_seconds: row.preparation_seconds,
        version: row.version,
      });
    });
  }

  async replaceOperatingHours(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly hours: readonly {
      readonly weekday: number;
      readonly opens_at: string;
      readonly closes_at: string;
    }[];
    readonly now?: Date;
  }): Promise<void> {
    if (input.hours.length < 1 || input.hours.length > 21)
      throw new VendorStaffInputError('Provide between 1 and 21 operating-hour windows');
    for (const window of input.hours) {
      if (!Number.isSafeInteger(window.weekday) || window.weekday < 0 || window.weekday > 6)
        throw new VendorStaffInputError('Weekday must be between 0 and 6');
    }
    const now = input.now ?? new Date();
    await tx(this.#pool, async (client) => {
      const { userId } = await requireMembership(client, input.context, input.vendor_location_id, [
        'VENDOR_OWNER',
        'VENDOR_MANAGER',
      ]);
      await client.query(
        'DELETE FROM marketplace.vendor_location_operating_hours WHERE vendor_location_id=$1',
        [input.vendor_location_id],
      );
      for (const window of input.hours) {
        await client.query(
          `INSERT INTO marketplace.vendor_location_operating_hours
             (operating_hour_id, vendor_location_id, weekday, opens_at, closes_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            createUuidV7(),
            input.vendor_location_id,
            window.weekday,
            window.opens_at,
            window.closes_at,
          ],
        );
      }
      await recordActivity(client, {
        vendor_location_id: input.vendor_location_id,
        actor_user_id: userId,
        event_type: 'SETTINGS_UPDATED',
        reason_code: 'OPERATING_HOURS_REPLACED',
        ids: {
          request: parseRequestId(input.context.request_id),
          correlation: parseUuidV7(input.context.correlation_id),
        },
        now,
      });
    });
  }

  async addTemporaryClosure(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly starts_at: Date;
    readonly ends_at: Date;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<void> {
    if (input.ends_at <= input.starts_at)
      throw new VendorStaffInputError('A closure must end after it starts');
    if (!reasonCode.test(input.reason_code))
      throw new VendorStaffInputError('Reason code must be shouting-snake-case');
    const now = input.now ?? new Date();
    await tx(this.#pool, async (client) => {
      const { userId } = await requireMembership(client, input.context, input.vendor_location_id, [
        'VENDOR_OWNER',
        'VENDOR_MANAGER',
      ]);
      const ids = {
        request: parseRequestId(input.context.request_id),
        correlation: parseUuidV7(input.context.correlation_id),
      };
      await client.query(
        `INSERT INTO marketplace.vendor_location_temporary_closures
           (temporary_closure_id, vendor_location_id, starts_at, ends_at, reason_code,
            request_id, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          input.vendor_location_id,
          input.starts_at,
          input.ends_at,
          input.reason_code,
          ids.request,
          ids.correlation,
        ],
      );
      await recordActivity(client, {
        vendor_location_id: input.vendor_location_id,
        actor_user_id: userId,
        event_type: 'SETTINGS_UPDATED',
        reason_code: 'TEMPORARY_CLOSURE_ADDED',
        ids,
        now,
      });
    });
  }

  async addServiceZone(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly zone_name: string;
    readonly boundary_wkt: string;
    readonly now?: Date;
  }): Promise<void> {
    if (input.zone_name.length < 3 || input.zone_name.length > 100)
      throw new VendorStaffInputError('Zone name must be between 3 and 100 characters');
    const now = input.now ?? new Date();
    await tx(this.#pool, async (client) => {
      const { userId } = await requireMembership(client, input.context, input.vendor_location_id, [
        'VENDOR_OWNER',
        'VENDOR_MANAGER',
      ]);
      const location = await client.query<{ operating_timezone: string }>(
        'SELECT operating_timezone FROM marketplace.vendor_locations WHERE vendor_location_id=$1',
        [input.vendor_location_id],
      );
      const timezone = location.rows[0]?.operating_timezone;
      if (!timezone) throw new VendorStaffNotFoundError();
      const ids = {
        request: parseRequestId(input.context.request_id),
        correlation: parseUuidV7(input.context.correlation_id),
      };
      // ST_Multi because the column is geography(MultiPolygon) and the vendor console
      // draws a single ring, so it sends POLYGON. PostGIS rejects the narrower type
      // outright rather than widening it. Already-multi input passes through unchanged.
      try {
        await client.query(
          `INSERT INTO marketplace.vendor_service_zones
             (service_zone_id, vendor_location_id, zone_name, operating_timezone, boundary,
              request_id, correlation_id)
           VALUES ($1,$2,$3,$4,ST_Multi(ST_SetSRID(ST_GeomFromText($5),4326))::geography,$6,$6)`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            input.vendor_location_id,
            input.zone_name,
            timezone,
            input.boundary_wkt,
            ids.request,
          ],
        );
      } catch (error) {
        // service_zone_name_unique is UNIQUE (vendor_location_id, zone_name) and covers
        // deactivated zones too, so a name is spent once used. Reusing one is the
        // operator's input, not a fault, and must not surface as INTERNAL_ERROR.
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: unknown }).code === '23505'
        )
          throw new VendorStaffConflictError(
            'A service zone with this name already exists',
            'RESOURCE_ALREADY_EXISTS',
          );
        throw error;
      }
      await recordActivity(client, {
        vendor_location_id: input.vendor_location_id,
        actor_user_id: userId,
        event_type: 'SETTINGS_UPDATED',
        reason_code: 'SERVICE_ZONE_ADDED',
        ids,
        now,
      });
    });
  }

  async deactivateServiceZone(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly service_zone_id: UuidV7;
    readonly now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    await tx(this.#pool, async (client) => {
      const { userId } = await requireMembership(client, input.context, input.vendor_location_id, [
        'VENDOR_OWNER',
        'VENDOR_MANAGER',
      ]);
      const updated = await client.query(
        `UPDATE marketplace.vendor_service_zones
            SET lifecycle_state='INACTIVE', version=version+1, updated_at=$3
          WHERE service_zone_id=$1 AND vendor_location_id=$2 AND lifecycle_state='ACTIVE'`,
        [input.service_zone_id, input.vendor_location_id, now],
      );
      if (updated.rowCount !== 1) throw new VendorStaffNotFoundError();
      await recordActivity(client, {
        vendor_location_id: input.vendor_location_id,
        actor_user_id: userId,
        event_type: 'SETTINGS_UPDATED',
        reason_code: 'SERVICE_ZONE_DEACTIVATED',
        ids: {
          request: parseRequestId(input.context.request_id),
          correlation: parseUuidV7(input.context.correlation_id),
        },
        now,
      });
    });
  }

  /** Read-only: current fulfilment modes are admin-approved (see engineering doc). */
  async listFulfilmentModes(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }): Promise<readonly string[]> {
    return tx(this.#pool, async (client) => {
      await requireMembership(client, input.context, input.vendor_location_id, [
        'VENDOR_OWNER',
        'VENDOR_MANAGER',
        'VENDOR_PICKER',
      ]);
      const result = await client.query<{ fulfilment_mode: string }>(
        'SELECT fulfilment_mode FROM marketplace.vendor_location_fulfilment_modes WHERE vendor_location_id=$1 ORDER BY fulfilment_mode',
        [input.vendor_location_id],
      );
      return Object.freeze(result.rows.map((row) => row.fulfilment_mode));
    });
  }

  /** Active zones first: those are the ones deciding discoverability today. */
  async listServiceZones(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }): Promise<readonly ServiceZoneSummary[]> {
    return tx(this.#pool, async (client) => {
      await requireMembership(client, input.context, input.vendor_location_id, [
        'VENDOR_OWNER',
        'VENDOR_MANAGER',
        'VENDOR_PICKER',
      ]);
      const result = await client.query<{
        service_zone_id: string;
        zone_name: string;
        lifecycle_state: string;
        area_square_metres: string;
        created_at: Date;
      }>(
        `SELECT service_zone_id, zone_name, lifecycle_state, created_at,
                ST_Area(boundary) AS area_square_metres
           FROM marketplace.vendor_service_zones
          WHERE vendor_location_id = $1
          ORDER BY (lifecycle_state = 'ACTIVE') DESC, created_at DESC`,
        [input.vendor_location_id],
      );
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            area_square_metres: Number(row.area_square_metres),
            created_at: row.created_at,
            lifecycle_state: row.lifecycle_state,
            service_zone_id: parseUuidV7(row.service_zone_id),
            zone_name: row.zone_name,
          }),
        ),
      );
    });
  }

  /** Closures that have not finished yet — a past closure is not actionable. */
  async listTemporaryClosures(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly now?: Date;
  }): Promise<readonly TemporaryClosureSummary[]> {
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      await requireMembership(client, input.context, input.vendor_location_id, [
        'VENDOR_OWNER',
        'VENDOR_MANAGER',
        'VENDOR_PICKER',
      ]);
      const result = await client.query<{
        temporary_closure_id: string;
        starts_at: Date;
        ends_at: Date;
        reason_code: string;
      }>(
        `SELECT temporary_closure_id, starts_at, ends_at, reason_code
           FROM marketplace.vendor_location_temporary_closures
          WHERE vendor_location_id = $1 AND ends_at > $2
          ORDER BY starts_at ASC`,
        [input.vendor_location_id, now],
      );
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            ends_at: row.ends_at,
            reason_code: row.reason_code,
            starts_at: row.starts_at,
            temporary_closure_id: parseUuidV7(row.temporary_closure_id),
          }),
        ),
      );
    });
  }

  async activityHistory(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly limit?: number;
  }): Promise<readonly ActivityEntry[]> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    return tx(this.#pool, async (client) => {
      await requireMembership(client, input.context, input.vendor_location_id, [
        'VENDOR_OWNER',
        'VENDOR_MANAGER',
      ]);
      const result = await client.query<{
        event_type: ActivityEntry['event_type'];
        actor_user_id: string;
        target_user_id: string | null;
        reason_code: string;
        occurred_at: Date;
      }>(
        `SELECT event_type, actor_user_id, target_user_id, reason_code, occurred_at
           FROM marketplace.vendor_staff_events
          WHERE vendor_location_id = $1
          ORDER BY occurred_at DESC
          LIMIT $2`,
        [input.vendor_location_id, limit],
      );
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            event_type: row.event_type,
            actor_user_id: parseUuidV7(row.actor_user_id),
            target_user_id: row.target_user_id ? parseUuidV7(row.target_user_id) : null,
            reason_code: row.reason_code,
            occurred_at: row.occurred_at,
          }),
        ),
      );
    });
  }
}
