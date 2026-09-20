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
  };
  readonly adminControl: {
    createSupportCase(input: {
      readonly category: string;
      readonly context: RequestContext;
      readonly description: string;
      readonly response_due_at: Date;
      readonly severity: string;
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
  'checkout.webhook_authorized',
  'partner.reinstated',
  'vendor.reinstated',
  'vendor.suspended',
]);

/** How long an operator has to answer a returned delivery. */
export const RETURNED_CASE_RESPONSE_MS = 4 * 60 * 60 * 1_000;

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
    await deps.dispatch.dispatchPlacedOrder({
      context,
      event_id: event.event_id,
      vendor_order_id: event.aggregate_id,
    });
  } else if (
    event.event_type === 'vendor_order.accepted' ||
    event.event_type === 'vendor_order.ended'
  ) {
    // Every shop in a checkout group shares one authorization, so the
    // decision to capture or void can only be taken once they have all
    // answered. This runs on each answer and returns WAITING until then.
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
    // Goods that came back are not a completed sale. The settlement that
    // divides the money is deliberately not run here: what the partner is
    // owed for a return trip is a policy question nobody has answered
    // yet, and guessing it would move real money on an invented rate.
    //
    // What must happen is that a person sees it. A returned order has
    // already failed and the customer is owed an answer, so it opens a
    // case rather than resting in a state nobody reads.
    await deps.adminControl.createSupportCase({
      category: 'DELIVERY_RETURNED',
      context,
      description:
        'Delivery was returned to the vendor. The customer has not received this order and the money has not been divided.',
      response_due_at: new Date(deps.now().getTime() + RETURNED_CASE_RESPONSE_MS),
      severity: 'HIGH',
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
