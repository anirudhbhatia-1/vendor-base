import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { transaction } from './transaction.js';

export type VendorLifecycleState = 'ACTIVE' | 'CLOSED' | 'DRAFT' | 'SUSPENDED';
export type VendorLocationLifecycleState = 'ACTIVE' | 'CLOSED' | 'DRAFT' | 'PAUSED';
export type VendorCategory = 'FRUIT_VEGETABLE';
export type FulfilmentMode = 'CUSTOMER_PICKUP' | 'PLATFORM_DELIVERY' | 'VENDOR_DELIVERY';
export type CalendarExceptionKind = 'CLOSED' | 'SPECIAL_HOURS';

export interface VendorRecord {
  readonly business_name: string;
  readonly lifecycle_state: VendorLifecycleState;
  readonly profile_description: string | null;
  readonly vendor_id: UuidV7;
  readonly version: number;
}

export interface VendorLocationRecord {
  readonly category: VendorCategory;
  readonly currency: 'INR';
  readonly latitude: number;
  readonly lifecycle_state: VendorLocationLifecycleState;
  readonly location_name: string;
  readonly longitude: number;
  readonly minimum_order_minor: number;
  readonly operating_timezone: string;
  readonly preparation_seconds: number;
  readonly profile_description: string | null;
  readonly vendor_id: UuidV7;
  readonly vendor_location_id: UuidV7;
  readonly version: number;
}

export interface OperatingWindow {
  readonly closes_at: string;
  readonly opens_at: string;
  /** Sunday is 0, matching PostgreSQL EXTRACT(DOW). */
  readonly weekday: number;
}

export interface PolygonBoundary {
  /** GeoJSON order: longitude, latitude. The exterior ring must be closed. */
  readonly coordinates: readonly (readonly (readonly [number, number])[])[];
  readonly type: 'Polygon';
}

export type OperationalReason =
  | 'CALENDAR_CLOSED'
  | 'LOCATION_INACTIVE'
  | 'OPEN'
  | 'OUTSIDE_HOURS'
  | 'OUTSIDE_SERVICE_ZONE'
  | 'TEMPORARILY_CLOSED'
  | 'VENDOR_INACTIVE';

export interface OperationalStatus {
  readonly approved_fulfilment_modes: readonly FulfilmentMode[];
  readonly currency: 'INR';
  readonly minimum_order_minor: number;
  readonly open: boolean;
  readonly preparation_seconds: number;
  readonly reason: OperationalReason;
}

export class VendorNetworkInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}

export class VendorNetworkNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}

export class VendorNetworkVersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';
}

export class VendorNetworkTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}

export class VendorNetworkAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}

// A validator looser than its constraint does not accept more input, it just
// converts a 400 into a 500. Since migration 0062 the constraint is length-only,
// so this regex is now the narrower of the two.
//
// It still cannot store a Devanagari shop name, but no longer because of the
// schema: `\p{L}` matches Devanagari consonants while the vowel signs that
// spell most Hindi words are combining marks (`\p{M}`), which this class omits.
// Widening it is an application change, not a migration. Tracked against
// MKT-11 / phase 12.3 in docs/engineering/phase-conformance-audit.md.
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'().,-]{1,118}$/u;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const FULFILMENT_MODES = new Set<FulfilmentMode>([
  'CUSTOMER_PICKUP',
  'PLATFORM_DELIVERY',
  'VENDOR_DELIVERY',
]);

/**
 * Validates a name as a person would type it and stores it in that form.
 *
 * Migration 0062 replaced `vendor_business_name_shape` and
 * `vendor_location_name_shape` with length-only runtime checks, so the
 * mandatory `SYNTH ` fixture prefix is gone from the schema and a name is
 * persisted exactly as it was typed. A leading historical prefix is still
 * stripped here so that re-importing older synthetic fixtures normalizes to
 * one canonical name instead of accumulating prefixes. The validator stays
 * exactly as strict as the constraint: a looser check does not accept more
 * input, it just converts a typed 400 into a raw PostgreSQL 500.
 */
function requireName(value: string, label: string): string {
  const normalized = value
    .trim()
    .replace(/^SYNTH(?:ETIC)?[ _-]*/i, '')
    .replace(/\s+/g, ' ');
  if (!NAME.test(normalized)) {
    throw new VendorNetworkInputError(`${label} contains unsupported characters`);
  }
  return normalized;
}

function optionalDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 1 || normalized.length > 500) {
    throw new VendorNetworkInputError('Profile description must contain 1 to 500 characters');
  }
  return normalized;
}

function requireReason(value: string): string {
  if (!REASON.test(value)) throw new VendorNetworkInputError('Reason code is invalid');
  return value;
}

function requireTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
  } catch {
    throw new VendorNetworkInputError('Operating timezone is invalid');
  }
  return value;
}

function requireCoordinate(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new VendorNetworkInputError(`${label} is outside valid geographic bounds`);
  }
  return value;
}

function requireMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000_000) {
    throw new VendorNetworkInputError('Minimum order must be an integer INR minor-unit amount');
  }
  return value;
}

function requirePreparation(value: number): number {
  if (!Number.isSafeInteger(value) || value < 300 || value > 14_400) {
    throw new VendorNetworkInputError('Preparation time must be between 300 and 14400 seconds');
  }
  return value;
}

function contextIds(context: RequestContext) {
  return {
    actorId: context.actor?.actor_id ?? null,
    correlationId: parseUuidV7(context.correlation_id),
    requestId: parseRequestId(context.request_id),
  };
}

function assertAdmin(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'admin') {
    throw new VendorNetworkAuthorizationError(
      'An authenticated admin must approve fulfilment modes',
    );
  }
  return context.actor.actor_id;
}

function validateHours(windows: readonly OperatingWindow[]): void {
  const byDay = new Map<number, { opens: string; closes: string }[]>();
  for (const window of windows) {
    if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6) {
      throw new VendorNetworkInputError('Weekday must be from 0 through 6');
    }
    if (
      !TIME.test(window.opens_at) ||
      !TIME.test(window.closes_at) ||
      window.closes_at <= window.opens_at
    ) {
      throw new VendorNetworkInputError('Operating window must be a valid same-day interval');
    }
    const existing = byDay.get(window.weekday) ?? [];
    if (existing.some((item) => item.opens < window.closes_at && window.opens_at < item.closes)) {
      throw new VendorNetworkInputError('Operating windows cannot overlap');
    }
    existing.push({ opens: window.opens_at, closes: window.closes_at });
    byDay.set(window.weekday, existing);
  }
}

function validateBoundary(boundary: PolygonBoundary): void {
  if (boundary.type !== 'Polygon' || boundary.coordinates.length === 0) {
    throw new VendorNetworkInputError('Service-zone boundary must be a GeoJSON Polygon');
  }
  for (const ring of boundary.coordinates) {
    if (ring.length < 4)
      throw new VendorNetworkInputError('Polygon rings require four coordinates');
    for (const coordinate of ring) {
      requireCoordinate(coordinate[0], -180, 180, 'Longitude');
      requireCoordinate(coordinate[1], -90, 90, 'Latitude');
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
      throw new VendorNetworkInputError('Polygon rings must be closed');
    }
  }
}

interface LocationVersionRow {
  readonly vendor_id: string;
  readonly version: number;
}

async function lockLocation(client: PoolClient, id: UuidV7, expectedVersion: number) {
  const result = await client.query<LocationVersionRow>(
    `SELECT vendor_id, version FROM marketplace.vendor_locations
      WHERE vendor_location_id = $1 FOR UPDATE`,
    [parseUuidV7(id)],
  );
  const row = result.rows[0];
  if (!row) throw new VendorNetworkNotFoundError('Vendor location was not found');
  if (row.version !== expectedVersion) {
    throw new VendorNetworkVersionConflictError('Vendor location version is stale');
  }
  return { vendor_id: parseUuidV7(row.vendor_id), version: row.version };
}

async function appendEvent(
  client: PoolClient,
  input: {
    readonly aggregate_id: UuidV7;
    readonly aggregate_type: 'VENDOR' | 'VENDOR_LOCATION';
    readonly context: RequestContext;
    readonly event_type:
      | 'CALENDAR_EXCEPTION_SET'
      | 'CREATED'
      | 'FULFILMENT_MODES_REPLACED'
      | 'LIFECYCLE_CHANGED'
      | 'OPERATING_HOURS_REPLACED'
      | 'PROFILE_UPDATED'
      | 'SERVICE_ZONE_ADDED'
      | 'SERVICE_ZONE_LIFECYCLE_CHANGED'
      | 'TEMPORARY_CLOSURE_ADDED';
    readonly now: Date;
    readonly reason_code: string;
    readonly resulting_version: number;
  },
) {
  const ids = contextIds(input.context);
  await client.query(
    `INSERT INTO marketplace.vendor_network_events
       (event_id, aggregate_type, aggregate_id, resulting_version, event_type,
        actor_id, reason_code, request_id, correlation_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.aggregate_type,
      input.aggregate_id,
      input.resulting_version,
      input.event_type,
      ids.actorId,
      requireReason(input.reason_code),
      ids.requestId,
      ids.correlationId,
      input.now,
    ],
  );
}

function vendorRecord(row: Record<string, unknown>): VendorRecord {
  return {
    vendor_id: parseUuidV7(String(row.vendor_id)),
    business_name: String(row.business_name),
    profile_description: row.profile_description === null ? null : String(row.profile_description),
    lifecycle_state: row.lifecycle_state as VendorLifecycleState,
    version: Number(row.version),
  };
}

function locationRecord(row: Record<string, unknown>): VendorLocationRecord {
  return {
    vendor_location_id: parseUuidV7(String(row.vendor_location_id)),
    vendor_id: parseUuidV7(String(row.vendor_id)),
    location_name: String(row.location_name),
    profile_description: row.profile_description === null ? null : String(row.profile_description),
    operating_timezone: String(row.operating_timezone),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    category: row.category as VendorCategory,
    lifecycle_state: row.lifecycle_state as VendorLocationLifecycleState,
    minimum_order_minor: Number(row.minimum_order_minor),
    currency: 'INR',
    preparation_seconds: Number(row.preparation_seconds),
    version: Number(row.version),
  };
}

export class VendorNetworkService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string }) {
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-vendor-network',
      connectionString: input.connection_string,
      connectionTimeoutMillis: 5_000,
      max: 8,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  /**
   * Admin overview of every service zone attached to a vendor location, with
   * the location's coordinates so the operator can see whether the zone still
   * covers the store after a lat/lng edit.
   */
  async listServiceZones(input: { readonly context: RequestContext }): Promise<
    readonly {
      readonly service_zone_id: UuidV7;
      readonly vendor_location_id: UuidV7;
      readonly zone_name: string;
      readonly lifecycle_state: 'ACTIVE' | 'INACTIVE';
      readonly operating_timezone: string;
      /** Needed to suspend or resume this zone without clobbering a change. */
      readonly version: number;
      readonly location_name: string;
      readonly location_lifecycle_state: string;
      readonly latitude: number;
      readonly longitude: number;
    }[]
  > {
    assertAdmin(input.context);
    const rows = await this.#pool.query<{
      service_zone_id: string;
      vendor_location_id: string;
      zone_name: string;
      lifecycle_state: 'ACTIVE' | 'INACTIVE';
      operating_timezone: string;
      version: number;
      location_name: string;
      location_lifecycle_state: string;
      latitude: string;
      longitude: string;
    }>(
      `SELECT z.service_zone_id, z.vendor_location_id, z.zone_name, z.lifecycle_state,
              z.operating_timezone, z.version, l.location_name,
              l.lifecycle_state AS location_lifecycle_state,
              ST_Y(l.coordinates::geometry)::text AS latitude,
              ST_X(l.coordinates::geometry)::text AS longitude
         FROM marketplace.vendor_service_zones z
         JOIN marketplace.vendor_locations l USING (vendor_location_id)
        ORDER BY l.location_name, z.zone_name
        LIMIT 200`,
    );
    return rows.rows.map((row) => ({
      service_zone_id: parseUuidV7(row.service_zone_id),
      vendor_location_id: parseUuidV7(row.vendor_location_id),
      zone_name: row.zone_name,
      lifecycle_state: row.lifecycle_state,
      operating_timezone: row.operating_timezone,
      version: row.version,
      location_name: row.location_name,
      location_lifecycle_state: row.location_lifecycle_state,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    }));
  }

  async createVendor(input: {
    readonly business_name: string;
    readonly context: RequestContext;
    readonly now?: Date;
    readonly profile_description?: string | null;
    readonly vendor_id: UuidV7;
  }): Promise<VendorRecord> {
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const ids = contextIds(input.context);
      const result = await client.query(
        `INSERT INTO marketplace.vendors
           (vendor_id, business_name, profile_description, request_id, correlation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
        [
          input.vendor_id,
          requireName(input.business_name, 'Business name'),
          optionalDescription(input.profile_description),
          ids.requestId,
          ids.correlationId,
          now,
        ],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_id,
        aggregate_type: 'VENDOR',
        context: input.context,
        event_type: 'CREATED',
        now,
        reason_code: 'VENDOR_CREATED',
        resulting_version: 1,
      });
      return vendorRecord(result.rows[0] as Record<string, unknown>);
    });
  }

  async createLocation(input: {
    readonly category: VendorCategory;
    readonly context: RequestContext;
    readonly latitude: number;
    readonly location_name: string;
    readonly longitude: number;
    readonly minimum_order_minor: number;
    readonly now?: Date;
    readonly operating_timezone: string;
    readonly preparation_seconds: number;
    readonly profile_description?: string | null;
    readonly vendor_id: UuidV7;
    readonly vendor_location_id: UuidV7;
  }): Promise<VendorLocationRecord> {
    if (input.category !== 'FRUIT_VEGETABLE')
      throw new VendorNetworkInputError('Category is not enabled for the pilot');
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const vendor = await client.query<{ lifecycle_state: VendorLifecycleState }>(
        'SELECT lifecycle_state FROM marketplace.vendors WHERE vendor_id = $1 FOR SHARE',
        [input.vendor_id],
      );
      if (!vendor.rows[0]) throw new VendorNetworkNotFoundError('Vendor was not found');
      if (vendor.rows[0].lifecycle_state === 'CLOSED')
        throw new VendorNetworkTransitionError('Closed vendor cannot add locations');
      const ids = contextIds(input.context);
      const result = await client.query(
        `INSERT INTO marketplace.vendor_locations
           (vendor_location_id, vendor_id, location_name, profile_description, operating_timezone,
            coordinates, category, minimum_order_minor, preparation_seconds, request_id,
            correlation_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5,
           ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8, $9, $10, $11, $12, $13, $13)
         RETURNING *, ST_Y(coordinates::geometry) AS latitude, ST_X(coordinates::geometry) AS longitude`,
        [
          input.vendor_location_id,
          input.vendor_id,
          requireName(input.location_name, 'Location name'),
          optionalDescription(input.profile_description),
          requireTimezone(input.operating_timezone),
          requireCoordinate(input.longitude, -180, 180, 'Longitude'),
          requireCoordinate(input.latitude, -90, 90, 'Latitude'),
          input.category,
          requireMoney(input.minimum_order_minor),
          requirePreparation(input.preparation_seconds),
          ids.requestId,
          ids.correlationId,
          now,
        ],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_location_id,
        aggregate_type: 'VENDOR_LOCATION',
        context: input.context,
        event_type: 'CREATED',
        now,
        reason_code: 'LOCATION_CREATED',
        resulting_version: 1,
      });
      return locationRecord(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateVendorProfile(input: {
    readonly business_name: string;
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly profile_description?: string | null;
    readonly vendor_id: UuidV7;
  }): Promise<VendorRecord> {
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const current = await client.query<{ version: number }>(
        'SELECT version FROM marketplace.vendors WHERE vendor_id=$1 FOR UPDATE',
        [input.vendor_id],
      );
      const row = current.rows[0];
      if (!row) throw new VendorNetworkNotFoundError('Vendor was not found');
      if (row.version !== input.expected_version)
        throw new VendorNetworkVersionConflictError('Vendor version is stale');
      const version = row.version + 1;
      const result = await client.query(
        `UPDATE marketplace.vendors SET business_name=$2,
        profile_description=$3, version=$4, updated_at=$5 WHERE vendor_id=$1 RETURNING *`,
        [
          input.vendor_id,
          requireName(input.business_name, 'Business name'),
          optionalDescription(input.profile_description),
          version,
          now,
        ],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_id,
        aggregate_type: 'VENDOR',
        context: input.context,
        event_type: 'PROFILE_UPDATED',
        now,
        reason_code: 'VENDOR_PROFILE_UPDATED',
        resulting_version: version,
      });
      return vendorRecord(result.rows[0] as Record<string, unknown>);
    });
  }

  async transitionVendor(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly reason_code: string;
    readonly to_state: VendorLifecycleState;
    readonly vendor_id: UuidV7;
  }): Promise<VendorRecord> {
    const allowed: Record<VendorLifecycleState, readonly VendorLifecycleState[]> = {
      DRAFT: ['ACTIVE'],
      ACTIVE: ['SUSPENDED', 'CLOSED'],
      SUSPENDED: ['ACTIVE', 'CLOSED'],
      CLOSED: [],
    };
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const current = await client.query<{
        lifecycle_state: VendorLifecycleState;
        version: number;
      }>('SELECT lifecycle_state, version FROM marketplace.vendors WHERE vendor_id=$1 FOR UPDATE', [
        input.vendor_id,
      ]);
      const row = current.rows[0];
      if (!row) throw new VendorNetworkNotFoundError('Vendor was not found');
      if (row.version !== input.expected_version)
        throw new VendorNetworkVersionConflictError('Vendor version is stale');
      if (!allowed[row.lifecycle_state].includes(input.to_state))
        throw new VendorNetworkTransitionError('Vendor transition is not allowed');
      const version = row.version + 1;
      const result = await client.query(
        `UPDATE marketplace.vendors SET lifecycle_state=$2,
        version=$3, updated_at=$4 WHERE vendor_id=$1 RETURNING *`,
        [input.vendor_id, input.to_state, version, now],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_id,
        aggregate_type: 'VENDOR',
        context: input.context,
        event_type: 'LIFECYCLE_CHANGED',
        now,
        reason_code: input.reason_code,
        resulting_version: version,
      });
      return vendorRecord(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateLocationProfile(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly location_name: string;
    readonly minimum_order_minor: number;
    readonly now?: Date;
    readonly preparation_seconds: number;
    readonly profile_description?: string | null;
    readonly vendor_location_id: UuidV7;
  }): Promise<VendorLocationRecord> {
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const locked = await lockLocation(client, input.vendor_location_id, input.expected_version);
      const version = locked.version + 1;
      const result = await client.query(
        `UPDATE marketplace.vendor_locations SET location_name=$2, profile_description=$3,
           minimum_order_minor=$4, preparation_seconds=$5, version=$6, updated_at=$7
         WHERE vendor_location_id=$1 RETURNING *, ST_Y(coordinates::geometry) AS latitude,
           ST_X(coordinates::geometry) AS longitude`,
        [
          input.vendor_location_id,
          requireName(input.location_name, 'Location name'),
          optionalDescription(input.profile_description),
          requireMoney(input.minimum_order_minor),
          requirePreparation(input.preparation_seconds),
          version,
          now,
        ],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_location_id,
        aggregate_type: 'VENDOR_LOCATION',
        context: input.context,
        event_type: 'PROFILE_UPDATED',
        now,
        reason_code: 'LOCATION_PROFILE_UPDATED',
        resulting_version: version,
      });
      return locationRecord(result.rows[0] as Record<string, unknown>);
    });
  }

  async transitionLocation(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly reason_code: string;
    readonly to_state: VendorLocationLifecycleState;
    readonly vendor_location_id: UuidV7;
  }): Promise<VendorLocationRecord> {
    const allowed: Record<VendorLocationLifecycleState, readonly VendorLocationLifecycleState[]> = {
      DRAFT: ['ACTIVE'],
      ACTIVE: ['PAUSED', 'CLOSED'],
      PAUSED: ['ACTIVE', 'CLOSED'],
      CLOSED: [],
    };
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const current = await client.query<{
        lifecycle_state: VendorLocationLifecycleState;
        version: number;
      }>(
        'SELECT lifecycle_state, version FROM marketplace.vendor_locations WHERE vendor_location_id=$1 FOR UPDATE',
        [input.vendor_location_id],
      );
      const row = current.rows[0];
      if (!row) throw new VendorNetworkNotFoundError('Vendor location was not found');
      if (row.version !== input.expected_version)
        throw new VendorNetworkVersionConflictError('Vendor location version is stale');
      if (!allowed[row.lifecycle_state].includes(input.to_state))
        throw new VendorNetworkTransitionError('Vendor location transition is not allowed');
      const version = row.version + 1;
      const result = await client.query(
        `UPDATE marketplace.vendor_locations SET lifecycle_state=$2, version=$3, updated_at=$4
          WHERE vendor_location_id=$1 RETURNING *, ST_Y(coordinates::geometry) AS latitude,
           ST_X(coordinates::geometry) AS longitude`,
        [input.vendor_location_id, input.to_state, version, now],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_location_id,
        aggregate_type: 'VENDOR_LOCATION',
        context: input.context,
        event_type: 'LIFECYCLE_CHANGED',
        now,
        reason_code: input.reason_code,
        resulting_version: version,
      });
      return locationRecord(result.rows[0] as Record<string, unknown>);
    });
  }

  async replaceOperatingHours(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly vendor_location_id: UuidV7;
    readonly windows: readonly OperatingWindow[];
  }): Promise<number> {
    validateHours(input.windows);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const locked = await lockLocation(client, input.vendor_location_id, input.expected_version);
      await client.query(
        'DELETE FROM marketplace.vendor_location_operating_hours WHERE vendor_location_id=$1',
        [input.vendor_location_id],
      );
      for (const window of input.windows) {
        await client.query(
          `INSERT INTO marketplace.vendor_location_operating_hours
          (operating_hour_id, vendor_location_id, weekday, opens_at, closes_at, created_at)
          VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            input.vendor_location_id,
            window.weekday,
            window.opens_at,
            window.closes_at,
            now,
          ],
        );
      }
      const version = locked.version + 1;
      await client.query(
        'UPDATE marketplace.vendor_locations SET version=$2, updated_at=$3 WHERE vendor_location_id=$1',
        [input.vendor_location_id, version, now],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_location_id,
        aggregate_type: 'VENDOR_LOCATION',
        context: input.context,
        event_type: 'OPERATING_HOURS_REPLACED',
        now,
        reason_code: 'OPERATING_HOURS_UPDATED',
        resulting_version: version,
      });
      return version;
    });
  }

  async setCalendarException(input: {
    readonly closes_at?: string;
    readonly context: RequestContext;
    readonly exception_kind: CalendarExceptionKind;
    readonly expected_version: number;
    readonly local_date: string;
    readonly now?: Date;
    readonly opens_at?: string;
    readonly reason_code: string;
    readonly vendor_location_id: UuidV7;
  }): Promise<number> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.local_date))
      throw new VendorNetworkInputError('Local date must be YYYY-MM-DD');
    if (
      input.exception_kind === 'SPECIAL_HOURS' &&
      (!input.opens_at ||
        !input.closes_at ||
        !TIME.test(input.opens_at) ||
        !TIME.test(input.closes_at) ||
        input.closes_at <= input.opens_at)
    ) {
      throw new VendorNetworkInputError('Special hours require a valid same-day interval');
    }
    if (input.exception_kind === 'CLOSED' && (input.opens_at || input.closes_at))
      throw new VendorNetworkInputError('Closed dates cannot include opening hours');
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const locked = await lockLocation(client, input.vendor_location_id, input.expected_version);
      await client.query(
        `INSERT INTO marketplace.vendor_location_calendar_exceptions
        (calendar_exception_id, vendor_location_id, local_date, exception_kind, opens_at, closes_at, reason_code, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (vendor_location_id, local_date) DO UPDATE SET exception_kind=EXCLUDED.exception_kind,
          opens_at=EXCLUDED.opens_at, closes_at=EXCLUDED.closes_at, reason_code=EXCLUDED.reason_code`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          input.vendor_location_id,
          input.local_date,
          input.exception_kind,
          input.opens_at ?? null,
          input.closes_at ?? null,
          requireReason(input.reason_code),
          now,
        ],
      );
      const version = locked.version + 1;
      await client.query(
        'UPDATE marketplace.vendor_locations SET version=$2, updated_at=$3 WHERE vendor_location_id=$1',
        [input.vendor_location_id, version, now],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_location_id,
        aggregate_type: 'VENDOR_LOCATION',
        context: input.context,
        event_type: 'CALENDAR_EXCEPTION_SET',
        now,
        reason_code: input.reason_code,
        resulting_version: version,
      });
      return version;
    });
  }

  async addTemporaryClosure(input: {
    readonly context: RequestContext;
    readonly ends_at: Date;
    readonly expected_version: number;
    readonly now?: Date;
    readonly reason_code: string;
    readonly starts_at: Date;
    readonly temporary_closure_id: UuidV7;
    readonly vendor_location_id: UuidV7;
  }): Promise<number> {
    if (input.ends_at <= input.starts_at)
      throw new VendorNetworkInputError('Temporary closure end must follow its start');
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const locked = await lockLocation(client, input.vendor_location_id, input.expected_version);
      const ids = contextIds(input.context);
      await client.query(
        `INSERT INTO marketplace.vendor_location_temporary_closures
        (temporary_closure_id, vendor_location_id, starts_at, ends_at, reason_code, request_id, correlation_id, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.temporary_closure_id,
          input.vendor_location_id,
          input.starts_at,
          input.ends_at,
          requireReason(input.reason_code),
          ids.requestId,
          ids.correlationId,
          now,
        ],
      );
      const version = locked.version + 1;
      await client.query(
        'UPDATE marketplace.vendor_locations SET version=$2, updated_at=$3 WHERE vendor_location_id=$1',
        [input.vendor_location_id, version, now],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_location_id,
        aggregate_type: 'VENDOR_LOCATION',
        context: input.context,
        event_type: 'TEMPORARY_CLOSURE_ADDED',
        now,
        reason_code: input.reason_code,
        resulting_version: version,
      });
      return version;
    });
  }

  async addServiceZone(input: {
    readonly boundary: PolygonBoundary;
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly operating_timezone: string;
    readonly service_zone_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly zone_name: string;
  }): Promise<number> {
    validateBoundary(input.boundary);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const locked = await lockLocation(client, input.vendor_location_id, input.expected_version);
      await client.query(
        `INSERT INTO marketplace.vendor_service_zones
        (service_zone_id, vendor_location_id, zone_name, operating_timezone, boundary,
         request_id, correlation_id, created_at, updated_at)
        VALUES ($1,$2,$3,$4,ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5),4326))::geography,$6,$7,$8,$8)`,
        [
          input.service_zone_id,
          input.vendor_location_id,
          input.zone_name.trim(),
          requireTimezone(input.operating_timezone),
          JSON.stringify(input.boundary),
          contextIds(input.context).requestId,
          contextIds(input.context).correlationId,
          now,
        ],
      );
      const covers = await client.query<{ covers: boolean }>(
        `SELECT ST_Covers(z.boundary, l.coordinates) AS covers
        FROM marketplace.vendor_service_zones z JOIN marketplace.vendor_locations l USING (vendor_location_id)
        WHERE z.service_zone_id=$1`,
        [input.service_zone_id],
      );
      if (!covers.rows[0]?.covers)
        throw new VendorNetworkInputError('Service zone must contain its vendor location');
      const version = locked.version + 1;
      await client.query(
        'UPDATE marketplace.vendor_locations SET version=$2, updated_at=$3 WHERE vendor_location_id=$1',
        [input.vendor_location_id, version, now],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_location_id,
        aggregate_type: 'VENDOR_LOCATION',
        context: input.context,
        event_type: 'SERVICE_ZONE_ADDED',
        now,
        reason_code: 'SERVICE_ZONE_ADDED',
        resulting_version: version,
      });
      return version;
    });
  }

  /**
   * Closes or reopens a service zone.
   *
   * The one operational control a launch day cannot run without: when a storm,
   * a festival or a road closure makes a neighbourhood undeliverable, every
   * shop that serves it has to stop being offered there, immediately and
   * reversibly. Discovery already filters on this state, so flipping it takes
   * effect on the next read with nothing to invalidate.
   *
   * Deliberately not zone editing. Redrawing a boundary changes who a shop can
   * ever serve; closing one changes who it can serve today, and only the second
   * is something to do under pressure.
   */
  async transitionServiceZone(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly lifecycle_state: 'ACTIVE' | 'INACTIVE';
    readonly now?: Date;
    readonly reason_code: string;
    readonly service_zone_id: UuidV7;
  }): Promise<number> {
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(input.reason_code)) {
      throw new VendorNetworkInputError('Reason code must be shouting-snake-case');
    }
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<{
        vendor_location_id: string;
        lifecycle_state: string;
        version: number;
      }>(
        `SELECT vendor_location_id, lifecycle_state, version
           FROM marketplace.vendor_service_zones WHERE service_zone_id=$1 FOR UPDATE`,
        [input.service_zone_id],
      );
      const zone = found.rows[0];
      if (!zone) throw new VendorNetworkNotFoundError('Service zone was not found');
      if (zone.version !== input.expected_version) {
        throw new VendorNetworkVersionConflictError('Service zone version has advanced');
      }
      if (zone.lifecycle_state === input.lifecycle_state) {
        throw new VendorNetworkTransitionError(`Service zone is already ${input.lifecycle_state}`);
      }
      await client.query(
        `UPDATE marketplace.vendor_service_zones
            SET lifecycle_state=$2, version=$3, updated_at=$4
          WHERE service_zone_id=$1`,
        [input.service_zone_id, input.lifecycle_state, zone.version + 1, now],
      );
      const locationId = parseUuidV7(zone.vendor_location_id);
      const locked = await client.query<{ version: number }>(
        'SELECT version FROM marketplace.vendor_locations WHERE vendor_location_id=$1 FOR UPDATE',
        [locationId],
      );
      const locationVersion = (locked.rows[0]?.version ?? 0) + 1;
      await client.query(
        'UPDATE marketplace.vendor_locations SET version=$2, updated_at=$3 WHERE vendor_location_id=$1',
        [locationId, locationVersion, now],
      );
      await appendEvent(client, {
        aggregate_id: locationId,
        aggregate_type: 'VENDOR_LOCATION',
        context: input.context,
        event_type: 'SERVICE_ZONE_LIFECYCLE_CHANGED',
        now,
        reason_code: input.reason_code,
        resulting_version: locationVersion,
      });
      return zone.version + 1;
    });
  }

  async replaceApprovedFulfilmentModes(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly modes: readonly FulfilmentMode[];
    readonly now?: Date;
    readonly vendor_location_id: UuidV7;
  }): Promise<number> {
    const approver = assertAdmin(input.context);
    const modes = [...new Set(input.modes)];
    if (modes.length === 0 || modes.some((mode) => !FULFILMENT_MODES.has(mode)))
      throw new VendorNetworkInputError('At least one approved fulfilment mode is required');
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const locked = await lockLocation(client, input.vendor_location_id, input.expected_version);
      const ids = contextIds(input.context);
      await client.query(
        'DELETE FROM marketplace.vendor_location_fulfilment_modes WHERE vendor_location_id=$1',
        [input.vendor_location_id],
      );
      for (const mode of modes) {
        await client.query(
          `INSERT INTO marketplace.vendor_location_fulfilment_modes
          (vendor_location_id, fulfilment_mode, approved_by_user_id, approved_at, request_id, correlation_id)
          VALUES ($1,$2,$3,$4,$5,$6)`,
          [input.vendor_location_id, mode, approver, now, ids.requestId, ids.correlationId],
        );
      }
      const version = locked.version + 1;
      await client.query(
        'UPDATE marketplace.vendor_locations SET version=$2, updated_at=$3 WHERE vendor_location_id=$1',
        [input.vendor_location_id, version, now],
      );
      await appendEvent(client, {
        aggregate_id: input.vendor_location_id,
        aggregate_type: 'VENDOR_LOCATION',
        context: input.context,
        event_type: 'FULFILMENT_MODES_REPLACED',
        now,
        reason_code: 'FULFILMENT_MODES_APPROVED',
        resulting_version: version,
      });
      return version;
    });
  }

  async getOperationalStatus(input: {
    readonly at?: Date;
    readonly latitude?: number;
    readonly longitude?: number;
    readonly vendor_location_id: UuidV7;
  }): Promise<OperationalStatus> {
    if ((input.latitude === undefined) !== (input.longitude === undefined))
      throw new VendorNetworkInputError('Latitude and longitude must be supplied together');
    const result = await this.#pool.query<{
      approved_fulfilment_modes: FulfilmentMode[];
      calendar_kind: CalendarExceptionKind | null;
      calendar_open: boolean | null;
      location_state: VendorLocationLifecycleState;
      minimum_order_minor: string;
      preparation_seconds: number;
      regular_open: boolean;
      temporarily_closed: boolean;
      vendor_state: VendorLifecycleState;
      zone_match: boolean | null;
    }>(
      `SELECT v.lifecycle_state AS vendor_state, l.lifecycle_state AS location_state,
        l.minimum_order_minor, l.preparation_seconds,
        ce.exception_kind AS calendar_kind,
        CASE WHEN ce.exception_kind='SPECIAL_HOURS' THEN
          (($2 AT TIME ZONE l.operating_timezone)::time >= ce.opens_at AND
           ($2 AT TIME ZONE l.operating_timezone)::time < ce.closes_at) END AS calendar_open,
        EXISTS (SELECT 1 FROM marketplace.vendor_location_operating_hours h
          WHERE h.vendor_location_id=l.vendor_location_id
            AND h.weekday=EXTRACT(DOW FROM ($2 AT TIME ZONE l.operating_timezone))::integer
            AND ($2 AT TIME ZONE l.operating_timezone)::time >= h.opens_at
            AND ($2 AT TIME ZONE l.operating_timezone)::time < h.closes_at) AS regular_open,
        EXISTS (SELECT 1 FROM marketplace.vendor_location_temporary_closures tc
          WHERE tc.vendor_location_id=l.vendor_location_id AND tc.starts_at <= $2 AND tc.ends_at > $2) AS temporarily_closed,
        CASE WHEN $3::double precision IS NULL THEN NULL ELSE EXISTS (
          SELECT 1 FROM marketplace.vendor_service_zones z WHERE z.vendor_location_id=l.vendor_location_id
            AND z.lifecycle_state='ACTIVE' AND ST_Covers(z.boundary,
              ST_SetSRID(ST_MakePoint($4,$3),4326)::geography)) END AS zone_match,
        ARRAY(SELECT f.fulfilment_mode FROM marketplace.vendor_location_fulfilment_modes f
          WHERE f.vendor_location_id=l.vendor_location_id ORDER BY f.fulfilment_mode) AS approved_fulfilment_modes
      FROM marketplace.vendor_locations l JOIN marketplace.vendors v USING (vendor_id)
      LEFT JOIN marketplace.vendor_location_calendar_exceptions ce
        ON ce.vendor_location_id=l.vendor_location_id
       AND ce.local_date=($2 AT TIME ZONE l.operating_timezone)::date
      WHERE l.vendor_location_id=$1`,
      [
        input.vendor_location_id,
        input.at ?? new Date(),
        input.latitude === undefined
          ? null
          : requireCoordinate(input.latitude, -90, 90, 'Latitude'),
        input.longitude === undefined
          ? null
          : requireCoordinate(input.longitude, -180, 180, 'Longitude'),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new VendorNetworkNotFoundError('Vendor location was not found');
    let reason: OperationalReason = 'OPEN';
    if (row.vendor_state !== 'ACTIVE') reason = 'VENDOR_INACTIVE';
    else if (row.location_state !== 'ACTIVE') reason = 'LOCATION_INACTIVE';
    else if (row.temporarily_closed) reason = 'TEMPORARILY_CLOSED';
    else if (row.calendar_kind === 'CLOSED') reason = 'CALENDAR_CLOSED';
    else if (row.calendar_kind === 'SPECIAL_HOURS' ? !row.calendar_open : !row.regular_open)
      reason = 'OUTSIDE_HOURS';
    else if (row.zone_match === false) reason = 'OUTSIDE_SERVICE_ZONE';
    return {
      approved_fulfilment_modes: row.approved_fulfilment_modes,
      currency: 'INR',
      minimum_order_minor: Number(row.minimum_order_minor),
      open: reason === 'OPEN',
      preparation_seconds: row.preparation_seconds,
      reason,
    };
  }
}
