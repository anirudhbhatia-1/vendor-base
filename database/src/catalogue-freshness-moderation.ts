import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';

export type AvailabilityFreshness = 'FRESH' | 'STALE' | 'EXPIRED';
export type CatalogueModerationState = 'PENDING' | 'CLEARED' | 'CORRECTION_REQUIRED' | 'RESTRICTED';

export interface CustomerAvailabilityRecord {
  readonly availability_state: 'AVAILABLE' | 'LOW_STOCK' | 'VENDOR_CONFIRMS';
  readonly display_name: string;
  readonly freshness: AvailabilityFreshness;
  readonly inventory_item_id: UuidV7;
  readonly last_confirmed_at: string;
  readonly product_reference: string;
}
export interface CatalogueModerationCase {
  readonly correction_reason: string | null;
  readonly display_name: string;
  readonly inventory_item_id: UuidV7;
  readonly moderation_case_id: UuidV7;
  readonly moderation_state: CatalogueModerationState;
  readonly product_reference: string;
  readonly reason_code: string;
  readonly vendor_location_id: UuidV7;
  readonly version: number;
}

export class CatalogueModerationInputError extends Error {}
export class CatalogueModerationNotFoundError extends Error {}
export class CatalogueModerationConflictError extends Error {}
export class CatalogueModerationAuthorizationError extends Error {}

const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const FRESH_MS = 15 * 60_000;
const STALE_MS = 60 * 60_000;

function assertAdmin(context: RequestContext): UuidV7 {
  if (!context.actor || context.actor.actor_kind !== 'admin') {
    throw new CatalogueModerationAuthorizationError('Catalogue moderation requires an admin actor');
  }
  return context.actor.actor_id;
}
function validReason(value: string): string {
  if (!REASON.test(value)) throw new CatalogueModerationInputError('Reason code is invalid');
  return value;
}
function correction(value: string | undefined): string | null {
  if (value === undefined) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 3 || normalized.length > 500) {
    throw new CatalogueModerationInputError('Correction reason must be 3 to 500 characters');
  }
  return normalized;
}
function freshness(lastConfirmedAt: Date, now: Date): AvailabilityFreshness {
  const age = Math.max(0, now.getTime() - lastConfirmedAt.getTime());
  if (age <= FRESH_MS) return 'FRESH';
  if (age <= STALE_MS) return 'STALE';
  return 'EXPIRED';
}
function customerRecord(row: CustomerRow, now: Date): CustomerAvailabilityRecord {
  return Object.freeze({
    availability_state: row.availability_state,
    display_name: row.display_name,
    freshness: freshness(row.last_confirmed_at, now),
    inventory_item_id: parseUuidV7(row.inventory_item_id),
    last_confirmed_at: row.last_confirmed_at.toISOString(),
    product_reference: row.product_reference,
  });
}
function moderationRecord(row: ModerationRow): CatalogueModerationCase {
  return Object.freeze({
    correction_reason: row.correction_reason,
    display_name: row.display_name,
    inventory_item_id: parseUuidV7(row.inventory_item_id),
    moderation_case_id: parseUuidV7(row.moderation_case_id),
    moderation_state: row.moderation_state,
    product_reference: row.product_reference,
    reason_code: row.reason_code,
    vendor_location_id: parseUuidV7(row.vendor_location_id),
    version: row.version,
  });
}
async function transaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface CustomerRow {
  availability_state: 'AVAILABLE' | 'LOW_STOCK' | 'VENDOR_CONFIRMS';
  display_name: string;
  inventory_item_id: string;
  last_confirmed_at: Date;
  product_reference: string;
}
interface ModerationRow {
  correction_reason: string | null;
  display_name: string;
  inventory_item_id: string;
  moderation_case_id: string;
  moderation_state: CatalogueModerationState;
  product_reference: string;
  reason_code: string;
  vendor_location_id: string;
  version: number;
}

export class CatalogueFreshnessModerationService {
  readonly #pool: Pool;
  constructor(input: { readonly connection_string: string }) {
    this.#pool = new Pool({
      application_name: 'neighbourhood-store-catalogue-freshness-moderation',
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

  async listCustomerAvailability(input: {
    readonly vendor_location_id: UuidV7;
    readonly now?: Date;
  }): Promise<readonly CustomerAvailabilityRecord[]> {
    const now = input.now ?? new Date();
    const result = await this.#pool.query<CustomerRow>(
      `SELECT item.inventory_item_id, item.display_name, item.product_reference,
              item.availability_state, item.last_confirmed_at
         FROM marketplace.inventory_items item
         JOIN marketplace.vendor_locations location USING (vendor_location_id)
        WHERE item.vendor_location_id=$1
          AND location.lifecycle_state='ACTIVE'
          AND item.availability_state IN ('AVAILABLE','LOW_STOCK','VENDOR_CONFIRMS')
          AND NOT EXISTS (
            SELECT 1 FROM marketplace.catalogue_moderation_cases moderation
             WHERE moderation.inventory_item_id=item.inventory_item_id
               AND moderation.moderation_state IN ('CORRECTION_REQUIRED','RESTRICTED')
          )
        ORDER BY item.display_name, item.inventory_item_id`,
      [input.vendor_location_id],
    );
    return Object.freeze(result.rows.map((row) => customerRecord(row, now)));
  }

  async openCase(input: {
    readonly context: RequestContext;
    readonly inventory_item_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<CatalogueModerationCase> {
    const actorId = assertAdmin(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const item = await client.query<{ vendor_location_id: string }>(
        'SELECT vendor_location_id FROM marketplace.inventory_items WHERE inventory_item_id=$1 FOR SHARE',
        [input.inventory_item_id],
      );
      const vendorLocationId = item.rows[0]?.vendor_location_id;
      if (!vendorLocationId)
        throw new CatalogueModerationNotFoundError('Inventory item was not found');
      const ids = {
        request: parseRequestId(input.context.request_id),
        correlation: parseUuidV7(input.context.correlation_id),
      };
      let created: ModerationRow;
      try {
        const result = await client.query<ModerationRow>(
          `INSERT INTO marketplace.catalogue_moderation_cases
             (moderation_case_id,inventory_item_id,vendor_location_id,moderation_state,reason_code,
              opened_by_actor_id,request_id,correlation_id,created_at,updated_at)
           VALUES ($1,$2,$3,'PENDING',$4,$5,$6,$7,$8,$8) RETURNING
             moderation_case_id,inventory_item_id,vendor_location_id,moderation_state,reason_code,
             correction_reason,version,
             (SELECT display_name FROM marketplace.inventory_items WHERE inventory_item_id=$2) display_name,
             (SELECT product_reference FROM marketplace.inventory_items WHERE inventory_item_id=$2) product_reference`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            input.inventory_item_id,
            vendorLocationId,
            validReason(input.reason_code),
            actorId,
            ids.request,
            ids.correlation,
            now,
          ],
        );
        const inserted = result.rows[0];
        if (!inserted)
          throw new CatalogueModerationNotFoundError('Moderation case was not created');
        created = inserted;
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === '23505'
        ) {
          throw new CatalogueModerationConflictError('An open moderation case already exists');
        }
        throw error;
      }
      await client.query(
        `INSERT INTO marketplace.catalogue_moderation_events
          (moderation_event_id,moderation_case_id,event_type,resulting_state,actor_id,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,'CASE_OPENED','PENDING',$3,$4,$5,$6)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          created.moderation_case_id,
          actorId,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      return moderationRecord(created);
    });
  }

  async decideCase(input: {
    readonly context: RequestContext;
    readonly correction_reason?: string;
    readonly expected_version: number;
    readonly moderation_case_id: UuidV7;
    readonly moderation_state: Exclude<CatalogueModerationState, 'PENDING'>;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<CatalogueModerationCase> {
    const actorId = assertAdmin(input.context);
    if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1)
      throw new CatalogueModerationInputError('Expected version is invalid');
    const now = input.now ?? new Date();
    const correctionReason =
      input.moderation_state === 'CLEARED' ? undefined : input.correction_reason;
    if (input.moderation_state === 'CLEARED' && input.correction_reason !== undefined)
      throw new CatalogueModerationInputError('Cleared cases cannot include a correction reason');
    const normalisedCorrection =
      input.moderation_state === 'CLEARED' ? null : correction(correctionReason);
    if (input.moderation_state !== 'CLEARED' && normalisedCorrection === null)
      throw new CatalogueModerationInputError('A correction reason is required');
    return transaction(this.#pool, async (client) => {
      const locked = await client.query<ModerationRow>(
        `SELECT case_.moderation_case_id,case_.inventory_item_id,case_.vendor_location_id,case_.moderation_state,
                case_.reason_code,case_.correction_reason,case_.version,item.display_name,item.product_reference
           FROM marketplace.catalogue_moderation_cases case_
           JOIN marketplace.inventory_items item USING (inventory_item_id)
          WHERE case_.moderation_case_id=$1 FOR UPDATE OF case_`,
        [input.moderation_case_id],
      );
      const current = locked.rows[0];
      if (!current) throw new CatalogueModerationNotFoundError('Moderation case was not found');
      if (current.moderation_state !== 'PENDING')
        throw new CatalogueModerationConflictError('Only pending cases can be decided');
      if (current.version !== input.expected_version)
        throw new CatalogueModerationConflictError('Moderation case version is stale');
      const ids = {
        request: parseRequestId(input.context.request_id),
        correlation: parseUuidV7(input.context.correlation_id),
      };
      const updated = await client.query<ModerationRow>(
        `UPDATE marketplace.catalogue_moderation_cases SET moderation_state=$2,reason_code=$3,
           correction_reason=$4,reviewed_by_actor_id=$5,reviewed_at=$6,updated_at=$6,version=version+1,
           request_id=$7,correlation_id=$8 WHERE moderation_case_id=$1 RETURNING
           moderation_case_id,inventory_item_id,vendor_location_id,moderation_state,reason_code,correction_reason,version`,
        [
          input.moderation_case_id,
          input.moderation_state,
          validReason(input.reason_code),
          normalisedCorrection,
          actorId,
          now,
          ids.request,
          ids.correlation,
        ],
      );
      const reviewed = updated.rows[0];
      if (!reviewed) throw new CatalogueModerationNotFoundError('Moderation case was not found');
      const result = {
        ...reviewed,
        display_name: current.display_name,
        product_reference: current.product_reference,
      };
      const eventType =
        input.moderation_state === 'CLEARED'
          ? 'CASE_CLEARED'
          : input.moderation_state === 'RESTRICTED'
            ? 'ITEM_RESTRICTED'
            : 'CORRECTION_REQUIRED';
      await client.query(
        `INSERT INTO marketplace.catalogue_moderation_events
          (moderation_event_id,moderation_case_id,event_type,previous_state,resulting_state,actor_id,request_id,correlation_id,occurred_at)
         VALUES ($1,$2,$3,'PENDING',$4,$5,$6,$7,$8)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          input.moderation_case_id,
          eventType,
          input.moderation_state,
          actorId,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      return moderationRecord(result);
    });
  }

  async listQueue(input: {
    readonly context: RequestContext;
    readonly state?: CatalogueModerationState;
  }): Promise<readonly CatalogueModerationCase[]> {
    assertAdmin(input.context);
    const state = input.state;
    const result = await this.#pool.query<ModerationRow>(
      `SELECT case_.moderation_case_id,case_.inventory_item_id,case_.vendor_location_id,case_.moderation_state,
              case_.reason_code,case_.correction_reason,case_.version,item.display_name,item.product_reference
         FROM marketplace.catalogue_moderation_cases case_
         JOIN marketplace.inventory_items item USING (inventory_item_id)
        WHERE ($1::text IS NULL OR case_.moderation_state=$1)
        ORDER BY case_.created_at,case_.moderation_case_id`,
      [state ?? null],
    );
    return Object.freeze(result.rows.map(moderationRecord));
  }
}
