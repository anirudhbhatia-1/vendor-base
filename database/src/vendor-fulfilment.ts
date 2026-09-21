import { deriveCheckoutGroupState } from './checkout-group-state.js';
import { createDatabasePool } from './database-pool.js';
import { createHash, randomInt } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import {
  commitReservationsLocked,
  InventoryConflictError,
  InventoryReservationService,
  releaseReservationsLocked,
} from './inventory-reservations.js';
import { completeVendorOrder, publishVendorOrderTransition } from './vendor-order-completion.js';
import { transaction as tx } from './transaction.js';
import { resolveConfiguration } from './versioned-configuration.js';

export class FulfilmentInputError extends Error {}
export class FulfilmentNotFoundError extends Error {}

/**
 * The reasons a shop may decline with (8.2): a fixed vocabulary, so the
 * acceptance record, the vendor health score and the customer's notice can
 * read them. Until audit run 50 any shouting-snake-case string was accepted,
 * and the list lived only in the console's copy. `ACCEPT_DEADLINE_TIMEOUT` is
 * the system's own reason and is not a choice.
 */
export const VENDOR_DECLINE_REASONS = Object.freeze([
  'VENDOR_CLOSED',
  'STOCK_MISMATCH',
  'WORKLOAD',
  'SERVICEABILITY',
  'PRICING_ERROR',
  'PROHIBITED_ITEM',
  'TECHNICAL_ISSUE',
] as const);
export type VendorDeclineReason = (typeof VENDOR_DECLINE_REASONS)[number];

/** What declining an order would do, computed before the shop decides. */
export interface DeclineImpact {
  readonly vendor_order_id: UuidV7;
  readonly order_reference: string;
  readonly lifecycle_state: string;
  readonly accept_by: Date | null;
  /** Whether the order can still be declined by the shop at all. */
  readonly can_decline: boolean;
  /** The customer's money released for this order alone, in minor units. */
  readonly released_minor: number;
  /** Every line and the units that would go back to the shelf. */
  readonly lines: readonly {
    readonly product_title: string;
    readonly quantity: number;
    /** Counted stock returned to the shelf; null where the shop confirms by hand. */
    readonly units_returned: number | null;
  }[];
  /** The customer's other orders in this checkout: untouched by the decline. */
  readonly sibling_orders: number;
  /** The shop's acceptance record over the window, before and after. */
  readonly acceptance: {
    readonly window_days: number;
    readonly answered: number;
    readonly accepted: number;
    readonly answered_after: number;
  };
  readonly reasons: readonly VendorDeclineReason[];
}
/**
 * Carries which kind of conflict it is.
 *
 * All 25 refusals in this module arrived at the browser as one bare 409, which
 * the API reports as VERSION_CONFLICT and clients render as "Something changed
 * while you were working. Refresh and try again." Only the version checks are
 * fixed by refreshing. A vendor whose pick list still had unresolved lines was
 * told to refresh, refreshed, pressed Mark ready again, and was told the same
 * thing -- five times in one minute in the reported session.
 *
 * The default is a state conflict because that is what most of these are; the
 * version checks name VERSION_CONFLICT explicitly.
 */
export type FulfilmentConflictCode =
  | 'LINE_AWAITING_CUSTOMER'
  | 'ORDER_STATE_CONFLICT'
  | 'PARTNER_NOT_PRESENT'
  | 'PICKING_INCOMPLETE'
  | 'SUBSTITUTION_NOT_ALLOWED'
  | 'VERSION_CONFLICT';

export class FulfilmentConflictError extends Error {
  readonly code: FulfilmentConflictCode;

  constructor(message: string, code: FulfilmentConflictCode = 'ORDER_STATE_CONFLICT') {
    super(message);
    this.code = code;
  }
}
export class FulfilmentAuthorizationError extends Error {}
/**
 * Raised when a vendor tries to mint a collection code while the customer's own
 * code is still live. Separate from FulfilmentConflictError because the answer
 * is an instruction to the shopkeeper ("ask them to open their order screen"),
 * not a retry.
 */
export class PickupOtpAlreadyIssuedError extends Error {}
/**
 * Nobody has minted a code yet. Distinct from a mismatch because the answer is
 * "ask them to open theirs", not "check the digits" -- and both used to arrive
 * as the same state conflict, so a shopkeeper who guessed a code was told the
 * same thing as one whose customer had not opened the app.
 */
export class PickupOtpMissingError extends Error {}
export class PickupOtpMismatchError extends Error {}
export class PickupOtpExhaustedError extends Error {}
export class PickupOtpExpiredError extends Error {}
/**
 * The door's four outcomes on a vendor self-delivery, one class each, mapped
 * to the same stable codes the partner's door uses (DELIVERY_OTP_*). The
 * customer holds the code and the shop's own staff validate it, so the
 * refusals belong to this module rather than to assignment-custody.
 */
export class VendorDeliveryOtpMissingError extends Error {}
export class VendorDeliveryOtpMismatchError extends Error {}
export class VendorDeliveryOtpExhaustedError extends Error {}
export class VendorDeliveryOtpExpiredError extends Error {}

/**
 * How long a customer has to answer a substitution/weight proposal before the
 * system auto-times it out. Kept as a policy default here rather than a
 * versioned configuration because a decision timeout is a mechanical safety
 * rail (never leave a picker blocked), not a merchant-tunable rule.
 */
export const DEFAULT_DECISION_DEADLINE_SECONDS = 300;

/**
 * Pickup OTP lifetime and attempt ceiling. Both are safety rails, not policy;
 * a longer window would let a stale slip walk in, and more attempts would
 * approach brute-force distance on a six-digit space.
 */
export const PICKUP_OTP_LIFETIME_SECONDS = 15 * 60;
export const PICKUP_OTP_MAX_ATTEMPTS = 5;

/** Default vendor response deadline if the caller does not override it. */
export const DEFAULT_ACCEPT_DEADLINE_SECONDS = 3 * 60;

export type VendorOrderState =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PICKING'
  | 'READY'
  | 'PICKED_UP'
  // Terminal outcomes of a platform delivery, written by `assignment-custody`
  // through `completeVendorOrder` rather than by this service.
  | 'DELIVERED'
  | 'RETURNED'
  | 'CANCELLED'
  | 'EXPIRED';

export type PickState =
  | 'FOUND'
  | 'MISSING'
  | 'PROPOSED_SUBSTITUTION'
  | 'PROPOSED_WEIGHT'
  | 'SUBSTITUTION_APPROVED'
  | 'SUBSTITUTION_REJECTED'
  | 'WEIGHT_APPROVED'
  | 'WEIGHT_REJECTED';

export type DecisionAnswer = 'PENDING' | 'APPROVED' | 'REJECTED' | 'TIMED_OUT';

export interface VendorOrderSummary {
  readonly vendor_order_id: UuidV7;
  readonly order_reference: string;
  readonly lifecycle_state: VendorOrderState;
  readonly total_minor: number;
  readonly version: number;
  readonly accept_by: Date | null;
  readonly accepted_at: Date | null;
  readonly ready_at: Date | null;
  readonly picked_up_at: Date | null;
  readonly package_count: number | null;
  readonly package_condition_note: string | null;
  readonly preparation_estimate_seconds: number | null;
  readonly pickup_otp_expires_at: Date | null;
  readonly pickup_otp_attempts: number;
  /**
   * The self-delivery leg (VEN-37): when the shop's own staff left with the
   * order, and the state of the customer's delivery code the door validates.
   * Null / zero on any other method.
   */
  readonly out_for_delivery_at: Date | null;
  readonly delivery_otp_expires_at: Date | null;
  readonly delivery_otp_attempts: number;
  readonly decline_reason_code: string | null;
  /**
   * How this order leaves the shop: CUSTOMER_PICKUP, VENDOR_DELIVERY or
   * PLATFORM_DELIVERY. The console could not tell them apart, so it asked for a
   * "customer's collection code" on an order a delivery partner was coming for.
   */
  readonly fulfilment_method: string;
  /**
   * The road from the shop to the door, as the quote priced it (0085), so the
   * shop's own driver knows how far and how long before setting off. Null on
   * a collected order and on any quote older than routing.
   */
  readonly route_metres: number | null;
  readonly route_seconds: number | null;
  readonly route_source: 'ESTIMATE' | 'MAPBOX' | null;
  /**
   * Who is collecting, and how far along they are.
   *
   * A shopkeeper with a packed order and a READY badge could not tell whether a
   * partner was on the way, standing at the counter, or had already left after
   * waiting — so an order that needed re-dispatching looked identical to one
   * about to be collected. These are operational facts about the store's own
   * order; the partner's identity and position are deliberately not here.
   */
  readonly collection: {
    readonly assignment_state: string;
    readonly partner_waiting_since: Date | null;
    readonly wait_state: string | null;
  } | null;
  /**
   * Why a finished order finished, and who ended it.
   *
   * A customer cancellation writes its reason only to `vendor_order_events` and
   * leaves `decline_reason_code` null — that column holds the *vendor's* own
   * decline reason. So a shopkeeper saw an order turn CANCELLED with nothing
   * saying whether they had declined it, the customer had, or it had timed out.
   */
  readonly resolution: {
    readonly reason_code: string;
    readonly ended_by: string;
    readonly occurred_at: Date;
  } | null;
}

/**
 * One child order as the customer sees it.
 *
 * Separate from `VendorOrderSummary`, which carries vendor-operational fields
 * (pickup OTP attempts, decline reason) that a customer must never receive.
 */
export interface CustomerOrderEntry {
  readonly vendor_order_id: UuidV7;
  readonly vendor_location_id: UuidV7;
  readonly location_name: string;
  readonly order_reference: string;
  readonly lifecycle_state: string;
  readonly total_minor: number;
  readonly fulfilment_method: string | null;
}

export interface PickRecord {
  readonly pick_id: UuidV7;
  readonly vendor_order_line_id: UuidV7;
  readonly pick_state: PickState | 'PENDING';
  readonly actual_quantity: number | null;
  readonly actual_unit_price_minor: number | null;
  readonly substitution_variant_id: UuidV7 | null;
  readonly version: number;
  readonly product_title: string | null;
  readonly ordered_quantity: number | null;
  readonly ordered_unit_price_minor: number | null;
  /** The customer's rule for this line: ask, let the store choose, or refund. */
  readonly substitution_preference: string | null;
  /** Whether the line is sold by weight, which is what "weigh" is for. */
  readonly variable_weight: boolean | null;
}

export interface DecisionRecord {
  readonly decision_id: UuidV7;
  readonly vendor_order_id: UuidV7;
  readonly pick_id: UuidV7;
  readonly proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
  readonly proposed_variant_id: UuidV7 | null;
  readonly proposed_quantity: number;
  readonly proposed_unit_price_minor: number;
  readonly authorization_delta_minor: number;
  readonly reason_note: string;
  readonly decision_deadline_at: Date;
  readonly answer: DecisionAnswer;
  readonly answered_at: Date | null;
}

interface Ids {
  readonly request: string;
  readonly correlation: string;
}

const reasonCode = /^[A-Z][A-Z0-9_]{2,63}$/;

function contextIds(context: RequestContext): Ids {
  return {
    request: parseRequestId(context.request_id),
    correlation: parseUuidV7(context.correlation_id),
  };
}

/**
 * Vendor staff at this order's location resolve to a `staff_memberships` row.
 * Locking their own membership row inside the transaction gives a stable
 * (userId, role) for the whole call.
 */
async function requireVendorMember(
  client: PoolClient,
  context: RequestContext,
  vendorLocationId: UuidV7,
): Promise<{ readonly userId: UuidV7 }> {
  if (context.actor?.actor_kind !== 'vendor_staff') throw new FulfilmentAuthorizationError();
  const userId = context.actor.actor_id;
  const result = await client.query<{ role_key: string }>(
    `SELECT ra.role_key
       FROM marketplace.role_assignments ra
       JOIN marketplace.staff_memberships sm USING (role_assignment_id)
      WHERE ra.user_id=$1 AND sm.vendor_location_id=$2 AND ra.state='ACTIVE'
        AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
      LIMIT 1`,
    [userId, vendorLocationId],
  );
  if (!result.rows[0]) throw new FulfilmentAuthorizationError();
  return { userId };
}

/** The same membership check, for reads that need no transaction. */
async function requireVendorMemberPool(
  pool: Pool,
  context: RequestContext,
  vendorLocationId: UuidV7,
): Promise<{ readonly userId: UuidV7 }> {
  const client = await pool.connect();
  try {
    return await requireVendorMember(client, context, vendorLocationId);
  } finally {
    client.release();
  }
}

function requireCustomer(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'customer') throw new FulfilmentAuthorizationError();
  return context.actor.actor_id;
}

function requireSystemOrVendor(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'system' && context.actor?.actor_kind !== 'vendor_staff') {
    throw new FulfilmentAuthorizationError();
  }
  return context.actor.actor_id;
}

/**
 * The ordered line, locked, with its pick as it stands (8.3).
 *
 * A pick is a draft the console may send again -- from a queue it built while
 * offline, or a second tap -- so each edit names the pick version it saw
 * (0 before any pick) and a stale one is refused rather than applied over a
 * newer answer. A line that is with the customer, or that the customer has
 * approved, takes no edit from the shop; a rejected proposal, a found or a
 * missing line may be marked again. Until audit run 51 any pick overwrote
 * any other, a pending decision included.
 */
async function lockLine(
  client: PoolClient,
  vendorOrderId: UuidV7,
  vendorOrderLineId: UuidV7,
  expectedVersion: number,
): Promise<{
  readonly quantity: number;
  readonly unit_price_minor: number;
  readonly substitution_preference: string;
  readonly pick_state: PickState | null;
  readonly pick_version: number;
}> {
  const found = await client.query<{
    vendor_order_id: string;
    quantity: number;
    unit_price_minor: string;
    substitution_preference: string;
    pick_state: PickState | null;
    pick_version: number | null;
  }>(
    `SELECT l.vendor_order_id, l.quantity, l.unit_price_minor::text AS unit_price_minor,
            l.substitution_preference, p.pick_state, p.version AS pick_version
       FROM marketplace.vendor_order_lines l
       LEFT JOIN marketplace.vendor_order_line_picks p USING (vendor_order_line_id)
      WHERE l.vendor_order_line_id=$1
      FOR UPDATE OF l`,
    [vendorOrderLineId],
  );
  const row = found.rows[0];
  if (!row || row.vendor_order_id !== vendorOrderId) throw new FulfilmentNotFoundError();
  const pickVersion = row.pick_version ?? 0;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== pickVersion)
    throw new FulfilmentConflictError('The line was changed since it was read', 'VERSION_CONFLICT');
  if (
    row.pick_state === 'PROPOSED_SUBSTITUTION' ||
    row.pick_state === 'PROPOSED_WEIGHT' ||
    row.pick_state === 'SUBSTITUTION_APPROVED' ||
    row.pick_state === 'WEIGHT_APPROVED'
  )
    throw new FulfilmentConflictError(
      'The line is with the customer or was answered by them',
      'LINE_AWAITING_CUSTOMER',
    );
  return {
    quantity: row.quantity,
    unit_price_minor: Number(row.unit_price_minor),
    substitution_preference: row.substitution_preference,
    pick_state: row.pick_state,
    pick_version: pickVersion,
  };
}

async function lockOrder(
  client: PoolClient,
  vendorOrderId: UuidV7,
): Promise<{
  readonly vendor_order_id: string;
  readonly vendor_location_id: string;
  readonly checkout_group_id: string;
  readonly lifecycle_state: VendorOrderState;
  readonly version: number;
  readonly accept_by: Date | null;
  readonly pickup_otp_hash: string | null;
  readonly pickup_otp_expires_at: Date | null;
  readonly pickup_otp_attempts: number;
  readonly pickup_otp_issued_by: string | null;
  readonly delivery_otp_hash: string | null;
  readonly delivery_otp_expires_at: Date | null;
  readonly delivery_otp_attempts: number;
  readonly total_minor: string;
}> {
  const result = await client.query(
    `SELECT vendor_order_id, vendor_location_id, checkout_group_id, lifecycle_state, version,
            accept_by, pickup_otp_hash, pickup_otp_expires_at, pickup_otp_attempts,
            pickup_otp_issued_by, delivery_otp_hash, delivery_otp_expires_at,
            delivery_otp_attempts, total_minor::text AS total_minor
       FROM marketplace.vendor_orders WHERE vendor_order_id=$1 FOR UPDATE`,
    [vendorOrderId],
  );
  const row = result.rows[0];
  if (!row) throw new FulfilmentNotFoundError();
  return row;
}

/**
 * Who the shop is handing this order to, and whether they are there.
 *
 * A platform delivery goes to its partner, and only once the partner has
 * marked arrival (workflow 6.7.5-6): before that there is nobody at the counter
 * to hand it to, and completing the handover would move the order to PICKED_UP
 * -- committing stock and starting capture -- for goods still on the shelf. The
 * latest assignment is locked so a partner leaving and a vendor handing over
 * cannot interleave. A pickup or vendor-delivery order has no partner to wait
 * for.
 */
/**
 * How an order leaves the shop, read from the cart group it was quoted from.
 * An order whose group cannot be joined is treated as a platform delivery, the
 * same default the summary and dispatch apply.
 */
export async function orderFulfilmentMethod(
  client: Pick<PoolClient, 'query'>,
  vendorOrderId: UuidV7,
): Promise<string> {
  const method = await client.query<{ fulfilment_method: string | null }>(
    `SELECT cvg.fulfilment_method
       FROM marketplace.vendor_orders o
       JOIN marketplace.checkout_groups cg USING (checkout_group_id)
       LEFT JOIN marketplace.checkout_quote_groups cqg
         ON cqg.checkout_quote_id = cg.checkout_quote_id
        AND cqg.vendor_location_id = o.vendor_location_id
       LEFT JOIN marketplace.cart_vendor_groups cvg USING (cart_vendor_group_id)
      WHERE o.vendor_order_id = $1`,
    [vendorOrderId],
  );
  return method.rows[0]?.fulfilment_method ?? 'PLATFORM_DELIVERY';
}

async function requireCollectorPresent(
  client: PoolClient,
  vendorOrderId: UuidV7,
): Promise<{
  readonly fulfilment_method: string;
  readonly delivery_assignment_id: string | null;
  readonly assignment_state: string | null;
}> {
  const fulfilmentMethod = await orderFulfilmentMethod(client, vendorOrderId);
  // A self-delivery leaves the shop through `startVendorDelivery`, not the
  // counter: accepting a fallback collection code here recorded the handover as
  // a customer collection on an order nobody collected.
  if (fulfilmentMethod === 'VENDOR_DELIVERY') {
    throw new FulfilmentConflictError(
      'A self-delivered order leaves the shop when your staff start the delivery, not at the counter',
    );
  }
  if (fulfilmentMethod !== 'PLATFORM_DELIVERY') {
    return {
      fulfilment_method: fulfilmentMethod,
      delivery_assignment_id: null,
      assignment_state: null,
    };
  }
  const assignment = await client.query<{
    delivery_assignment_id: string;
    assignment_state: string;
  }>(
    `SELECT delivery_assignment_id, assignment_state
       FROM marketplace.delivery_assignments
      WHERE vendor_order_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [vendorOrderId],
  );
  const row = assignment.rows[0];
  if (row?.assignment_state !== 'AT_VENDOR') {
    throw new FulfilmentConflictError(
      'A platform delivery is handed over once its partner is at the store',
      'PARTNER_NOT_PRESENT',
    );
  }
  return {
    fulfilment_method: fulfilmentMethod,
    delivery_assignment_id: row.delivery_assignment_id,
    assignment_state: row.assignment_state,
  };
}

async function appendEvent(
  client: PoolClient,
  input: {
    readonly vendor_order_id: UuidV7;
    readonly event_type: string;
    readonly actor_id: UuidV7;
    readonly actor_kind: 'customer' | 'delivery_partner' | 'system' | 'vendor_staff';
    readonly previous_state: VendorOrderState | null;
    readonly resulting_state: VendorOrderState | null;
    readonly reason_code: string;
    readonly note?: string | null;
    /** The customer decision this event is about, so a notice can carry it. */
    readonly decision_id?: UuidV7 | null;
    readonly ids: Ids;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO marketplace.vendor_order_events
       (event_id, vendor_order_id, event_type, actor_id, actor_kind, previous_state,
        resulting_state, reason_code, note, request_id, correlation_id, decision_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      createUuidV7(),
      input.vendor_order_id,
      input.event_type,
      input.actor_id,
      input.actor_kind,
      input.previous_state,
      input.resulting_state,
      input.reason_code,
      input.note ?? null,
      input.ids.request,
      input.ids.correlation,
      input.decision_id ?? null,
    ],
  );
}

/**
 * Moves the customer's authorisation by `delta_minor` for one order, before
 * capture, and records why (8.4). Positive for an approved dearer replacement
 * or heavier weight; negative for a lighter weight, a replacement under the
 * customer's own rule, or the lines that are not in the bag at ready. The
 * allocation moves by the same amount so capture and the vendor's settlement
 * read the final figure. Refuses when the payment is no longer authorised or
 * the result would be nothing at all: an order with nothing to charge is an
 * ending, not an adjustment.
 */
async function adjustAuthorizationForOrder(
  client: PoolClient,
  input: {
    readonly vendor_order_id: UuidV7;
    readonly delta_minor: number;
    readonly adjustment_kind: 'CUSTOMER_DECISION' | 'LINES_NOT_SUPPLIED';
    readonly decision_id: UuidV7 | null;
    readonly actor_id: UuidV7;
    readonly actor_kind: string;
    readonly reason_code: string;
    readonly ids: Ids;
    readonly now: Date;
  },
): Promise<void> {
  if (input.delta_minor === 0) return;
  const payment = await client.query<{
    payment_transaction_id: string;
    payment_state: string;
    amount_minor: string;
    source_order_reference: string;
    version: number;
  }>(
    `SELECT payment.payment_transaction_id,payment.payment_state,payment.amount_minor::text,
            orders.order_reference source_order_reference,payment.version
       FROM marketplace.vendor_orders orders
       JOIN marketplace.checkout_groups grouping USING(checkout_group_id)
       JOIN marketplace.payment_transactions payment USING(payment_transaction_id)
      WHERE orders.vendor_order_id=$1 FOR UPDATE OF payment`,
    [input.vendor_order_id],
  );
  const transaction = payment.rows[0];
  if (!transaction || transaction.payment_state !== 'AUTHORIZED') {
    throw new FulfilmentConflictError(
      'A price adjustment requires an authorized, uncaptured payment',
    );
  }
  const previous = Number(transaction.amount_minor);
  const resulting = previous + input.delta_minor;
  if (!Number.isSafeInteger(resulting) || resulting <= 0) {
    throw new FulfilmentConflictError('The price adjustment is outside payment bounds');
  }
  const reference =
    input.decision_id === null
      ? `SYNTH-PAY-LINES-${String(input.vendor_order_id).toUpperCase()}`
      : `SYNTH-PAY-ADJUST-${String(input.decision_id).toUpperCase()}`;
  const inserted = await client.query(
    `INSERT INTO marketplace.payment_authorization_adjustments
      (payment_authorization_adjustment_id,decision_id,payment_transaction_id,vendor_order_id,
       delta_minor,previous_authorized_minor,resulting_authorized_minor,provider_scenario,
       provider_reference,adjustment_kind,request_id,correlation_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'SUCCESS',$8,$9,$10,$11,$12)
     ON CONFLICT DO NOTHING`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.decision_id,
      transaction.payment_transaction_id,
      input.vendor_order_id,
      input.delta_minor,
      previous,
      resulting,
      reference,
      input.adjustment_kind,
      input.ids.request,
      input.ids.correlation,
      input.now,
    ],
  );
  // A replay finds its adjustment already recorded and moves nothing twice.
  if (inserted.rowCount === 0) return;
  await client.query(
    `UPDATE marketplace.payment_allocations SET item_minor=item_minor+$3
      WHERE payment_transaction_id=$1 AND source_order_reference=$2`,
    [transaction.payment_transaction_id, transaction.source_order_reference, input.delta_minor],
  );
  await client.query(
    `UPDATE marketplace.payment_transactions SET amount_minor=$2,version=version+1,updated_at=$3
      WHERE payment_transaction_id=$1`,
    [transaction.payment_transaction_id, resulting, input.now],
  );
  await client.query(
    `INSERT INTO marketplace.payment_events
      (payment_event_id,payment_transaction_id,payment_version,event_type,previous_state,
       resulting_state,provider_result,command_reference,actor_id,actor_kind,reason_code,
       request_id,correlation_id,occurred_at)
     VALUES($1,$2,$3,'AUTHORIZATION_ADJUSTED','AUTHORIZED','AUTHORIZED',
       'SYNTHETIC_ADJUSTMENT',$4,$5,$6,$7,$8,$9,$10)`,
    [
      createUuidV7({ now_ms: input.now.getTime() + 1 }),
      transaction.payment_transaction_id,
      transaction.version + 1,
      reference.replace('SYNTH-PAY-', 'SYNTH-CMD-'),
      input.actor_id,
      input.actor_kind,
      input.reason_code,
      input.ids.request,
      input.ids.correlation,
      input.now,
    ],
  );
}

/**
 * Stops charging the customer for an order that ended before it was supplied.
 *
 * One authorization funds a whole checkout group, and `capture` is all or
 * nothing. With a basket from two shops where one declines, capturing would take
 * the full amount and leave the customer waiting on a refund for goods nobody
 * was ever going to bring. Shrinking the authorization instead is the per-shop
 * form of "a decline releases the money", and it leaves nothing owed.
 *
 * This runs in the same transaction as the ending itself: money that must not be
 * charged is not something to leave to a retryable side effect.
 *
 * Two cases deliberately do nothing. A payment that is no longer AUTHORIZED has
 * already been captured or voided, and adjusting it would be rewriting history.
 * And when this order is the last live one in its group, the remainder would be
 * zero — there is no such thing as a zero authorization, so the whole thing is
 * released by the void path instead.
 */
async function releaseAuthorizationForEndedOrder(
  client: PoolClient,
  input: {
    readonly vendor_order_id: UuidV7;
    readonly actor_id: UuidV7;
    readonly actor_kind: string;
    readonly reason_code: string;
    readonly ids: Ids;
    readonly now: Date;
  },
): Promise<void> {
  const found = await client.query<{
    payment_transaction_id: string;
    payment_state: string;
    amount_minor: string;
    version: number;
    order_reference: string;
    allocated_total_minor: string | null;
  }>(
    `SELECT payment.payment_transaction_id, payment.payment_state,
            payment.amount_minor::text, payment.version,
            orders.order_reference,
            allocation.allocated_total_minor::text AS allocated_total_minor
       FROM marketplace.vendor_orders orders
       JOIN marketplace.checkout_groups grouping USING(checkout_group_id)
       JOIN marketplace.payment_transactions payment USING(payment_transaction_id)
       LEFT JOIN marketplace.payment_allocations allocation
         ON allocation.payment_transaction_id = payment.payment_transaction_id
        AND allocation.source_order_reference = orders.order_reference
      WHERE orders.vendor_order_id=$1
      FOR UPDATE OF payment`,
    [input.vendor_order_id],
  );
  const transaction = found.rows[0];
  if (!transaction || transaction.payment_state !== 'AUTHORIZED') return;

  const allocated = Number(transaction.allocated_total_minor ?? '0');
  if (!Number.isSafeInteger(allocated) || allocated <= 0) return;
  const previous = Number(transaction.amount_minor);
  const resulting = previous - allocated;
  if (!Number.isSafeInteger(resulting) || resulting <= 0) return;

  const inserted = await client.query(
    `INSERT INTO marketplace.payment_authorization_adjustments
      (payment_authorization_adjustment_id,decision_id,payment_transaction_id,vendor_order_id,
       delta_minor,previous_authorized_minor,resulting_authorized_minor,provider_scenario,
       provider_reference,adjustment_kind,request_id,correlation_id,created_at)
     VALUES($1,NULL,$2,$3,$4,$5,$6,'SUCCESS',$7,'VENDOR_ORDER_ENDED',$8,$9,$10)
     ON CONFLICT (vendor_order_id) WHERE adjustment_kind='VENDOR_ORDER_ENDED' DO NOTHING`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      transaction.payment_transaction_id,
      input.vendor_order_id,
      -allocated,
      previous,
      resulting,
      `SYNTH-PAY-RELEASE-${String(input.vendor_order_id).toUpperCase()}`,
      input.ids.request,
      input.ids.correlation,
      input.now,
    ],
  );
  // A replayed ending finds its adjustment already recorded. Reducing the
  // authorization again would charge the customer less than they owe.
  if (inserted.rowCount === 0) return;

  await client.query(
    `UPDATE marketplace.payment_allocations
        SET item_minor=0, tax_minor=0, delivery_minor=0, tip_minor=0, discount_minor=0
      WHERE payment_transaction_id=$1 AND source_order_reference=$2`,
    [transaction.payment_transaction_id, transaction.order_reference],
  );
  await client.query(
    `UPDATE marketplace.payment_transactions
        SET amount_minor=$2, version=version+1, updated_at=$3
      WHERE payment_transaction_id=$1`,
    [transaction.payment_transaction_id, resulting, input.now],
  );
  await client.query(
    `INSERT INTO marketplace.payment_events
      (payment_event_id,payment_transaction_id,payment_version,event_type,previous_state,
       resulting_state,provider_result,command_reference,actor_id,actor_kind,reason_code,
       request_id,correlation_id,occurred_at)
     VALUES($1,$2,$3,'AUTHORIZATION_ADJUSTED','AUTHORIZED','AUTHORIZED','SYNTHETIC_ADJUSTMENT',
       $4,$5,$6,$7,$8,$9,$10)`,
    [
      createUuidV7({ now_ms: input.now.getTime() + 1 }),
      transaction.payment_transaction_id,
      transaction.version + 1,
      `SYNTH-CMD-RELEASE-${String(input.vendor_order_id).toUpperCase()}`,
      input.actor_id,
      input.actor_kind,
      input.reason_code,
      input.ids.request,
      input.ids.correlation,
      input.now,
    ],
  );
}

/** A pool or a checked-out client: reads that need no transaction accept either. */
type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/**
 * The vendor's view of one order, with how it leaves the shop, who is
 * collecting it and why it ended if it did.
 *
 * One query, used for the list, the single read and the summary every
 * transition returns. The list and the read used to carry this 40-line block
 * each, verbatim, and the transitions returned a bare RETURNING projection
 * that reported every order as a platform delivery.
 */
const VENDOR_ORDER_SUMMARY_SQL = `
  SELECT o.vendor_order_id, o.order_reference, o.lifecycle_state,
         o.total_minor::text AS total_minor,
         o.version, o.accept_by, o.accepted_at, o.ready_at, o.picked_up_at, o.package_count,
         o.package_condition_note, o.preparation_estimate_seconds, o.pickup_otp_expires_at,
         o.pickup_otp_attempts, o.out_for_delivery_at, o.delivery_otp_expires_at,
         o.delivery_otp_attempts, o.decline_reason_code,
         method.fulfilment_method, method.route_metres, method.route_seconds, method.route_source,
         collection.assignment_state, collection.wait_state, collection.partner_waiting_since,
         resolution.reason_code AS resolution_reason_code,
         resolution.actor_kind AS resolution_actor_kind,
         resolution.occurred_at AS resolution_occurred_at
    FROM marketplace.vendor_orders o
    LEFT JOIN LATERAL (
      SELECT cvg.fulfilment_method, cqg.route_metres, cqg.route_seconds, cqg.route_source
        FROM marketplace.checkout_groups cg
        JOIN marketplace.checkout_quote_groups cqg
          ON cqg.checkout_quote_id = cg.checkout_quote_id
         AND cqg.vendor_location_id = o.vendor_location_id
        JOIN marketplace.cart_vendor_groups cvg USING (cart_vendor_group_id)
       WHERE cg.checkout_group_id = o.checkout_group_id
       LIMIT 1
    ) method ON true
    LEFT JOIN LATERAL (
      SELECT a.assignment_state, w.wait_state,
             CASE WHEN w.ended_at IS NULL THEN w.started_at END AS partner_waiting_since
        FROM marketplace.delivery_assignments a
        LEFT JOIN marketplace.partner_wait_timers w
          ON w.delivery_assignment_id = a.delivery_assignment_id
       WHERE a.vendor_order_id = o.vendor_order_id
       ORDER BY a.created_at DESC
       LIMIT 1
    ) collection ON true
    LEFT JOIN LATERAL (
      SELECT e.reason_code, e.actor_kind, e.occurred_at
        FROM marketplace.vendor_order_events e
       WHERE e.vendor_order_id = o.vendor_order_id
         AND e.resulting_state = o.lifecycle_state
         AND o.lifecycle_state IN ('CANCELLED', 'EXPIRED')
       ORDER BY e.occurred_at DESC
       LIMIT 1
    ) resolution ON true`;

async function orderSummaries(
  db: Queryable,
  input: { readonly where: string; readonly params: readonly unknown[]; readonly tail?: string },
): Promise<readonly VendorOrderSummary[]> {
  const result = await db.query(
    `${VENDOR_ORDER_SUMMARY_SQL} WHERE ${input.where} ${input.tail ?? ''}`,
    [...input.params],
  );
  return Object.freeze(result.rows.map((row) => projectSummary(row as Record<string, unknown>)));
}

/** The summary of one order, or not found. */
async function orderSummary(db: Queryable, vendorOrderId: UuidV7): Promise<VendorOrderSummary> {
  const [summary] = await orderSummaries(db, {
    where: 'o.vendor_order_id=$1',
    params: [vendorOrderId],
  });
  if (!summary) throw new FulfilmentNotFoundError();
  return summary;
}

function projectSummary(row: Record<string, unknown>): VendorOrderSummary {
  return Object.freeze({
    vendor_order_id: parseUuidV7(row['vendor_order_id'] as string),
    order_reference: row['order_reference'] as string,
    lifecycle_state: row['lifecycle_state'] as VendorOrderState,
    total_minor: Number(row['total_minor']),
    version: row['version'] as number,
    accept_by: (row['accept_by'] as Date | null) ?? null,
    accepted_at: (row['accepted_at'] as Date | null) ?? null,
    ready_at: (row['ready_at'] as Date | null) ?? null,
    picked_up_at: (row['picked_up_at'] as Date | null) ?? null,
    package_count: (row['package_count'] as number | null) ?? null,
    package_condition_note: (row['package_condition_note'] as string | null) ?? null,
    preparation_estimate_seconds: (row['preparation_estimate_seconds'] as number | null) ?? null,
    pickup_otp_expires_at: (row['pickup_otp_expires_at'] as Date | null) ?? null,
    pickup_otp_attempts: row['pickup_otp_attempts'] as number,
    out_for_delivery_at: (row['out_for_delivery_at'] as Date | null) ?? null,
    delivery_otp_expires_at: (row['delivery_otp_expires_at'] as Date | null) ?? null,
    delivery_otp_attempts: (row['delivery_otp_attempts'] as number | null) ?? 0,
    decline_reason_code: (row['decline_reason_code'] as string | null) ?? null,
    // The same default `customerTracking` and dispatch apply: an order whose
    // checkout group cannot be joined is treated as a platform delivery.
    fulfilment_method: (row['fulfilment_method'] as string | null) ?? 'PLATFORM_DELIVERY',
    route_metres: row['route_metres'] == null ? null : Number(row['route_metres']),
    route_seconds: row['route_seconds'] == null ? null : Number(row['route_seconds']),
    route_source: (row['route_source'] as 'ESTIMATE' | 'MAPBOX' | null) ?? null,
    resolution: row['resolution_reason_code']
      ? Object.freeze({
          reason_code: row['resolution_reason_code'] as string,
          ended_by: row['resolution_actor_kind'] as string,
          occurred_at: row['resolution_occurred_at'] as Date,
        })
      : null,
    collection: row['assignment_state']
      ? Object.freeze({
          assignment_state: row['assignment_state'] as string,
          partner_waiting_since: (row['partner_waiting_since'] as Date | null) ?? null,
          wait_state: (row['wait_state'] as string | null) ?? null,
        })
      : null,
  });
}

function projectPick(row: Record<string, unknown>): PickRecord {
  return Object.freeze({
    pick_id: parseUuidV7(row['pick_id'] as string),
    vendor_order_line_id: parseUuidV7(row['vendor_order_line_id'] as string),
    pick_state: row['pick_state'] as PickState | 'PENDING',
    actual_quantity: (row['actual_quantity'] as number | null) ?? null,
    actual_unit_price_minor: row['actual_unit_price_minor']
      ? Number(row['actual_unit_price_minor'])
      : null,
    substitution_variant_id: row['substitution_variant_id']
      ? parseUuidV7(row['substitution_variant_id'] as string)
      : null,
    version: row['version'] as number,
    product_title: (row['product_title'] as string | null) ?? null,
    ordered_quantity: row['ordered_quantity'] == null ? null : Number(row['ordered_quantity']),
    ordered_unit_price_minor:
      row['ordered_unit_price_minor'] == null ? null : Number(row['ordered_unit_price_minor']),
    substitution_preference: (row['substitution_preference'] as string | null) ?? null,
    variable_weight: (row['variable_weight'] as boolean | null) ?? null,
  });
}

/** A decision as the customer reads it: the old item, the new one, the money. */
export interface CustomerDecision {
  readonly decision_id: UuidV7;
  readonly vendor_order_id: UuidV7;
  readonly order_reference: string;
  readonly location_name: string;
  readonly proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
  readonly ordered: {
    readonly product_title: string;
    readonly variant_title: string;
    readonly quantity: number;
    readonly unit_price_minor: number;
    readonly total_minor: number;
  };
  readonly offered: {
    readonly product_title: string;
    readonly variant_title: string;
    readonly quantity: number;
    readonly unit_price_minor: number;
    readonly total_minor: number;
  };
  /** Offered total minus ordered total; what approval adds to the authorisation. */
  readonly difference_minor: number;
  readonly reason_note: string;
  readonly decision_deadline_at: string;
  readonly answer: DecisionAnswer;
  readonly answered_at: string | null;
}

interface CustomerDecisionRow {
  decision_id: string;
  vendor_order_id: string;
  order_reference: string;
  location_name: string;
  proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
  ordered_product_title: string;
  ordered_variant_title: string;
  ordered_quantity: number;
  ordered_unit_price_minor: string;
  offered_product_title: string | null;
  offered_variant_title: string | null;
  proposed_quantity: number;
  proposed_unit_price_minor: string;
  authorization_delta_minor: string;
  reason_note: string;
  decision_deadline_at: Date;
  answer: DecisionAnswer;
  answered_at: Date | null;
}

const CUSTOMER_DECISION_SELECT = `
  SELECT d.decision_id, d.vendor_order_id, vo.order_reference, loc.location_name,
         d.proposal_kind,
         l.product_title_snapshot AS ordered_product_title,
         l.variant_title_snapshot AS ordered_variant_title,
         l.quantity AS ordered_quantity, l.unit_price_minor::text AS ordered_unit_price_minor,
         offered_product.title AS offered_product_title,
         offered_variant.variant_title AS offered_variant_title,
         d.proposed_quantity, d.proposed_unit_price_minor::text AS proposed_unit_price_minor,
         d.authorization_delta_minor::text AS authorization_delta_minor, d.reason_note,
         d.decision_deadline_at, d.answer, d.answered_at
    FROM marketplace.vendor_order_customer_decisions d
    JOIN marketplace.vendor_orders vo ON vo.vendor_order_id = d.vendor_order_id
    JOIN marketplace.vendor_locations loc ON loc.vendor_location_id = vo.vendor_location_id
    JOIN marketplace.checkout_groups cg ON cg.checkout_group_id = vo.checkout_group_id
    JOIN marketplace.vendor_order_line_picks p ON p.pick_id = d.pick_id
    JOIN marketplace.vendor_order_lines l ON l.vendor_order_line_id = p.vendor_order_line_id
    LEFT JOIN marketplace.catalogue_product_variants offered_variant
      ON offered_variant.catalogue_variant_id = d.proposed_variant_id
    LEFT JOIN marketplace.catalogue_products offered_product
      ON offered_product.catalogue_product_id = offered_variant.catalogue_product_id`;

function projectCustomerDecision(row: CustomerDecisionRow): CustomerDecision {
  const orderedUnit = Number(row.ordered_unit_price_minor);
  const offeredUnit = Number(row.proposed_unit_price_minor);
  return Object.freeze({
    decision_id: parseUuidV7(row.decision_id),
    vendor_order_id: parseUuidV7(row.vendor_order_id),
    order_reference: row.order_reference,
    location_name: row.location_name,
    proposal_kind: row.proposal_kind,
    ordered: Object.freeze({
      product_title: row.ordered_product_title,
      variant_title: row.ordered_variant_title,
      quantity: row.ordered_quantity,
      unit_price_minor: orderedUnit,
      total_minor: orderedUnit * row.ordered_quantity,
    }),
    offered: Object.freeze({
      // A weight is the same item, weighed; a replacement is another one.
      product_title: row.offered_product_title ?? row.ordered_product_title,
      variant_title: row.offered_variant_title ?? row.ordered_variant_title,
      quantity: row.proposed_quantity,
      unit_price_minor: offeredUnit,
      total_minor: offeredUnit * row.proposed_quantity,
    }),
    difference_minor: Number(row.authorization_delta_minor),
    reason_note: row.reason_note,
    decision_deadline_at: row.decision_deadline_at.toISOString(),
    answer: row.answer,
    answered_at: row.answered_at?.toISOString() ?? null,
  });
}

function projectDecision(row: Record<string, unknown>): DecisionRecord {
  return Object.freeze({
    decision_id: parseUuidV7(row['decision_id'] as string),
    vendor_order_id: parseUuidV7(row['vendor_order_id'] as string),
    pick_id: parseUuidV7(row['pick_id'] as string),
    proposal_kind: row['proposal_kind'] as 'SUBSTITUTION' | 'WEIGHT',
    proposed_variant_id: row['proposed_variant_id']
      ? parseUuidV7(row['proposed_variant_id'] as string)
      : null,
    proposed_quantity: row['proposed_quantity'] as number,
    proposed_unit_price_minor: Number(row['proposed_unit_price_minor']),
    authorization_delta_minor: Number(row['authorization_delta_minor']),
    reason_note: row['reason_note'] as string,
    decision_deadline_at: row['decision_deadline_at'] as Date,
    answer: row['answer'] as DecisionAnswer,
    answered_at: (row['answered_at'] as Date | null) ?? null,
  });
}

/**
 * Every route in this service converges on the vendor_order aggregate,
 * consuming inventory holds committed by Phase 7 checkout and producing
 * customer-facing state changes. Payment capture and ledger posting stay in
 * MoneyLifecycleService; this service triggers them via an outbox event on
 * pickup.
 */
export class VendorFulfilmentService {
  readonly #pool: Pool;
  readonly #inventory: InventoryReservationService;

  constructor(input: {
    readonly connection_string: string;
    readonly inventory: InventoryReservationService;
  }) {
    this.#pool = createDatabasePool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-vendor-fulfilment',
      max: 8,
    });
    this.#inventory = input.inventory;
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  /**
   * The decisions the caller (a customer) still owes an answer on, with what
   * they need to answer (8.4): the item as ordered and what the shop offers
   * instead -- titles, quantities, prices -- the difference, the reason, the
   * deadline and the store. Until audit run 52 the list carried the proposed
   * quantity and price alone, so the customer was asked to approve
   * "a replacement item" without being told which item, or for what.
   */
  async listPendingCustomerDecisions(input: {
    readonly context: RequestContext;
  }): Promise<readonly CustomerDecision[]> {
    const actor = input.context.actor;
    if (!actor || actor.actor_kind !== 'customer') return [];
    const rows = await this.#pool.query<CustomerDecisionRow>(
      `${CUSTOMER_DECISION_SELECT}
        WHERE d.answer = 'PENDING' AND cg.customer_user_id = $1
        ORDER BY d.decision_deadline_at ASC
        LIMIT 25`,
      [parseUuidV7(actor.actor_id)],
    );
    return rows.rows.map(projectCustomerDecision);
  }

  // -----------------------------------------------------------------------
  // 8.1 -- issue an accept-by deadline (system, at checkout completion time)
  // -----------------------------------------------------------------------

  /**
   * Called by the checkout finalizer (or a maintenance backfill) to attach a
   * response deadline to every freshly-PLACED vendor_order in a checkout
   * group. Idempotent: rows that already carry an accept_by are untouched.
   */
  async issueAcceptDeadlines(input: {
    readonly context: RequestContext;
    readonly checkout_group_id: UuidV7;
    readonly deadline_seconds?: number;
    readonly now?: Date;
  }): Promise<readonly UuidV7[]> {
    requireSystemOrVendor(input.context);
    const seconds = input.deadline_seconds ?? DEFAULT_ACCEPT_DEADLINE_SECONDS;
    if (seconds < 30 || seconds > 30 * 60) {
      throw new FulfilmentInputError('Response deadline must be between 30s and 30 minutes');
    }
    const now = input.now ?? new Date();
    const deadline = new Date(now.getTime() + seconds * 1000);
    return tx(this.#pool, async (client) => {
      const updated = await client.query<{ vendor_order_id: string }>(
        `UPDATE marketplace.vendor_orders SET accept_by=$2, updated_at=$3
          WHERE checkout_group_id=$1 AND lifecycle_state='PLACED' AND accept_by IS NULL
          RETURNING vendor_order_id`,
        [input.checkout_group_id, deadline, now],
      );
      return Object.freeze(updated.rows.map((row) => parseUuidV7(row.vendor_order_id)));
    });
  }

  // -----------------------------------------------------------------------
  // 8.2 -- accept and decline
  // -----------------------------------------------------------------------

  async accept(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly preparation_estimate_seconds: number;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    if (
      !Number.isSafeInteger(input.preparation_estimate_seconds) ||
      input.preparation_estimate_seconds < 60 ||
      input.preparation_estimate_seconds > 14400
    ) {
      throw new FulfilmentInputError('Preparation estimate must be between 60 and 14400 seconds');
    }
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PLACED')
        throw new FulfilmentConflictError('Only a placed order can be accepted');
      if (order.version !== input.expected_version)
        throw new FulfilmentConflictError('Vendor order version has advanced', 'VERSION_CONFLICT');
      if (order.accept_by && order.accept_by <= now)
        throw new FulfilmentConflictError('The response deadline has passed');
      const version = order.version + 1;
      const ids = contextIds(input.context);
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='ACCEPTED', accepted_at=$2, preparation_estimate_seconds=$3,
                version=$4, updated_at=$2
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, now, input.preparation_estimate_seconds, version],
      );
      // The acceptance is the sale: the order's provisional holds are committed
      // in this transaction, so an accepted order never sits on a hold with a
      // deadline (8.2). A hold that is no longer held means the shelf may be
      // short, and the shop is told rather than promised stock it may not have.
      await this.#commitHolds(client, input.context, input.vendor_order_id, now);
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'ACCEPTED',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'PLACED',
        resulting_state: 'ACCEPTED',
        reason_code: 'VENDOR_ACCEPTED',
        // The estimate as given, kept even if it is revised while picking.
        note: `Preparation estimate ${input.preparation_estimate_seconds}s`,
        ids,
      });
      // Capture is a provider call, so it belongs on the outbox rather than in
      // the vendor's own transaction: the shop should not wait on a payment
      // gateway to see its order accepted, and a gateway failure must retry
      // rather than undo the acceptance.
      await publishVendorOrderTransition(client, {
        context: input.context,
        event_type: 'vendor_order.accepted',
        now,
        reason_code: 'VENDOR_ACCEPTED',
        source: 'vendor_fulfilment',
        to_state: 'ACCEPTED',
        vendor_order_id: input.vendor_order_id,
      });
      return orderSummary(client, input.vendor_order_id);
    });
  }

  /**
   * What declining would do, for the shop to read before it decides (8.2):
   * the customer's money released for this order alone, the units that go
   * back to the shelf, the sibling orders left untouched, and the shop's own
   * acceptance record before and after. Read-only; the numbers are the ones
   * the decline itself would use. Until audit run 50 the console computed a
   * sentence from the order total on its own.
   */
  async previewDecline(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly window_days?: number;
    readonly now?: Date;
  }): Promise<DeclineImpact> {
    await requireVendorMemberPool(this.#pool, input.context, input.vendor_location_id);
    const now = input.now ?? new Date();
    const windowDays = Math.min(Math.max(input.window_days ?? 30, 1), 90);
    const order = await this.#pool.query<{
      order_reference: string;
      lifecycle_state: string;
      accept_by: Date | null;
      total_minor: string;
      checkout_group_id: string;
      allocated_minor: string | null;
    }>(
      `SELECT o.order_reference, o.lifecycle_state, o.accept_by, o.total_minor::text,
              o.checkout_group_id,
              (SELECT allocation.allocated_total_minor::text
                 FROM marketplace.payment_allocations allocation
                 JOIN marketplace.checkout_groups grouping
                   ON grouping.payment_transaction_id = allocation.payment_transaction_id
                WHERE grouping.checkout_group_id = o.checkout_group_id
                  AND allocation.source_order_reference = o.order_reference) AS allocated_minor
         FROM marketplace.vendor_orders o
        WHERE o.vendor_order_id=$1 AND o.vendor_location_id=$2`,
      [input.vendor_order_id, input.vendor_location_id],
    );
    const found = order.rows[0];
    if (!found) throw new FulfilmentNotFoundError();
    const lines = await this.#pool.query<{
      product_title: string;
      quantity: number;
      counted: boolean | null;
      held: string | null;
    }>(
      `SELECT l.product_title_snapshot AS product_title, l.quantity,
              r.counted_stock_applied AS counted, r.quantity::text AS held
         FROM marketplace.vendor_order_lines l
         LEFT JOIN marketplace.inventory_reservations r
           ON r.reservation_id = l.inventory_reservation_id
          AND r.reservation_state IN ('SOFT_HELD','PROVISIONAL','COMMITTED')
        WHERE l.vendor_order_id=$1
        ORDER BY l.vendor_order_line_id`,
      [input.vendor_order_id],
    );
    const siblings = await this.#pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.vendor_orders
        WHERE checkout_group_id=$1 AND vendor_order_id<>$2`,
      [found.checkout_group_id, input.vendor_order_id],
    );
    const record = await this.#pool.query<{ answered: string; accepted: string }>(
      `SELECT count(*) FILTER (WHERE accepted_at IS NOT NULL OR decline_reason_code IS NOT NULL)::text
                AS answered,
              count(*) FILTER (WHERE accepted_at IS NOT NULL)::text AS accepted
         FROM marketplace.vendor_orders
        WHERE vendor_location_id=$1 AND created_at >= $2 AND vendor_order_id<>$3`,
      [
        input.vendor_location_id,
        new Date(now.getTime() - windowDays * 86_400_000),
        input.vendor_order_id,
      ],
    );
    const answered = Number(record.rows[0]?.answered ?? '0');
    const allocated = Number(found.allocated_minor ?? found.total_minor);
    return Object.freeze({
      vendor_order_id: input.vendor_order_id,
      order_reference: found.order_reference,
      lifecycle_state: found.lifecycle_state,
      accept_by: found.accept_by,
      can_decline:
        found.lifecycle_state === 'PLACED' && (found.accept_by === null || found.accept_by > now),
      released_minor: Number.isSafeInteger(allocated) && allocated > 0 ? allocated : 0,
      lines: Object.freeze(
        lines.rows.map((line) =>
          Object.freeze({
            product_title: line.product_title,
            quantity: line.quantity,
            units_returned: line.counted && line.held !== null ? Number(line.held) : null,
          }),
        ),
      ),
      sibling_orders: Number(siblings.rows[0]?.count ?? '0'),
      acceptance: Object.freeze({
        window_days: windowDays,
        answered,
        accepted: Number(record.rows[0]?.accepted ?? '0'),
        answered_after: answered + 1,
      }),
      reasons: VENDOR_DECLINE_REASONS,
    });
  }

  /**
   * Decline moves the order to CANCELLED and releases its inventory holds so
   * a sibling order in the same checkout group is not blocked. The customer
   * refund path is triggered by the outbox event this appends, not by this
   * service directly - MoneyLifecycleService owns the ledger.
   */
  async decline(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly note?: string;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    if (!(VENDOR_DECLINE_REASONS as readonly string[]).includes(input.reason_code))
      throw new FulfilmentInputError(
        `Decline reason must be one of ${VENDOR_DECLINE_REASONS.join(', ')}`,
      );
    if (input.note !== undefined && (input.note.length < 1 || input.note.length > 240))
      throw new FulfilmentInputError('Note must be between 1 and 240 characters');
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PLACED')
        throw new FulfilmentConflictError('Only a placed order can be declined');
      if (order.version !== input.expected_version)
        throw new FulfilmentConflictError('Vendor order version has advanced', 'VERSION_CONFLICT');
      const version = order.version + 1;
      const ids = contextIds(input.context);
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='CANCELLED', decline_reason_code=$2, decline_note=$3,
                version=$4, updated_at=$5
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, input.reason_code, input.note ?? null, version, now],
      );
      await this.#releaseHolds(
        client,
        input.context,
        input.vendor_order_id,
        now,
        'VENDOR_DECLINED',
      );
      await releaseAuthorizationForEndedOrder(client, {
        actor_id: userId,
        actor_kind: 'vendor_staff',
        ids,
        now,
        reason_code: 'VENDOR_DECLINED_ORDER',
        vendor_order_id: input.vendor_order_id,
      });
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'DECLINED',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'PLACED',
        resulting_state: 'CANCELLED',
        reason_code: input.reason_code,
        note: input.note ?? null,
        ids,
      });
      await publishVendorOrderTransition(client, {
        context: input.context,
        event_type: 'vendor_order.ended',
        now,
        payload: { ended_by: 'vendor_staff', reason_code: input.reason_code },
        reason_code: input.reason_code,
        source: 'vendor_fulfilment',
        to_state: 'CANCELLED',
        vendor_order_id: input.vendor_order_id,
      });
      return orderSummary(client, input.vendor_order_id);
    });
  }

  /**
   * Cron/worker entry point: any PLACED order whose accept_by has passed is
   * cancelled with reason ACCEPT_DEADLINE_TIMEOUT and its holds are released.
   */
  async timeoutOverdueAccepts(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<readonly UuidV7[]> {
    const systemActorId = requireSystemOrVendor(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const overdue = await client.query<{ vendor_order_id: string; version: number }>(
        `SELECT vendor_order_id, version FROM marketplace.vendor_orders
          WHERE lifecycle_state='PLACED' AND accept_by IS NOT NULL AND accept_by <= $1
          FOR UPDATE SKIP LOCKED`,
        [now],
      );
      const ids = contextIds(input.context);
      const timedOut: UuidV7[] = [];
      for (const row of overdue.rows) {
        const orderId = parseUuidV7(row.vendor_order_id);
        await client.query(
          `UPDATE marketplace.vendor_orders
              SET lifecycle_state='EXPIRED', decline_reason_code='ACCEPT_DEADLINE_TIMEOUT',
                  version=$2, updated_at=$3
            WHERE vendor_order_id=$1`,
          [orderId, row.version + 1, now],
        );
        await this.#releaseHolds(client, input.context, orderId, now, 'ACCEPT_DEADLINE_TIMEOUT');
        await releaseAuthorizationForEndedOrder(client, {
          actor_id: systemActorId,
          actor_kind: 'system',
          ids,
          now,
          reason_code: 'ACCEPT_DEADLINE_TIMEOUT',
          vendor_order_id: orderId,
        });
        await appendEvent(client, {
          vendor_order_id: orderId,
          event_type: 'TIMED_OUT',
          actor_id: systemActorId,
          actor_kind: 'system',
          previous_state: 'PLACED',
          resulting_state: 'EXPIRED',
          reason_code: 'ACCEPT_DEADLINE_TIMEOUT',
          ids,
        });
        await publishVendorOrderTransition(client, {
          context: input.context,
          event_type: 'vendor_order.ended',
          now,
          payload: { ended_by: 'system', reason_code: 'ACCEPT_DEADLINE_TIMEOUT' },
          reason_code: 'ACCEPT_DEADLINE_TIMEOUT',
          source: 'vendor_fulfilment',
          to_state: 'EXPIRED',
          vendor_order_id: orderId,
        });
        timedOut.push(orderId);
      }
      return Object.freeze(timedOut);
    });
  }

  // -----------------------------------------------------------------------
  // 8.3 -- picking workflow
  // -----------------------------------------------------------------------

  async startPicking(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'ACCEPTED')
        throw new FulfilmentConflictError('Only an accepted order can start picking');
      if (order.version !== input.expected_version)
        throw new FulfilmentConflictError('Vendor order version has advanced', 'VERSION_CONFLICT');
      const version = order.version + 1;
      const ids = contextIds(input.context);
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='PICKING', picking_started_at=$2, version=$3, updated_at=$2
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, now, version],
      );
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'PICKING_STARTED',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'ACCEPTED',
        resulting_state: 'PICKING',
        reason_code: 'PICKER_STARTED',
        ids,
      });
      return orderSummary(client, input.vendor_order_id);
    });
  }

  /**
   * Found: the line as ordered, or fewer of it. The quantity is bounded by
   * what was ordered and the price is the snapshot's -- a changed price or a
   * heavier weight is a proposal for the customer (8.4), never a "found".
   * Until audit run 51 any quantity and any price were recorded as found.
   */
  async markLineFound(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly actual_quantity: number;
    readonly actual_unit_price_minor: number;
    readonly expected_version: number;
    readonly now?: Date;
  }): Promise<PickRecord> {
    if (!Number.isSafeInteger(input.actual_quantity) || input.actual_quantity < 1)
      throw new FulfilmentInputError('A found line has at least one unit');
    return this.#recordPick({
      ...input,
      pick_state: 'FOUND',
      actual_quantity: input.actual_quantity,
      actual_unit_price_minor: input.actual_unit_price_minor,
      substitution_variant_id: null,
      reason_code: 'LINE_PICKED_FOUND',
      event_type: 'LINE_PICKED',
    });
  }

  async markLineMissing(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly expected_version: number;
    readonly now?: Date;
  }): Promise<PickRecord> {
    return this.#recordPick({
      ...input,
      pick_state: 'MISSING',
      actual_quantity: null,
      actual_unit_price_minor: null,
      substitution_variant_id: null,
      reason_code: 'LINE_UNAVAILABLE',
      event_type: 'LINE_MISSING',
    });
  }

  async proposeSubstitution(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly substitution_variant_id: UuidV7;
    readonly proposed_quantity: number;
    readonly proposed_unit_price_minor: number;
    readonly reason_note: string;
    readonly expected_version: number;
    readonly decision_deadline_seconds?: number;
    readonly now?: Date;
  }): Promise<{ readonly pick: PickRecord; readonly decision: DecisionRecord }> {
    if (input.reason_note.length < 1 || input.reason_note.length > 240)
      throw new FulfilmentInputError('Reason note must be between 1 and 240 characters');
    const deadlineSeconds =
      input.decision_deadline_seconds ?? (await this.decisionDeadlineSeconds(input.now));
    if (deadlineSeconds < 60 || deadlineSeconds > 3600)
      throw new FulfilmentInputError('Decision deadline must be between 60s and 60 minutes');
    return this.#recordPickAndProposal({
      ...input,
      pick_state: 'PROPOSED_SUBSTITUTION',
      proposal_kind: 'SUBSTITUTION',
      substitution_variant_id: input.substitution_variant_id,
      proposed_variant_id: input.substitution_variant_id,
      decision_deadline_seconds: deadlineSeconds,
      reason_code: 'SUBSTITUTION_PROPOSED',
      event_type: 'SUBSTITUTION_PROPOSED',
    });
  }

  async proposeWeight(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly proposed_quantity: number;
    readonly proposed_unit_price_minor: number;
    readonly reason_note: string;
    readonly expected_version: number;
    readonly decision_deadline_seconds?: number;
    readonly now?: Date;
  }): Promise<{ readonly pick: PickRecord; readonly decision: DecisionRecord }> {
    if (input.reason_note.length < 1 || input.reason_note.length > 240)
      throw new FulfilmentInputError('Reason note must be between 1 and 240 characters');
    const deadlineSeconds =
      input.decision_deadline_seconds ?? (await this.decisionDeadlineSeconds(input.now));
    if (deadlineSeconds < 60 || deadlineSeconds > 3600)
      throw new FulfilmentInputError('Decision deadline must be between 60s and 60 minutes');
    return this.#recordPickAndProposal({
      ...input,
      pick_state: 'PROPOSED_WEIGHT',
      proposal_kind: 'WEIGHT',
      substitution_variant_id: null,
      proposed_variant_id: null,
      decision_deadline_seconds: deadlineSeconds,
      reason_code: 'WEIGHT_PROPOSED',
      event_type: 'WEIGHT_PROPOSED',
    });
  }

  // -----------------------------------------------------------------------
  // 8.4 -- customer decision
  // -----------------------------------------------------------------------

  /**
   * How long the customer has to answer: `customer.decision_seconds`
   * (implementation.md 6.1, a SETTING resolved at the proposal), 60-3600, or
   * the default. Until audit run 52 the default was the only value.
   */
  async decisionDeadlineSeconds(at?: Date): Promise<number> {
    const resolved = await resolveConfiguration(this.#pool, {
      configuration_key: 'customer.decision_seconds',
      configuration_kind: 'SETTING',
      ...(at ? { at } : {}),
    });
    const value = resolved?.configuration_value;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 60 && value <= 3600
      ? value
      : DEFAULT_DECISION_DEADLINE_SECONDS;
  }

  async answerDecision(input: {
    readonly context: RequestContext;
    readonly decision_id: UuidV7;
    readonly answer: 'APPROVED' | 'REJECTED';
    readonly now?: Date;
  }): Promise<DecisionRecord> {
    if (input.answer !== 'APPROVED' && input.answer !== 'REJECTED')
      throw new FulfilmentInputError('Answer must be APPROVED or REJECTED');
    const customerId = requireCustomer(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const found = await client.query<{
        decision_id: string;
        vendor_order_id: string;
        pick_id: string;
        proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
        proposed_variant_id: string | null;
        proposed_quantity: number;
        proposed_unit_price_minor: string;
        authorization_delta_minor: string;
        answer: DecisionAnswer;
        decision_deadline_at: Date;
        customer_user_id: string;
      }>(
        `SELECT d.decision_id, d.vendor_order_id, d.pick_id, d.proposal_kind, d.proposed_variant_id,
                d.proposed_quantity, d.proposed_unit_price_minor::text AS proposed_unit_price_minor,
                d.authorization_delta_minor::text AS authorization_delta_minor,
                d.answer, d.decision_deadline_at, cg.customer_user_id
           FROM marketplace.vendor_order_customer_decisions d
           JOIN marketplace.vendor_orders o USING (vendor_order_id)
           JOIN marketplace.checkout_groups cg ON cg.checkout_group_id=o.checkout_group_id
          WHERE d.decision_id=$1 FOR UPDATE OF d`,
        [input.decision_id],
      );
      const row = found.rows[0];
      if (!row) throw new FulfilmentNotFoundError();
      if (row.customer_user_id !== customerId) throw new FulfilmentNotFoundError();
      if (row.answer !== 'PENDING')
        throw new FulfilmentConflictError('Decision has already been answered');
      if (row.decision_deadline_at <= now)
        throw new FulfilmentConflictError('Decision deadline has passed');
      await client.query(
        `UPDATE marketplace.vendor_order_customer_decisions
            SET answer=$2, answered_at=$3, updated_at=$3
          WHERE decision_id=$1`,
        [input.decision_id, input.answer, now],
      );
      const updated = await client.query<Record<string, unknown>>(
        `SELECT * FROM marketplace.vendor_order_customer_decisions WHERE decision_id=$1`,
        [input.decision_id],
      );
      // Roll the pick row forward to match the customer's decision.
      const nextPickState: PickState =
        row.proposal_kind === 'SUBSTITUTION'
          ? input.answer === 'APPROVED'
            ? 'SUBSTITUTION_APPROVED'
            : 'SUBSTITUTION_REJECTED'
          : input.answer === 'APPROVED'
            ? 'WEIGHT_APPROVED'
            : 'WEIGHT_REJECTED';
      const ids = contextIds(input.context);
      await client.query(
        `UPDATE marketplace.vendor_order_line_picks
            SET pick_state=$2,
                actual_quantity=CASE WHEN $3='APPROVED' THEN $4::integer ELSE NULL END,
                actual_unit_price_minor=CASE WHEN $3='APPROVED' THEN $5::bigint ELSE NULL END,
                substitution_variant_id=CASE WHEN $3='APPROVED' THEN $6::uuid ELSE NULL END,
                version=version+1, updated_at=$7
          WHERE pick_id=$1`,
        [
          row.pick_id,
          nextPickState,
          input.answer,
          row.proposed_quantity,
          row.proposed_unit_price_minor,
          row.proposed_variant_id,
          now,
        ],
      );
      if (input.answer === 'APPROVED') {
        await adjustAuthorizationForOrder(client, {
          vendor_order_id: parseUuidV7(row.vendor_order_id),
          delta_minor: Number(row.authorization_delta_minor),
          adjustment_kind: 'CUSTOMER_DECISION',
          decision_id: input.decision_id,
          actor_id: customerId,
          actor_kind: 'customer',
          reason_code: 'CUSTOMER_DECISION_ADJUSTED',
          ids,
          now,
        });
      }
      await appendEvent(client, {
        vendor_order_id: parseUuidV7(row.vendor_order_id),
        event_type:
          row.proposal_kind === 'SUBSTITUTION'
            ? input.answer === 'APPROVED'
              ? 'SUBSTITUTION_APPROVED'
              : 'SUBSTITUTION_REJECTED'
            : input.answer === 'APPROVED'
              ? 'WEIGHT_APPROVED'
              : 'WEIGHT_REJECTED',
        actor_id: customerId,
        actor_kind: 'customer',
        previous_state: null,
        resulting_state: null,
        reason_code: input.answer === 'APPROVED' ? 'CUSTOMER_APPROVED' : 'CUSTOMER_REJECTED',
        decision_id: input.decision_id,
        ids,
      });
      return projectDecision(updated.rows[0] as Record<string, unknown>);
    });
  }

  /**
   * Any decision whose deadline has passed is auto-answered TIMED_OUT with
   * the same effect as REJECTED (safer default: never charge for a
   * substitution the customer never saw).
   */
  async timeoutOverdueDecisions(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<readonly UuidV7[]> {
    const systemActorId = requireSystemOrVendor(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const overdue = await client.query<{
        decision_id: string;
        vendor_order_id: string;
        pick_id: string;
        proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
      }>(
        `SELECT decision_id, vendor_order_id, pick_id, proposal_kind
           FROM marketplace.vendor_order_customer_decisions
          WHERE answer='PENDING' AND decision_deadline_at <= $1 FOR UPDATE SKIP LOCKED`,
        [now],
      );
      const ids = contextIds(input.context);
      const timedOut: UuidV7[] = [];
      for (const row of overdue.rows) {
        await client.query(
          `UPDATE marketplace.vendor_order_customer_decisions
              SET answer='TIMED_OUT', answered_at=$2, updated_at=$2
            WHERE decision_id=$1`,
          [row.decision_id, now],
        );
        const rejectedState: PickState =
          row.proposal_kind === 'SUBSTITUTION' ? 'SUBSTITUTION_REJECTED' : 'WEIGHT_REJECTED';
        await client.query(
          `UPDATE marketplace.vendor_order_line_picks
              SET pick_state=$2, actual_quantity=NULL, actual_unit_price_minor=NULL,
                  substitution_variant_id=NULL, version=version+1, updated_at=$3
            WHERE pick_id=$1`,
          [row.pick_id, rejectedState, now],
        );
        await appendEvent(client, {
          vendor_order_id: parseUuidV7(row.vendor_order_id),
          event_type:
            row.proposal_kind === 'SUBSTITUTION' ? 'SUBSTITUTION_REJECTED' : 'WEIGHT_REJECTED',
          actor_id: systemActorId,
          actor_kind: 'system',
          previous_state: null,
          resulting_state: null,
          reason_code: 'DECISION_DEADLINE_TIMEOUT',
          decision_id: parseUuidV7(row.decision_id),
          ids,
        });
        timedOut.push(parseUuidV7(row.decision_id));
      }
      return Object.freeze(timedOut);
    });
  }

  // -----------------------------------------------------------------------
  // 8.5 -- ready
  // -----------------------------------------------------------------------

  async markReady(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly package_count: number;
    readonly package_condition_note?: string;
    readonly pickup_promise_at?: Date;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    if (
      !Number.isSafeInteger(input.package_count) ||
      input.package_count < 1 ||
      input.package_count > 40
    ) {
      throw new FulfilmentInputError('Package count must be between 1 and 40');
    }
    if (
      input.package_condition_note !== undefined &&
      (input.package_condition_note.length < 1 || input.package_condition_note.length > 240)
    ) {
      throw new FulfilmentInputError('Condition note must be between 1 and 240 characters');
    }
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PICKING')
        throw new FulfilmentConflictError('Only an order in picking can be marked ready');
      if (order.version !== input.expected_version)
        throw new FulfilmentConflictError('Vendor order version has advanced', 'VERSION_CONFLICT');
      // Every line must be resolved (FOUND, MISSING, or a decided proposal)
      // and no proposal may still be PENDING before ready succeeds.
      const unresolved = await client.query<{ count: string }>(
        `SELECT (
           (SELECT count(*) FROM marketplace.vendor_order_lines l
             WHERE l.vendor_order_id=$1
               AND NOT EXISTS (SELECT 1 FROM marketplace.vendor_order_line_picks p
                                 WHERE p.vendor_order_line_id=l.vendor_order_line_id))
           +
           (SELECT count(*) FROM marketplace.vendor_order_line_picks p
             WHERE p.vendor_order_id=$1
               AND p.pick_state IN ('PROPOSED_SUBSTITUTION','PROPOSED_WEIGHT'))
         )::text AS count`,
        [input.vendor_order_id],
      );
      if (unresolved.rows[0]?.count !== '0')
        throw new FulfilmentConflictError(
          'Unresolved lines cannot reach ready',
          'PICKING_INCOMPLETE',
        );
      // The picks are final now: a line that will not be in the bag -- missing,
      // or a proposal the customer refused, or one they approved a replacement
      // for -- gives its committed units back to the shelf. Until audit run 51
      // they stayed sold to nobody.
      const notSupplied = await client.query<{ reservation_id: string }>(
        `SELECT l.inventory_reservation_id AS reservation_id
           FROM marketplace.vendor_order_lines l
           JOIN marketplace.vendor_order_line_picks p USING (vendor_order_line_id)
          WHERE l.vendor_order_id=$1 AND l.inventory_reservation_id IS NOT NULL
            AND p.pick_state IN ('MISSING','SUBSTITUTION_REJECTED','WEIGHT_REJECTED',
                                 'SUBSTITUTION_APPROVED')
          ORDER BY l.vendor_order_line_id`,
        [input.vendor_order_id],
      );
      await releaseReservationsLocked(client, {
        context: input.context,
        now,
        reason_code: 'LINE_NOT_SUPPLIED',
        reservation_ids: notSupplied.rows.map((row) => parseUuidV7(row.reservation_id)),
        states: ['SOFT_HELD', 'PROVISIONAL', 'COMMITTED'],
      });
      const version = order.version + 1;
      const ids = contextIds(input.context);
      // The capture plan (implementation.md 6.2.4): what the bag holds is what
      // the customer pays for. Each line's ordered total less what is in the
      // bag -- nothing for a missing or refused line, fewer units for a short
      // one; an approved change already moved its own delta -- comes off the
      // authorisation in one recorded adjustment. A bag with nothing in it is
      // not "ready"; that order has to be ended, not packed. Until audit run
      // 52 the full order was captured whatever the picks said.
      const supplied = await client.query<{
        ordered_minor: string;
        supplied_minor: string;
        lines: string;
        in_bag: string;
      }>(
        `SELECT sum(l.line_total_minor)::text AS ordered_minor,
                sum(CASE
                      WHEN p.pick_state = 'FOUND'
                        THEN COALESCE(p.actual_quantity, l.quantity) * l.unit_price_minor
                      WHEN p.pick_state IN ('SUBSTITUTION_APPROVED','WEIGHT_APPROVED')
                        THEN l.line_total_minor
                      ELSE 0 END)::text AS supplied_minor,
                count(*)::text AS lines,
                count(*) FILTER (WHERE p.pick_state IN
                  ('FOUND','SUBSTITUTION_APPROVED','WEIGHT_APPROVED'))::text AS in_bag
           FROM marketplace.vendor_order_lines l
           JOIN marketplace.vendor_order_line_picks p USING (vendor_order_line_id)
          WHERE l.vendor_order_id=$1`,
        [input.vendor_order_id],
      );
      const bag = supplied.rows[0];
      if (bag && Number(bag.lines) > 0 && Number(bag.in_bag) === 0)
        throw new FulfilmentConflictError(
          'Nothing is in the bag: an order with every line missing cannot be ready',
        );
      const shortfall = bag ? Number(bag.ordered_minor) - Number(bag.supplied_minor) : 0;
      if (shortfall > 0) {
        await adjustAuthorizationForOrder(client, {
          vendor_order_id: input.vendor_order_id,
          delta_minor: -shortfall,
          adjustment_kind: 'LINES_NOT_SUPPLIED',
          decision_id: null,
          actor_id: userId,
          actor_kind: 'vendor_staff',
          reason_code: 'LINES_NOT_SUPPLIED',
          ids,
          now,
        });
      }
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='READY', ready_at=$2, package_count=$3,
                package_condition_note=$4, pickup_promise_at=$5,
                version=$6, updated_at=$2
          WHERE vendor_order_id=$1`,
        [
          input.vendor_order_id,
          now,
          input.package_count,
          input.package_condition_note ?? null,
          input.pickup_promise_at ?? null,
          version,
        ],
      );
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'READY',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'PICKING',
        resulting_state: 'READY',
        reason_code: 'ORDER_READY',
        ids,
      });
      // The bag is final: the group's authorisation may now be settled once
      // every sibling is as far along (the worker decides).
      await publishVendorOrderTransition(client, {
        context: input.context,
        event_type: 'vendor_order.ready',
        now,
        reason_code: 'ORDER_READY',
        source: 'vendor_fulfilment',
        to_state: 'READY',
        vendor_order_id: input.vendor_order_id,
      });
      return orderSummary(client, input.vendor_order_id);
    });
  }

  // -----------------------------------------------------------------------
  // 8.6 -- pickup OTP + completion
  // -----------------------------------------------------------------------

  /**
   * Issues a fresh six-digit pickup OTP for a READY order. The plaintext is
   * returned to the caller once (customer notification path); only its SHA-256
   * hash is stored. Issuing again before the current OTP expires rotates it.
   */
  /**
   * The customer's own collection code (CUS-51).
   *
   * The vendor could already mint a pickup code and read it aloud, which works
   * for a delivery partner standing at the counter. A customer collecting their
   * own order needs it on their phone before they set out — otherwise the
   * "server-validated OTP" the workflow calls for is a code only the shop can
   * see, which proves nothing about who is collecting.
   *
   * Deliberately the same column, lifetime and attempt limit as the vendor
   * path: one code per order, whoever asked for it, so the shop and the
   * customer can never be looking at two different numbers.
   */
  async issueCustomerPickupOtp(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly now?: Date;
  }): Promise<{ readonly plaintext_otp: string; readonly expires_at: Date }> {
    const customerId = requireCustomer(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const owned = await client.query<{
        customer_user_id: string;
        fulfilment_method: string | null;
      }>(
        `SELECT g.customer_user_id, cvg.fulfilment_method
           FROM marketplace.vendor_orders o
           JOIN marketplace.checkout_groups g ON g.checkout_group_id = o.checkout_group_id
           LEFT JOIN marketplace.checkout_quote_groups cqg
             ON cqg.checkout_quote_id = g.checkout_quote_id
            AND cqg.vendor_location_id = o.vendor_location_id
           LEFT JOIN marketplace.cart_vendor_groups cvg USING (cart_vendor_group_id)
          WHERE o.vendor_order_id = $1`,
        [input.vendor_order_id],
      );
      if (owned.rows[0]?.customer_user_id !== customerId) throw new FulfilmentNotFoundError();
      // A collection code proves who is at the counter. On a delivery the
      // customer is at home, and the code they hold is the delivery code for
      // the door (CUS-56); a collection code here would be one only the shop
      // could validate against nobody.
      if (owned.rows[0].fulfilment_method !== 'CUSTOMER_PICKUP') {
        throw new FulfilmentConflictError(
          'A collection code applies to an order the customer collects themselves',
        );
      }
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.lifecycle_state !== 'READY') {
        throw new FulfilmentConflictError('A collection code applies once the order is ready');
      }
      const otp = String(randomInt(100000, 1000000));
      const hash = createHash('sha256').update(otp).digest('hex');
      const expiresAt = new Date(now.getTime() + PICKUP_OTP_LIFETIME_SECONDS * 1000);
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET pickup_otp_hash=$2, pickup_otp_expires_at=$3, pickup_otp_attempts=0,
                pickup_otp_issued_by='CUSTOMER', updated_at=$4
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, hash, expiresAt, now],
      );
      const ids = contextIds(input.context);
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'PICKUP_OTP_ISSUED',
        actor_id: customerId,
        actor_kind: 'customer',
        previous_state: 'READY',
        resulting_state: 'READY',
        reason_code: 'CUSTOMER_PICKUP_OTP_ISSUED',
        ids,
      });
      return { plaintext_otp: otp, expires_at: expiresAt };
    });
  }

  /**
   * The delivery partner's pickup code (DLP-24, workflow 6.7.6).
   *
   * A platform delivery is handed to a rider, not to the customer, and the
   * rider had nothing to present: the only issuers were the customer -- at
   * home, holding a delivery code for the door -- and the vendor's fallback,
   * whose reasons are all about the customer's phone. The console therefore
   * asked for a "customer's collection code" that did not exist, and the one
   * way through was a fallback issued for a reason that was not true.
   *
   * The partner mints it on their own assignment, only once they have marked
   * arrival, and it lands on the same column with the same lifetime and attempt
   * limit as the customer's code -- so the shop validates one number, whoever
   * is standing there, and `completePickup` does not change.
   */
  async issuePartnerPickupOtp(input: {
    readonly context: RequestContext;
    readonly delivery_assignment_id: UuidV7;
    readonly now?: Date;
  }): Promise<{ readonly plaintext_otp: string; readonly expires_at: Date }> {
    const partner = input.context.actor;
    if (partner?.actor_kind !== 'delivery_partner') throw new FulfilmentAuthorizationError();
    const partnerId = partner.actor_id;
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const assignment = await client.query<{
        assignment_state: string;
        vendor_order_id: string | null;
      }>(
        `SELECT assignment_state, vendor_order_id
           FROM marketplace.delivery_assignments
          WHERE delivery_assignment_id = $1 AND partner_user_id = $2
          FOR UPDATE`,
        [input.delivery_assignment_id, partnerId],
      );
      const row = assignment.rows[0];
      if (!row || row.vendor_order_id === null) throw new FulfilmentNotFoundError();
      // The code proves presence at the counter, so it exists only once the
      // partner has said they are there. Before that it would be a way to be
      // handed the goods from the road.
      if (row.assignment_state !== 'AT_VENDOR') {
        throw new FulfilmentConflictError('A pickup code applies once you are at the store');
      }
      const order = await lockOrder(client, parseUuidV7(row.vendor_order_id));
      if (order.lifecycle_state !== 'READY') {
        throw new FulfilmentConflictError('A pickup code applies once the order is ready');
      }
      const otp = String(randomInt(100000, 1000000));
      const hash = createHash('sha256').update(otp).digest('hex');
      const expiresAt = new Date(now.getTime() + PICKUP_OTP_LIFETIME_SECONDS * 1000);
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET pickup_otp_hash=$2, pickup_otp_expires_at=$3, pickup_otp_attempts=0,
                pickup_otp_issued_by='PARTNER', updated_at=$4
          WHERE vendor_order_id=$1`,
        [order.vendor_order_id, hash, expiresAt, now],
      );
      const ids = contextIds(input.context);
      await appendEvent(client, {
        vendor_order_id: parseUuidV7(order.vendor_order_id),
        event_type: 'PICKUP_OTP_ISSUED',
        actor_id: partnerId,
        actor_kind: 'delivery_partner',
        previous_state: 'READY',
        resulting_state: 'READY',
        reason_code: 'PARTNER_PICKUP_OTP_ISSUED',
        ids,
      });
      return { plaintext_otp: otp, expires_at: expiresAt };
    });
  }

  /**
   * The alternative-proof path: a collection code for a customer who cannot
   * show their own (dead phone, no signal, no app).
   *
   * This is deliberately *not* a peer of `issueCustomerPickupOtp`. Both used to
   * write the same column, so whichever ran last silently invalidated the
   * other and the customer was refused at the counter with no explanation on
   * either screen. CUS-51 gives the customer the code and VEN-35 has staff
   * validate it, so a code the vendor mints and reads aloud proves nothing
   * about who is standing there — it is a fallback, and it refuses to displace
   * a live customer code.
   */
  async issuePickupOtp(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<{ readonly plaintext_otp: string; readonly expires_at: Date }> {
    const now = input.now ?? new Date();
    if (!reasonCode.test(input.reason_code))
      throw new FulfilmentInputError('A fallback collection code needs a reason code');
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'READY')
        throw new FulfilmentConflictError('Only a ready order can receive a pickup OTP');
      // A fallback stands in for the collector's own code, so it needs the
      // collector to be there: on a platform delivery, the partner at the counter.
      await requireCollectorPresent(client, input.vendor_order_id);
      // Read under the same FOR UPDATE lock that guards issuance, so two
      // counters cannot both pass this check and then overwrite each other.
      // The partner's code is as canonical as the customer's: whoever is
      // collecting holds the live number, and the shop does not displace it.
      if (
        order.pickup_otp_issued_by !== null &&
        order.pickup_otp_issued_by !== 'VENDOR_FALLBACK' &&
        order.pickup_otp_hash !== null &&
        order.pickup_otp_expires_at !== null &&
        order.pickup_otp_expires_at > now
      ) {
        throw new PickupOtpAlreadyIssuedError(
          'The person collecting already has a live collection code. Ask them to read it from their screen.',
        );
      }
      const otp = String(randomInt(100000, 1000000));
      const hash = createHash('sha256').update(otp).digest('hex');
      const expiresAt = new Date(now.getTime() + PICKUP_OTP_LIFETIME_SECONDS * 1000);
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET pickup_otp_hash=$2, pickup_otp_expires_at=$3, pickup_otp_attempts=0,
                pickup_otp_issued_by='VENDOR_FALLBACK', updated_at=$4
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, hash, expiresAt, now],
      );
      const ids = contextIds(input.context);
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'PICKUP_OTP_ISSUED',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'READY',
        resulting_state: 'READY',
        // The shopkeeper's stated reason, on the append-only record. Support
        // needs to know why a handover skipped the customer's own code.
        reason_code: input.reason_code,
        ids,
      });
      return { plaintext_otp: otp, expires_at: expiresAt };
    });
  }

  /**
   * Redeems a pickup OTP and transitions the order to PICKED_UP. Attempt
   * counter and expiry are checked first: an expired OTP raises
   * PickupOtpExpiredError, exhausting attempts locks the OTP until it is
   * re-issued. On success, inventory holds are committed and a
   * `vendor_order.picked_up` outbox event is appended for money capture.
   */
  async completePickup(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly otp: string;
    readonly proof_note?: string;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    if (!/^[0-9]{6}$/.test(input.otp))
      throw new FulfilmentInputError('OTP must be exactly six digits');
    const now = input.now ?? new Date();
    // OTP validation runs in its own committed transaction so that a failed
    // attempt persists (attempts_counter++, audit event) even though the
    // caller-facing error rolls back the caller. This is what keeps
    // PICKUP_OTP_MAX_ATTEMPTS enforceable.
    const validation = await tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'READY')
        throw new FulfilmentConflictError('Only a ready order can complete pickup');
      await requireCollectorPresent(client, input.vendor_order_id);
      if (!order.pickup_otp_hash || !order.pickup_otp_expires_at)
        throw new PickupOtpMissingError('No pickup OTP has been issued');
      if (order.pickup_otp_attempts >= PICKUP_OTP_MAX_ATTEMPTS) throw new PickupOtpExhaustedError();
      if (order.pickup_otp_expires_at <= now) throw new PickupOtpExpiredError();
      const attempted = createHash('sha256').update(input.otp).digest('hex');
      const ids = contextIds(input.context);
      if (attempted !== order.pickup_otp_hash) {
        await client.query(
          `UPDATE marketplace.vendor_orders SET pickup_otp_attempts=pickup_otp_attempts+1, updated_at=$2
            WHERE vendor_order_id=$1`,
          [input.vendor_order_id, now],
        );
        await appendEvent(client, {
          vendor_order_id: input.vendor_order_id,
          event_type: 'PICKUP_OTP_ATTEMPTED',
          actor_id: userId,
          actor_kind: 'vendor_staff',
          previous_state: 'READY',
          resulting_state: 'READY',
          reason_code: 'PICKUP_OTP_MISMATCH',
          ids,
        });
        return { mismatched: true as const };
      }
      return { mismatched: false as const };
    });
    if (validation.mismatched) throw new PickupOtpMismatchError();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'READY')
        throw new FulfilmentConflictError('Only a ready order can complete pickup');
      // Re-checked under the commit lock: the partner may have left between the
      // validation transaction and this one.
      const collector = await requireCollectorPresent(client, input.vendor_order_id);
      const ids = contextIds(input.context);
      const version = order.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='PICKED_UP', picked_up_at=$2, version=$3, updated_at=$2,
                pickup_otp_hash=NULL, pickup_otp_expires_at=NULL, pickup_otp_issued_by=NULL
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, now, version],
      );
      // Inventory commit is delegated to settleInventoryOnPickup, which the
      // outbox worker invokes when it consumes the event appended below.
      // The record says who took the goods. A partner handover written as a
      // customer collection would be wrong about the one fact support reads.
      const reasonCode =
        collector.fulfilment_method === 'PLATFORM_DELIVERY'
          ? 'PARTNER_PICKUP_COMPLETED'
          : 'CUSTOMER_PICKUP_COMPLETED';
      await this.#publishPickedUp(client, {
        context: input.context,
        now,
        reason_code: reasonCode,
        vendor_order_id: input.vendor_order_id,
      });
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'PICKED_UP',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'READY',
        resulting_state: 'PICKED_UP',
        reason_code: reasonCode,
        note: input.proof_note ?? null,
        ids,
      });
      return orderSummary(client, input.vendor_order_id);
    });
  }

  /** How an order leaves the shop, for callers holding no transaction. */
  async fulfilmentMethod(vendorOrderId: UuidV7): Promise<string> {
    return orderFulfilmentMethod(this.#pool, vendorOrderId);
  }

  /**
   * The shop's own staff leave with the order (VEN-37, workflow 6.7 "vendor
   * self-delivery").
   *
   * READY -> PICKED_UP, the same state a partner handover reaches, because the
   * goods have left the shop either way and everything downstream -- inventory
   * settlement, the customer's "on the way" card, the delivery code becoming
   * available -- keys on that. What differs is recorded: who carried it, when,
   * and a reason that says a self-delivery started rather than a collection.
   */
  async startVendorDelivery(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly expected_version: number;
    readonly proof_note?: string;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'READY')
        throw new FulfilmentConflictError('Only a ready order can go out for delivery');
      if (order.version !== input.expected_version)
        throw new FulfilmentConflictError('Vendor order version has advanced', 'VERSION_CONFLICT');
      const method = await orderFulfilmentMethod(client, input.vendor_order_id);
      if (method !== 'VENDOR_DELIVERY') {
        throw new FulfilmentConflictError(
          'Only an order the store delivers itself can go out with your staff',
        );
      }
      const ids = contextIds(input.context);
      const version = order.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='PICKED_UP', picked_up_at=$2, out_for_delivery_at=$2,
                vendor_delivery_by_user_id=$3, version=$4, updated_at=$2,
                pickup_otp_hash=NULL, pickup_otp_expires_at=NULL, pickup_otp_issued_by=NULL
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, now, userId, version],
      );
      await this.#publishPickedUp(client, {
        context: input.context,
        now,
        reason_code: 'VENDOR_DELIVERY_STARTED',
        vendor_order_id: input.vendor_order_id,
      });
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'PICKED_UP',
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: 'READY',
        resulting_state: 'PICKED_UP',
        reason_code: 'VENDOR_DELIVERY_STARTED',
        note: input.proof_note ?? null,
        ids,
      });
      return orderSummary(client, input.vendor_order_id);
    });
  }

  /**
   * The customer's delivery code for a self-delivered order (CUS-56).
   *
   * The partner's door keeps this code on the delivery assignment; a
   * self-delivery has no assignment, so the code lives on the order. Same
   * lifetime and attempt ceiling as every other code, and available only while
   * the goods are on their way -- before that it proves nothing, after delivery
   * it would re-open a closed handoff.
   */
  async issueVendorDeliveryOtp(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly now?: Date;
  }): Promise<{ readonly plaintext_otp: string; readonly expires_at: Date }> {
    const customerId = requireCustomer(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const owned = await client.query<{ customer_user_id: string }>(
        `SELECT g.customer_user_id
           FROM marketplace.vendor_orders o
           JOIN marketplace.checkout_groups g ON g.checkout_group_id = o.checkout_group_id
          WHERE o.vendor_order_id = $1`,
        [input.vendor_order_id],
      );
      if (owned.rows[0]?.customer_user_id !== customerId) throw new FulfilmentNotFoundError();
      const method = await orderFulfilmentMethod(client, input.vendor_order_id);
      if (method !== 'VENDOR_DELIVERY') {
        throw new FulfilmentConflictError(
          'This delivery code applies to an order the store delivers itself',
        );
      }
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.lifecycle_state !== 'PICKED_UP') {
        throw new FulfilmentConflictError(
          'A delivery code applies only while the order is on its way',
        );
      }
      const otp = String(randomInt(100000, 1000000));
      const hash = createHash('sha256').update(otp).digest('hex');
      const expiresAt = new Date(now.getTime() + PICKUP_OTP_LIFETIME_SECONDS * 1000);
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET delivery_otp_hash=$2, delivery_otp_expires_at=$3, delivery_otp_attempts=0,
                updated_at=$4
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, hash, expiresAt, now],
      );
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'DELIVERY_OTP_ISSUED',
        actor_id: customerId,
        actor_kind: 'customer',
        previous_state: 'PICKED_UP',
        resulting_state: 'PICKED_UP',
        reason_code: 'CUSTOMER_DELIVERY_OTP_ISSUED',
        ids: contextIds(input.context),
      });
      return { plaintext_otp: otp, expires_at: expiresAt };
    });
  }

  /**
   * The shop's staff complete a self-delivery at the customer's door against
   * the customer's code. Mirrors `completePickup`: the validation commits on
   * its own so a wrong attempt is counted even though the caller-facing error
   * unwinds them, and the order ends through `completeVendorOrder` so the
   * outbox event that settles the money is the same one a partner delivery
   * emits.
   */
  async completeVendorDelivery(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly otp: string;
    readonly proof_note?: string;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    if (!/^[0-9]{6}$/.test(input.otp))
      throw new FulfilmentInputError('The delivery code must be exactly six digits');
    const now = input.now ?? new Date();
    const validation = await tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PICKED_UP')
        throw new FulfilmentConflictError('Only an order on its way can be delivered');
      const method = await orderFulfilmentMethod(client, input.vendor_order_id);
      if (method !== 'VENDOR_DELIVERY') {
        throw new FulfilmentConflictError(
          'A platform delivery is completed by its partner, not at the store',
        );
      }
      if (!order.delivery_otp_hash || !order.delivery_otp_expires_at)
        throw new VendorDeliveryOtpMissingError('Ask the customer to show their delivery code');
      if (order.delivery_otp_attempts >= PICKUP_OTP_MAX_ATTEMPTS)
        throw new VendorDeliveryOtpExhaustedError();
      if (order.delivery_otp_expires_at <= now) throw new VendorDeliveryOtpExpiredError();
      const attempted = createHash('sha256').update(input.otp).digest('hex');
      if (attempted !== order.delivery_otp_hash) {
        await client.query(
          `UPDATE marketplace.vendor_orders
              SET delivery_otp_attempts=delivery_otp_attempts+1, updated_at=$2
            WHERE vendor_order_id=$1`,
          [input.vendor_order_id, now],
        );
        await appendEvent(client, {
          vendor_order_id: input.vendor_order_id,
          event_type: 'DELIVERY_OTP_ATTEMPTED',
          actor_id: userId,
          actor_kind: 'vendor_staff',
          previous_state: 'PICKED_UP',
          resulting_state: 'PICKED_UP',
          reason_code: 'DELIVERY_OTP_MISMATCH',
          ids: contextIds(input.context),
        });
        return { mismatched: true as const };
      }
      return { mismatched: false as const };
    });
    if (validation.mismatched) throw new VendorDeliveryOtpMismatchError();
    return tx(this.#pool, async (client) => {
      await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PICKED_UP')
        throw new FulfilmentConflictError('Only an order on its way can be delivered');
      // The code is spent on success, so it cannot be replayed against a later
      // re-issue or a re-opened handoff.
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET delivery_otp_hash=NULL, delivery_otp_expires_at=NULL, updated_at=$2
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, now],
      );
      await completeVendorOrder(client, {
        context: input.context,
        now,
        reason_code: 'VENDOR_DELIVERY_COMPLETED',
        source: 'vendor_fulfilment',
        state: 'DELIVERED',
        vendor_order_id: input.vendor_order_id,
      });
      return orderSummary(client, input.vendor_order_id);
    });
  }

  /**
   * Registers `vendor_order` as a versioned aggregate and appends the
   * `vendor_order.picked_up` outbox event in the same transaction as the
   * lifecycle write.
   *
   * The outbox FK (`outbox_transition_fk`) requires a matching
   * `aggregate_transitions` row, so the head is created lazily on the first
   * event this aggregate emits. Without this event the worker's
   * `settleInventoryOnPickup` handler never fires and every PROVISIONAL
   * inventory hold on the order stays uncommitted.
   */
  async #publishPickedUp(
    client: PoolClient,
    input: {
      readonly context: RequestContext;
      readonly now: Date;
      readonly reason_code: string;
      readonly vendor_order_id: UuidV7;
    },
  ): Promise<void> {
    const ids = contextIds(input.context);
    const actor = input.context.actor;
    const actorId = actor?.actor_id ?? createUuidV7();
    const actorKind = actor?.actor_kind ?? 'system';
    const head = await client.query<{ version: number; state: string }>(
      `SELECT version, state FROM marketplace.aggregate_heads
        WHERE aggregate_type='vendor_order' AND aggregate_id=$1 FOR UPDATE`,
      [input.vendor_order_id],
    );
    const previous = head.rows[0];
    const version = (previous?.version ?? 0) + 1;
    if (previous) {
      await client.query(
        `UPDATE marketplace.aggregate_heads SET version=$2, state='PICKED_UP', updated_at=$3
          WHERE aggregate_type='vendor_order' AND aggregate_id=$1`,
        [input.vendor_order_id, version, input.now],
      );
    } else {
      await client.query(
        `INSERT INTO marketplace.aggregate_heads
           (aggregate_type,aggregate_id,version,state,created_at,updated_at)
         VALUES ('vendor_order',$1,1,'PICKED_UP',$2,$2)`,
        [input.vendor_order_id, input.now],
      );
    }
    await client.query(
      `INSERT INTO marketplace.aggregate_transitions
         (transition_id,aggregate_type,aggregate_id,previous_version,resulting_version,from_state,
          to_state,actor_id,actor_kind,reason_code,evidence,request_id,correlation_id,causation_id,
          occurred_at)
       VALUES ($1,'vendor_order',$2,$3,$4,$5,'PICKED_UP',$6,$7,$13,$8,$9,$10,$11,$12)`,
      [
        createUuidV7(),
        input.vendor_order_id,
        version - 1,
        version,
        previous?.state ?? null,
        actorId,
        actorKind,
        JSON.stringify({ source: 'vendor_fulfilment' }),
        ids.request,
        ids.correlation,
        input.context.causation_id,
        input.now,
        input.reason_code,
      ],
    );
    await client.query(
      `INSERT INTO marketplace.outbox_events
         (event_id,aggregate_type,aggregate_id,aggregate_version,event_type,payload,request_id,
          correlation_id,causation_id,max_attempts,available_at,created_at,updated_at)
       VALUES ($1,'vendor_order',$2,$3,'vendor_order.picked_up',$4,$5,$6,$7,8,$8,$8,$8)`,
      [
        createUuidV7(),
        input.vendor_order_id,
        version,
        JSON.stringify({ vendor_order_id: input.vendor_order_id, state: 'PICKED_UP' }),
        ids.request,
        ids.correlation,
        input.context.causation_id,
        input.now,
      ],
    );
  }

  /**
   * Called by an outbox worker for a `vendor_order.picked_up` event: commits
   * any PROVISIONAL reservation still attached to the order. Since audit run
   * 50 the acceptance commits them (8.2), so this finds nothing to do for an
   * order accepted after it; it remains the backstop for orders accepted
   * before. Idempotent through InventoryReservationService.commit's own
   * version guard.
   */
  async settleInventoryOnPickup(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly now?: Date;
  }): Promise<number> {
    requireSystemOrVendor(input.context);
    const now = input.now ?? new Date();
    const reservations = await this.#pool.query<{
      reservation_id: string;
      version: number;
      reservation_state: string;
    }>(
      `SELECT ir.reservation_id, ir.version, ir.reservation_state
         FROM marketplace.vendor_order_lines l
         JOIN marketplace.inventory_reservations ir ON ir.reservation_id=l.inventory_reservation_id
        WHERE l.vendor_order_id=$1`,
      [input.vendor_order_id],
    );
    let committed = 0;
    for (const row of reservations.rows) {
      if (row.reservation_state === 'COMMITTED') continue;
      if (row.reservation_state !== 'PROVISIONAL') continue;
      await this.#inventory.commit({
        context: input.context,
        reservation_id: parseUuidV7(row.reservation_id),
        expected_version: row.version,
        reason_code: 'CUSTOMER_PICKUP_COMPLETED',
        now,
      });
      committed += 1;
    }
    return committed;
  }

  // -----------------------------------------------------------------------
  // 8.7 -- history, receipt, rating, support
  // -----------------------------------------------------------------------

  /**
   * The customer's own order history, grouped as the architecture groups it.
   *
   * Each entry names its store and carries its own fulfilment method, because
   * MKT-07 gives every vendor order an independent promise and CUS-46 requires
   * the customer to see the group *and* each child order's state. The previous
   * shape returned a reference and a total, which is why the orders screen had
   * to print UUID fragments and flatten children away from their group.
   *
   * One query, not one per checkout group: the old loop issued a query per row
   * of the outer result and grew linearly with a customer's history.
   */
  async listCustomerOrders(input: {
    readonly context: RequestContext;
    readonly limit?: number;
  }): Promise<
    readonly {
      readonly checkout_group_id: UuidV7;
      readonly checkout_reference: string;
      readonly created_at: Date;
      readonly lifecycle_state: string;
      readonly payment_lifecycle_state: string;
      readonly total_minor: number;
      readonly vendor_orders: readonly CustomerOrderEntry[];
    }[]
  > {
    const customerId = requireCustomer(input.context);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const rows = await this.#pool.query<{
      checkout_group_id: string;
      checkout_reference: string;
      created_at: Date;
      checkout_state: string;
      checkout_total_minor: string;
      vendor_order_id: string | null;
      vendor_location_id: string | null;
      location_name: string | null;
      order_reference: string | null;
      lifecycle_state: string | null;
      total_minor: string | null;
      fulfilment_method: string | null;
    }>(
      `SELECT g.checkout_group_id, g.checkout_reference, g.created_at,
              g.lifecycle_state AS checkout_state, g.total_minor::text AS checkout_total_minor,
              o.vendor_order_id, o.vendor_location_id, l.location_name, o.order_reference,
              o.lifecycle_state, o.total_minor::text AS total_minor,
              cvg.fulfilment_method
         FROM marketplace.checkout_groups g
         LEFT JOIN marketplace.vendor_orders o ON o.checkout_group_id = g.checkout_group_id
         LEFT JOIN marketplace.vendor_locations l ON l.vendor_location_id = o.vendor_location_id
         LEFT JOIN marketplace.checkout_quote_groups cqg
                ON cqg.checkout_quote_id = g.checkout_quote_id
               AND cqg.vendor_location_id = o.vendor_location_id
         LEFT JOIN marketplace.cart_vendor_groups cvg USING (cart_vendor_group_id)
        WHERE g.checkout_group_id IN (
                SELECT checkout_group_id FROM marketplace.checkout_groups
                 WHERE customer_user_id = $1
                 ORDER BY created_at DESC LIMIT $2
              )
        ORDER BY g.created_at DESC, l.location_name ASC, o.created_at ASC`,
      [customerId, limit],
    );

    const byGroup = new Map<
      string,
      {
        readonly checkout_group_id: UuidV7;
        readonly checkout_reference: string;
        readonly created_at: Date;
        readonly lifecycle_state: string;
        readonly total_minor: number;
        readonly vendor_orders: CustomerOrderEntry[];
      }
    >();
    for (const row of rows.rows) {
      let group = byGroup.get(row.checkout_group_id);
      if (!group) {
        group = {
          checkout_group_id: parseUuidV7(row.checkout_group_id),
          checkout_reference: row.checkout_reference,
          created_at: row.created_at,
          lifecycle_state: row.checkout_state,
          total_minor: Number(row.checkout_total_minor),
          vendor_orders: [],
        };
        byGroup.set(row.checkout_group_id, group);
      }
      // A checkout group with no child order yet is still a real group the
      // customer paid for, so the LEFT JOIN row is kept and its order omitted.
      // `vendor_location_id`, `order_reference`, `lifecycle_state` and
      // `total_minor` are NOT NULL on `vendor_orders`; they are nullable here
      // only because of the LEFT JOIN, so a present order id proves them present.
      if (
        row.vendor_order_id === null ||
        row.vendor_location_id === null ||
        row.order_reference === null ||
        row.lifecycle_state === null ||
        row.total_minor === null
      ) {
        continue;
      }
      group.vendor_orders.push(
        Object.freeze({
          vendor_order_id: parseUuidV7(row.vendor_order_id),
          vendor_location_id: parseUuidV7(row.vendor_location_id),
          location_name: row.location_name ?? '',
          order_reference: row.order_reference,
          lifecycle_state: row.lifecycle_state,
          total_minor: Number(row.total_minor),
          fulfilment_method: row.fulfilment_method,
        }),
      );
    }
    // The group's state is a summary of its orders (7.7), never the stored
    // payment state on its own: read as that, a group of delivered orders
    // stayed "In progress" for good.
    return Object.freeze(
      [...byGroup.values()].map((group) =>
        Object.freeze({
          ...group,
          payment_lifecycle_state: group.lifecycle_state,
          lifecycle_state: deriveCheckoutGroupState({
            payment_state: group.lifecycle_state,
            orders: group.vendor_orders,
          }),
          vendor_orders: Object.freeze(group.vendor_orders),
        }),
      ),
    );
  }

  /**
   * A store's own numbers, computed from its orders (VEN-45, VEN-47).
   *
   * The dashboard used to state "12 orders · 96% accepted" from nothing at all.
   * Every figure here is a count over `vendor_orders` for this location, so a
   * vendor can check any of it against their own memory of the day — which is
   * the only reason to show it. Rates are returned as counts *and* a
   * denominator rather than a pre-rounded percentage, so the screen can say
   * "3 of 4" and never imply precision the sample does not carry.
   */
  async locationInsights(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly window_days?: number;
    readonly now?: Date;
  }): Promise<{
    readonly window_days: number;
    readonly orders_total: number;
    readonly orders_accepted: number;
    readonly orders_declined: number;
    readonly orders_expired: number;
    readonly orders_cancelled: number;
    readonly orders_completed: number;
    readonly gross_minor: number;
    readonly median_preparation_seconds: number | null;
    readonly rating_average: number | null;
    readonly rating_count: number;
    readonly decline_reasons: readonly { readonly reason_code: string; readonly count: number }[];
  }> {
    await requireVendorMemberPool(this.#pool, input.context, input.vendor_location_id);
    const windowDays = Math.min(Math.max(input.window_days ?? 30, 1), 90);
    const since = new Date((input.now ?? new Date()).getTime() - windowDays * 86_400_000);

    const totals = await this.#pool.query<{
      orders_total: string;
      orders_accepted: string;
      orders_declined: string;
      orders_expired: string;
      orders_cancelled: string;
      orders_completed: string;
      gross_minor: string;
      median_preparation_seconds: string | null;
    }>(
      `SELECT count(*)::text AS orders_total,
              count(*) FILTER (WHERE accepted_at IS NOT NULL)::text AS orders_accepted,
              count(*) FILTER (WHERE decline_reason_code IS NOT NULL)::text AS orders_declined,
              count(*) FILTER (WHERE lifecycle_state = 'EXPIRED')::text AS orders_expired,
              count(*) FILTER (WHERE lifecycle_state = 'CANCELLED')::text AS orders_cancelled,
              count(*) FILTER (WHERE lifecycle_state = 'PICKED_UP')::text AS orders_completed,
              COALESCE(sum(total_minor) FILTER (WHERE lifecycle_state = 'PICKED_UP'), 0)::text
                AS gross_minor,
              -- A median, not a mean: one order that sat overnight should not
              -- move the number a shopkeeper is being asked to trust.
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (ready_at - accepted_at))
              ) FILTER (WHERE ready_at IS NOT NULL AND accepted_at IS NOT NULL)::text
                AS median_preparation_seconds
         FROM marketplace.vendor_orders
        WHERE vendor_location_id = $1 AND created_at >= $2`,
      [input.vendor_location_id, since],
    );

    const ratings = await this.#pool.query<{ rating_average: string | null; rating_count: string }>(
      `SELECT avg(rating.stars)::text AS rating_average, count(*)::text AS rating_count
         FROM marketplace.vendor_order_ratings rating
         JOIN marketplace.vendor_orders o USING (vendor_order_id)
        WHERE o.vendor_location_id = $1 AND rating.created_at >= $2`,
      [input.vendor_location_id, since],
    );

    const reasons = await this.#pool.query<{ reason_code: string; count: string }>(
      `SELECT decline_reason_code AS reason_code, count(*)::text AS count
         FROM marketplace.vendor_orders
        WHERE vendor_location_id = $1 AND created_at >= $2 AND decline_reason_code IS NOT NULL
        GROUP BY decline_reason_code
        ORDER BY count(*) DESC, decline_reason_code`,
      [input.vendor_location_id, since],
    );

    const row = totals.rows[0];
    const rating = ratings.rows[0];
    return Object.freeze({
      window_days: windowDays,
      orders_total: Number(row?.orders_total ?? '0'),
      orders_accepted: Number(row?.orders_accepted ?? '0'),
      orders_declined: Number(row?.orders_declined ?? '0'),
      orders_expired: Number(row?.orders_expired ?? '0'),
      orders_cancelled: Number(row?.orders_cancelled ?? '0'),
      orders_completed: Number(row?.orders_completed ?? '0'),
      gross_minor: Number(row?.gross_minor ?? '0'),
      median_preparation_seconds:
        row?.median_preparation_seconds == null
          ? null
          : Math.round(Number(row.median_preparation_seconds)),
      rating_average: rating?.rating_average == null ? null : Number(rating.rating_average),
      rating_count: Number(rating?.rating_count ?? '0'),
      decline_reasons: Object.freeze(
        reasons.rows.map((entry) =>
          Object.freeze({ reason_code: entry.reason_code, count: Number(entry.count) }),
        ),
      ),
    });
  }

  /**
   * Support cases raised against this store's orders (VEN-43).
   *
   * The workflow says the current instruction stays on the affected order until
   * resolution. Cases existed and the vendor could not see any of them, so an
   * order under dispute looked identical to one that was fine.
   */
  async locationSupportCases(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
  }): Promise<
    readonly {
      readonly support_case_id: UuidV7;
      readonly vendor_order_id: UuidV7;
      readonly order_reference: string;
      readonly category: string;
      readonly lifecycle_state: string;
      readonly created_at: string;
    }[]
  > {
    await requireVendorMemberPool(this.#pool, input.context, input.vendor_location_id);
    const rows = await this.#pool.query<{
      support_case_id: string;
      vendor_order_id: string;
      order_reference: string;
      category: string;
      lifecycle_state: string;
      created_at: Date;
    }>(
      // Deliberately not the description: a customer's account of what went
      // wrong is support's to relay, and the category plus the case reference
      // is what the store needs in order to act.
      `SELECT c.support_case_id, c.vendor_order_id, o.order_reference, c.category,
              c.lifecycle_state, c.created_at
         FROM marketplace.support_cases c
         JOIN marketplace.vendor_orders o USING (vendor_order_id)
        WHERE o.vendor_location_id = $1 AND c.lifecycle_state IN ('OPEN', 'IN_PROGRESS')
        ORDER BY c.created_at DESC
        LIMIT 50`,
      [input.vendor_location_id],
    );
    return Object.freeze(
      rows.rows.map((row) =>
        Object.freeze({
          support_case_id: parseUuidV7(row.support_case_id),
          vendor_order_id: parseUuidV7(row.vendor_order_id),
          order_reference: row.order_reference,
          category: row.category,
          lifecycle_state: row.lifecycle_state,
          created_at: row.created_at.toISOString(),
        }),
      ),
    );
  }

  async getReceipt(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
  }): Promise<{
    readonly order: VendorOrderSummary;
    readonly lines: readonly {
      readonly catalogue_variant_id: UuidV7;
      readonly vendor_location_id: UuidV7;
      readonly title: string;
      readonly variant_title: string;
      readonly quantity: number;
      readonly unit_price_minor: number;
      readonly line_total_minor: number;
      readonly pick_state: PickState | 'PENDING';
      readonly actual_quantity: number | null;
      readonly actual_unit_price_minor: number | null;
    }[];
  }> {
    const customerId = requireCustomer(input.context);
    const order = await this.#pool.query(
      `SELECT o.vendor_order_id, o.order_reference, o.lifecycle_state,
              o.total_minor::text AS total_minor, o.version, o.accept_by, o.accepted_at,
              o.ready_at, o.picked_up_at, o.package_count, o.package_condition_note,
              o.preparation_estimate_seconds, o.pickup_otp_expires_at, o.pickup_otp_attempts,
              o.decline_reason_code, cg.customer_user_id
         FROM marketplace.vendor_orders o
         JOIN marketplace.checkout_groups cg USING (checkout_group_id)
        WHERE o.vendor_order_id=$1`,
      [input.vendor_order_id],
    );
    const orderRow = order.rows[0];
    if (!orderRow) throw new FulfilmentNotFoundError();
    if (orderRow['customer_user_id'] !== customerId) throw new FulfilmentNotFoundError();
    const lines = await this.#pool.query(
      `SELECT l.catalogue_variant_id, o.vendor_location_id,
              l.product_title_snapshot AS title, l.variant_title_snapshot AS variant_title,
              l.quantity, l.unit_price_minor::text AS unit_price_minor,
              l.line_total_minor::text AS line_total_minor,
              COALESCE(p.pick_state, 'PENDING') AS pick_state,
              p.actual_quantity,
              p.actual_unit_price_minor::text AS actual_unit_price_minor
         FROM marketplace.vendor_order_lines l
         JOIN marketplace.vendor_orders o ON o.vendor_order_id=l.vendor_order_id
         LEFT JOIN marketplace.vendor_order_line_picks p
           ON p.vendor_order_line_id=l.vendor_order_line_id
        WHERE l.vendor_order_id=$1 ORDER BY l.vendor_order_line_id`,
      [input.vendor_order_id],
    );
    return {
      order: projectSummary(orderRow as Record<string, unknown>),
      lines: lines.rows.map((row) => ({
        catalogue_variant_id: parseUuidV7(row['catalogue_variant_id']),
        vendor_location_id: parseUuidV7(row['vendor_location_id']),
        title: row['title'],
        variant_title: row['variant_title'],
        quantity: Number(row['quantity']),
        unit_price_minor: Number(row['unit_price_minor']),
        line_total_minor: Number(row['line_total_minor']),
        pick_state: row['pick_state'],
        actual_quantity: row['actual_quantity'] ?? null,
        actual_unit_price_minor: row['actual_unit_price_minor']
          ? Number(row['actual_unit_price_minor'])
          : null,
      })),
    };
  }

  async submitRating(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly stars: number;
    readonly review_note?: string;
    readonly now?: Date;
  }): Promise<void> {
    if (!Number.isSafeInteger(input.stars) || input.stars < 1 || input.stars > 5)
      throw new FulfilmentInputError('Stars must be between 1 and 5');
    if (
      input.review_note !== undefined &&
      (input.review_note.length < 1 || input.review_note.length > 500)
    ) {
      throw new FulfilmentInputError('Review note must be between 1 and 500 characters');
    }
    const customerId = requireCustomer(input.context);
    const now = input.now ?? new Date();
    await tx(this.#pool, async (client) => {
      const order = await client.query<{ lifecycle_state: string; customer_user_id: string }>(
        `SELECT o.lifecycle_state, cg.customer_user_id
           FROM marketplace.vendor_orders o
           JOIN marketplace.checkout_groups cg USING (checkout_group_id)
          WHERE o.vendor_order_id=$1`,
        [input.vendor_order_id],
      );
      const row = order.rows[0];
      if (!row) throw new FulfilmentNotFoundError();
      if (row.customer_user_id !== customerId) throw new FulfilmentNotFoundError();
      // A collected order ends at PICKED_UP; a delivered one at DELIVERED
      // (0055). The check predates DELIVERED, so no delivered order could be
      // rated: every rating from the orders screen answered a state conflict.
      if (row.lifecycle_state !== 'PICKED_UP' && row.lifecycle_state !== 'DELIVERED')
        throw new FulfilmentConflictError('Only a completed order can be rated');
      const ids = contextIds(input.context);
      const inserted = await client.query(
        `INSERT INTO marketplace.vendor_order_ratings
           (vendor_order_id, customer_user_id, stars, review_note, request_id, correlation_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (vendor_order_id) DO NOTHING RETURNING vendor_order_id`,
        [
          input.vendor_order_id,
          customerId,
          input.stars,
          input.review_note ?? null,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      if (inserted.rowCount !== 1)
        throw new FulfilmentConflictError('Order has already been rated');
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'RATING_SUBMITTED',
        actor_id: customerId,
        actor_kind: 'customer',
        previous_state: null,
        resulting_state: null,
        reason_code: 'CUSTOMER_RATED_ORDER',
        ids,
      });
    });
  }

  /**
   * What cancelling this order would do, without doing it (CUS-57).
   *
   * Cancellation stops being a private matter the moment someone else is
   * holding the packages, so the answer depends on where the order has got to.
   * Returning the reason — rather than a disabled button — is what lets the
   * customer choose the path that is still open to them.
   */
  async previewCancellation(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
  }): Promise<{
    readonly allowed: boolean;
    readonly lifecycle_state: string;
    readonly reason: string;
    readonly refund_expectation: string;
    readonly next_step: 'CANCEL' | 'SUPPORT_CASE' | 'NONE';
    readonly version: number;
  }> {
    const customerId = requireCustomer(input.context);
    const found = await this.#pool.query<{
      lifecycle_state: string;
      version: number;
      customer_user_id: string;
      assignment_state: string | null;
      delivery_assignment_id: string | null;
    }>(
      `SELECT o.lifecycle_state, o.version, cg.customer_user_id, a.assignment_state
         FROM marketplace.vendor_orders o
         JOIN marketplace.checkout_groups cg USING (checkout_group_id)
         LEFT JOIN marketplace.delivery_assignments a ON a.vendor_order_id = o.vendor_order_id
        WHERE o.vendor_order_id=$1`,
      [input.vendor_order_id],
    );
    const order = found.rows[0];
    if (!order || order.customer_user_id !== customerId) throw new FulfilmentNotFoundError();

    const inCustody =
      order.assignment_state !== null &&
      !['UNASSIGNED', 'OFFERED', 'DECLINED', 'OFFER_EXPIRED'].includes(order.assignment_state);

    if (['CANCELLED', 'EXPIRED'].includes(order.lifecycle_state)) {
      return Object.freeze({
        allowed: false,
        lifecycle_state: order.lifecycle_state,
        next_step: 'NONE' as const,
        reason: 'This order has already ended.',
        refund_expectation: 'Any refund due is already recorded against the order.',
        version: order.version,
      });
    }
    if (order.lifecycle_state === 'PICKED_UP' || inCustody) {
      return Object.freeze({
        allowed: false,
        lifecycle_state: order.lifecycle_state,
        next_step: 'SUPPORT_CASE' as const,
        reason:
          'Someone is already carrying this order, so it cannot simply be called off. Open a support case and we will arrange a return.',
        refund_expectation:
          'A refund is decided once the goods are back with the store; delivery already performed may not be refunded.',
        version: order.version,
      });
    }
    return Object.freeze({
      allowed: true,
      lifecycle_state: order.lifecycle_state,
      next_step: 'CANCEL' as const,
      reason:
        order.lifecycle_state === 'PLACED'
          ? 'The store has not started on this order yet.'
          : 'The store has started preparing, so cancelling now may still cost them work.',
      refund_expectation:
        order.lifecycle_state === 'PLACED'
          ? 'The full amount is returned.'
          : 'The item total is returned; the delivery fee may be kept.',
      version: order.version,
    });
  }

  /**
   * Cancels an order at the customer\'s request (CUS-58).
   *
   * Refuses once the packages are in custody: at that point the goods exist
   * somewhere in the world and a state flip would strand them. The customer is
   * pointed at the support path instead, which is the one that can actually
   * arrange a return.
   */
  async cancelByCustomer(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly now?: Date;
  }): Promise<VendorOrderSummary> {
    if (!reasonCode.test(input.reason_code))
      throw new FulfilmentInputError('Reason must be shouting-snake-case');
    const customerId = requireCustomer(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const found = await client.query<{
        lifecycle_state: string;
        version: number;
        customer_user_id: string;
        assignment_state: string | null;
      }>(
        `SELECT o.lifecycle_state, o.version, cg.customer_user_id, a.assignment_state
           FROM marketplace.vendor_orders o
           JOIN marketplace.checkout_groups cg USING (checkout_group_id)
           LEFT JOIN marketplace.delivery_assignments a ON a.vendor_order_id = o.vendor_order_id
          WHERE o.vendor_order_id=$1 FOR UPDATE OF o`,
        [input.vendor_order_id],
      );
      const order = found.rows[0];
      if (!order || order.customer_user_id !== customerId) throw new FulfilmentNotFoundError();
      if (order.version !== input.expected_version) {
        throw new FulfilmentConflictError('The order changed while you were deciding');
      }
      const inCustody =
        order.assignment_state !== null &&
        !['UNASSIGNED', 'OFFERED', 'DECLINED', 'OFFER_EXPIRED'].includes(order.assignment_state);
      if (!['PLACED', 'ACCEPTED', 'PICKING'].includes(order.lifecycle_state) || inCustody) {
        throw new FulfilmentConflictError(
          'This order is too far along to cancel; open a support case instead',
        );
      }
      const version = order.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_orders
            SET lifecycle_state='CANCELLED', version=$2, updated_at=$3
          WHERE vendor_order_id=$1`,
        [input.vendor_order_id, version, now],
      );
      // A cancelled order was leaving its stock held, so a sibling order in the
      // same group could be starved of inventory nobody was going to buy. An
      // accepted order's stock is committed, not held (8.2), and goes back too.
      await this.#releaseHolds(
        client,
        input.context,
        input.vendor_order_id,
        now,
        'CUSTOMER_CANCELLED',
        ['SOFT_HELD', 'PROVISIONAL', 'COMMITTED'],
      );
      await releaseAuthorizationForEndedOrder(client, {
        actor_id: customerId,
        actor_kind: 'customer',
        ids: contextIds(input.context),
        now,
        reason_code: 'CUSTOMER_CANCELLED_ORDER',
        vendor_order_id: input.vendor_order_id,
      });
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'CANCELLED',
        actor_id: customerId,
        actor_kind: 'customer',
        previous_state: order.lifecycle_state as VendorOrderState,
        resulting_state: 'CANCELLED',
        reason_code: input.reason_code,
        ids: contextIds(input.context),
      });
      await publishVendorOrderTransition(client, {
        context: input.context,
        event_type: 'vendor_order.ended',
        now,
        payload: { ended_by: 'customer', reason_code: input.reason_code },
        reason_code: input.reason_code,
        source: 'vendor_fulfilment',
        to_state: 'CANCELLED',
        vendor_order_id: input.vendor_order_id,
      });
      return orderSummary(client, input.vendor_order_id);
    });
  }

  /**
   * What the customer may know about their delivery (CUS-52, CUS-53, CUS-55).
   *
   * Deliberately coarse: the stage of the attempt and the approximate drop
   * area, never the partner\'s identity or live coordinates. The customer needs
   * to know whether to expect a knock, not to watch a person move.
   */
  async customerTracking(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
  }): Promise<{
    readonly lifecycle_state: string;
    readonly fulfilment_method: string;
    readonly stage: string;
    readonly approximate_drop_area: string | null;
    readonly in_custody: boolean;
  }> {
    const customerId = requireCustomer(input.context);
    const found = await this.#pool.query<{
      lifecycle_state: string;
      customer_user_id: string;
      fulfilment_method: string | null;
      assignment_state: string | null;
      approximate_drop_area: string | null;
      delivery_assignment_id: string | null;
    }>(
      `SELECT o.lifecycle_state, cg.customer_user_id, cvg.fulfilment_method,
              a.assignment_state, a.approximate_drop_area, a.delivery_assignment_id
         FROM marketplace.vendor_orders o
         JOIN marketplace.checkout_groups cg USING (checkout_group_id)
         LEFT JOIN marketplace.checkout_quote_groups cqg
           ON cqg.checkout_quote_id = cg.checkout_quote_id
          AND cqg.vendor_location_id = o.vendor_location_id
         LEFT JOIN marketplace.cart_vendor_groups cvg USING (cart_vendor_group_id)
         LEFT JOIN marketplace.delivery_assignments a ON a.vendor_order_id = o.vendor_order_id
        WHERE o.vendor_order_id=$1`,
      [input.vendor_order_id],
    );
    const order = found.rows[0];
    if (!order || order.customer_user_id !== customerId) throw new FulfilmentNotFoundError();

    const method = order.fulfilment_method ?? 'PLATFORM_DELIVERY';
    const inCustody =
      order.assignment_state !== null &&
      ['PICKED_UP', 'EN_ROUTE_TO_CUSTOMER', 'ARRIVED'].includes(order.assignment_state);
    // Pickup and delivery are genuinely different promises, so they are
    // described differently rather than sharing one vague "on the way".
    const stage =
      method === 'CUSTOMER_PICKUP'
        ? order.lifecycle_state === 'READY'
          ? 'READY_FOR_COLLECTION'
          : 'BEING_PREPARED'
        : order.assignment_state === null
          ? 'AWAITING_DISPATCH'
          : order.assignment_state;
    return Object.freeze({
      approximate_drop_area: order.approximate_drop_area,
      fulfilment_method: method,
      in_custody: inCustody,
      lifecycle_state: order.lifecycle_state,
      stage,
      // The customer's own delivery, so they can rate it separately from the
      // shop. Null for a collected order, which has no delivery to rate.
      delivery_assignment_id: order.delivery_assignment_id,
    });
  }

  /** The customer\'s own support cases, so an open issue is visible (CUS-64). */
  async listCustomerSupportCases(input: {
    readonly context: RequestContext;
    readonly limit?: number;
  }): Promise<readonly Record<string, unknown>[]> {
    const customerId = requireCustomer(input.context);
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const rows = await this.#pool.query(
      `SELECT c.support_case_id, c.category, c.description, c.lifecycle_state,
              c.created_at, c.updated_at, o.order_reference
         FROM marketplace.support_cases c
         JOIN marketplace.vendor_orders o USING (vendor_order_id)
        WHERE c.opened_by_user_id=$1
        ORDER BY c.created_at DESC
        LIMIT $2`,
      [customerId, limit],
    );
    return rows.rows as Record<string, unknown>[];
  }

  /** Participant-safe case projection. Internal notes are excluded in SQL. */
  async getCustomerSupportCase(input: {
    readonly context: RequestContext;
    readonly support_case_id: UuidV7;
  }): Promise<Record<string, unknown>> {
    const customerId = requireCustomer(input.context);
    const found = await this.#pool.query(
      `SELECT c.support_case_id,c.category,c.description,c.lifecycle_state,c.severity,
              c.response_due_at,c.created_at,c.updated_at,o.order_reference,
              COALESCE(jsonb_agg(jsonb_build_object(
                'support_case_message_id',m.support_case_message_id,
                'author_user_id',m.author_user_id,
                'body',m.body,
                'created_at',m.created_at
              ) ORDER BY m.created_at) FILTER (WHERE m.support_case_message_id IS NOT NULL), '[]') AS messages
         FROM marketplace.support_cases c
         JOIN marketplace.vendor_orders o USING (vendor_order_id)
         LEFT JOIN marketplace.support_case_messages m
           ON m.support_case_id=c.support_case_id AND m.audience='PARTICIPANT'
        WHERE c.support_case_id=$1 AND c.opened_by_user_id=$2
        GROUP BY c.support_case_id,o.order_reference`,
      [input.support_case_id, customerId],
    );
    const row = found.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new FulfilmentNotFoundError();
    return row;
  }

  async addCustomerSupportMessage(input: {
    readonly context: RequestContext;
    readonly support_case_id: UuidV7;
    readonly body: string;
    readonly now?: Date;
  }): Promise<Record<string, unknown>> {
    const customerId = requireCustomer(input.context);
    const body = input.body.trim();
    if (body.length < 1 || body.length > 2000)
      throw new FulfilmentInputError('Message must be between 1 and 2000 characters');
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const owned = await client.query(
        `SELECT 1 FROM marketplace.support_cases
          WHERE support_case_id=$1 AND opened_by_user_id=$2 AND lifecycle_state <> 'MERGED'`,
        [input.support_case_id, customerId],
      );
      if (!owned.rows[0]) throw new FulfilmentNotFoundError();
      const messageId = createUuidV7({ now_ms: now.getTime() });
      const ids = contextIds(input.context);
      await client.query(
        `INSERT INTO marketplace.support_case_messages
           (support_case_message_id,support_case_id,author_user_id,audience,body,created_at)
         VALUES($1,$2,$3,'PARTICIPANT',$4,$5)`,
        [messageId, input.support_case_id, customerId, body, now],
      );
      await client.query(
        `INSERT INTO marketplace.support_case_events
           (support_case_event_id,support_case_id,event_type,actor_id,reason_code,payload,
            request_id,correlation_id,occurred_at)
         VALUES($1,$2,'MESSAGE_SENT',$3,'CUSTOMER_MESSAGE','{}'::jsonb,$4,$5,$6)`,
        [
          createUuidV7({ now_ms: now.getTime() + 1 }),
          input.support_case_id,
          customerId,
          ids.request,
          ids.correlation,
          now,
        ],
      );
      return Object.freeze({
        support_case_message_id: messageId,
        author_user_id: customerId,
        body,
        created_at: now.toISOString(),
      });
    });
  }

  async openSupportCase(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly category: string;
    readonly description: string;
    readonly now?: Date;
  }): Promise<UuidV7> {
    if (!reasonCode.test(input.category))
      throw new FulfilmentInputError('Category must be shouting-snake-case');
    if (input.description.length < 1 || input.description.length > 1000)
      throw new FulfilmentInputError('Description must be between 1 and 1000 characters');
    const customerId = requireCustomer(input.context);
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const order = await client.query<{ customer_user_id: string }>(
        `SELECT cg.customer_user_id FROM marketplace.vendor_orders o
           JOIN marketplace.checkout_groups cg USING (checkout_group_id)
          WHERE o.vendor_order_id=$1`,
        [input.vendor_order_id],
      );
      if (order.rows[0]?.customer_user_id !== customerId) throw new FulfilmentNotFoundError();
      const caseId = createUuidV7({ now_ms: now.getTime() });
      const ids = contextIds(input.context);
      await client.query(
        `INSERT INTO marketplace.support_cases
           (support_case_id, vendor_order_id, opened_by_user_id, category, description,
            request_id, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          caseId,
          input.vendor_order_id,
          customerId,
          input.category,
          input.description,
          ids.request,
          ids.correlation,
        ],
      );
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: 'SUPPORT_CASE_OPENED',
        actor_id: customerId,
        actor_kind: 'customer',
        previous_state: null,
        resulting_state: null,
        reason_code: input.category,
        ids,
      });
      return caseId;
    });
  }

  // -----------------------------------------------------------------------
  // Read-only projections used by tests and controllers.
  // -----------------------------------------------------------------------

  async listVendorOrders(input: {
    readonly context: RequestContext;
    readonly vendor_location_id: UuidV7;
    readonly limit?: number;
  }): Promise<readonly VendorOrderSummary[]> {
    requireSystemOrVendor(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    return orderSummaries(this.#pool, {
      where: 'o.vendor_location_id=$1',
      params: [input.vendor_location_id, limit],
      tail: 'ORDER BY o.created_at DESC, o.vendor_order_id DESC LIMIT $2',
    });
  }

  async getOrder(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
  }): Promise<VendorOrderSummary> {
    return orderSummary(this.#pool, input.vendor_order_id);
  }

  /**
   * The pick list, for the store that owns the order.
   *
   * Scoped by location: the route's guard proves membership at
   * `:vendor_location_id`, and this refuses an order that is not that
   * location's -- previously any vendor member could read any store's pick
   * list by order id.
   */
  async listPicks(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
  }): Promise<readonly PickRecord[]> {
    await requireVendorMemberPool(this.#pool, input.context, input.vendor_location_id);
    const result = await this.#pool.query(
      `SELECT COALESCE(p.pick_id,l.vendor_order_line_id) AS pick_id,
              l.vendor_order_line_id, COALESCE(p.pick_state,'PENDING') AS pick_state,
              p.actual_quantity,
              p.actual_unit_price_minor::text AS actual_unit_price_minor,
              p.substitution_variant_id, COALESCE(p.version,0) AS version,
              l.product_title_snapshot AS product_title,
              l.quantity AS ordered_quantity, l.unit_price_minor::text AS ordered_unit_price_minor,
              l.substitution_preference, product.variable_weight
         FROM marketplace.vendor_order_lines l
         JOIN marketplace.vendor_orders o USING (vendor_order_id)
         LEFT JOIN marketplace.vendor_order_line_picks p USING(vendor_order_line_id)
         LEFT JOIN marketplace.catalogue_product_variants variant
           ON variant.catalogue_variant_id = l.catalogue_variant_id
         LEFT JOIN marketplace.catalogue_products product
           ON product.catalogue_product_id = variant.catalogue_product_id
        WHERE l.vendor_order_id=$1 AND o.vendor_location_id=$2
        ORDER BY l.vendor_order_line_id`,
      [input.vendor_order_id, input.vendor_location_id],
    );
    if (result.rows.length === 0) {
      const owned = await this.#pool.query(
        `SELECT 1 FROM marketplace.vendor_orders WHERE vendor_order_id=$1 AND vendor_location_id=$2`,
        [input.vendor_order_id, input.vendor_location_id],
      );
      if (!owned.rows[0]) throw new FulfilmentNotFoundError();
    }
    return Object.freeze(result.rows.map((row) => projectPick(row as Record<string, unknown>)));
  }

  async listDecisions(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
  }): Promise<readonly DecisionRecord[]> {
    const result = await this.#pool.query(
      `SELECT decision_id, vendor_order_id, pick_id, proposal_kind, proposed_variant_id,
              proposed_quantity, proposed_unit_price_minor::text AS proposed_unit_price_minor,
              authorization_delta_minor::text AS authorization_delta_minor, reason_note,
              decision_deadline_at, answer, answered_at
         FROM marketplace.vendor_order_customer_decisions WHERE vendor_order_id=$1
         ORDER BY created_at`,
      [input.vendor_order_id],
    );
    return Object.freeze(result.rows.map((row) => projectDecision(row as Record<string, unknown>)));
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Gives back what an ended order still holds, so a sibling order in the
   * same checkout group is not starved and the shop's count is right. This
   * used to flip the reservations to RELEASED and stop: the units were never
   * returned to `exact_available_quantity`, so every decline, timeout or
   * cancellation of a counted item lost that stock for good.
   */
  async #releaseHolds(
    client: PoolClient,
    context: RequestContext,
    vendorOrderId: UuidV7,
    now: Date,
    reasonCode: string,
    states?: readonly ('SOFT_HELD' | 'PROVISIONAL' | 'COMMITTED')[],
  ): Promise<void> {
    await releaseReservationsLocked(client, {
      context,
      now,
      reason_code: reasonCode,
      reservation_ids: await this.#lineReservations(client, vendorOrderId),
      ...(states ? { states } : {}),
    });
  }

  /** The acceptance's half of the sale: every held line becomes sold (8.2). */
  async #commitHolds(
    client: PoolClient,
    context: RequestContext,
    vendorOrderId: UuidV7,
    now: Date,
  ): Promise<void> {
    try {
      await commitReservationsLocked(client, {
        context,
        now,
        reason_code: 'VENDOR_ACCEPTED',
        reservation_ids: await this.#lineReservations(client, vendorOrderId),
      });
    } catch (error) {
      if (error instanceof InventoryConflictError) {
        throw new FulfilmentConflictError(
          'The stock held for this order is no longer held; it cannot be accepted',
        );
      }
      throw error;
    }
  }

  async #lineReservations(client: PoolClient, vendorOrderId: UuidV7): Promise<readonly UuidV7[]> {
    const held = await client.query<{ reservation_id: string }>(
      `SELECT l.inventory_reservation_id AS reservation_id
         FROM marketplace.vendor_order_lines l
        WHERE l.vendor_order_id=$1 AND l.inventory_reservation_id IS NOT NULL
        ORDER BY l.vendor_order_line_id`,
      [vendorOrderId],
    );
    return held.rows.map((row) => parseUuidV7(row.reservation_id));
  }

  async #recordPick(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly pick_state: PickState;
    readonly actual_quantity: number | null;
    readonly actual_unit_price_minor: number | null;
    readonly substitution_variant_id: UuidV7 | null;
    readonly reason_code: string;
    readonly event_type: string;
    readonly expected_version: number;
    readonly now?: Date;
  }): Promise<PickRecord> {
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PICKING')
        throw new FulfilmentConflictError('Picking edits require the order to be in PICKING');
      const line = await lockLine(
        client,
        input.vendor_order_id,
        input.vendor_order_line_id,
        input.expected_version,
      );
      if (input.pick_state === 'FOUND') {
        if (input.actual_quantity !== null && input.actual_quantity > line.quantity)
          throw new FulfilmentInputError('A found line cannot exceed the quantity ordered');
        if (input.actual_unit_price_minor !== line.unit_price_minor)
          throw new FulfilmentInputError(
            'A found line is priced as ordered; a changed price or weight is a proposal',
          );
      }
      const pickId = createUuidV7({ now_ms: now.getTime() });
      const upserted = await client.query(
        `INSERT INTO marketplace.vendor_order_line_picks
           (pick_id, vendor_order_line_id, vendor_order_id, pick_state, actual_quantity,
            actual_unit_price_minor, substitution_variant_id, picker_user_id, version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)
         ON CONFLICT (vendor_order_line_id) DO UPDATE
           SET pick_state=EXCLUDED.pick_state,
               actual_quantity=EXCLUDED.actual_quantity,
               actual_unit_price_minor=EXCLUDED.actual_unit_price_minor,
               substitution_variant_id=EXCLUDED.substitution_variant_id,
               version=marketplace.vendor_order_line_picks.version + 1,
               updated_at=EXCLUDED.updated_at
         RETURNING pick_id, vendor_order_line_id, pick_state, actual_quantity,
                   actual_unit_price_minor::text AS actual_unit_price_minor,
                   substitution_variant_id, version`,
        [
          pickId,
          input.vendor_order_line_id,
          input.vendor_order_id,
          input.pick_state,
          input.actual_quantity,
          input.actual_unit_price_minor,
          input.substitution_variant_id,
          userId,
          now,
        ],
      );
      const ids = contextIds(input.context);
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: input.event_type,
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: null,
        resulting_state: null,
        reason_code: input.reason_code,
        ids,
      });
      return projectPick(upserted.rows[0] as Record<string, unknown>);
    });
  }

  async #recordPickAndProposal(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly vendor_order_line_id: UuidV7;
    readonly pick_state: PickState;
    readonly proposal_kind: 'SUBSTITUTION' | 'WEIGHT';
    readonly proposed_variant_id: UuidV7 | null;
    readonly proposed_quantity: number;
    readonly proposed_unit_price_minor: number;
    readonly substitution_variant_id: UuidV7 | null;
    readonly reason_note: string;
    readonly decision_deadline_seconds: number;
    readonly reason_code: string;
    readonly event_type: string;
    readonly expected_version: number;
    readonly now?: Date;
  }): Promise<{ readonly pick: PickRecord; readonly decision: DecisionRecord }> {
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const { userId } = await requireVendorMember(client, input.context, input.vendor_location_id);
      const order = await lockOrder(client, input.vendor_order_id);
      if (order.vendor_location_id !== input.vendor_location_id)
        throw new FulfilmentNotFoundError();
      if (order.lifecycle_state !== 'PICKING')
        throw new FulfilmentConflictError('Picking edits require the order to be in PICKING');
      const lineRow = await lockLine(
        client,
        input.vendor_order_id,
        input.vendor_order_line_id,
        input.expected_version,
      );
      if (input.proposal_kind === 'SUBSTITUTION') {
        // The order proceeds under the customer's rule (PRD): a line they
        // asked to have refunded rather than replaced takes no proposal, and
        // the replacement is one of this store's own live products.
        if (lineRow.substitution_preference === 'NO_SUBSTITUTION')
          throw new FulfilmentConflictError(
            'The customer asked for no substitution on this line',
            'SUBSTITUTION_NOT_ALLOWED',
          );
        const replacement = await client.query(
          `SELECT 1 FROM marketplace.catalogue_product_variants variant
             JOIN marketplace.catalogue_products product USING (catalogue_product_id)
            WHERE variant.catalogue_variant_id=$1 AND product.vendor_location_id=$2
              AND variant.lifecycle_state='ACTIVE'`,
          [input.substitution_variant_id, input.vendor_location_id],
        );
        if (replacement.rows.length === 0)
          throw new FulfilmentInputError(
            "The replacement must be one of this store's published products",
          );
      }
      const originalTotal = lineRow.unit_price_minor * lineRow.quantity;
      const proposedTotal = input.proposed_unit_price_minor * input.proposed_quantity;
      const delta = proposedTotal - originalTotal;
      // Only a material change is a question for the customer (8.4): a total
      // that rises. A lighter weight is recorded and the difference is not
      // charged; a replacement at no extra cost on a line whose rule lets the
      // store choose is applied under that rule. Until audit run 52 every
      // weight and every replacement waited on the customer.
      const appliedUnderRule =
        delta <= 0 &&
        (input.proposal_kind === 'WEIGHT' ||
          lineRow.substitution_preference === 'ALLOW_SAME_STORE');
      const pickState: PickState = appliedUnderRule
        ? input.proposal_kind === 'SUBSTITUTION'
          ? 'SUBSTITUTION_APPROVED'
          : 'WEIGHT_APPROVED'
        : input.pick_state;
      const pickId = createUuidV7({ now_ms: now.getTime() });
      const upserted = await client.query(
        `INSERT INTO marketplace.vendor_order_line_picks
           (pick_id, vendor_order_line_id, vendor_order_id, pick_state, actual_quantity,
            actual_unit_price_minor, substitution_variant_id, picker_user_id, version, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)
         ON CONFLICT (vendor_order_line_id) DO UPDATE
           SET pick_state=EXCLUDED.pick_state,
               actual_quantity=EXCLUDED.actual_quantity,
               actual_unit_price_minor=EXCLUDED.actual_unit_price_minor,
               substitution_variant_id=EXCLUDED.substitution_variant_id,
               version=marketplace.vendor_order_line_picks.version + 1,
               updated_at=EXCLUDED.updated_at
         RETURNING pick_id, vendor_order_line_id, pick_state, actual_quantity,
                   actual_unit_price_minor::text AS actual_unit_price_minor,
                   substitution_variant_id, version`,
        [
          pickId,
          input.vendor_order_line_id,
          input.vendor_order_id,
          pickState,
          input.proposed_quantity,
          input.proposed_unit_price_minor,
          input.substitution_variant_id,
          userId,
          now,
        ],
      );
      const pick = projectPick(upserted.rows[0] as Record<string, unknown>);
      const decisionId = createUuidV7({ now_ms: now.getTime() });
      const deadline = new Date(now.getTime() + input.decision_deadline_seconds * 1000);
      // The record of the change is a decision row either way: answered by the
      // customer's rule, or waiting on the customer.
      const inserted = await client.query(
        `INSERT INTO marketplace.vendor_order_customer_decisions
           (decision_id, vendor_order_id, pick_id, proposal_kind, proposed_variant_id,
            proposed_quantity, proposed_unit_price_minor, authorization_delta_minor,
            reason_note, decision_deadline_at, answer, answered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING decision_id, vendor_order_id, pick_id, proposal_kind, proposed_variant_id,
                   proposed_quantity, proposed_unit_price_minor::text AS proposed_unit_price_minor,
                   authorization_delta_minor::text AS authorization_delta_minor, reason_note,
                   decision_deadline_at, answer, answered_at`,
        [
          decisionId,
          input.vendor_order_id,
          pick.pick_id,
          input.proposal_kind,
          input.proposed_variant_id,
          input.proposed_quantity,
          input.proposed_unit_price_minor,
          delta,
          input.reason_note,
          deadline,
          appliedUnderRule ? 'APPROVED' : 'PENDING',
          appliedUnderRule ? now : null,
        ],
      );
      const ids = contextIds(input.context);
      if (appliedUnderRule) {
        await adjustAuthorizationForOrder(client, {
          vendor_order_id: input.vendor_order_id,
          delta_minor: delta,
          adjustment_kind: 'CUSTOMER_DECISION',
          decision_id: decisionId,
          actor_id: userId,
          actor_kind: 'vendor_staff',
          reason_code:
            input.proposal_kind === 'SUBSTITUTION'
              ? 'CUSTOMER_RULE_ALLOW_SAME_STORE'
              : 'LIGHTER_WEIGHT_RECORDED',
          ids,
          now,
        });
      }
      await appendEvent(client, {
        vendor_order_id: input.vendor_order_id,
        event_type: appliedUnderRule ? pickState : input.event_type,
        actor_id: userId,
        actor_kind: 'vendor_staff',
        previous_state: null,
        resulting_state: null,
        reason_code: appliedUnderRule
          ? input.proposal_kind === 'SUBSTITUTION'
            ? 'CUSTOMER_RULE_ALLOW_SAME_STORE'
            : 'LIGHTER_WEIGHT_RECORDED'
          : input.reason_code,
        decision_id: decisionId,
        ids,
      });
      return {
        pick,
        decision: projectDecision(inserted.rows[0] as Record<string, unknown>),
      };
    });
  }
}
