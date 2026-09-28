import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { AssignmentCustodyService } from '../src/assignment-custody.js';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { GroupedCheckoutService } from '../src/grouped-checkout.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { MoneyLifecycleService } from '../src/money-lifecycle.js';
import { OrderMoneyOrchestrator } from '../src/order-money-orchestrator.js';
import {
  OrderMonitorAuthorizationError,
  OrderMonitorInputError,
  OrderMonitorService,
  OrderMonitorStateError,
} from '../src/order-monitor.js';
import { VendorFulfilmentService } from '../src/vendor-fulfilment.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import {
  adminContext,
  check,
  customerContext,
  rejects,
  systemContext,
  vendorContext,
} from './verify-support.js';

/**
 * 11.2 -- the live order monitor finds an order, shows its whole history,
 * and acts on it only through previewed, confirmed, reasoned commands that
 * never touch its siblings.
 *
 * One checkout group, two shops: order A is accepted, picked and packed;
 * order B waits. The monitor filters them apart; A's history reads in time
 * order; B's partner is reassigned with compensation and B is cancelled while
 * the payment is only authorised; the payment is captured on A; a refund on A
 * is proposed for a second person; A goes into a return, which blocks a
 * cancellation and allows a directed return; the customer is messaged. Each
 * command is also tried unconfirmed, without its capability, and stale.
 */
export async function verifyOrderMonitor(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4, application_name: 'order-monitor-verifier' });
  const HASH_KEY = 'synthetic-verifier-handover-code-material';
  const inventory = new InventoryReservationService({ connection_string: connectionString });
  const catalogue = new CatalogueProductService({ connection_string: connectionString });
  const carts = new CustomerCartService({ connection_string: connectionString });
  const checkout = new GroupedCheckoutService({ connection_string: connectionString });
  const fulfilment = new VendorFulfilmentService({
    connection_string: connectionString,
    inventory,
    hash_key: HASH_KEY,
  });
  const assignments = new AssignmentCustodyService({
    connection_string: connectionString,
    hash_key: HASH_KEY,
  });
  const money = new MoneyLifecycleService({ connection_string: connectionString });
  const complete = new CompleteMoneyLifecycleService({ connection_string: connectionString });
  const orderMoney = new OrderMoneyOrchestrator({
    complete_money: complete,
    connection_string: connectionString,
    money,
  });
  const monitor = new OrderMonitorService({
    assignments,
    connection_string: connectionString,
    fulfilment,
    money,
  });
  // The walk's clock starts two minutes back. Steps stamped at `later(n)`
  // and steps that read the real clock touch the same orders; with the
  // walk's time already behind the wall clock (by more than any offset a
  // write uses), a real-clock step can never land before an earlier one,
  // however fast the machine runs. CI's did, on 9ed22dc.
  const now = new Date(Date.now() - 2 * 60_000);
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1_000);
  const people = {
    customer: createUuidV7(),
    support: createUuidV7(),
    finance: createUuidV7(),
    delivery: createUuidV7(),
    configurer: createUuidV7(),
    rider: createUuidV7(),
    system: createUuidV7(),
  };
  const grant = async (user: UuidV7, role: string) => {
    const assignment = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, granted_by_user_id,
          request_id, correlation_id, retention_review_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$5,$6,$4,$4)`,
      [assignment, user, role, later(-3_600), createUuidV7(), later(365 * 86_400)],
    );
    await pool.query(
      `INSERT INTO marketplace.admin_membership_scopes
         (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
       VALUES ($1,$2,$3,'GLOBAL',NULL,$4)`,
      [createUuidV7(), assignment, user, later(-3_600)],
    );
  };
  const support = adminContext(people.support);
  const finance = adminContext(people.finance);
  const delivery = adminContext(people.delivery);
  const configurer = adminContext(people.configurer);
  const attempt = async (
    order: { vendor_order_id: UuidV7; order_reference: string; vendor_location_id: UuidV7 },
    state: 'ASSIGNED' | 'RETURN_REQUIRED',
  ) => {
    const id = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id,source_order_reference,vendor_location_id,vendor_order_id,
         partner_user_id,assignment_state,custody_state,package_count,approximate_pickup_area,
         approximate_drop_area,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'SYNTH Monitor Store','SYNTH Monitor Drop',$8,$8,$9,$9)`,
      [
        id,
        order.order_reference,
        order.vendor_location_id,
        order.vendor_order_id,
        people.rider,
        state,
        state === 'ASSIGNED' ? 'NONE' : 'IN_CUSTODY',
        createUuidV7(),
        later(10),
      ],
    );
    if (state === 'ASSIGNED')
      await pool.query(
        `INSERT INTO marketplace.partner_assignment_memberships
          (partner_assignment_membership_id,user_id,delivery_assignment_id,state,activated_at,reason_code)
         VALUES ($1,$2,$3,'ACTIVE',$4,'PARTNER_ACCEPTED')`,
        [createUuidV7(), people.rider, id, later(-60)],
      );
    else
      await pool.query(
        `INSERT INTO marketplace.return_tasks
          (return_task_id,delivery_assignment_id,return_state,return_reason_code,expected_package_count)
         VALUES ($1,$2,'REQUIRED','DELIVERY_FAILED',1)`,
        [createUuidV7(), id],
      );
    return id;
  };
  const audited = async (id: string) =>
    (
      await pool.query<{
        action: string;
        reason_code: string;
        before_value: Record<string, unknown> | null;
        after_value: Record<string, unknown> | null;
        approval_reference: string | null;
      }>(
        `SELECT action, reason_code, before_value, after_value, approval_reference::text
           FROM marketplace.operational_audit_events WHERE operational_audit_event_id=$1`,
        [id],
      )
    ).rows[0];

  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) SELECT unnest($1::uuid[]),'ACTIVE','RESTRICTED'",
      [Object.values(people)],
    );
    await grant(people.support, 'SUPPORT_AGENT');
    await grant(people.finance, 'FINANCE_OPERATOR');
    await grant(people.delivery, 'DELIVERY_OPERATOR');
    await grant(people.configurer, 'CONFIG_OPERATOR');

    // One group, two shops.
    const stores = await Promise.all(
      ['M', 'N'].map((suffix, index) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Monitor Store ${suffix}`,
          latitude: 26.921 + index * 0.001,
          longitude: 75.821,
          fulfilment_modes: ['PLATFORM_DELIVERY'],
        }),
      ),
    );
    const variants: string[] = [];
    for (const [index, store] of stores.entries()) {
      const suffix = `${Date.now()}${index}`;
      const product = await catalogue.createProduct({
        context: vendorContext(store.ownerUserId),
        vendor_location_id: store.locationId,
        product_reference: `SYNTH-PROD-MON${suffix}`,
        title: `SYNTH Monitor Product ${index}`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-MON${suffix}`,
        variant_title: `SYNTH Monitor Variant ${index}`,
        price_minor: 15_000,
        initial_stock_quantity: 6,
        low_stock_threshold: 1,
        now,
      });
      variants.push(product.catalogue_variant_id);
    }
    const addressId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.customer_addresses
        (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH-ADDRESS-MONITOR-' || $4,'SYNTH Monitor Home','302020',
         ST_SetSRID(ST_MakePoint(75.825,26.921),4326)::geography,$3,$3)`,
      [
        addressId,
        people.customer,
        createUuidV7(),
        people.customer.replaceAll('-', '').slice(-10).toUpperCase(),
      ],
    );
    const shopper = customerContext(people.customer);
    const cart = await carts.currentCart({ context: shopper, now });
    await carts.setCartAddress({ context: shopper, customer_address_id: addressId, now });
    for (const [index, store] of stores.entries())
      await carts.addLine({
        context: shopper,
        vendor_location_id: store.locationId,
        catalogue_variant_id: variants[index] as UuidV7,
        quantity: 1,
        now,
      });
    const quote = await checkout.createQuote({ context: shopper, cart_id: cart.cart_id, now });
    const placed = await checkout.place({
      context: shopper,
      checkout_quote_id: quote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: `monitor-${people.customer}`,
      now: later(1),
    });
    const [orderA, orderB] = placed.orders;
    check(orderA && orderB, 'The fixture did not place two orders');
    const storeA = stores.find((store) => store.locationId === orderA.vendor_location_id);
    check(storeA, 'Store fixture lookup failed');
    const groupId = placed.checkout_group_id as UuidV7;

    // 1. Filters: by state and group; by shop, with the sibling counted, not shown.
    const byState = await monitor.monitor({
      context: support,
      filters: { state: 'PLACED', checkout_group_id: groupId },
      now: later(2),
    });
    check(
      byState.checkout_groups.length === 1 &&
        byState.checkout_groups[0]?.orders.length === 2 &&
        byState.checkout_groups[0].sibling_orders_not_shown === 0,
      `The monitor did not find the placed group (${JSON.stringify(byState)})`,
    );
    const byShop = await monitor.monitor({
      context: support,
      filters: { vendor_location_id: storeA.locationId as UuidV7, checkout_group_id: groupId },
      now: later(2),
    });
    check(
      byShop.checkout_groups[0]?.orders.length === 1 &&
        byShop.checkout_groups[0].orders[0]?.vendor_order_id === orderA.vendor_order_id &&
        byShop.checkout_groups[0].sibling_orders_not_shown === 1,
      `Filtering by shop brought the sibling into view (${JSON.stringify(byShop)})`,
    );
    const stalled = await monitor.monitor({
      context: support,
      filters: { exception: 'STALLED', checkout_group_id: groupId },
      now: later(24 * 3_600),
    });
    const fresh = await monitor.monitor({
      context: support,
      filters: { exception: 'STALLED', checkout_group_id: groupId },
      now: later(2),
    });
    const aged = await monitor.monitor({
      context: support,
      filters: { min_time_in_state_seconds: 3_600, checkout_group_id: groupId },
      now: later(2),
    });
    check(
      stalled.checkout_groups[0]?.orders.every((order) => order.exceptions.includes('STALLED')) &&
        stalled.checkout_groups[0].orders.length === 2 &&
        fresh.checkout_groups.length === 0 &&
        aged.checkout_groups.length === 0,
      'The exception and time-in-state filters did not separate a stalled order from a fresh one',
    );
    await rejects(
      () => monitor.monitor({ context: support, filters: { state: 'LOST' } }),
      OrderMonitorInputError,
      'An unknown state filter was accepted',
    );

    // A is accepted, picked and packed; B waits.
    const vendorA = vendorContext(storeA.ownerUserId);
    const accepted = await fulfilment.accept({
      context: vendorA,
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: orderA.version,
      preparation_estimate_seconds: 600,
      now: later(5),
    });
    const picking = await fulfilment.startPicking({
      context: vendorA,
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: accepted.version,
    });
    const lines = await pool.query<{
      vendor_order_line_id: UuidV7;
      quantity: number;
      unit_price_minor: string;
    }>(
      `SELECT vendor_order_line_id, quantity, unit_price_minor::text
         FROM marketplace.vendor_order_lines WHERE vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    for (const line of lines.rows)
      await fulfilment.markLineFound({
        context: vendorA,
        vendor_order_id: orderA.vendor_order_id,
        vendor_location_id: storeA.locationId,
        vendor_order_line_id: line.vendor_order_line_id,
        actual_quantity: line.quantity,
        actual_unit_price_minor: Number(line.unit_price_minor),
        expected_version: 0,
      });
    await fulfilment.markReady({
      context: vendorA,
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: picking.version,
      package_count: 1,
    });

    // 2. A's history, in time order, across its sources; the view is recorded.
    const history = await monitor.timeline({
      context: support,
      vendor_order_id: orderA.vendor_order_id,
    });
    const kinds = new Set(history.entries.map((entry) => entry.kind));
    const times = history.entries.map((entry) => new Date(entry.at).getTime());
    check(
      kinds.has('TRANSITION') &&
        kinds.has('PAYMENT') &&
        history.entries.some((entry) => entry.summary.startsWith('ACCEPTED')) &&
        times.every((time, index) => index === 0 || time >= (times[index - 1] ?? 0)) &&
        (await audited(history.trace.audit_event_id))?.action === 'ORDER_TIMELINE_VIEWED',
      `The order's history was not read in time order across its sources (${JSON.stringify([...kinds])})`,
    );

    // 3. Reassign B's partner, with compensation: confirmed, capable, current.
    const attemptB = await attempt(orderB, 'ASSIGNED');
    const reassignPreview = await monitor.preview({
      context: delivery,
      vendor_order_id: orderB.vendor_order_id,
      kind: 'REASSIGN',
      params: { compensation_minor: 1_500 },
    });
    check(
      reassignPreview.allowed &&
        reassignPreview.siblings.every((sibling) => !sibling.affected) &&
        reassignPreview.required_capability === 'admin.delivery.assignment_manage',
      `Reassigning an assigned attempt was not previewed as allowed (${JSON.stringify(reassignPreview)})`,
    );
    const reassign = {
      vendor_order_id: orderB.vendor_order_id,
      kind: 'REASSIGN',
      reason_code: 'PARTNER_UNREACHABLE',
      expected_order_version: reassignPreview.expected.order_version,
      expected_assignment_version: reassignPreview.expected.assignment_version ?? 0,
      params: { compensation_minor: 1_500 },
    };
    await rejects(
      () => monitor.intervene({ ...reassign, context: delivery, confirm: false }),
      OrderMonitorInputError,
      'An intervention ran without being confirmed',
    );
    await rejects(
      () => monitor.intervene({ ...reassign, context: configurer, confirm: true }),
      OrderMonitorAuthorizationError,
      'An intervention ran for an operator without its capability',
    );
    await rejects(
      () =>
        monitor.intervene({
          ...reassign,
          context: delivery,
          confirm: true,
          expected_assignment_version: reassign.expected_assignment_version + 1,
        }),
      OrderMonitorStateError,
      'An intervention ran against a stale preview',
    );
    const reassigned = await monitor.intervene({ ...reassign, context: delivery, confirm: true });
    const afterReassign = await pool.query<{
      assignment_state: string;
      compensation: string | null;
    }>(
      `SELECT attempt.assignment_state,
              (SELECT amount_minor::text FROM marketplace.partner_attempt_compensations c
                WHERE c.delivery_assignment_id = attempt.delivery_assignment_id) AS compensation
         FROM marketplace.delivery_assignments attempt WHERE attempt.delivery_assignment_id=$1`,
      [attemptB],
    );
    const reassignAudit = await audited(reassigned.audit_event_id);
    check(
      afterReassign.rows[0]?.assignment_state === 'UNASSIGNED' &&
        afterReassign.rows[0].compensation === '1500' &&
        reassignAudit?.action === 'ORDER_INTERVENTION_REASSIGN' &&
        reassignAudit.reason_code === 'PARTNER_UNREACHABLE' &&
        reassignAudit.before_value?.['assignment_state'] === 'ASSIGNED',
      `The reassignment did not release the partner with compensation on the record (${JSON.stringify({ ...afterReassign.rows[0], reassignAudit })})`,
    );

    // 4. Cancel B while the payment is authorised: B ends, A is untouched.
    const cancelPreview = await monitor.preview({
      context: support,
      vendor_order_id: orderB.vendor_order_id,
      kind: 'CANCEL',
    });
    check(
      cancelPreview.allowed &&
        cancelPreview.approval === 'NONE' &&
        cancelPreview.effects.some((effect) => effect.includes('authorisation shrinks')) &&
        cancelPreview.siblings.length === 1 &&
        cancelPreview.siblings[0]?.affected === false,
      `Cancelling a waiting order was not previewed with its money and its sibling (${JSON.stringify(cancelPreview)})`,
    );
    const authorisedBefore = await pool.query<{ amount_minor: string }>(
      `SELECT payment.amount_minor::text FROM marketplace.payment_transactions payment
         JOIN marketplace.checkout_groups grouping USING (payment_transaction_id)
        WHERE grouping.checkout_group_id=$1`,
      [groupId],
    );
    await monitor.intervene({
      context: support,
      vendor_order_id: orderB.vendor_order_id,
      kind: 'CANCEL',
      reason_code: 'SHOP_UNREACHABLE',
      confirm: true,
      expected_order_version: cancelPreview.expected.order_version,
    });
    const afterCancel = await pool.query<{
      b_state: string;
      a_state: string;
      actor_kind: string;
      amount_minor: string;
    }>(
      `SELECT (SELECT lifecycle_state FROM marketplace.vendor_orders WHERE vendor_order_id=$1) AS b_state,
              (SELECT lifecycle_state FROM marketplace.vendor_orders WHERE vendor_order_id=$2) AS a_state,
              (SELECT actor_kind FROM marketplace.vendor_order_events
                WHERE vendor_order_id=$1 AND event_type='CANCELLED') AS actor_kind,
              (SELECT payment.amount_minor::text FROM marketplace.payment_transactions payment
                 JOIN marketplace.checkout_groups grouping USING (payment_transaction_id)
                WHERE grouping.checkout_group_id=$3) AS amount_minor`,
      [orderB.vendor_order_id, orderA.vendor_order_id, groupId],
    );
    check(
      afterCancel.rows[0]?.b_state === 'CANCELLED' &&
        afterCancel.rows[0].a_state === 'READY' &&
        afterCancel.rows[0].actor_kind === 'admin' &&
        Number(afterCancel.rows[0].amount_minor) < Number(authorisedBefore.rows[0]?.amount_minor),
      `The cancellation did not end B alone, as operations, with the authorisation reduced (${JSON.stringify(afterCancel.rows[0])})`,
    );
    await rejects(
      () =>
        monitor.intervene({
          context: support,
          vendor_order_id: orderA.vendor_order_id,
          kind: 'COMMUNICATE',
          reason_code: 'KEEP_CUSTOMER_INFORMED',
          confirm: true,
          expected_order_version: 1,
          params: { message: 'UNDER_REVIEW' },
        }),
      OrderMonitorStateError,
      'An intervention ran against a stale order version',
    );
    const again = await monitor.preview({
      context: support,
      vendor_order_id: orderB.vendor_order_id,
      kind: 'CANCEL',
    });
    check(!again.allowed, 'A cancelled order was previewed as cancellable again');

    // 5. Capture A, then a refund on A is a proposal for a second person.
    const captured = await orderMoney.settleAuthorizationForOrder({
      context: systemContext(people.system),
      vendor_order_id: orderA.vendor_order_id,
      now: later(60),
    });
    check(captured === 'CAPTURED', `A's payment was not captured (${captured})`);
    const refundPreview = await monitor.preview({
      context: finance,
      vendor_order_id: orderA.vendor_order_id,
      kind: 'REFUND',
      params: { amount_minor: 500 },
    });
    check(
      refundPreview.allowed &&
        refundPreview.approval === 'SECOND_PERSON' &&
        refundPreview.money.refundable_minor > 500,
      `A refund on a captured order was not previewed with its approval (${JSON.stringify(refundPreview)})`,
    );
    await rejects(
      () =>
        monitor.intervene({
          context: support,
          vendor_order_id: orderA.vendor_order_id,
          kind: 'REFUND',
          reason_code: 'ITEM_DAMAGED',
          confirm: true,
          expected_order_version: refundPreview.expected.order_version,
          params: { amount_minor: 500 },
        }),
      OrderMonitorAuthorizationError,
      'A support agent proposed a refund without the finance capability',
    );
    const refunded = await monitor.intervene({
      context: finance,
      vendor_order_id: orderA.vendor_order_id,
      kind: 'REFUND',
      reason_code: 'ITEM_DAMAGED',
      confirm: true,
      expected_order_version: refundPreview.expected.order_version,
      params: { amount_minor: 500 },
    });
    const refundRow = await pool.query<{ refund_state: string; refund_total_minor: string }>(
      `SELECT refund_state, refund_total_minor::text FROM marketplace.refunds WHERE refund_id=$1`,
      [refunded.result['refund_id']],
    );
    const refundAudit = await audited(refunded.audit_event_id);
    check(
      refundRow.rows[0]?.refund_state === 'PENDING_APPROVAL' &&
        refundRow.rows[0].refund_total_minor === '500' &&
        refundAudit?.approval_reference === refunded.result['refund_id'],
      `The refund was not a proposal awaiting a second person, on the record (${JSON.stringify({ ...refundRow.rows[0], refundAudit })})`,
    );

    // 6. A goes into a return: cancelling is refused, a return is directed.
    const attemptA = await attempt(orderA, 'RETURN_REQUIRED');
    const blockedCancel = await monitor.preview({
      context: support,
      vendor_order_id: orderA.vendor_order_id,
      kind: 'CANCEL',
    });
    check(
      !blockedCancel.allowed && blockedCancel.custody === 'GOODS_WITH_PARTNER',
      `Cancelling an order whose goods a partner holds was allowed (${JSON.stringify(blockedCancel)})`,
    );
    const blockedReassign = await monitor.preview({
      context: delivery,
      vendor_order_id: orderA.vendor_order_id,
      kind: 'REASSIGN',
    });
    check(
      !blockedReassign.allowed,
      `Reassigning a partner who holds the goods was previewed as allowed (${JSON.stringify(blockedReassign)})`,
    );
    const returnPreview = await monitor.preview({
      context: delivery,
      vendor_order_id: orderA.vendor_order_id,
      kind: 'RETURN',
    });
    await monitor.intervene({
      context: delivery,
      vendor_order_id: orderA.vendor_order_id,
      kind: 'RETURN',
      reason_code: 'CUSTOMER_REFUSED',
      confirm: true,
      expected_order_version: returnPreview.expected.order_version,
      expected_assignment_version: returnPreview.expected.assignment_version ?? 0,
    });
    const afterReturn = await pool.query<{
      assignment_state: string;
      return_state: string;
      note: string | null;
    }>(
      `SELECT attempt.assignment_state, task.return_state, task.destination_note AS note
         FROM marketplace.delivery_assignments attempt
         JOIN marketplace.return_tasks task USING (delivery_assignment_id)
        WHERE attempt.delivery_assignment_id=$1`,
      [attemptA],
    );
    check(
      returnPreview.allowed &&
        afterReturn.rows[0]?.assignment_state === 'RETURN_AUTHORIZED' &&
        afterReturn.rows[0].return_state === 'AUTHORIZED' &&
        afterReturn.rows[0].note === null,
      `A directed return did not send the goods back to the shop (${JSON.stringify(afterReturn.rows[0])})`,
    );

    // 7. The customer is told, in a fixed message; free choice is refused.
    await rejects(
      () =>
        monitor.intervene({
          context: support,
          vendor_order_id: orderA.vendor_order_id,
          kind: 'COMMUNICATE',
          reason_code: 'KEEP_CUSTOMER_INFORMED',
          confirm: true,
          expected_order_version: returnPreview.expected.order_version,
          params: { message: 'ANYTHING_I_LIKE' },
        }),
      OrderMonitorStateError,
      'An operator sent a message outside the fixed set',
    );
    const told = await monitor.intervene({
      context: support,
      vendor_order_id: orderA.vendor_order_id,
      kind: 'COMMUNICATE',
      reason_code: 'KEEP_CUSTOMER_INFORMED',
      confirm: true,
      expected_order_version: returnPreview.expected.order_version,
      params: { message: 'DELAY_ACKNOWLEDGED' },
    });
    const notice = await pool.query<{ recipient_user_id: string; template_key: string }>(
      `SELECT recipient_user_id::text, template_key FROM marketplace.notification_intents
        WHERE notification_intent_id=$1`,
      [told.result['notification_intent_id']],
    );
    const afterHistory = await monitor.timeline({
      context: support,
      vendor_order_id: orderA.vendor_order_id,
    });
    check(
      notice.rows[0]?.recipient_user_id === people.customer &&
        notice.rows[0].template_key === 'operations_message.delay_acknowledged' &&
        afterHistory.entries.some(
          (entry) =>
            entry.kind === 'NOTIFICATION' &&
            entry.summary.startsWith('operations_message.delay_acknowledged'),
        ) &&
        afterHistory.entries.some((entry) => entry.kind === 'ASSIGNMENT') &&
        afterHistory.entries.some((entry) => entry.kind === 'LEDGER'),
      `The customer was not told, or the history does not show it (${JSON.stringify(notice.rows[0])})`,
    );
  } finally {
    await Promise.all([
      pool.end(),
      monitor.close(),
      orderMoney.close(),
      complete.close(),
      money.close(),
      assignments.close(),
      fulfilment.close(),
      checkout.close(),
      carts.close(),
      catalogue.close(),
      inventory.close(),
    ]);
  }
}
