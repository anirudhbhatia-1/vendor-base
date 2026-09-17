import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { type PoolClient } from 'pg';

/**
 * The terminal states a delivery can leave a vendor order in.
 *
 * Both are reachable only from `PICKED_UP`: custody cannot begin until the
 * vendor has completed handover, so an order that reaches either of these has
 * definitively been picked up.
 */
export type VendorOrderCompletionState = 'DELIVERED' | 'RETURNED';

export class VendorOrderCompletionConflictError extends Error {
  readonly code = 'VENDOR_ORDER_COMPLETION_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'VendorOrderCompletionConflictError';
  }
}

const OUTBOX_EVENT_TYPE: Readonly<Record<VendorOrderCompletionState, string>> = Object.freeze({
  DELIVERED: 'vendor_order.delivered',
  RETURNED: 'vendor_order.returned',
});

const COMPLETED_AT_COLUMN: Readonly<Record<VendorOrderCompletionState, string>> = Object.freeze({
  DELIVERED: 'delivered_at',
  RETURNED: 'returned_at',
});

/**
 * Advances the vendor-order aggregate and appends one outbox event for it.
 *
 * The three writes and their order are not arbitrary: `outbox_events` carries a
 * foreign key to `aggregate_transitions`, so the head has to be advanced and the
 * transition recorded before the event can be appended. The head is created
 * lazily, because an order may reach its first published transition through a
 * path that never published one.
 *
 * Everything runs on the caller's client, inside the caller's transaction, so a
 * state change and the event announcing it commit together or not at all.
 */
export async function publishVendorOrderTransition(
  client: PoolClient,
  input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly to_state: string;
    readonly event_type: string;
    readonly reason_code: string;
    readonly payload?: Readonly<Record<string, unknown>>;
    readonly source: string;
    readonly now: Date;
  },
): Promise<number> {
  const request = parseRequestId(input.context.request_id);
  const correlation = parseUuidV7(input.context.correlation_id);
  const actor = input.context.actor;
  const actorId = actor?.actor_id ?? createUuidV7();
  const actorKind = actor?.actor_kind ?? 'system';

  const head = await client.query<{ version: number; state: string }>(
    `SELECT version, state FROM marketplace.aggregate_heads
      WHERE aggregate_type='vendor_order' AND aggregate_id=$1 FOR UPDATE`,
    [input.vendor_order_id],
  );
  const previous = head.rows[0];
  const aggregateVersion = (previous?.version ?? 0) + 1;
  if (previous) {
    await client.query(
      `UPDATE marketplace.aggregate_heads SET version=$2, state=$3, updated_at=$4
        WHERE aggregate_type='vendor_order' AND aggregate_id=$1`,
      [input.vendor_order_id, aggregateVersion, input.to_state, input.now],
    );
  } else {
    await client.query(
      `INSERT INTO marketplace.aggregate_heads
         (aggregate_type,aggregate_id,version,state,created_at,updated_at)
       VALUES ('vendor_order',$1,1,$2,$3,$3)`,
      [input.vendor_order_id, input.to_state, input.now],
    );
  }

  await client.query(
    `INSERT INTO marketplace.aggregate_transitions
       (transition_id,aggregate_type,aggregate_id,previous_version,resulting_version,from_state,
        to_state,actor_id,actor_kind,reason_code,evidence,request_id,correlation_id,causation_id,
        occurred_at)
     VALUES ($1,'vendor_order',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      createUuidV7(),
      input.vendor_order_id,
      aggregateVersion - 1,
      aggregateVersion,
      previous?.state ?? null,
      input.to_state,
      actorId,
      actorKind,
      input.reason_code,
      JSON.stringify({ source: input.source }),
      request,
      correlation,
      input.context.causation_id,
      input.now,
    ],
  );

  await client.query(
    `INSERT INTO marketplace.outbox_events
       (event_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,request_id,
        correlation_id,causation_id,max_attempts,available_at,created_at,updated_at)
     VALUES ($1,'vendor_order',$2,$3,$4,$5,$6,$7,$8,8,$9,$9,$9)`,
    [
      createUuidV7(),
      input.vendor_order_id,
      aggregateVersion,
      input.event_type,
      JSON.stringify({
        vendor_order_id: input.vendor_order_id,
        state: input.to_state,
        ...(input.payload ?? {}),
      }),
      request,
      correlation,
      input.context.causation_id,
      input.now,
    ],
  );
  return aggregateVersion;
}

/**
 * Completes a vendor order because its delivery ended.
 *
 * This is the edge that did not exist. The order's happy path stopped at
 * `PICKED_UP`, delivery was recorded only on `delivery_assignments`, and the
 * order the customer placed therefore had no terminal state and emitted no
 * event — so payment capture, the vendor payable, the partner earning and the
 * review window were reachable only by calling a finance endpoint by hand.
 *
 * It lives in its own module rather than on either service because both sides
 * of the handoff need it: `assignment-custody` causes it, and `vendor-fulfilment`
 * owns the aggregate it writes. Everything below happens on the caller's client,
 * inside the caller's transaction, so the assignment's completion and the
 * order's completion commit together or not at all.
 *
 * The three writes are the same sequence `vendor-fulfilment`'s pickup publisher
 * uses, and their order is not arbitrary: `outbox_events` carries a foreign key
 * to `aggregate_transitions`, so the aggregate head has to be advanced and the
 * transition recorded before the event can be appended.
 */
export async function completeVendorOrder(
  client: PoolClient,
  input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly state: VendorOrderCompletionState;
    readonly reason_code: string;
    readonly now: Date;
  },
): Promise<void> {
  const request = parseRequestId(input.context.request_id);
  const correlation = parseUuidV7(input.context.correlation_id);
  const actor = input.context.actor;
  const actorId = actor?.actor_id ?? createUuidV7();
  const actorKind = actor?.actor_kind ?? 'system';

  const locked = await client.query<{ lifecycle_state: string; version: number }>(
    `SELECT lifecycle_state, version FROM marketplace.vendor_orders
      WHERE vendor_order_id=$1 FOR UPDATE`,
    [input.vendor_order_id],
  );
  const order = locked.rows[0];
  if (!order) {
    throw new VendorOrderCompletionConflictError('The delivered order no longer exists');
  }
  // A replayed command reaches here with the order already completed. Returning
  // quietly keeps the caller's own replay guard authoritative rather than
  // turning a duplicate delivery confirmation into an error at the door.
  if (order.lifecycle_state === input.state) return;
  if (order.lifecycle_state !== 'PICKED_UP') {
    throw new VendorOrderCompletionConflictError(
      `An order in ${order.lifecycle_state} cannot be completed as ${input.state}`,
    );
  }

  const version = order.version + 1;
  await client.query(
    `UPDATE marketplace.vendor_orders
        SET lifecycle_state=$2, ${COMPLETED_AT_COLUMN[input.state]}=$3, version=$4, updated_at=$3
      WHERE vendor_order_id=$1`,
    [input.vendor_order_id, input.state, input.now, version],
  );

  await publishVendorOrderTransition(client, {
    context: input.context,
    event_type: OUTBOX_EVENT_TYPE[input.state],
    now: input.now,
    reason_code: input.reason_code,
    source: 'assignment_custody',
    to_state: input.state,
    vendor_order_id: input.vendor_order_id,
  });

  // The order's own append-only history, which is what the customer's timeline
  // and the notification sweep read. `syncDomainSignals` polls this table for a
  // whitelisted set of event types, so an entry here is what tells the customer
  // their order arrived.
  await client.query(
    `INSERT INTO marketplace.vendor_order_events
       (event_id, vendor_order_id, event_type, actor_id, actor_kind, previous_state,
        resulting_state, reason_code, note, request_id, correlation_id)
     VALUES ($1,$2,$3,$4,$5,'PICKED_UP',$6,$7,NULL,$8,$9)`,
    [
      createUuidV7(),
      input.vendor_order_id,
      input.state,
      actorId,
      actorKind,
      input.state,
      input.reason_code,
      request,
      correlation,
    ],
  );
}
