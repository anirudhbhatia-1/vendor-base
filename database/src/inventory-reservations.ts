import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type ActorKind,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { transaction } from './transaction.js';

export type InventoryQuantityBasis = 'COUNTED' | 'VENDOR_CONFIRMS';
export type InventoryAvailability = 'AVAILABLE' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'VENDOR_CONFIRMS';
export type InventoryReservationState =
  'COMMITTED' | 'EXPIRED' | 'PROVISIONAL' | 'RELEASED' | 'SOFT_HELD';

export interface InventoryItemRecord {
  readonly availability_state: InventoryAvailability;
  readonly display_name: string;
  readonly exact_available_quantity: number | null;
  readonly inventory_item_id: UuidV7;
  readonly last_confirmed_at: string;
  readonly low_stock_threshold: number | null;
  readonly product_reference: string;
  readonly quantity_basis: InventoryQuantityBasis;
  readonly vendor_location_id: UuidV7;
  readonly version: number;
}

export interface InventoryReservationRecord {
  readonly counted_stock_applied: boolean;
  readonly expires_at: string;
  readonly inventory_item_id: UuidV7;
  readonly quantity: number;
  readonly reservation_id: UuidV7;
  readonly reservation_state: InventoryReservationState;
  readonly source_reference: string;
  readonly vendor_location_id: UuidV7;
  readonly version: number;
}

/**
 * What a stock line looks like to the shopkeeper who owns it.
 *
 * `inventory_items` is keyed by `(vendor_location_id, product_reference)` and
 * carries no link to the catalogue, while the checkout quote joins the two on
 * exactly that pair — with an inner join. A stock line whose reference matches
 * no catalogue product is therefore invisible to every customer, and the
 * console showed it identically to a sellable one. This read model carries the
 * catalogue side so the difference can be stated on screen.
 */
export interface VendorStockLine extends InventoryItemRecord {
  readonly catalogue_product_id: UuidV7 | null;
  readonly catalogue_title: string | null;
  readonly catalogue_lifecycle_state: string | null;
  readonly unit_label: string | null;
  readonly price_minor: number | null;
  /** Units spoken for by carts and unfulfilled orders, not yet collected. */
  readonly held_quantity: number;
}

export class InventoryInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class InventoryNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
export class InventoryConflictError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}
export class InventoryVersionError extends Error {
  readonly code = 'VERSION_CONFLICT';
}
export class InventoryAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}
export class InventoryUnavailableError extends Error {
  readonly code = 'INVENTORY_UNAVAILABLE';
  constructor(readonly available_quantity: number | null) {
    super('The requested inventory is unavailable');
  }
}

interface ItemRow {
  availability_state: InventoryAvailability;
  display_name: string;
  exact_available_quantity: string | null;
  inventory_item_id: string;
  last_confirmed_at: Date;
  lifecycle_state?: string;
  low_stock_threshold: string | null;
  product_reference: string;
  quantity_basis: InventoryQuantityBasis;
  vendor_location_id: string;
  version: number;
}
interface ReservationRow {
  counted_stock_applied: boolean;
  expires_at: Date;
  inventory_item_id: string;
  quantity: string;
  reservation_id: string;
  reservation_state: InventoryReservationState;
  source_reference: string;
  vendor_location_id: string;
  version: number;
}

const PRODUCT_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const SOURCE_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{3,127}$/;
const DISPLAY_NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'().,/%+-]{1,118}$/u;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;

function actor(
  context: RequestContext,
  allowed: readonly ActorKind[],
): { readonly id: UuidV7; readonly kind: ActorKind } {
  if (!context.actor || !allowed.includes(context.actor.actor_kind)) {
    throw new InventoryAuthorizationError('The authenticated actor cannot perform this command');
  }
  return { id: context.actor.actor_id, kind: context.actor.actor_kind };
}

function quantity(value: number, label = 'Quantity'): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new InventoryInputError(`${label} must be an integer from 1 to 1000000`);
  }
  return value;
}

function stock(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000) {
    throw new InventoryInputError('Exact stock must be an integer from 0 to 100000000');
  }
  return value;
}

function threshold(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new InventoryInputError('Low-stock threshold must be an integer from 0 to 1000000');
  }
  return value;
}

function reason(value: string): string {
  if (!REASON.test(value)) throw new InventoryInputError('Reason code is invalid');
  return value;
}

function productReference(value: string): string {
  if (!PRODUCT_REFERENCE.test(value)) {
    throw new InventoryInputError('Product reference is invalid');
  }
  return value;
}

function sourceReference(value: string): string {
  if (!SOURCE_REFERENCE.test(value)) {
    throw new InventoryInputError('Reservation source reference is invalid');
  }
  return value;
}

function displayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!DISPLAY_NAME.test(normalized)) {
    throw new InventoryInputError('Inventory display name contains unsupported characters');
  }
  return normalized;
}

function expiry(value: Date, now: Date, maximumMs: number): Date {
  if (!Number.isFinite(value.getTime())) throw new InventoryInputError('Expiry is invalid');
  const duration = value.getTime() - now.getTime();
  if (duration < 5_000 || duration > maximumMs) {
    throw new InventoryInputError('Expiry is outside the permitted server-time window');
  }
  return value;
}

function countedAvailability(value: number, lowStockThreshold: number): InventoryAvailability {
  if (value === 0) return 'OUT_OF_STOCK';
  return value <= lowStockThreshold ? 'LOW_STOCK' : 'AVAILABLE';
}

function itemRecord(row: ItemRow): InventoryItemRecord {
  return Object.freeze({
    availability_state: row.availability_state,
    display_name: row.display_name,
    exact_available_quantity:
      row.exact_available_quantity === null ? null : Number(row.exact_available_quantity),
    inventory_item_id: parseUuidV7(row.inventory_item_id),
    last_confirmed_at: row.last_confirmed_at.toISOString(),
    low_stock_threshold: row.low_stock_threshold === null ? null : Number(row.low_stock_threshold),
    product_reference: row.product_reference,
    quantity_basis: row.quantity_basis,
    vendor_location_id: parseUuidV7(row.vendor_location_id),
    version: row.version,
  });
}

function reservationRecord(row: ReservationRow): InventoryReservationRecord {
  return Object.freeze({
    counted_stock_applied: row.counted_stock_applied,
    expires_at: row.expires_at.toISOString(),
    inventory_item_id: parseUuidV7(row.inventory_item_id),
    quantity: Number(row.quantity),
    reservation_id: parseUuidV7(row.reservation_id),
    reservation_state: row.reservation_state,
    source_reference: row.source_reference,
    vendor_location_id: parseUuidV7(row.vendor_location_id),
    version: row.version,
  });
}

function contextIds(context: RequestContext) {
  return {
    causationId: context.causation_id ? parseUuidV7(context.causation_id) : null,
    correlationId: parseUuidV7(context.correlation_id),
    requestId: parseRequestId(context.request_id),
  };
}

async function appendEvent(
  client: PoolClient,
  input: {
    readonly actor_id: UuidV7;
    readonly actor_kind: ActorKind;
    readonly context: RequestContext;
    readonly event_type:
      | 'AVAILABILITY_CONFIRMED'
      | 'COMMITTED'
      | 'EXPIRED'
      | 'ITEM_CREATED'
      | 'PROVISIONAL'
      | 'RELEASED'
      | 'SOFT_HELD'
      | 'STOCK_SET';
    readonly exact_available_quantity: number | null;
    readonly inventory_item_id: UuidV7;
    readonly item_version: number;
    readonly previous_state?: InventoryReservationState | null;
    readonly quantity?: number | null;
    readonly reason_code: string;
    readonly reservation_id?: UuidV7 | null;
    readonly reservation_version?: number | null;
    readonly resulting_state?: InventoryReservationState | null;
    readonly counted_stock_applied?: boolean | null;
    readonly now: Date;
  },
) {
  const ids = contextIds(input.context);
  await client.query(
    `INSERT INTO marketplace.inventory_events
      (inventory_event_id, inventory_item_id, item_version, reservation_id,
       reservation_version, event_type, previous_state, resulting_state,
       actor_id, actor_kind, reason_code, quantity, exact_available_quantity,
       counted_stock_applied, request_id, correlation_id, causation_id, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.inventory_item_id,
      input.item_version,
      input.reservation_id ?? null,
      input.reservation_version ?? null,
      input.event_type,
      input.previous_state ?? null,
      input.resulting_state ?? null,
      input.actor_id,
      input.actor_kind,
      reason(input.reason_code),
      input.quantity ?? null,
      input.exact_available_quantity,
      input.counted_stock_applied ?? null,
      ids.requestId,
      ids.correlationId,
      ids.causationId,
      input.now,
    ],
  );
}

async function lockItem(client: PoolClient, id: UuidV7): Promise<ItemRow> {
  const result = await client.query<ItemRow>(
    `SELECT item.*, location.lifecycle_state
       FROM marketplace.inventory_items item
       JOIN marketplace.vendor_locations location USING (vendor_location_id)
      WHERE item.inventory_item_id=$1 FOR UPDATE OF item`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new InventoryNotFoundError('Inventory item was not found');
  return row;
}

function requiredRow<T>(rows: readonly T[], message: string): T {
  const row = rows[0];
  if (!row) throw new InventoryNotFoundError(message);
  return row;
}

async function lockReservation(
  client: PoolClient,
  id: UuidV7,
  expectedVersion: number,
): Promise<{ item: ItemRow; reservation: ReservationRow }> {
  const reservationResult = await client.query<ReservationRow>(
    `SELECT * FROM marketplace.inventory_reservations WHERE reservation_id=$1 FOR UPDATE`,
    [id],
  );
  const reservation = reservationResult.rows[0];
  if (!reservation) throw new InventoryNotFoundError('Inventory reservation was not found');
  if (!Number.isSafeInteger(expectedVersion) || reservation.version !== expectedVersion) {
    throw new InventoryVersionError('Inventory reservation version is stale');
  }
  return { item: await lockItem(client, parseUuidV7(reservation.inventory_item_id)), reservation };
}

async function updateItemQuantity(
  client: PoolClient,
  item: ItemRow,
  nextQuantity: number,
  nextVersion: number,
  now: Date,
) {
  const low = Number(item.low_stock_threshold ?? 0);
  await client.query(
    `UPDATE marketplace.inventory_items
        SET exact_available_quantity=$2, availability_state=$3, version=$4,
            updated_at=$5
      WHERE inventory_item_id=$1`,
    [
      item.inventory_item_id,
      nextQuantity,
      countedAvailability(nextQuantity, low),
      nextVersion,
      now,
    ],
  );
}

async function expireLocked(
  client: PoolClient,
  input: {
    readonly context: RequestContext;
    readonly item: ItemRow;
    readonly now: Date;
    readonly reason_code: string;
    readonly reservation: ReservationRow;
  },
): Promise<InventoryReservationRecord> {
  const who = actor(input.context, ['system']);
  const nextReservationVersion = input.reservation.version + 1;
  const nextItemVersion = input.item.version + 1;
  let available =
    input.item.exact_available_quantity === null
      ? null
      : Number(input.item.exact_available_quantity);
  if (input.reservation.counted_stock_applied && available !== null) {
    available += Number(input.reservation.quantity);
    await updateItemQuantity(client, input.item, available, nextItemVersion, input.now);
  } else {
    await client.query(
      `UPDATE marketplace.inventory_items SET version=$2, updated_at=$3
        WHERE inventory_item_id=$1`,
      [input.item.inventory_item_id, nextItemVersion, input.now],
    );
  }
  const result = await client.query<ReservationRow>(
    `UPDATE marketplace.inventory_reservations
        SET reservation_state='EXPIRED', version=$2, updated_at=$3
      WHERE reservation_id=$1 RETURNING *`,
    [input.reservation.reservation_id, nextReservationVersion, input.now],
  );
  await appendEvent(client, {
    actor_id: who.id,
    actor_kind: who.kind,
    context: input.context,
    counted_stock_applied: input.reservation.counted_stock_applied,
    event_type: 'EXPIRED',
    exact_available_quantity: available,
    inventory_item_id: parseUuidV7(input.item.inventory_item_id),
    item_version: nextItemVersion,
    now: input.now,
    previous_state: input.reservation.reservation_state,
    quantity: Number(input.reservation.quantity),
    reason_code: input.reason_code,
    reservation_id: parseUuidV7(input.reservation.reservation_id),
    reservation_version: nextReservationVersion,
    resulting_state: 'EXPIRED',
  });
  return reservationRecord(requiredRow(result.rows, 'Expired reservation was not returned'));
}

/**
 * Releases reservations inside a caller's transaction, restoring counted stock
 * and recomputing the shelf state, with the append-only event each release
 * leaves. The one release routine.
 *
 * The checkout and fulfilment modules each had a private copy: the checkout's
 * gave the units back but left `availability_state` at OUT_OF_STOCK, so a
 * declined payment left the shelf saying sold out with stock on it; the
 * fulfilment's marked the reservation RELEASED and never gave the units back
 * at all, so every vendor decline, timeout or customer cancellation of a
 * counted item lost that stock for good. Neither wrote an inventory event.
 *
 * Reservations not in one of `states` are skipped, not refused: a caller
 * releasing "whatever this quote still holds" is not wrong because one line
 * was already expired by the sweep.
 */
export async function releaseReservationsLocked(
  client: PoolClient,
  input: {
    readonly context: RequestContext;
    readonly now: Date;
    readonly reason_code: string;
    readonly reservation_ids: readonly UuidV7[];
    readonly states?: readonly InventoryReservationState[];
  },
): Promise<readonly InventoryReservationRecord[]> {
  const who = actor(input.context, ['admin', 'customer', 'system', 'vendor_staff']);
  const states = input.states ?? ['SOFT_HELD', 'PROVISIONAL'];
  const released: InventoryReservationRecord[] = [];
  for (const reservationId of input.reservation_ids) {
    const locked = await client.query<ReservationRow>(
      `SELECT * FROM marketplace.inventory_reservations WHERE reservation_id=$1 FOR UPDATE`,
      [reservationId],
    );
    const reservation = locked.rows[0];
    if (!reservation || !states.includes(reservation.reservation_state)) continue;
    const item = await lockItem(client, parseUuidV7(reservation.inventory_item_id));
    const nextItemVersion = item.version + 1;
    const nextReservationVersion = reservation.version + 1;
    let available =
      item.exact_available_quantity === null ? null : Number(item.exact_available_quantity);
    if (reservation.counted_stock_applied && available !== null) {
      available += Number(reservation.quantity);
      await updateItemQuantity(client, item, available, nextItemVersion, input.now);
    } else {
      await client.query(
        `UPDATE marketplace.inventory_items SET version=$2, updated_at=$3
          WHERE inventory_item_id=$1`,
        [item.inventory_item_id, nextItemVersion, input.now],
      );
    }
    const result = await client.query<ReservationRow>(
      `UPDATE marketplace.inventory_reservations
          SET reservation_state='RELEASED', version=$2, updated_at=$3
        WHERE reservation_id=$1 RETURNING *`,
      [reservation.reservation_id, nextReservationVersion, input.now],
    );
    await appendEvent(client, {
      actor_id: who.id,
      actor_kind: who.kind,
      context: input.context,
      counted_stock_applied: reservation.counted_stock_applied,
      event_type: 'RELEASED',
      exact_available_quantity: available,
      inventory_item_id: parseUuidV7(item.inventory_item_id),
      item_version: nextItemVersion,
      now: input.now,
      previous_state: reservation.reservation_state,
      quantity: Number(reservation.quantity),
      reason_code: input.reason_code,
      reservation_id: parseUuidV7(reservation.reservation_id),
      reservation_version: nextReservationVersion,
      resulting_state: 'RELEASED',
    });
    released.push(
      reservationRecord(requiredRow(result.rows, 'Released reservation was not returned')),
    );
  }
  return Object.freeze(released);
}

/**
 * Commits provisional reservations inside the caller's transaction (8.2).
 *
 * Vendor acceptance is what turns "held for this order" into "sold to it",
 * and the acceptance and the commitment stand or fall together: until audit
 * run 50 nothing committed at acceptance -- the holds were committed at
 * pickup, one transaction each, from the outbox worker, so an accepted order
 * spent its whole preparation on a hold with a deadline. A reservation already
 * `COMMITTED` is left as it is (an acceptance replayed). One in any other
 * state -- released, expired -- means its units went back to the shelf, and an
 * order cannot be accepted on stock that may be gone. A provisional hold whose
 * deadline has passed but which the sweep has not reached is still committed:
 * its units are still deducted, the row is locked here, and the shop has just
 * promised them.
 */
export async function commitReservationsLocked(
  client: PoolClient,
  input: {
    readonly context: RequestContext;
    readonly now: Date;
    readonly reason_code: string;
    readonly reservation_ids: readonly UuidV7[];
  },
): Promise<readonly InventoryReservationRecord[]> {
  const who = actor(input.context, ['system', 'vendor_staff']);
  const committed: InventoryReservationRecord[] = [];
  for (const reservationId of input.reservation_ids) {
    const locked = await client.query<ReservationRow>(
      `SELECT * FROM marketplace.inventory_reservations WHERE reservation_id=$1 FOR UPDATE`,
      [reservationId],
    );
    const reservation = requiredRow(locked.rows, 'Inventory reservation was not found');
    if (reservation.reservation_state === 'COMMITTED') continue;
    if (reservation.reservation_state !== 'PROVISIONAL') {
      throw new InventoryConflictError(
        `The reservation is ${reservation.reservation_state}, not provisional`,
      );
    }
    const item = await lockItem(client, parseUuidV7(reservation.inventory_item_id));
    const nextItemVersion = item.version + 1;
    const nextReservationVersion = reservation.version + 1;
    await client.query(
      `UPDATE marketplace.inventory_items SET version=$2, updated_at=$3
        WHERE inventory_item_id=$1`,
      [item.inventory_item_id, nextItemVersion, input.now],
    );
    const result = await client.query<ReservationRow>(
      `UPDATE marketplace.inventory_reservations
          SET reservation_state='COMMITTED', version=$2, updated_at=$3
        WHERE reservation_id=$1 RETURNING *`,
      [reservation.reservation_id, nextReservationVersion, input.now],
    );
    await appendEvent(client, {
      actor_id: who.id,
      actor_kind: who.kind,
      context: input.context,
      counted_stock_applied: reservation.counted_stock_applied,
      event_type: 'COMMITTED',
      exact_available_quantity:
        item.exact_available_quantity === null ? null : Number(item.exact_available_quantity),
      inventory_item_id: parseUuidV7(item.inventory_item_id),
      item_version: nextItemVersion,
      now: input.now,
      previous_state: 'PROVISIONAL',
      quantity: Number(reservation.quantity),
      reason_code: input.reason_code,
      reservation_id: parseUuidV7(reservation.reservation_id),
      reservation_version: nextReservationVersion,
      resulting_state: 'COMMITTED',
    });
    committed.push(
      reservationRecord(requiredRow(result.rows, 'Committed reservation was not returned')),
    );
  }
  return Object.freeze(committed);
}

export class InventoryReservationService {
  readonly #pool: Pool;
  constructor(input: { readonly connection_string: string }) {
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-inventory-reservations',
      connectionString: input.connection_string,
      connectionTimeoutMillis: 5_000,
      max: 12,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }
  async close(): Promise<void> {
    await this.#pool.end();
  }

  async createItem(input: {
    readonly context: RequestContext;
    readonly display_name: string;
    readonly exact_available_quantity?: number;
    readonly inventory_item_id?: UuidV7;
    readonly low_stock_threshold?: number;
    readonly now?: Date;
    readonly product_reference: string;
    readonly quantity_basis: InventoryQuantityBasis;
    readonly reason_code: string;
    readonly vendor_location_id: UuidV7;
  }): Promise<InventoryItemRecord> {
    const who = actor(input.context, ['admin', 'vendor_staff']);
    const now = input.now ?? new Date();
    const itemId = input.inventory_item_id ?? createUuidV7({ now_ms: now.getTime() });
    const isCounted = input.quantity_basis === 'COUNTED';
    if (!isCounted && input.quantity_basis !== 'VENDOR_CONFIRMS') {
      throw new InventoryInputError('Quantity basis is invalid');
    }
    const available = isCounted ? stock(input.exact_available_quantity ?? -1) : null;
    const low = isCounted ? threshold(input.low_stock_threshold ?? 0) : null;
    return transaction(this.#pool, async (client) => {
      const location = await client.query<{ lifecycle_state: string }>(
        `SELECT lifecycle_state FROM marketplace.vendor_locations
          WHERE vendor_location_id=$1 FOR SHARE`,
        [input.vendor_location_id],
      );
      if (!location.rows[0]) throw new InventoryNotFoundError('Vendor location was not found');
      if (location.rows[0].lifecycle_state === 'CLOSED') {
        throw new InventoryConflictError('Closed locations cannot create inventory');
      }
      const ids = contextIds(input.context);
      const result = await client.query<ItemRow>(
        `INSERT INTO marketplace.inventory_items
          (inventory_item_id, vendor_location_id, product_reference, display_name,
           quantity_basis, availability_state, exact_available_quantity,
           low_stock_threshold, last_confirmed_at, request_id, correlation_id,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$9,$9) RETURNING *`,
        [
          itemId,
          input.vendor_location_id,
          productReference(input.product_reference),
          displayName(input.display_name),
          input.quantity_basis,
          isCounted ? countedAvailability(available ?? 0, low ?? 0) : 'VENDOR_CONFIRMS',
          available,
          low,
          now,
          ids.requestId,
          ids.correlationId,
        ],
      );
      await appendEvent(client, {
        actor_id: who.id,
        actor_kind: who.kind,
        context: input.context,
        event_type: 'ITEM_CREATED',
        exact_available_quantity: available,
        inventory_item_id: itemId,
        item_version: 1,
        now,
        reason_code: input.reason_code,
      });
      return itemRecord(requiredRow(result.rows, 'Created inventory item was not returned'));
    });
  }

  async setCountedStock(input: {
    readonly context: RequestContext;
    readonly exact_available_quantity: number;
    readonly expected_version: number;
    readonly inventory_item_id: UuidV7;
    readonly low_stock_threshold: number;
    readonly now?: Date;
    readonly reason_code: string;
    readonly vendor_location_id: UuidV7;
  }): Promise<InventoryItemRecord> {
    const who = actor(input.context, ['admin', 'vendor_staff']);
    const available = stock(input.exact_available_quantity);
    const low = threshold(input.low_stock_threshold);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const item = await lockItem(client, input.inventory_item_id);
      if (item.vendor_location_id !== input.vendor_location_id) {
        throw new InventoryNotFoundError('Inventory item was not found');
      }
      if (item.quantity_basis !== 'COUNTED') {
        throw new InventoryConflictError('Vendor-confirms inventory has no exact stock count');
      }
      if (item.version !== input.expected_version) {
        throw new InventoryVersionError('Inventory item version is stale');
      }
      const active = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM marketplace.inventory_reservations
          WHERE inventory_item_id=$1
            AND reservation_state IN ('SOFT_HELD','PROVISIONAL','COMMITTED')`,
        [input.inventory_item_id],
      );
      if (active.rows[0]?.count !== '0') {
        throw new InventoryConflictError(
          'Exact stock cannot be reset while reservations are active',
        );
      }
      const nextVersion = item.version + 1;
      const result = await client.query<ItemRow>(
        `UPDATE marketplace.inventory_items
            SET exact_available_quantity=$2, low_stock_threshold=$3,
                availability_state=$4, last_confirmed_at=$5, version=$6,
                updated_at=$5, request_id=$7, correlation_id=$8
          WHERE inventory_item_id=$1 RETURNING *`,
        [
          input.inventory_item_id,
          available,
          low,
          countedAvailability(available, low),
          now,
          nextVersion,
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      await appendEvent(client, {
        actor_id: who.id,
        actor_kind: who.kind,
        context: input.context,
        event_type: 'STOCK_SET',
        exact_available_quantity: available,
        inventory_item_id: input.inventory_item_id,
        item_version: nextVersion,
        now,
        reason_code: input.reason_code,
      });
      return itemRecord(requiredRow(result.rows, 'Updated inventory item was not returned'));
    });
  }

  async confirmAvailability(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly inventory_item_id: UuidV7;
    readonly now?: Date;
    readonly reason_code: string;
    readonly vendor_location_id: UuidV7;
  }): Promise<InventoryItemRecord> {
    const who = actor(input.context, ['admin', 'vendor_staff']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const item = await lockItem(client, input.inventory_item_id);
      if (item.vendor_location_id !== input.vendor_location_id) {
        throw new InventoryNotFoundError('Inventory item was not found');
      }
      if (item.quantity_basis !== 'VENDOR_CONFIRMS') {
        throw new InventoryConflictError('Counted inventory must use an exact stock update');
      }
      if (item.version !== input.expected_version) {
        throw new InventoryVersionError('Inventory item version is stale');
      }
      const nextVersion = item.version + 1;
      const result = await client.query<ItemRow>(
        `UPDATE marketplace.inventory_items
            SET last_confirmed_at=$2, version=$3, updated_at=$2,
                request_id=$4, correlation_id=$5
          WHERE inventory_item_id=$1 RETURNING *`,
        [
          input.inventory_item_id,
          now,
          nextVersion,
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      await appendEvent(client, {
        actor_id: who.id,
        actor_kind: who.kind,
        context: input.context,
        event_type: 'AVAILABILITY_CONFIRMED',
        exact_available_quantity: null,
        inventory_item_id: input.inventory_item_id,
        item_version: nextVersion,
        now,
        reason_code: input.reason_code,
      });
      return itemRecord(requiredRow(result.rows, 'Confirmed inventory item was not returned'));
    });
  }

  async listLocation(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }): Promise<readonly InventoryItemRecord[]> {
    actor(input.context, ['admin', 'vendor_staff']);
    const result = await this.#pool.query<ItemRow>(
      `SELECT * FROM marketplace.inventory_items WHERE vendor_location_id=$1
        ORDER BY display_name, inventory_item_id`,
      [input.vendor_location_id],
    );
    return Object.freeze(result.rows.map(itemRecord));
  }

  /**
   * The stock list with its catalogue counterpart attached.
   *
   * Held quantity is counted here rather than fetched per row: the console
   * previously needed a click per line to reveal soft holds, so the number
   * that explains "8 on hand but customers can only buy 6" was hidden behind
   * the one interaction nobody performs.
   */
  async listLocationStock(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }): Promise<readonly VendorStockLine[]> {
    actor(input.context, ['admin', 'vendor_staff']);
    const result = await this.#pool.query<
      ItemRow & {
        catalogue_product_id: string | null;
        catalogue_title: string | null;
        catalogue_lifecycle_state: string | null;
        unit_label: string | null;
        price_minor: string | null;
        held_quantity: string;
      }
    >(
      `SELECT i.*,
              p.catalogue_product_id,
              p.title AS catalogue_title,
              p.lifecycle_state AS catalogue_lifecycle_state,
              p.unit_label,
              price.price_minor,
              COALESCE(held.quantity, 0) AS held_quantity
         FROM marketplace.inventory_items i
         LEFT JOIN marketplace.catalogue_products p
           ON p.vendor_location_id = i.vendor_location_id
          AND p.product_reference = i.product_reference
         LEFT JOIN LATERAL (
           SELECT cp.price_minor
             FROM marketplace.catalogue_product_variants v
             JOIN marketplace.catalogue_prices cp
               ON cp.catalogue_variant_id = v.catalogue_variant_id
              AND cp.effective_until IS NULL
            WHERE v.catalogue_product_id = p.catalogue_product_id
            ORDER BY cp.price_minor ASC
            LIMIT 1
         ) price ON true
         LEFT JOIN LATERAL (
           SELECT SUM(r.quantity) AS quantity
             FROM marketplace.inventory_reservations r
            WHERE r.inventory_item_id = i.inventory_item_id
              AND r.reservation_state IN ('SOFT_HELD', 'PROVISIONAL', 'COMMITTED')
         ) held ON true
        WHERE i.vendor_location_id = $1
        ORDER BY i.display_name, i.inventory_item_id`,
      [input.vendor_location_id],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          ...itemRecord(row),
          catalogue_lifecycle_state: row.catalogue_lifecycle_state,
          catalogue_product_id: row.catalogue_product_id
            ? parseUuidV7(row.catalogue_product_id)
            : null,
          catalogue_title: row.catalogue_title,
          held_quantity: Number(row.held_quantity),
          price_minor: row.price_minor === null ? null : Number(row.price_minor),
          unit_label: row.unit_label,
        }),
      ),
    );
  }

  async listReservations(input: {
    readonly context: RequestContext;
    readonly inventory_item_id: UuidV7;
    readonly vendor_location_id: UuidV7;
  }): Promise<readonly InventoryReservationRecord[]> {
    actor(input.context, ['admin', 'vendor_staff']);
    const result = await this.#pool.query<ReservationRow>(
      `SELECT reservation.* FROM marketplace.inventory_reservations reservation
       JOIN marketplace.inventory_items item USING (inventory_item_id)
       WHERE reservation.inventory_item_id=$1 AND item.vendor_location_id=$2
       ORDER BY reservation.created_at DESC, reservation.reservation_id`,
      [input.inventory_item_id, input.vendor_location_id],
    );
    return Object.freeze(result.rows.map(reservationRecord));
  }

  async softHold(input: {
    readonly context: RequestContext;
    readonly expires_at: Date;
    readonly inventory_item_id: UuidV7;
    readonly now?: Date;
    readonly quantity: number;
    readonly reason_code: string;
    readonly source_reference: string;
  }): Promise<InventoryReservationRecord> {
    const who = actor(input.context, ['customer', 'system']);
    const now = input.now ?? new Date();
    const expiresAt = expiry(input.expires_at, now, 30 * 60_000);
    const requested = quantity(input.quantity);
    return transaction(this.#pool, async (client) => {
      const item = await lockItem(client, input.inventory_item_id);
      if (item.lifecycle_state !== 'ACTIVE') {
        throw new InventoryUnavailableError(null);
      }
      const source = sourceReference(input.source_reference);
      const replay = await client.query<ReservationRow>(
        `SELECT * FROM marketplace.inventory_reservations
          WHERE inventory_item_id=$1 AND source_reference=$2`,
        [input.inventory_item_id, source],
      );
      if (replay.rows[0]) {
        if (Number(replay.rows[0].quantity) !== requested) {
          throw new InventoryConflictError('Reservation source was reused with another quantity');
        }
        return reservationRecord(replay.rows[0]);
      }
      if (item.availability_state === 'OUT_OF_STOCK') {
        throw new InventoryUnavailableError(0);
      }
      const counted = item.quantity_basis === 'COUNTED';
      let available =
        item.exact_available_quantity === null ? null : Number(item.exact_available_quantity);
      if (counted) {
        if (available === null || available < requested) {
          throw new InventoryUnavailableError(available);
        }
        available -= requested;
      }
      const itemVersion = item.version + 1;
      if (available === null) {
        await client.query(
          `UPDATE marketplace.inventory_items SET version=$2, updated_at=$3
            WHERE inventory_item_id=$1`,
          [input.inventory_item_id, itemVersion, now],
        );
      } else {
        await updateItemQuantity(client, item, available, itemVersion, now);
      }
      const reservationId = createUuidV7({ now_ms: now.getTime() });
      const ids = contextIds(input.context);
      const created = await client.query<ReservationRow>(
        `INSERT INTO marketplace.inventory_reservations
          (reservation_id, inventory_item_id, vendor_location_id, source_reference,
           reservation_state, quantity, counted_stock_applied, expires_at,
           request_id, correlation_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'SOFT_HELD',$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
        [
          reservationId,
          input.inventory_item_id,
          item.vendor_location_id,
          source,
          requested,
          counted,
          expiresAt,
          ids.requestId,
          ids.correlationId,
          now,
        ],
      );
      await appendEvent(client, {
        actor_id: who.id,
        actor_kind: who.kind,
        context: input.context,
        counted_stock_applied: counted,
        event_type: 'SOFT_HELD',
        exact_available_quantity: available,
        inventory_item_id: input.inventory_item_id,
        item_version: itemVersion,
        now,
        previous_state: null,
        quantity: requested,
        reason_code: input.reason_code,
        reservation_id: reservationId,
        reservation_version: 1,
        resulting_state: 'SOFT_HELD',
      });
      return reservationRecord(
        requiredRow(created.rows, 'Created inventory reservation was not returned'),
      );
    });
  }

  async provisional(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly expires_at: Date;
    readonly now?: Date;
    readonly reason_code: string;
    readonly reservation_id: UuidV7;
  }): Promise<InventoryReservationRecord> {
    const who = actor(input.context, ['customer', 'system']);
    const now = input.now ?? new Date();
    const expiresAt = expiry(input.expires_at, now, 2 * 60 * 60_000);
    return transaction(this.#pool, async (client) => {
      const locked = await lockReservation(client, input.reservation_id, input.expected_version);
      if (locked.reservation.reservation_state !== 'SOFT_HELD') {
        throw new InventoryConflictError('Only a soft hold can become provisional');
      }
      if (locked.reservation.expires_at <= now) {
        throw new InventoryConflictError('The soft hold has expired and awaits server expiry');
      }
      const reservationVersion = locked.reservation.version + 1;
      const itemVersion = locked.item.version + 1;
      await client.query(
        `UPDATE marketplace.inventory_items SET version=$2, updated_at=$3
          WHERE inventory_item_id=$1`,
        [locked.item.inventory_item_id, itemVersion, now],
      );
      const result = await client.query<ReservationRow>(
        `UPDATE marketplace.inventory_reservations
            SET reservation_state='PROVISIONAL', expires_at=$2, version=$3, updated_at=$4
          WHERE reservation_id=$1 RETURNING *`,
        [input.reservation_id, expiresAt, reservationVersion, now],
      );
      await appendEvent(client, {
        actor_id: who.id,
        actor_kind: who.kind,
        context: input.context,
        counted_stock_applied: locked.reservation.counted_stock_applied,
        event_type: 'PROVISIONAL',
        exact_available_quantity:
          locked.item.exact_available_quantity === null
            ? null
            : Number(locked.item.exact_available_quantity),
        inventory_item_id: parseUuidV7(locked.item.inventory_item_id),
        item_version: itemVersion,
        now,
        previous_state: 'SOFT_HELD',
        quantity: Number(locked.reservation.quantity),
        reason_code: input.reason_code,
        reservation_id: input.reservation_id,
        reservation_version: reservationVersion,
        resulting_state: 'PROVISIONAL',
      });
      return reservationRecord(
        requiredRow(result.rows, 'Provisional inventory reservation was not returned'),
      );
    });
  }

  async commit(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly reason_code: string;
    readonly reservation_id: UuidV7;
  }): Promise<InventoryReservationRecord> {
    const who = actor(input.context, ['system', 'vendor_staff']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const locked = await lockReservation(client, input.reservation_id, input.expected_version);
      if (locked.reservation.reservation_state !== 'PROVISIONAL') {
        throw new InventoryConflictError('Only a provisional reservation can be committed');
      }
      if (locked.reservation.expires_at <= now) {
        throw new InventoryConflictError(
          'The provisional reservation has expired and awaits server expiry',
        );
      }
      return this.transitionLocked(client, {
        actor_id: who.id,
        actor_kind: who.kind,
        context: input.context,
        event_type: 'COMMITTED',
        item: locked.item,
        now,
        reason_code: input.reason_code,
        reservation: locked.reservation,
        resulting_state: 'COMMITTED',
      });
    });
  }

  async release(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly reason_code: string;
    readonly reservation_id: UuidV7;
  }): Promise<InventoryReservationRecord> {
    const who = actor(input.context, ['admin', 'customer', 'system', 'vendor_staff']);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const locked = await lockReservation(client, input.reservation_id, input.expected_version);
      if (
        !['SOFT_HELD', 'PROVISIONAL', 'COMMITTED'].includes(locked.reservation.reservation_state)
      ) {
        throw new InventoryConflictError('Only an active reservation can be released');
      }
      let available =
        locked.item.exact_available_quantity === null
          ? null
          : Number(locked.item.exact_available_quantity);
      const itemVersion = locked.item.version + 1;
      if (locked.reservation.counted_stock_applied && available !== null) {
        available += Number(locked.reservation.quantity);
        await updateItemQuantity(client, locked.item, available, itemVersion, now);
      } else {
        await client.query(
          `UPDATE marketplace.inventory_items SET version=$2, updated_at=$3
            WHERE inventory_item_id=$1`,
          [locked.item.inventory_item_id, itemVersion, now],
        );
      }
      return this.transitionLocked(client, {
        actor_id: who.id,
        actor_kind: who.kind,
        context: input.context,
        event_type: 'RELEASED',
        exact_available_quantity: available,
        item: { ...locked.item, version: itemVersion - 1 },
        item_already_updated: true,
        now,
        reason_code: input.reason_code,
        reservation: locked.reservation,
        resulting_state: 'RELEASED',
      });
    });
  }

  async expireDue(input: {
    readonly context: RequestContext;
    readonly limit?: number;
    readonly now?: Date;
  }): Promise<readonly InventoryReservationRecord[]> {
    actor(input.context, ['system']);
    const now = input.now ?? new Date();
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new InventoryInputError('Expiry batch limit must be from 1 to 500');
    }
    return transaction(this.#pool, async (client) => {
      const due = await client.query<ReservationRow>(
        `SELECT * FROM marketplace.inventory_reservations
          WHERE reservation_state IN ('SOFT_HELD','PROVISIONAL') AND expires_at <= $1
          ORDER BY expires_at, reservation_id FOR UPDATE SKIP LOCKED LIMIT $2`,
        [now, limit],
      );
      const expired: InventoryReservationRecord[] = [];
      for (const reservation of due.rows) {
        const item = await lockItem(client, parseUuidV7(reservation.inventory_item_id));
        expired.push(
          await expireLocked(client, {
            context: input.context,
            item,
            now,
            reason_code: 'RESERVATION_EXPIRED',
            reservation,
          }),
        );
      }
      return Object.freeze(expired);
    });
  }

  private async transitionLocked(
    client: PoolClient,
    input: {
      readonly actor_id: UuidV7;
      readonly actor_kind: ActorKind;
      readonly context: RequestContext;
      readonly event_type: 'COMMITTED' | 'RELEASED';
      readonly exact_available_quantity?: number | null;
      readonly item: ItemRow;
      readonly item_already_updated?: boolean;
      readonly now: Date;
      readonly reason_code: string;
      readonly reservation: ReservationRow;
      readonly resulting_state: 'COMMITTED' | 'RELEASED';
    },
  ): Promise<InventoryReservationRecord> {
    const itemVersion = input.item.version + 1;
    if (!input.item_already_updated) {
      await client.query(
        `UPDATE marketplace.inventory_items SET version=$2, updated_at=$3
          WHERE inventory_item_id=$1`,
        [input.item.inventory_item_id, itemVersion, input.now],
      );
    }
    const reservationVersion = input.reservation.version + 1;
    const result = await client.query<ReservationRow>(
      `UPDATE marketplace.inventory_reservations
          SET reservation_state=$2, version=$3, updated_at=$4
        WHERE reservation_id=$1 RETURNING *`,
      [input.reservation.reservation_id, input.resulting_state, reservationVersion, input.now],
    );
    await appendEvent(client, {
      actor_id: input.actor_id,
      actor_kind: input.actor_kind,
      context: input.context,
      counted_stock_applied: input.reservation.counted_stock_applied,
      event_type: input.event_type,
      exact_available_quantity:
        input.exact_available_quantity === undefined
          ? input.item.exact_available_quantity === null
            ? null
            : Number(input.item.exact_available_quantity)
          : input.exact_available_quantity,
      inventory_item_id: parseUuidV7(input.item.inventory_item_id),
      item_version: itemVersion,
      now: input.now,
      previous_state: input.reservation.reservation_state,
      quantity: Number(input.reservation.quantity),
      reason_code: input.reason_code,
      reservation_id: parseUuidV7(input.reservation.reservation_id),
      reservation_version: reservationVersion,
      resulting_state: input.resulting_state,
    });
    return reservationRecord(
      requiredRow(result.rows, 'Transitioned inventory reservation was not returned'),
    );
  }
}
