import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { resolveConfiguration } from './versioned-configuration.js';

export class CustomerAddressInputError extends Error {}
export class CustomerAddressNotFoundError extends Error {}
export class CustomerAddressConflictError extends Error {}
export class CustomerAddressAuthorizationError extends Error {}

/** Applied when no active `customer.saved_address_limit` configuration exists. */
export const DEFAULT_SAVED_ADDRESS_LIMIT = 4;

export type CoordinateSource = 'DEVICE_LOCATION' | 'MANUAL_PIN';

export interface CustomerAddress {
  readonly customer_address_id: UuidV7;
  readonly address_reference: string;
  readonly label: string;
  readonly pin_code: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly coordinate_source: CoordinateSource;
  readonly landmark: string | null;
  readonly delivery_instructions: string | null;
  readonly is_selected: boolean;
  readonly lifecycle_state: 'ACTIVE' | 'ARCHIVED';
  readonly version: number;
}

/**
 * A fulfilment actor never sees a full address until the order it belongs to has
 * reached the stage that needs it. Until orders exist (Phase 7 onward) the only
 * caller is the owning customer, so every other stage resolves to the redacted
 * projection rather than inventing an authorization it cannot yet prove.
 */
export type FulfilmentStage = 'ASSIGNED' | 'CARRYING' | 'UNASSIGNED';

export interface RedactedCustomerAddress {
  readonly customer_address_id: UuidV7;
  readonly pin_code: string;
  readonly label: string;
  readonly landmark: string | null;
  readonly delivery_instructions: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

interface AddressRow {
  readonly customer_address_id: string;
  readonly address_reference: string;
  readonly label: string;
  readonly pin_code: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly coordinate_source: CoordinateSource;
  readonly landmark: string | null;
  readonly delivery_instructions: string | null;
  readonly is_selected: boolean;
  readonly lifecycle_state: 'ACTIVE' | 'ARCHIVED';
  readonly version: number;
}

const addressReference = /^SYNTH-ADDRESS-[A-Z0-9-]{4,64}$/;
const addressLabel = /^SYNTH [A-Za-z0-9][A-Za-z0-9 &'().,-]{1,80}$/;
const pinCode = /^[1-9][0-9]{5}$/;

function customer(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'customer') throw new CustomerAddressAuthorizationError();
  return context.actor.actor_id;
}

function requireCoordinates(latitude: number, longitude: number): void {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new CustomerAddressInputError('Coordinates are outside the permitted range');
  }
}

function requireOptionalText(value: string | null | undefined, limit: number, field: string) {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > limit) {
    throw new CustomerAddressInputError(`${field} must be between 1 and ${limit} characters`);
  }
  return trimmed;
}

function project(row: AddressRow): CustomerAddress {
  return Object.freeze({
    customer_address_id: parseUuidV7(row.customer_address_id),
    address_reference: row.address_reference,
    label: row.label,
    pin_code: row.pin_code,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    coordinate_source: row.coordinate_source,
    landmark: row.landmark,
    delivery_instructions: row.delivery_instructions,
    is_selected: row.is_selected,
    lifecycle_state: row.lifecycle_state,
    version: row.version,
  });
}

const selectColumns = `customer_address_id, address_reference, label, pin_code,
  ST_Y(coordinates::geometry)::text AS latitude,
  ST_X(coordinates::geometry)::text AS longitude,
  coordinate_source, landmark, delivery_instructions, is_selected, lifecycle_state, version`;

async function tx<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class CustomerAddressService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string }) {
    this.#pool = new Pool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-customer-addresses',
      max: 8,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  /**
   * The saved-address ceiling is operator policy, not a schema rule, so it is
   * read from versioned configuration and falls back to the documented default.
   */
  async savedAddressLimit(at?: Date): Promise<number> {
    const resolved = await resolveConfiguration(this.#pool, {
      configuration_key: 'customer.saved_address_limit',
      configuration_kind: 'SETTING',
      ...(at ? { at } : {}),
    });
    const value = resolved?.configuration_value;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 50) {
      return DEFAULT_SAVED_ADDRESS_LIMIT;
    }
    return value;
  }

  async listAddresses(input: {
    readonly context: RequestContext;
    readonly include_archived?: boolean;
  }): Promise<readonly CustomerAddress[]> {
    const userId = customer(input.context);
    const result = await this.#pool.query<AddressRow>(
      `SELECT ${selectColumns} FROM marketplace.customer_addresses
        WHERE user_id = $1 AND ($2 OR lifecycle_state = 'ACTIVE')
        ORDER BY is_selected DESC, created_at DESC`,
      [userId, input.include_archived ?? false],
    );
    return Object.freeze(result.rows.map(project));
  }

  async createAddress(input: {
    readonly context: RequestContext;
    readonly address_reference: string;
    readonly label: string;
    readonly pin_code: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly coordinate_source?: CoordinateSource;
    readonly landmark?: string | null;
    readonly delivery_instructions?: string | null;
    readonly now?: Date;
  }): Promise<CustomerAddress> {
    const userId = customer(input.context);
    if (!addressReference.test(input.address_reference))
      throw new CustomerAddressInputError('Address reference must be a synthetic reference');
    if (!addressLabel.test(input.label))
      throw new CustomerAddressInputError('Address label must be a synthetic label');
    if (!pinCode.test(input.pin_code))
      throw new CustomerAddressInputError('Pin code must be six digits');
    requireCoordinates(input.latitude, input.longitude);
    const landmark = requireOptionalText(input.landmark, 160, 'Landmark');
    const instructions = requireOptionalText(input.delivery_instructions, 240, 'Instructions');
    const limit = await this.savedAddressLimit(input.now);
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };

    return tx(this.#pool, async (client) => {
      // Row locks cannot hold a ceiling: the row that would breach it does not
      // exist yet, so there is nothing to lock. Serialise per customer instead.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
      const active = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM marketplace.customer_addresses
          WHERE user_id = $1 AND lifecycle_state = 'ACTIVE'`,
        [userId],
      );
      const existing = Number(active.rows[0]?.count ?? '0');
      if (existing >= limit) {
        throw new CustomerAddressConflictError(
          `A customer may keep at most ${limit} saved addresses`,
        );
      }
      const addressId = createUuidV7({ now_ms: now.getTime() });
      // The first saved address becomes the selected one so a customer always
      // has exactly one ordering address without an extra round trip.
      const selected = existing === 0;
      let inserted;
      try {
        inserted = await client.query<AddressRow>(
          `INSERT INTO marketplace.customer_addresses
             (customer_address_id, user_id, address_reference, label, pin_code, coordinates,
              coordinate_source, landmark, delivery_instructions, is_selected,
              request_id, correlation_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,
                   $8,$9,$10,$11,$12,$13,$14,$14)
           RETURNING ${selectColumns}`,
          [
            addressId,
            userId,
            input.address_reference,
            input.label,
            input.pin_code,
            input.longitude,
            input.latitude,
            input.coordinate_source ?? 'MANUAL_PIN',
            landmark,
            instructions,
            selected,
            ids.request,
            ids.correlation,
            now,
          ],
        );
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: unknown }).code === '23505'
        )
          throw new CustomerAddressConflictError('Address reference already exists');
        throw error;
      }
      const row = inserted.rows[0];
      if (!row) throw new CustomerAddressConflictError('Address was not created');
      await this.#recordEvent(client, {
        address_id: addressId,
        user_id: userId,
        version: 1,
        event_type: 'CREATED',
        actor_id: userId,
        reason_code: 'CUSTOMER_ADDED_ADDRESS',
        ids,
        now,
      });
      if (selected) {
        await this.#recordEvent(client, {
          address_id: addressId,
          user_id: userId,
          version: 1,
          event_type: 'SELECTED',
          actor_id: userId,
          reason_code: 'FIRST_ADDRESS_AUTOSELECTED',
          ids,
          now,
        });
      }
      return project(row);
    });
  }

  async updateAddress(input: {
    readonly context: RequestContext;
    readonly customer_address_id: UuidV7;
    readonly expected_version: number;
    readonly label: string;
    readonly pin_code: string;
    readonly latitude: number;
    readonly longitude: number;
    readonly coordinate_source?: CoordinateSource;
    readonly landmark?: string | null;
    readonly delivery_instructions?: string | null;
    readonly now?: Date;
  }): Promise<CustomerAddress> {
    const userId = customer(input.context);
    if (!addressLabel.test(input.label))
      throw new CustomerAddressInputError('Address label must be a synthetic label');
    if (!pinCode.test(input.pin_code))
      throw new CustomerAddressInputError('Pin code must be six digits');
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1)
      throw new CustomerAddressInputError('An expected version is required');
    requireCoordinates(input.latitude, input.longitude);
    const landmark = requireOptionalText(input.landmark, 160, 'Landmark');
    const instructions = requireOptionalText(input.delivery_instructions, 240, 'Instructions');
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };

    return tx(this.#pool, async (client) => {
      const updated = await client.query<AddressRow>(
        `UPDATE marketplace.customer_addresses
            SET label=$4, pin_code=$5,
                coordinates=ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,
                coordinate_source=$8, landmark=$9, delivery_instructions=$10,
                version=version+1, updated_at=$11, request_id=$12, correlation_id=$13
          WHERE customer_address_id=$1 AND user_id=$2 AND version=$3
            AND lifecycle_state='ACTIVE'
        RETURNING ${selectColumns}`,
        [
          input.customer_address_id,
          userId,
          input.expected_version,
          input.label,
          input.pin_code,
          input.longitude,
          input.latitude,
          input.coordinate_source ?? 'MANUAL_PIN',
          landmark,
          instructions,
          now,
          ids.request,
          ids.correlation,
        ],
      );
      const row = updated.rows[0];
      if (!row) throw new CustomerAddressNotFoundError();
      await this.#recordEvent(client, {
        address_id: input.customer_address_id,
        user_id: userId,
        version: row.version,
        event_type: 'UPDATED',
        actor_id: userId,
        reason_code: 'CUSTOMER_EDITED_ADDRESS',
        ids,
        now,
      });
      return project(row);
    });
  }

  async selectAddress(input: {
    readonly context: RequestContext;
    readonly customer_address_id: UuidV7;
    readonly now?: Date;
  }): Promise<CustomerAddress> {
    const userId = customer(input.context);
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };

    return tx(this.#pool, async (client) => {
      // Clear the previous selection first so the partial unique index never
      // sees two selected rows inside the transaction.
      const cleared = await client.query<{ customer_address_id: string; version: number }>(
        `UPDATE marketplace.customer_addresses SET is_selected=false, updated_at=$2
          WHERE user_id=$1 AND is_selected AND customer_address_id <> $3
        RETURNING customer_address_id, version`,
        [userId, now, input.customer_address_id],
      );
      const selected = await client.query<AddressRow>(
        `UPDATE marketplace.customer_addresses SET is_selected=true, updated_at=$3,
                request_id=$4, correlation_id=$5
          WHERE customer_address_id=$1 AND user_id=$2 AND lifecycle_state='ACTIVE'
        RETURNING ${selectColumns}`,
        [input.customer_address_id, userId, now, ids.request, ids.correlation],
      );
      const row = selected.rows[0];
      if (!row) throw new CustomerAddressNotFoundError();
      for (const previous of cleared.rows) {
        await this.#recordEvent(client, {
          address_id: parseUuidV7(previous.customer_address_id),
          user_id: userId,
          version: previous.version,
          event_type: 'DESELECTED',
          actor_id: userId,
          reason_code: 'CUSTOMER_CHANGED_SELECTION',
          ids,
          now,
        });
      }
      await this.#recordEvent(client, {
        address_id: input.customer_address_id,
        user_id: userId,
        version: row.version,
        event_type: 'SELECTED',
        actor_id: userId,
        reason_code: 'CUSTOMER_CHANGED_SELECTION',
        ids,
        now,
      });
      return project(row);
    });
  }

  /**
   * Removing an address archives it. History and any later order snapshot must
   * keep resolving, so the row is never deleted.
   */
  async archiveAddress(input: {
    readonly context: RequestContext;
    readonly customer_address_id: UuidV7;
    readonly now?: Date;
  }): Promise<CustomerAddress> {
    const userId = customer(input.context);
    const now = input.now ?? new Date();
    const ids = {
      request: parseRequestId(input.context.request_id),
      correlation: parseUuidV7(input.context.correlation_id),
    };

    return tx(this.#pool, async (client) => {
      const archived = await client.query<AddressRow>(
        `UPDATE marketplace.customer_addresses
            SET lifecycle_state='ARCHIVED', is_selected=false, version=version+1,
                updated_at=$3, request_id=$4, correlation_id=$5
          WHERE customer_address_id=$1 AND user_id=$2 AND lifecycle_state='ACTIVE'
        RETURNING ${selectColumns}`,
        [input.customer_address_id, userId, now, ids.request, ids.correlation],
      );
      const row = archived.rows[0];
      if (!row) throw new CustomerAddressNotFoundError();
      await this.#recordEvent(client, {
        address_id: input.customer_address_id,
        user_id: userId,
        version: row.version,
        event_type: 'ARCHIVED',
        actor_id: userId,
        reason_code: 'CUSTOMER_REMOVED_ADDRESS',
        ids,
        now,
      });
      return project(row);
    });
  }

  /**
   * Serviceability is derived, never stored: a zone can be added or retired at
   * any time, so a cached answer would go stale silently.
   */
  async eligibleVendorLocations(input: {
    readonly context: RequestContext;
    readonly customer_address_id: UuidV7;
  }): Promise<readonly UuidV7[]> {
    const userId = customer(input.context);
    const result = await this.#pool.query<{ vendor_location_id: string }>(
      `SELECT DISTINCT z.vendor_location_id
         FROM marketplace.customer_addresses a
         JOIN marketplace.vendor_service_zones z
           ON z.lifecycle_state = 'ACTIVE' AND ST_Covers(z.boundary, a.coordinates)
         JOIN marketplace.vendor_locations l
           ON l.vendor_location_id = z.vendor_location_id AND l.lifecycle_state = 'ACTIVE'
        WHERE a.customer_address_id = $1 AND a.user_id = $2 AND a.lifecycle_state = 'ACTIVE'
        ORDER BY z.vendor_location_id`,
      [input.customer_address_id, userId],
    );
    return Object.freeze(result.rows.map((row) => parseUuidV7(row.vendor_location_id)));
  }

  /**
   * Stage gate for later fulfilment actors. Precise coordinates and the free-text
   * fields are withheld until an assignment is actually carrying the order.
   */
  async fulfilmentProjection(input: {
    readonly customer_address_id: UuidV7;
    readonly stage: FulfilmentStage;
  }): Promise<RedactedCustomerAddress> {
    const result = await this.#pool.query<AddressRow>(
      `SELECT ${selectColumns} FROM marketplace.customer_addresses
        WHERE customer_address_id = $1`,
      [input.customer_address_id],
    );
    const row = result.rows[0];
    if (!row) throw new CustomerAddressNotFoundError();
    const precise = input.stage === 'CARRYING';
    return Object.freeze({
      customer_address_id: parseUuidV7(row.customer_address_id),
      pin_code: row.pin_code,
      label: row.label,
      landmark: precise ? row.landmark : null,
      delivery_instructions: precise ? row.delivery_instructions : null,
      latitude: precise ? Number(row.latitude) : null,
      longitude: precise ? Number(row.longitude) : null,
    });
  }

  async #recordEvent(
    client: PoolClient,
    input: {
      readonly address_id: UuidV7;
      readonly user_id: UuidV7;
      readonly version: number;
      readonly event_type: 'ARCHIVED' | 'CREATED' | 'DESELECTED' | 'SELECTED' | 'UPDATED';
      readonly actor_id: UuidV7;
      readonly reason_code: string;
      readonly ids: { readonly request: string; readonly correlation: string };
      readonly now: Date;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO marketplace.customer_address_events
         (event_id, customer_address_id, user_id, resulting_version, event_type,
          actor_id, reason_code, request_id, correlation_id, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        createUuidV7({ now_ms: input.now.getTime() }),
        input.address_id,
        input.user_id,
        input.version,
        input.event_type,
        input.actor_id,
        input.reason_code,
        input.ids.request,
        input.ids.correlation,
        input.now,
      ],
    );
  }
}
