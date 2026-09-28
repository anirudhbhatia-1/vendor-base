import type { RequestContext, UuidV7 } from '@neighbourhood-store/domain-types';

/**
 * What the worker does with each domain event, separated from the service that
 * consumes them so the routing can be tested without a queue, a database or
 * the fourteen services the worker constructs.
 *
 * The dependencies are the narrowest shape each branch needs, not the service
 * classes, so a test supplies a fake per branch and asserts which was called.
 * The routing itself had never been asserted anywhere: it lived inside a
 * closure in the worker's constructor-built service, reachable only through the
 * integration queue canary, which carries an event that reacts to nothing.
 */
export interface DomainEvent {
  readonly event_id: UuidV7;
  readonly event_type: string;
  readonly aggregate_id: UuidV7;
}

export interface DomainEventDependencies {
  readonly fulfilment: {
    settleInventoryOnPickup(input: {
      readonly context: RequestContext;
      readonly vendor_order_id: UuidV7;
    }): Promise<unknown>;
    fulfilmentMethod(vendorOrderId: UuidV7): Promise<string>;
  };
  readonly dispatch: {
    dispatchPlacedOrder(input: {
      readonly context: RequestContext;
      readonly event_id: UuidV7;
      readonly vendor_order_id: UuidV7;
    }): Promise<unknown>;
  };
  readonly orderMoney: {
    settleAuthorizationForOrder(input: {
      readonly context: RequestContext;
      readonly vendor_order_id: UuidV7;
    }): Promise<string>;
    recordDeliveryEarnings(input: {
      readonly context: RequestContext;
      readonly vendor_order_id: UuidV7;
    }): Promise<{ readonly earning_posted: boolean; readonly settled: boolean }>;
    refundEndedOrder(input: {
      readonly context: RequestContext;
      readonly vendor_order_id: UuidV7;
    }): Promise<{ readonly refund_id?: unknown; readonly refund_state?: unknown } | null>;
    recordReturnEarnings(input: {
      readonly context: RequestContext;
      readonly vendor_order_id: UuidV7;
    }): Promise<{ readonly earning_posted: boolean }>;
  };
  readonly supportCases: {
    open(input: {
      readonly category: string;
      readonly context: RequestContext;
      readonly description: string;
      readonly vendor_order_id: UuidV7;
    }): Promise<unknown>;
  };
  readonly availability: {
    forceOffline(input: {
      readonly context: RequestContext;
      readonly partner_user_id: UuidV7;
      readonly reason_code: string;
    }): Promise<unknown>;
  };
  readonly notifications: {
    alertStaffOfPlacedOrder(input: {
      readonly context: RequestContext;
      readonly vendor_order_id: UuidV7;
    }): Promise<number>;
  };
  readonly log: (event: string, fields: Record<string, unknown>) => void;
  readonly now: () => Date;
}

/**
 * Emitted event types with no worker-side reaction today. Their domain effects
 * are applied synchronously in the emitting transaction; the event exists for
 * ordering and audit. Listing them explicitly keeps an unhandled *new* event
 * type from being mistaken for a deliberate no-op.
 */
export const ACKNOWLEDGED_WITHOUT_REACTION: ReadonlySet<string> = new Set([
  'checkout.payment_failed',
  // The queue canary. R0.5 asks for a bounded, cleaned-up round trip that proves
  // jobs actually flow, because a broker PING proves only that the broker answers
  // and a heartbeat proves only that a worker is alive -- neither shows that an
  // event enqueued now gets consumed. This type carries the whole path
  // (outbox row -> dispatch -> Valkey -> worker -> acknowledged) and reacts to
  // nothing, so it is inert in every environment rather than test-only code
  // living in a production branch.
  'ops.queue_canary',
  'checkout.payment_abandoned',
  'checkout.payment_unknown',
  'checkout.placed',
  'checkout.submitted',
  'checkout.webhook_authorized',
  'partner.reinstated',
  'vendor.reinstated',
  'vendor.suspended',
  // The store's delay (9.5): the revised estimate is on the order already;
  // telling the customer is the notifications slice's.
  'vendor_order.delayed',
]);

export async function handleDomainEvent(
  deps: DomainEventDependencies,
  context: RequestContext,
  event: DomainEvent,
): Promise<void> {
  deps.log('outbox.event.processing', {
    event_id: event.event_id,
    event_type: event.event_type,
  });
  if (event.event_type === 'vendor_order.picked_up') {
    await deps.fulfilment.settleInventoryOnPickup({
      context,
      vendor_order_id: event.aggregate_id,
    });
    // A collected order ends here: PICKED_UP is its last state, and the money
    // was divided only on `vendor_order.delivered`, so a shop was never paid
    // for anything a customer carried out of it themselves. A platform or
    // self-delivery is still on its way and settles when it is delivered.
    const method = await deps.fulfilment.fulfilmentMethod(event.aggregate_id);
    if (method === 'CUSTOMER_PICKUP') {
      const result = await deps.orderMoney.recordDeliveryEarnings({
        context,
        vendor_order_id: event.aggregate_id,
      });
      deps.log('vendor_order.collection.settled', {
        event_id: event.event_id,
        settled: result.settled,
        vendor_order_id: event.aggregate_id,
      });
    }
  } else if (event.event_type === 'order.placed') {
    // The shop is told first (8.1): every staff member's device, sounding,
    // with the deadline the server set. Until audit run 49 nothing told the
    // shop; the console polled a list in silence while the deadline ran.
    const alerted = await deps.notifications.alertStaffOfPlacedOrder({
      context,
      vendor_order_id: event.aggregate_id,
    });
    deps.log('vendor_order.staff_alerted', {
      event_id: event.event_id,
      recipients: alerted,
      vendor_order_id: event.aggregate_id,
    });
    await deps.dispatch.dispatchPlacedOrder({
      context,
      event_id: event.event_id,
      vendor_order_id: event.aggregate_id,
    });
  } else if (
    event.event_type === 'vendor_order.accepted' ||
    event.event_type === 'vendor_order.ready' ||
    event.event_type === 'vendor_order.ended'
  ) {
    // Every shop in a checkout group shares one authorization, so the
    // decision to capture or void can only be taken once they have all
    // answered and packed (8.4: an approved change or a missing line moves
    // the amount until ready). This runs on each answer and each ready and
    // returns WAITING until then.
    const outcome = await deps.orderMoney.settleAuthorizationForOrder({
      context,
      vendor_order_id: event.aggregate_id,
    });
    deps.log('checkout.authorization.settled', {
      event_id: event.event_id,
      event_type: event.event_type,
      outcome,
      vendor_order_id: event.aggregate_id,
    });
    if (event.event_type === 'vendor_order.ended') {
      // An order called off after its group was captured is owed the money
      // back (10.2). The refund is filed here for a person to approve;
      // nothing is filed for an order that ended before capture, whose
      // share the ending already released from the authorisation.
      const refund = await deps.orderMoney.refundEndedOrder({
        context,
        vendor_order_id: event.aggregate_id,
      });
      if (refund)
        deps.log('vendor_order.refund.proposed', {
          event_id: event.event_id,
          refund_id: refund.refund_id,
          refund_state: refund.refund_state,
          vendor_order_id: event.aggregate_id,
        });
    }
  } else if (event.event_type === 'vendor_order.delivered') {
    const result = await deps.orderMoney.recordDeliveryEarnings({
      context,
      vendor_order_id: event.aggregate_id,
    });
    deps.log('vendor_order.delivery.settled', {
      earning_posted: result.earning_posted,
      event_id: event.event_id,
      settled: result.settled,
      vendor_order_id: event.aggregate_id,
    });
  } else if (event.event_type === 'vendor_order.returned') {
    // Goods that came back are not a completed sale, and the settlement
    // that divides the money is deliberately not run here. The partner who
    // drove the trip out is still owed what their offer said (10.4); what
    // the trip back pays is a policy question nobody has answered yet
    // (DLP-49), so it is recorded at nothing rather than an invented rate.
    const returned = await deps.orderMoney.recordReturnEarnings({
      context,
      vendor_order_id: event.aggregate_id,
    });
    deps.log('vendor_order.return.earning_recorded', {
      earning_posted: returned.earning_posted,
      event_id: event.event_id,
      vendor_order_id: event.aggregate_id,
    });
    //
    // What must happen is that a person sees it. A returned order has
    // already failed and the customer is owed an answer, so it opens a
    // case rather than resting in a state nobody reads. The case is high
    // (a return, D-09) with its first response due on that window, on the
    // delivery attempt, and visible to the customer (11.3); a redelivered
    // event lands on the same open case.
    await deps.supportCases.open({
      category: 'DELIVERY_RETURNED',
      context,
      description:
        'Delivery was returned to the vendor. The customer has not received this order and the money has not been divided.',
      vendor_order_id: event.aggregate_id,
    });
    deps.log('vendor_order.return.case_opened', {
      event_id: event.event_id,
      vendor_order_id: event.aggregate_id,
    });
  } else if (event.event_type === 'partner.suspended') {
    // A suspended partner keeps whatever availability row they last
    // wrote. Dispatch already re-checks eligibility, but clearing the
    // row keeps the two views of the same partner consistent.
    await deps.availability.forceOffline({
      context,
      partner_user_id: event.aggregate_id,
      reason_code: 'PARTNER_SUSPENDED',
    });
  } else if (!ACKNOWLEDGED_WITHOUT_REACTION.has(event.event_type)) {
    // Falling through used to acknowledge the event, so an emitted type
    // nobody handled looked delivered. Unknown types now fail and retry
    // into the dead-letter path instead of disappearing.
    throw new Error(`No outbox handler is registered for ${event.event_type}`);
  }
}
