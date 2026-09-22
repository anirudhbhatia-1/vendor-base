import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import type { CompleteMoneyLifecycleService } from './complete-money-lifecycle.js';
import type { MoneyLifecycleService } from './money-lifecycle.js';
import { resolveFinancialPolicy } from './financial-policy.js';
import { calculatePartnerOfferEarning } from './money-policy.js';

/** What settling a group's authorization concluded. */
export type AuthorizationOutcome = 'WAITING' | 'CAPTURED' | 'VOIDED' | 'ALREADY_SETTLED';

/**
 * Turns order-lifecycle events into money movements.
 *
 * Every piece of machinery below already existed — authorize, capture, void,
 * settlement with its three-way split, the partner earnings ledger posting — and
 * none of it had a caller outside an HTTP controller. An order could be accepted,
 * picked, delivered and rated without a rupee moving, because nothing connected
 * the lifecycle to the ledger. This is that connection, and it lives beside the
 * services rather than inside the worker for the same reason
 * `DeliveryDispatchOrchestrator` does: the worker's job is to consume events, not
 * to hold domain SQL.
 */
export class OrderMoneyOrchestrator {
  readonly #complete: CompleteMoneyLifecycleService;
  readonly #money: MoneyLifecycleService;
  readonly #pool: Pool;

  constructor(input: {
    readonly complete_money: CompleteMoneyLifecycleService;
    readonly connection_string: string;
    readonly money: MoneyLifecycleService;
  }) {
    this.#complete = input.complete_money;
    this.#money = input.money;
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-order-money',
      connectionString: input.connection_string,
      max: 4,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  /**
   * Decides the fate of a checkout group's authorization once every shop in it
   * has answered and packed.
   *
   * One authorization funds the whole group, and capture is all or nothing, so
   * this cannot run per order as each shop answers. It waits until no order is
   * still being answered or picked -- PLACED, ACCEPTED, PICKING or awaiting a
   * customer decision -- because until the picks are final the amount is not:
   * an ending shrinks the authorization to what is being supplied
   * (`releaseAuthorizationForEndedOrder`), an approved change moves it by its
   * delta, and ready takes off what is not in the bag (implementation.md
   * 6.2.4, the capture plan). Until audit run 52 this captured as soon as
   * every shop had *accepted*, so every approved replacement or heavier
   * weight after that point was refused for want of an uncaptured payment,
   * and a missing line was captured in full. What remains at ready is
   * therefore exactly what the bags hold, and capturing it is correct rather
   * than approximate.
   *
   * Every branch is safe to replay: capture and void both return their existing
   * result for a repeated command reference.
   */
  async settleAuthorizationForOrder(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly now?: Date;
  }): Promise<AuthorizationOutcome> {
    const now = input.now ?? new Date();
    const group = await this.#pool.query<{
      payment_transaction_id: string;
      payment_state: string;
      version: number;
      placed: string;
      supplied: string;
    }>(
      `SELECT payment.payment_transaction_id, payment.payment_state, payment.version,
              count(*) FILTER (WHERE sibling.lifecycle_state IN
                ('PLACED','ACCEPTED','PICKING','AWAITING_CUSTOMER_DECISION'))::text AS placed,
              count(*) FILTER (WHERE sibling.lifecycle_state NOT IN ('PLACED','CANCELLED','EXPIRED'))::text
                AS supplied
         FROM marketplace.vendor_orders orders
         JOIN marketplace.checkout_groups grouping USING(checkout_group_id)
         JOIN marketplace.payment_transactions payment USING(payment_transaction_id)
         JOIN marketplace.vendor_orders sibling
           ON sibling.checkout_group_id = orders.checkout_group_id
        WHERE orders.vendor_order_id=$1
        GROUP BY payment.payment_transaction_id, payment.payment_state, payment.version`,
      [input.vendor_order_id],
    );
    const row = group.rows[0];
    if (!row) return 'ALREADY_SETTLED';
    // Captured or voided already: a replayed event must not move money twice.
    if (row.payment_state !== 'AUTHORIZED') return 'ALREADY_SETTLED';
    if (Number(row.placed) > 0) return 'WAITING';

    const paymentId = parseUuidV7(row.payment_transaction_id);
    const reference = String(row.payment_transaction_id).toUpperCase();
    if (Number(row.supplied) === 0) {
      // Nobody is supplying anything, so nothing should be charged at all.
      await this.#complete.voidAuthorization({
        command_reference: `SYNTH-CMD-VOID-${reference}`,
        context: input.context,
        expected_version: row.version,
        now,
        payment_transaction_id: paymentId,
      });
      return 'VOIDED';
    }
    await this.#money.capture({
      command_reference: `SYNTH-CMD-CAPTURE-${reference}`,
      context: input.context,
      expected_version: row.version,
      now,
      payment_transaction_id: paymentId,
    });
    return 'CAPTURED';
  }

  /**
   * Records what the delivery earned and how the captured money divides.
   *
   * The partner's earning is built from the same function that priced the offer
   * card, so the number shown before they accepted is the number they are paid —
   * changing it afterwards would need an auditable adjustment, not a different
   * formula here.
   *
   * Settlement runs per vendor order against that order's allocated share of the
   * payment, not the whole group's capture. Passing the group total would credit
   * every shop in a two-shop basket with the entire amount.
   */
  /**
   * Also the settlement of a collected order, run on `vendor_order.picked_up`
   * when the method is CUSTOMER_PICKUP: no assignment joins, so no partner
   * earning posts, and the settlement divides the captured amount between the
   * shop and the platform. Before that call existed a collected order was never
   * settled at all.
   */
  async recordDeliveryEarnings(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly now?: Date;
  }): Promise<{ readonly earning_posted: boolean; readonly settled: boolean }> {
    const now = input.now ?? new Date();
    const request = parseRequestId(input.context.request_id);
    const correlation = parseUuidV7(input.context.correlation_id);
    const found = await this.#pool.query<{
      delivery_assignment_id: string | null;
      partner_user_id: string | null;
      package_count: number | null;
      route_metres: string | null;
      payment_transaction_id: string;
      payment_state: string;
      order_reference: string;
      vendor_location_id: string;
      item_minor: string | null;
      tip_minor: string | null;
      allocated_total_minor: string | null;
      refunded_minor: string;
      policy_version_reference: string;
      quoted_at: Date;
      wait_minor: string;
    }>(
      `SELECT assignment.delivery_assignment_id, assignment.partner_user_id,
              assignment.package_count,
              -- What the partner's wait at the counter was owed (9.5), as the
              -- handover recorded it; nothing when there was no wait to pay.
              COALESCE((SELECT wait.amount_minor
                          FROM marketplace.partner_wait_earning_adjustments wait
                         WHERE wait.delivery_assignment_id = assignment.delivery_assignment_id
                           AND wait.partner_user_id = assignment.partner_user_id), 0)::text
                AS wait_minor,
              -- The road the order was priced on, from the quote (0085). A quote
              -- older than routing carries none and falls back to the line.
              COALESCE(quote_group.route_metres::bigint,
                       ST_Distance(location.coordinates, address.coordinates)::bigint)::text AS route_metres,
              payment.payment_transaction_id, payment.payment_state,
              orders.order_reference, orders.vendor_location_id,
              quote.policy_version_reference,
              quote.created_at AS quoted_at,
              allocation.item_minor::text AS item_minor,
              allocation.tip_minor::text AS tip_minor,
              allocation.allocated_total_minor::text AS allocated_total_minor,
              COALESCE((SELECT sum(refund.refund_total_minor)
                          FROM marketplace.refunds refund
                         WHERE refund.source_order_reference = orders.order_reference
                           AND refund.refund_state = 'SUCCEEDED'), 0)::text AS refunded_minor
         FROM marketplace.vendor_orders orders
         JOIN marketplace.checkout_groups grouping USING(checkout_group_id)
         JOIN marketplace.payment_transactions payment USING(payment_transaction_id)
         JOIN marketplace.vendor_locations location
           ON location.vendor_location_id = orders.vendor_location_id
         JOIN marketplace.checkout_quotes quote
           ON quote.checkout_quote_id = grouping.checkout_quote_id
         LEFT JOIN marketplace.checkout_quote_groups quote_group
           ON quote_group.checkout_quote_id = quote.checkout_quote_id
          AND quote_group.vendor_location_id = orders.vendor_location_id
         LEFT JOIN marketplace.customer_addresses address
           ON address.customer_address_id = quote.customer_address_id
         LEFT JOIN marketplace.payment_allocations allocation
           ON allocation.payment_transaction_id = payment.payment_transaction_id
          AND allocation.source_order_reference = orders.order_reference
         -- An order can carry more than one attempt: an offer that was declined
         -- or returned to the pool leaves its row behind. The earning belongs to
         -- the attempt that actually completed the delivery, so the join names
         -- that state rather than taking whichever row comes back first.
         LEFT JOIN marketplace.delivery_assignments assignment
           ON assignment.vendor_order_id = orders.vendor_order_id
          AND assignment.assignment_state = 'DELIVERED'
        WHERE orders.vendor_order_id=$1`,
      [input.vendor_order_id],
    );
    const row = found.rows[0];
    // A delivery whose payment was never captured has nothing to divide. That
    // is a real state — a group whose every order ended is voided — and it is
    // not an error to find one here.
    if (!row || row.payment_state !== 'CAPTURED') {
      return { earning_posted: false, settled: false };
    }

    // Resolved as of the moment the quote was priced, so an order settles under
    // the rules it was sold under even if the fee model has since changed.
    const { policy } = await resolveFinancialPolicy(this.#pool, { at: row.quoted_at });

    const tip = Number(row.tip_minor ?? '0');
    let earningPosted = false;
    let outbound = 0;
    let waitMinor = 0;

    if (row.delivery_assignment_id && row.partner_user_id) {
      const metres = Math.min(
        Math.max(Number(row.route_metres ?? '0'), 0),
        policy.outer_route_metres,
      );
      const earning = calculatePartnerOfferEarning(
        {
          package_count: Math.max(row.package_count ?? 1, 1),
          route_metres: metres,
        },
        policy,
      );
      outbound = earning.total_minor;
      // The wait was measured and priced at the counter under the policy in
      // force then; the settlement carries it, capped by the policy the order
      // was sold under so a later change cannot inflate it.
      waitMinor = Math.min(Math.max(Number(row.wait_minor), 0), policy.wait_cap_minor);
      const net = earning.base_minor + earning.distance_minor + waitMinor + tip;
      // The unique key on delivery_assignment_id makes a replayed delivery
      // harmless: the second attempt inserts nothing and posts nothing.
      const inserted = await this.#pool.query<{ partner_earnings_record_id: string }>(
        `INSERT INTO marketplace.partner_earnings_records
          (partner_earnings_record_id,delivery_assignment_id,partner_user_id,outcome,
           base_minor,distance_minor,time_minor,wait_minor,return_minor,incentive_minor,
           tip_minor,adjustment_minor,net_minor,request_id,correlation_id,created_at,updated_at)
         VALUES ($1,$2,$3,'DELIVERED',$4,$5,0,$11,0,0,$6,0,$7,$8,$9,$10,$10)
         ON CONFLICT (delivery_assignment_id) DO NOTHING
         RETURNING partner_earnings_record_id`,
        [
          createUuidV7(),
          row.delivery_assignment_id,
          row.partner_user_id,
          earning.base_minor,
          earning.distance_minor,
          tip,
          net,
          request,
          correlation,
          now,
          waitMinor,
        ],
      );
      const record = inserted.rows[0];
      if (record) {
        await this.#complete.postPartnerEarning({
          context: input.context,
          now,
          partner_earnings_record_id: parseUuidV7(record.partner_earnings_record_id),
        });
        earningPosted = true;
      }
    }

    await this.#money.createSettlement({
      completed: true,
      context: input.context,
      financial_policy: policy,
      policy_version_reference: row.policy_version_reference,
      customer_captured_minor: Number(row.allocated_total_minor ?? '0'),
      now,
      partner_outbound_minor: outbound,
      partner_return_minor: 0,
      // A tip is a partner's only when a partner delivered. On a
      // self-delivered order (VEN-37) it is not owed to a partner who does
      // not exist; it stays in the platform remainder, visible on the
      // settlement's ADJUSTMENT line, until 10.3 decides whose it is.
      partner_tip_minor: row.partner_user_id ? tip : 0,
      partner_wait_minor: waitMinor,
      payment_transaction_id: parseUuidV7(row.payment_transaction_id),
      source_order_reference: row.order_reference,
      successful_refunds_minor: Number(row.refunded_minor),
      vendor_item_minor: Number(row.item_minor ?? '0'),
      vendor_location_id: parseUuidV7(row.vendor_location_id),
      ...(row.partner_user_id ? { partner_user_id: parseUuidV7(row.partner_user_id) } : {}),
    });
    return { earning_posted: earningPosted, settled: true };
  }
}
