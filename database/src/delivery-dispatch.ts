import { createDatabasePool } from './database-pool.js';
import type { RequestContext, UuidV7 } from '@neighbourhood-store/domain-types';
import { parseUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  AssignmentConflictError,
  AssignmentVersionError,
  type AssignmentCustodyService,
  type DeliveryAssignmentRecord,
} from './assignment-custody.js';
import type { PartnerAvailabilityService } from './partner-availability.js';

export class DeliveryDispatchUnavailableError extends Error {}

/** How long a partner has to answer an offer before it is re-dispatched. */
const OFFER_WINDOW_MS = 5 * 60 * 1_000;

type OrderDispatchRow = {
  readonly approximate_drop_area: string;
  readonly approximate_pickup_area: string;
  readonly fulfilment_method: string;
  readonly order_reference: string;
  readonly package_count: number;
  readonly vendor_location_id: string;
};

function area(value: string): string {
  const normalized = value
    .replace(/^SYNTH\s+/i, '')
    .replace(/[^\p{L}\p{N}\p{M} .,&'()/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `SYNTH ${(normalized || 'Local area').slice(0, 88)}`;
}

export class DeliveryDispatchOrchestrator {
  readonly #assignments: AssignmentCustodyService;
  readonly #availability: PartnerAvailabilityService;
  readonly #pool: Pool;

  constructor(input: {
    readonly assignments: AssignmentCustodyService;
    readonly availability: PartnerAvailabilityService;
    readonly connection_string: string;
  }) {
    this.#assignments = input.assignments;
    this.#availability = input.availability;
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-delivery-dispatch',
      connectionString: input.connection_string,
      max: 4,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async dispatchPlacedOrder(input: {
    readonly context: RequestContext;
    readonly event_id: UuidV7;
    readonly vendor_order_id: UuidV7;
    readonly now?: Date;
  }): Promise<DeliveryAssignmentRecord | null> {
    const now = input.now ?? new Date();
    const result = await this.#pool.query<OrderDispatchRow>(
      `SELECT vo.order_reference,vo.vendor_location_id,cvg.fulfilment_method,
              GREATEST(1,COUNT(cql.checkout_quote_line_id))::integer AS package_count,
              vl.location_name AS approximate_pickup_area,
              a.label AS approximate_drop_area
         FROM marketplace.vendor_orders vo
         JOIN marketplace.checkout_groups checkout_group USING (checkout_group_id)
         JOIN marketplace.checkout_quote_groups cqg
           ON cqg.checkout_quote_id=checkout_group.checkout_quote_id
          AND cqg.vendor_location_id=vo.vendor_location_id
         JOIN marketplace.cart_vendor_groups cvg USING (cart_vendor_group_id)
         JOIN marketplace.checkout_quotes quote
           ON quote.checkout_quote_id=checkout_group.checkout_quote_id
         JOIN marketplace.customer_addresses a
           ON a.customer_address_id=quote.customer_address_id
         JOIN marketplace.vendor_locations vl
           ON vl.vendor_location_id=vo.vendor_location_id
         LEFT JOIN marketplace.checkout_quote_lines cql USING (checkout_quote_group_id)
        WHERE vo.vendor_order_id=$1
        GROUP BY vo.order_reference,vo.vendor_location_id,cvg.fulfilment_method,
                 vl.location_name,a.label`,
      [input.vendor_order_id],
    );
    const order = result.rows[0];
    if (!order) throw new DeliveryDispatchUnavailableError('Placed order was not found');
    if (order.fulfilment_method !== 'PLATFORM_DELIVERY') return null;

    // Placement only reserves the custody attempt. Offering it is the job of
    // offerReadyAssignments, which runs every worker tick. No partner may be
    // online at placement time, so candidate selection must remain retryable.
    return this.#assignments.create({
      approximate_drop_area: area(order.approximate_drop_area),
      approximate_pickup_area: area(order.approximate_pickup_area),
      command_reference: `SYNTH-CMD-DISPATCH-${input.event_id}`.toUpperCase(),
      context: input.context,
      handling_flags: [],
      package_count: order.package_count,
      reason_code: 'ORDER_PLACED_AUTO_DISPATCH',
      source_order_reference: order.order_reference,
      vendor_location_id: parseUuidV7(order.vendor_location_id),
      vendor_order_id: input.vendor_order_id,
      now,
    });
  }

  /**
   * Offers every unassigned attempt whose vendor order is being prepared, and
   * returns declined or expired attempts to the pool first so they are picked
   * up again.
   *
   * This is the retry loop the dispatch path never had. Running it on the
   * worker tick means "no partner was online" and "the offer timed out" are
   * transient conditions rather than a silently undelivered order.
   */
  async offerReadyAssignments(input: {
    readonly context: RequestContext;
    readonly command_prefix: string;
    readonly limit?: number;
    readonly now?: Date;
  }): Promise<{ readonly offered: number; readonly returned: number; readonly waiting: number }> {
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

    // An attempt whose offer was declined or timed out is still the order's
    // only attempt; put it back in the pool before looking for candidates.
    const stalled = await this.#pool.query<{ delivery_assignment_id: string; version: number }>(
      `SELECT assignment.delivery_assignment_id, assignment.version
         FROM marketplace.delivery_assignments assignment
         JOIN marketplace.vendor_orders vendor_order
           ON vendor_order.vendor_order_id = assignment.vendor_order_id
        WHERE assignment.assignment_state IN ('DECLINED','OFFER_EXPIRED')
          -- Not PLACED: a rider must never be offered a job for an order the shop
          -- has not agreed to supply, because the shop may still decline it.
          AND vendor_order.lifecycle_state IN ('ACCEPTED','PICKING','READY')
        ORDER BY assignment.updated_at
        LIMIT $1`,
      [limit],
    );
    let returned = 0;
    for (const row of stalled.rows) {
      try {
        await this.#assignments.returnToPool({
          command_reference:
            `${input.command_prefix}-RETURN-${row.delivery_assignment_id}`.toUpperCase(),
          context: input.context,
          delivery_assignment_id: parseUuidV7(row.delivery_assignment_id),
          expected_version: row.version,
          reason_code: 'RETURNED_FOR_REDISPATCH',
          now,
        });
        returned += 1;
      } catch (error) {
        // A concurrent operator action moved the attempt on. The next tick
        // re-reads its state.
        if (!(error instanceof AssignmentConflictError || error instanceof AssignmentVersionError))
          throw error;
      }
    }

    const pending = await this.#pool.query<{
      delivery_assignment_id: string;
      vendor_location_id: string;
      version: number;
      package_count: number;
      handling_flags: string[];
    }>(
      `SELECT assignment.delivery_assignment_id, assignment.vendor_location_id, assignment.version,
              assignment.package_count, assignment.handling_flags
         FROM marketplace.delivery_assignments assignment
         JOIN marketplace.vendor_orders vendor_order
           ON vendor_order.vendor_order_id = assignment.vendor_order_id
        WHERE assignment.assignment_state = 'UNASSIGNED'
          -- Not PLACED: a rider must never be offered a job for an order the shop
          -- has not agreed to supply, because the shop may still decline it.
          AND vendor_order.lifecycle_state IN ('ACCEPTED','PICKING','READY')
        ORDER BY assignment.created_at
        LIMIT $1`,
      [limit],
    );

    let offered = 0;
    let waiting = 0;
    for (const row of pending.rows) {
      const assignmentId = parseUuidV7(row.delivery_assignment_id);
      const history = await this.#assignments.offerHistory({
        delivery_assignment_id: assignmentId,
      });
      const eligible = await this.#availability.eligible({
        context: input.context,
        exclude_partner_user_ids: history.declined,
        handling_flags: row.handling_flags,
        now,
        package_count: row.package_count,
        vendor_location_id: parseUuidV7(row.vendor_location_id),
      });
      // Nearest first, but whoever has let this attempt lapse the fewest times
      // goes ahead of whoever has let it lapse more. Taking the nearest alone
      // re-offered every expired attempt to the same partner: an online rider
      // ignoring their phone held the job indefinitely while a second rider,
      // online and in range, was never asked. With one partner in range the
      // order still comes back to them, so nothing waits forever that need not.
      const partner = [...eligible].sort(
        (left, right) =>
          (history.passes.get(left.partner_user_id) ?? 0) -
            (history.passes.get(right.partner_user_id) ?? 0) ||
          left.distance_meters - right.distance_meters,
      )[0];
      if (!partner) {
        waiting += 1;
        continue;
      }
      try {
        await this.#assignments.offer({
          command_reference:
            `${input.command_prefix}-OFFER-${row.delivery_assignment_id}`.toUpperCase(),
          context: input.context,
          delivery_assignment_id: assignmentId,
          expected_version: row.version,
          expires_at: new Date(now.getTime() + OFFER_WINDOW_MS),
          partner_user_id: partner.partner_user_id,
          reason_code: 'WORKER_AUTO_DISPATCH',
          now,
        });
        offered += 1;
      } catch (error) {
        // The partner went offline or the attempt changed under us. Leave it
        // unassigned; the next tick tries the next candidate.
        if (!(error instanceof AssignmentConflictError || error instanceof AssignmentVersionError))
          throw error;
        waiting += 1;
      }
    }
    return { offered, returned, waiting };
  }
}
