import { releaseServicePool, resolveServicePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { transaction } from './transaction.js';

export class VendorSettingsInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class VendorSettingsNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
/**
 * A stale optimistic-concurrency version on a row that does exist.
 *
 * Previously folded into "not found", which told the caller their store had
 * vanished when in fact a colleague had saved first. ENG-03 asks for a
 * recoverable conflict, and a client can only offer "reload and try again" if
 * it can tell the two apart.
 */
export class VendorSettingsConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';
}
export class VendorSettingsAuthorizationError extends Error {
  readonly code = 'AUTHORIZATION_DENIED';
}

async function requireVendorOwner(
  client: PoolClient,
  input: { readonly context: RequestContext; readonly vendor_location_id: UuidV7 },
): Promise<void> {
  const actor = input.context.actor;
  if (!actor || actor.actor_kind !== 'vendor_staff') {
    throw new VendorSettingsAuthorizationError('Vendor staff role required');
  }
  const rows = await client.query<{ exists: boolean }>(
    `SELECT 1 AS exists FROM marketplace.role_assignments ra
       JOIN marketplace.staff_memberships sm USING (role_assignment_id)
      WHERE ra.user_id = $1 AND ra.state = 'ACTIVE'
        AND ra.role_key IN ('VENDOR_OWNER','VENDOR_MANAGER')
        AND sm.vendor_location_id = $2`,
    [parseUuidV7(actor.actor_id), parseUuidV7(input.vendor_location_id)],
  );
  if (!rows.rows[0]) {
    throw new VendorSettingsAuthorizationError('Not a VENDOR_OWNER/MANAGER at this location');
  }
}

export interface VendorLocationSettingsUpdate {
  readonly context: RequestContext;
  readonly vendor_location_id: UuidV7;
  readonly expected_version: number;
  readonly location_name?: string;
  readonly profile_description?: string | null;
  /** `null` clears it; absent leaves it. */
  readonly landmark?: string | null;
  readonly preparation_seconds?: number;
  readonly minimum_order_minor?: number;
  readonly operating_timezone?: string;
  readonly hours?: readonly {
    readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    readonly opens_at: string; // 'HH:MM' or 'HH:MM:SS'
    readonly closes_at: string;
  }[];
  readonly now?: Date;
}

const HH_MM_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/;

export class VendorSettingsService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-vendor-settings',
      connectionTimeoutMillis: 5_000,
      max: 4,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }

  async close(): Promise<void> {
    await releaseServicePool(this.#pool);
  }

  /**
   * The store's current settings, including the version an edit must carry.
   *
   * There was no read at all. That has two consequences the settings screen was
   * living with: the form had nothing to populate from, so it started on
   * hardcoded defaults and *overwrote* the real name, hours, minimum and
   * preparation time with them on save; and `expected_version` — an optimistic
   * concurrency token — was exposed as a text box for the shopkeeper to type,
   * because nothing could tell them what it was. ENG-03 wants a stale edit to
   * return a recoverable conflict, not to make the version a guessing game.
   */
  async readLocation(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }): Promise<{
    readonly vendor_location_id: UuidV7;
    readonly location_name: string;
    readonly profile_description: string | null;
    /** The written way to find the store, for the partner heading there (9.4). */
    readonly landmark: string | null;
    readonly category: string;
    readonly lifecycle_state: string;
    readonly operating_timezone: string;
    readonly preparation_seconds: number | null;
    readonly minimum_order_minor: number;
    readonly currency: string;
    readonly version: number;
    readonly fulfilment_modes: readonly string[];
    readonly hours: readonly {
      readonly weekday: number;
      readonly opens_at: string;
      readonly closes_at: string;
    }[];
  }> {
    return transaction(this.#pool, async (client) => {
      await requireVendorOwner(client, input);
      const found = await client.query<{
        vendor_location_id: string;
        location_name: string;
        profile_description: string | null;
        landmark: string | null;
        category: string;
        lifecycle_state: string;
        operating_timezone: string;
        preparation_seconds: number | null;
        minimum_order_minor: string;
        currency: string;
        version: number;
        fulfilment_modes: string[];
      }>(
        `SELECT l.vendor_location_id, l.location_name, l.profile_description, l.landmark, l.category,
                l.lifecycle_state, l.operating_timezone, l.preparation_seconds,
                l.minimum_order_minor::text AS minimum_order_minor, l.currency, l.version,
                COALESCE(
                  (SELECT array_agg(DISTINCT fulfilment_mode)
                     FROM marketplace.vendor_location_fulfilment_modes
                    WHERE vendor_location_id = l.vendor_location_id),
                  ARRAY[]::text[]
                ) AS fulfilment_modes
           FROM marketplace.vendor_locations l
          WHERE l.vendor_location_id = $1`,
        [parseUuidV7(input.vendor_location_id)],
      );
      const row = found.rows[0];
      if (!row) throw new VendorSettingsNotFoundError('Vendor location was not found');
      const hours = await client.query<{
        weekday: number;
        opens_at: string;
        closes_at: string;
      }>(
        `SELECT weekday, opens_at::text AS opens_at, closes_at::text AS closes_at
           FROM marketplace.vendor_location_operating_hours
          WHERE vendor_location_id = $1
          ORDER BY weekday, opens_at`,
        [parseUuidV7(input.vendor_location_id)],
      );
      return Object.freeze({
        vendor_location_id: parseUuidV7(row.vendor_location_id),
        location_name: row.location_name,
        profile_description: row.profile_description,
        landmark: row.landmark,
        category: row.category,
        lifecycle_state: row.lifecycle_state,
        operating_timezone: row.operating_timezone,
        preparation_seconds: row.preparation_seconds,
        minimum_order_minor: Number(row.minimum_order_minor),
        currency: row.currency,
        version: row.version,
        fulfilment_modes: Object.freeze([...row.fulfilment_modes]),
        hours: Object.freeze(
          hours.rows.map((hour) =>
            Object.freeze({
              weekday: hour.weekday,
              // `time` renders as HH:MM:SS; the form works in HH:MM.
              opens_at: hour.opens_at.slice(0, 5),
              closes_at: hour.closes_at.slice(0, 5),
            }),
          ),
        ),
      });
    });
  }

  async updateLocation(input: VendorLocationSettingsUpdate): Promise<{ version: number }> {
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1) {
      throw new VendorSettingsInputError('expected_version must be a positive integer');
    }
    if (input.preparation_seconds !== undefined) {
      if (
        !Number.isSafeInteger(input.preparation_seconds) ||
        input.preparation_seconds < 60 ||
        input.preparation_seconds > 24 * 60 * 60
      ) {
        throw new VendorSettingsInputError('preparation_seconds must be in [60, 86400]');
      }
    }
    if (input.minimum_order_minor !== undefined) {
      if (!Number.isSafeInteger(input.minimum_order_minor) || input.minimum_order_minor < 0) {
        throw new VendorSettingsInputError('minimum_order_minor must be a non-negative integer');
      }
    }
    if (input.location_name !== undefined) {
      const trimmed = input.location_name.trim();
      if (trimmed.length < 2 || trimmed.length > 120) {
        throw new VendorSettingsInputError('location_name length must be 2..120');
      }
    }
    if (input.landmark !== undefined && input.landmark !== null) {
      const trimmed = input.landmark.trim();
      if (trimmed.length < 2 || trimmed.length > 120) {
        throw new VendorSettingsInputError('landmark length must be 2..120');
      }
    }
    if (input.hours !== undefined) {
      for (const h of input.hours) {
        if (h.weekday < 0 || h.weekday > 6) {
          throw new VendorSettingsInputError('weekday must be 0..6');
        }
        if (!HH_MM_PATTERN.test(h.opens_at) || !HH_MM_PATTERN.test(h.closes_at)) {
          throw new VendorSettingsInputError('opens_at/closes_at must be HH:MM or HH:MM:SS');
        }
      }
    }
    const now = input.now ?? new Date();
    const requestId = parseRequestId(input.context.request_id);
    const correlationId = parseUuidV7(input.context.correlation_id);
    void requestId;
    void correlationId;

    return transaction(this.#pool, async (client) => {
      await requireVendorOwner(client, {
        context: input.context,
        vendor_location_id: input.vendor_location_id,
      });
      const updated = await client.query<{ version: number }>(
        `UPDATE marketplace.vendor_locations
            SET
              location_name = COALESCE($3, location_name),
              profile_description = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE profile_description END,
              preparation_seconds = COALESCE($5, preparation_seconds),
              minimum_order_minor = COALESCE($6, minimum_order_minor),
              operating_timezone = COALESCE($7, operating_timezone),
              landmark = CASE WHEN $9::boolean THEN $10::text ELSE landmark END,
              version = version + 1,
              updated_at = $8
          WHERE vendor_location_id = $1 AND version = $2
          RETURNING version`,
        [
          parseUuidV7(input.vendor_location_id),
          input.expected_version,
          input.location_name ?? null,
          input.profile_description ?? null,
          input.preparation_seconds ?? null,
          input.minimum_order_minor ?? null,
          input.operating_timezone ?? null,
          now,
          input.landmark !== undefined,
          input.landmark === undefined || input.landmark === null ? null : input.landmark.trim(),
        ],
      );
      if (!updated.rows[0]) {
        // Distinguish "gone" from "someone else got there first".
        const present = await client.query<{ version: number }>(
          'SELECT version FROM marketplace.vendor_locations WHERE vendor_location_id = $1',
          [parseUuidV7(input.vendor_location_id)],
        );
        if (present.rows[0]) {
          throw new VendorSettingsConflictError(
            'These settings changed while you were editing. Reload and try again.',
          );
        }
        throw new VendorSettingsNotFoundError('Vendor location not found');
      }
      if (input.hours && input.hours.length > 0) {
        await client.query(
          'DELETE FROM marketplace.vendor_location_operating_hours WHERE vendor_location_id = $1',
          [parseUuidV7(input.vendor_location_id)],
        );
        for (const h of input.hours) {
          const opens = h.opens_at.length === 5 ? `${h.opens_at}:00` : h.opens_at;
          const closes = h.closes_at.length === 5 ? `${h.closes_at}:00` : h.closes_at;
          await client.query(
            `INSERT INTO marketplace.vendor_location_operating_hours
               (operating_hour_id, vendor_location_id, weekday, opens_at, closes_at)
             VALUES ($1, $2, $3, $4::time, $5::time)`,
            [
              createUuidV7({ now_ms: now.getTime() }),
              parseUuidV7(input.vendor_location_id),
              h.weekday,
              opens,
              closes,
            ],
          );
        }
      }
      return { version: updated.rows[0].version };
    });
  }

  /**
   * Toggle the operating state of a vendor location. PAUSED hides the store
   * from customer discovery via the vendor_locations.lifecycle_state join;
   * ACTIVE restores it.
   */
  async setLifecycle(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly state: 'ACTIVE' | 'PAUSED';
    readonly expected_version: number;
    readonly now?: Date;
  }): Promise<{ version: number; lifecycle_state: 'ACTIVE' | 'PAUSED' }> {
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1) {
      throw new VendorSettingsInputError('expected_version must be a positive integer');
    }
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      await requireVendorOwner(client, {
        context: input.context,
        vendor_location_id: input.vendor_location_id,
      });
      const row = await client.query<{ version: number; lifecycle_state: 'ACTIVE' | 'PAUSED' }>(
        `UPDATE marketplace.vendor_locations
            SET lifecycle_state = $3, version = version + 1, updated_at = $4
          WHERE vendor_location_id = $1 AND version = $2
          RETURNING version, lifecycle_state`,
        [parseUuidV7(input.vendor_location_id), input.expected_version, input.state, now],
      );
      if (!row.rows[0]) {
        const present = await client.query<{ version: number }>(
          'SELECT version FROM marketplace.vendor_locations WHERE vendor_location_id = $1',
          [parseUuidV7(input.vendor_location_id)],
        );
        if (present.rows[0]) {
          throw new VendorSettingsConflictError(
            'This store changed while you were editing. Reload and try again.',
          );
        }
        throw new VendorSettingsNotFoundError('Vendor location not found');
      }
      return row.rows[0];
    });
  }
}
