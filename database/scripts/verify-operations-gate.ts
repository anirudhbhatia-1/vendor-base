import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { AdminControlPlaneService } from '../src/admin-control-plane.js';
import { AssignmentCustodyService } from '../src/assignment-custody.js';
import { AuditSearchService } from '../src/audit-search.js';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { CheckoutConflictError, GroupedCheckoutService } from '../src/grouped-checkout.js';
import { IncidentControlService } from '../src/incident-controls.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { MoneyLifecycleService, MoneyStateError } from '../src/money-lifecycle.js';
import { OrderMoneyOrchestrator } from '../src/order-money-orchestrator.js';
import { OrderMonitorService } from '../src/order-monitor.js';
import { SupportCaseService } from '../src/support-cases.js';
import { TrustReviewAuthorizationError, TrustReviewService } from '../src/trust-review.js';
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

const DAY = 24 * 60 * 60_000;

/**
 * Phase 11 exit gate -- operations resolve the launch scenarios through
 * controlled product actions (phases.md; implementation.md §13.2, 8 and
 * 10-13), walked end to end on one checkout.
 *
 * Each scenario arrives where the people who resolve it work -- their
 * dashboard shows it, and nobody else's does -- is resolved only by a
 * previewed, capability-checked command, leaves siblings, custody and the
 * ledger as they were, drops off the dashboard, and is on the audit under
 * the person who acted, who cannot erase it. No scenario is resolved by
 * writing to the database: the walk's own writes are its fixtures (a
 * partner already holding the goods) and nothing else.
 *
 *  - 10: support cancels one child order; its sibling is untouched.
 *  - 11: the customer's case reaches support; support proposes a protected
 *    refund, cannot approve it, finance approves, and support resolves the
 *    case on it.
 *  - 12: the case is a signal against the shop; trust reviews it, a second
 *    person decides, the shop appeals, and a third person decides the appeal.
 *  - 8: goods a partner holds after the customer refused are sent back by
 *    delivery operations, not cancelled.
 *  - 13: the shop is paused; new work there stops while the order, its
 *    custody and the ledger stay as they were; it is lifted on its checklist.
 */
export async function verifyOperationsGate(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4, application_name: 'operations-gate-verifier' });
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
  const support = new SupportCaseService({ connection_string: connectionString });
  const trust = new TrustReviewService({ connection_string: connectionString });
  const incidents = new IncidentControlService({ connection_string: connectionString });
  const control = new AdminControlPlaneService({ connection_string: connectionString });
  const audit = new AuditSearchService({ connection_string: connectionString });
  const now = new Date(Date.now() - 2 * 60_000);
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1_000);
  const people = {
    customer: createUuidV7(),
    newcomer: createUuidV7(),
    agent: createUuidV7(),
    finance: createUuidV7(),
    delivery: createUuidV7(),
    trustOperator: createUuidV7(),
    trustApprover: createUuidV7(),
    appealDecider: createUuidV7(),
    commander: createUuidV7(),
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
  const as = (user: UuidV7) => adminContext(user);
  /** What an operator's dashboard shows: its queues and the objects on them. */
  const board = async (user: UuidV7, at: Date) => {
    const view = await control.dashboard({ context: as(user), now: at });
    return {
      queues: view.queues,
      has: (kind: string, id: string) =>
        view.items.some((item) => item.kind === kind && item.object_id === id),
    };
  };
  const orderState = async (id: string) =>
    (
      await pool.query<{ lifecycle_state: string; version: number }>(
        'SELECT lifecycle_state, version FROM marketplace.vendor_orders WHERE vendor_order_id=$1',
        [id],
      )
    ).rows[0];

  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) SELECT unnest($1::uuid[]),'ACTIVE','RESTRICTED'",
      [Object.values(people)],
    );
    await grant(people.agent, 'SUPPORT_AGENT');
    await grant(people.finance, 'FINANCE_APPROVER');
    await grant(people.delivery, 'DELIVERY_OPERATOR');
    await grant(people.trustOperator, 'TRUST_OPERATOR');
    await grant(people.trustApprover, 'TRUST_APPROVER');
    await grant(people.appealDecider, 'TRUST_APPROVER');
    await grant(people.commander, 'INCIDENT_COMMANDER');

    // One checkout across two shops.
    const stores = await Promise.all(
      ['P', 'Q'].map((suffix, index) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Gate Store ${suffix}`,
          latitude: 26.951 + index * 0.001,
          longitude: 75.851,
          fulfilment_modes: ['PLATFORM_DELIVERY'],
        }),
      ),
    );
    const [storeP, storeQ] = stores;
    check(storeP && storeQ, 'Store fixtures missing');
    const variants: UuidV7[] = [];
    for (const [index, store] of stores.entries()) {
      const suffix = `${Date.now()}${index}`;
      const product = await catalogue.createProduct({
        context: vendorContext(store.ownerUserId),
        vendor_location_id: store.locationId,
        product_reference: `SYNTH-PROD-GATE${suffix}`,
        title: `SYNTH Gate Product ${index}`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-GATE${suffix}`,
        variant_title: `SYNTH Gate Variant ${index}`,
        price_minor: 15_000,
        initial_stock_quantity: 10,
        low_stock_threshold: 1,
        now,
      });
      variants.push(product.catalogue_variant_id as UuidV7);
    }
    const basket = async (customer: UuidV7, storeIndexes: readonly number[], at: Date) => {
      const addressId = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.customer_addresses
          (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
         VALUES ($1,$2,'SYNTH-ADDRESS-GATE-' || $4,'SYNTH Gate Home','302020',
           ST_SetSRID(ST_MakePoint(75.855,26.951),4326)::geography,$3,$3)`,
        [
          addressId,
          customer,
          createUuidV7(),
          customer.replaceAll('-', '').slice(-10).toUpperCase(),
        ],
      );
      const shopper = customerContext(customer);
      const cart = await carts.currentCart({ context: shopper, now: at });
      await carts.setCartAddress({ context: shopper, customer_address_id: addressId, now: at });
      for (const index of storeIndexes) {
        const store = stores[index];
        const variant = variants[index];
        check(store && variant, 'Basket fixture missing');
        await carts.addLine({
          context: shopper,
          vendor_location_id: store.locationId,
          catalogue_variant_id: variant,
          quantity: 1,
          now: at,
        });
      }
      return { shopper, cart_id: cart.cart_id };
    };
    const first = await basket(people.customer, [0, 1], later(5));
    const quote = await checkout.createQuote({
      context: first.shopper,
      cart_id: first.cart_id,
      now: later(5),
    });
    const placed = await checkout.place({
      context: first.shopper,
      checkout_quote_id: quote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: `gate-${people.customer}`,
      now: later(6),
    });
    const orderA = placed.orders.find((order) => order.vendor_location_id === storeP.locationId);
    const orderB = placed.orders.find((order) => order.vendor_location_id === storeQ.locationId);
    check(orderA && orderB, 'The checkout did not place an order at each shop');

    // Scenario 10 -- support ends one child order; its sibling is untouched.
    const cancelPreview = await monitor.preview({
      context: as(people.agent),
      vendor_order_id: orderB.vendor_order_id,
      kind: 'CANCEL',
    });
    check(
      cancelPreview.allowed && cancelPreview.siblings.every((sibling) => !sibling.affected),
      `Cancelling one child was not previewed as leaving its sibling (${JSON.stringify(cancelPreview)})`,
    );
    const siblingBefore = await orderState(orderA.vendor_order_id);
    await monitor.intervene({
      context: as(people.agent),
      vendor_order_id: orderB.vendor_order_id,
      kind: 'CANCEL',
      reason_code: 'SHOP_UNREACHABLE',
      confirm: true,
      expected_order_version: cancelPreview.expected.order_version,
    });
    const siblingAfter = await orderState(orderA.vendor_order_id);
    check(
      (await orderState(orderB.vendor_order_id))?.lifecycle_state === 'CANCELLED' &&
        JSON.stringify(siblingAfter) === JSON.stringify(siblingBefore),
      'Cancelling one child order changed its sibling',
    );

    // A is packed and its payment captured.
    const vendorP = vendorContext(storeP.ownerUserId);
    const accepted = await fulfilment.accept({
      context: vendorP,
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeP.locationId,
      expected_version: orderA.version,
      preparation_estimate_seconds: 600,
      now: later(10),
    });
    const picking = await fulfilment.startPicking({
      context: vendorP,
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeP.locationId,
      expected_version: accepted.version,
    });
    const lines = await pool.query<{
      vendor_order_line_id: UuidV7;
      quantity: number;
      unit_price_minor: string;
    }>(
      'SELECT vendor_order_line_id, quantity, unit_price_minor::text FROM marketplace.vendor_order_lines WHERE vendor_order_id=$1',
      [orderA.vendor_order_id],
    );
    for (const line of lines.rows)
      await fulfilment.markLineFound({
        context: vendorP,
        vendor_order_id: orderA.vendor_order_id,
        vendor_location_id: storeP.locationId,
        vendor_order_line_id: line.vendor_order_line_id,
        actual_quantity: line.quantity,
        actual_unit_price_minor: Number(line.unit_price_minor),
        expected_version: 0,
      });
    await fulfilment.markReady({
      context: vendorP,
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeP.locationId,
      expected_version: picking.version,
      package_count: 1,
    });
    const captured = await orderMoney.settleAuthorizationForOrder({
      context: systemContext(people.system),
      vendor_order_id: orderA.vendor_order_id,
      now: later(20),
    });
    check(captured === 'CAPTURED', `A's payment was not captured (${captured})`);

    // Scenario 11 -- the customer's case reaches support, and only support.
    const line = lines.rows[0];
    check(line, 'Order A has no line');
    const opened = await support.open({
      context: first.shopper,
      vendor_order_id: orderA.vendor_order_id,
      vendor_order_line_id: line.vendor_order_line_id,
      category: 'DAMAGED_ITEM',
      description: 'SYNTH the tomatoes arrived crushed',
      now: later(30),
    });
    const caseId = opened.support_case_id;
    const agentBoard = await board(people.agent, later(31));
    const financeBoard = await board(people.finance, later(31));
    check(
      agentBoard.has('SUPPORT', caseId) && !financeBoard.has('SUPPORT', caseId),
      'The customer case did not reach support, or reached finance',
    );
    // Support proposes the protected refund; it cannot approve it.
    const refundPreview = await monitor.preview({
      context: as(people.agent),
      vendor_order_id: orderA.vendor_order_id,
      kind: 'REFUND',
      params: { amount_minor: 1_500 },
    });
    check(
      refundPreview.allowed && refundPreview.approval === 'SECOND_PERSON',
      `Support could not propose a refund, or it did not need a second person (${JSON.stringify(refundPreview)})`,
    );
    const proposed = await monitor.intervene({
      context: as(people.agent),
      vendor_order_id: orderA.vendor_order_id,
      kind: 'REFUND',
      reason_code: 'ITEM_DAMAGED',
      confirm: true,
      expected_order_version: refundPreview.expected.order_version,
      params: { amount_minor: 1_500 },
    });
    const refundId = String(proposed.result['refund_id']) as UuidV7;
    const refundVersion = async () =>
      (
        await pool.query<{ version: number; refund_state: string }>(
          'SELECT version, refund_state FROM marketplace.refunds WHERE refund_id=$1',
          [refundId],
        )
      ).rows[0];
    const pending = await refundVersion();
    check(
      pending?.refund_state === 'PENDING_APPROVAL',
      'The refund was not a proposal awaiting approval',
    );
    check(
      (await board(people.finance, later(40))).has('REFUND', refundId) &&
        !(await board(people.agent, later(40))).queues.includes('REFUND_APPROVAL'),
      'The refund awaiting approval did not reach finance, or reached support',
    );
    await rejects(
      () =>
        money.approveAndSubmitRefund({
          command_reference: `SYNTH-CMD-GATE-SELF-${refundId.slice(-12).toUpperCase()}`,
          context: as(people.agent),
          expected_version: pending.version,
          refund_id: refundId,
          now: later(41),
        }),
      MoneyStateError,
      'Support approved the refund it proposed',
    );
    await money.approveAndSubmitRefund({
      command_reference: `SYNTH-CMD-GATE-APPROVE-${refundId.slice(-12).toUpperCase()}`,
      context: as(people.finance),
      expected_version: pending.version,
      refund_id: refundId,
      now: later(42),
    });
    check(
      (await refundVersion())?.refund_state === 'SUCCEEDED' &&
        !(await board(people.finance, later(43))).has('REFUND', refundId),
      'Finance approval did not refund the customer and clear the approval queue',
    );
    const caseRow = async () =>
      (
        await pool.query<{
          version: number;
          lifecycle_state: string;
          resolution_refund_id: string | null;
        }>(
          'SELECT version, lifecycle_state, resolution_refund_id::text FROM marketplace.support_cases WHERE support_case_id=$1',
          [caseId],
        )
      ).rows[0];
    const beforeResolve = await caseRow();
    check(beforeResolve, 'The support case is missing');
    await support.act({
      context: as(people.agent),
      support_case_id: caseId,
      action: 'RESOLVE',
      expected_version: beforeResolve.version,
      reason_code: 'REFUND_APPROVED',
      resolution_code: 'REFUNDED',
      refund_id: refundId,
      body: 'We refunded the crushed tomatoes.',
      now: later(44),
    });
    const resolved = await caseRow();
    check(
      resolved?.lifecycle_state === 'RESOLVED' &&
        resolved.resolution_refund_id === refundId &&
        !(await board(people.agent, later(45))).has('SUPPORT', caseId),
      'Support did not resolve the case on the approved refund, or it stayed on the queue',
    );

    // Scenario 12 -- the case is a signal against the shop; nothing restricts
    // it until a second person decides, and the shop can appeal.
    await trust.collectSignals({ context: systemContext(people.system), now: later(50) });
    const dossier = await trust.dossier({
      context: as(people.trustOperator),
      subject_kind: 'VENDOR_LOCATION',
      subject_reference: storeP.locationId,
      now: later(51),
    });
    const signal = dossier.signals.find(
      (candidate) => candidate.signal_kind === 'ITEM_COMPLAINT_CASE',
    );
    check(signal, 'The damaged-item case did not become a signal against the shop');
    const proposal = await trust.propose({
      context: as(people.trustOperator),
      subject_kind: 'VENDOR_LOCATION',
      subject_reference: storeP.locationId,
      scope_kind: 'CATEGORY',
      scope_reference: 'FRUIT_VEGETABLE',
      reason_code: 'DAMAGED_PRODUCE_REPORTS',
      policy_reference: 'SYNTH-POLICY-PRODUCE-1',
      signal_ids: [signal.trust_signal_id as UuidV7],
      evidence_reference: 'SYNTH-EVIDENCE-PHOTO-GATE-1',
      effective_until: new Date(later(52).getTime() + 3 * DAY),
      review_at: new Date(later(52).getTime() + 2 * DAY),
      now: later(52),
    });
    const trustId = proposal.trust_restriction_case_id as UuidV7;
    check(
      (await board(people.trustApprover, later(53))).has('TRUST', trustId) &&
        !(await board(people.agent, later(53))).has('TRUST', trustId),
      'The proposed restriction did not reach trust approvers, or reached support',
    );
    const trustAct = (
      user: UuidV7,
      action: string,
      version: number,
      at: Date,
      fields: Record<string, unknown> = {},
    ) =>
      trust.act({
        context: as(user),
        trust_restriction_case_id: trustId,
        action,
        expected_version: version,
        reason_code: `GATE_${action}`,
        now: at,
        ...fields,
      });
    await rejects(
      () => trustAct(people.trustOperator, 'APPROVE', 1, later(54)),
      TrustReviewAuthorizationError,
      'The operator who proposed the restriction approved it',
    );
    const approved = await trustAct(people.trustApprover, 'APPROVE', 1, later(55));
    await trust.appeal({
      context: vendorP,
      trust_restriction_case_id: trustId,
      vendor_location_id: storeP.locationId,
      statement: 'SYNTH the produce left us whole; the crate was crushed in transit.',
      now: later(56),
    });
    const appealed = await trust.detail({
      context: as(people.appealDecider),
      trust_restriction_case_id: trustId,
      now: later(57),
    });
    const overturned = await trustAct(
      people.appealDecider,
      'DECIDE_APPEAL',
      appealed.version,
      later(58),
      {
        outcome: 'OVERTURN',
      },
    );
    const decisions = await pool.query<{ approved_by_user_id: string; lifecycle_state: string }>(
      'SELECT approved_by_user_id::text, lifecycle_state FROM marketplace.trust_restriction_cases WHERE trust_restriction_case_id=$1',
      [trustId],
    );
    check(
      approved.lifecycle_state === 'ACTIVE' &&
        overturned.lifecycle_state !== 'ACTIVE' &&
        decisions.rows[0]?.approved_by_user_id === people.trustApprover,
      `The restriction was not decided by a second person and lifted on appeal (${JSON.stringify(decisions.rows[0])})`,
    );

    // Scenario 8 -- the customer refused at the door with the goods on a
    // partner: delivery operations send them back; nobody can cancel them.
    const attemptId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id,source_order_reference,vendor_location_id,vendor_order_id,
         partner_user_id,assignment_state,custody_state,package_count,approximate_pickup_area,
         approximate_drop_area,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'RETURN_REQUIRED','IN_CUSTODY',1,'SYNTH Gate Store','SYNTH Gate Drop',$6,$6,$7,$7)`,
      [
        attemptId,
        orderA.order_reference,
        storeP.locationId,
        orderA.vendor_order_id,
        people.rider,
        createUuidV7(),
        later(60),
      ],
    );
    await pool.query(
      `INSERT INTO marketplace.return_tasks
        (return_task_id,delivery_assignment_id,return_state,return_reason_code,expected_package_count)
       VALUES ($1,$2,'REQUIRED','DELIVERY_FAILED',1)`,
      [createUuidV7(), attemptId],
    );
    const noCancel = await monitor.preview({
      context: as(people.agent),
      vendor_order_id: orderA.vendor_order_id,
      kind: 'CANCEL',
    });
    const returnPreview = await monitor.preview({
      context: as(people.delivery),
      vendor_order_id: orderA.vendor_order_id,
      kind: 'RETURN',
    });
    await monitor.intervene({
      context: as(people.delivery),
      vendor_order_id: orderA.vendor_order_id,
      kind: 'RETURN',
      reason_code: 'CUSTOMER_REFUSED',
      confirm: true,
      expected_order_version: returnPreview.expected.order_version,
      expected_assignment_version: returnPreview.expected.assignment_version ?? 0,
    });
    const custody = async () =>
      (
        await pool.query<{
          assignment_state: string;
          custody_state: string;
          partner_user_id: string;
        }>(
          'SELECT assignment_state, custody_state, partner_user_id::text FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1',
          [attemptId],
        )
      ).rows[0];
    const returning = await custody();
    check(
      !noCancel.allowed &&
        returnPreview.allowed &&
        returning?.assignment_state === 'RETURN_AUTHORIZED' &&
        returning.custody_state === 'IN_CUSTODY' &&
        returning.partner_user_id === people.rider,
      `Goods with a partner were cancellable, or the return was not directed with custody kept (${JSON.stringify(returning)})`,
    );

    // Scenario 13 -- the shop is paused: new work there stops; the order, its
    // custody and the ledger stay as they were; it is lifted on its checklist.
    const snapshot = async () =>
      JSON.stringify({
        ledger: (
          await pool.query(
            'SELECT count(*)::text AS n, COALESCE(sum(debit_minor),0)::text AS debits FROM marketplace.ledger_entries',
          )
        ).rows,
        order: await orderState(orderA.vendor_order_id),
        custody: await custody(),
        refund: await refundVersion(),
      });
    const beforePause = await snapshot();
    const pause = await incidents.engage({
      context: as(people.commander),
      control_key: 'VENDOR_PAUSE',
      scope_kind: 'VENDOR_LOCATION',
      scope_reference: storeP.locationId,
      reason_code: 'PRODUCE_QUALITY_CHECK',
      banner: 'SYNTH This shop is not taking new orders while we check its produce.',
      expires_at: later(70 + 3_600),
      review_at: later(70 + 1_800),
      now: later(70),
    });
    check(
      (await board(people.commander, later(71))).has('INCIDENT', pause.incident_control_id),
      'The pause is not on the commander’s dashboard',
    );
    const newcomer = await basket(people.newcomer, [0], later(72));
    let blocked = false;
    try {
      await checkout.createQuote({
        context: newcomer.shopper,
        cart_id: newcomer.cart_id,
        now: later(72),
      });
    } catch (error) {
      blocked = error instanceof CheckoutConflictError;
    }
    let control_: { version: number; recovery_checklist: readonly unknown[] } =
      await incidents.detail({
        context: as(people.commander),
        incident_control_id: pause.incident_control_id as UuidV7,
        now: later(80),
      });
    for (const [index] of control_.recovery_checklist.entries())
      control_ = await incidents.act({
        context: as(people.commander),
        incident_control_id: pause.incident_control_id as UuidV7,
        action: 'CHECK',
        item_index: index,
        expected_version: control_.version,
        reason_code: 'CHECKED',
        now: later(80),
      });
    await incidents.act({
      context: as(people.commander),
      incident_control_id: pause.incident_control_id as UuidV7,
      action: 'REVOKE',
      expected_version: control_.version,
      reason_code: 'PRODUCE_CHECKED',
      now: later(81),
    });
    const reopened = await checkout.createQuote({
      context: newcomer.shopper,
      cart_id: newcomer.cart_id,
      now: later(82),
    });
    check(
      blocked &&
        (await snapshot()) === beforePause &&
        reopened.groups.length === 1 &&
        !(await board(people.commander, later(83))).has('INCIDENT', pause.incident_control_id),
      'The pause did not stop new work alone, changed the order, custody or ledger, or outlived its lifting',
    );

    // Every resolution is on the audit under the person who acted, found by
    // them, and none of them can erase it.
    const actionsOf = async (actor: UuidV7) =>
      new Set(
        (
          await audit.search({
            context: as(people.commander),
            filters: { actor_id: actor, from: later(-60), to: new Date(Date.now() + 5 * 60_000) },
            limit: 200,
            now: later(90),
          })
        ).entries.map((entry) => entry.action),
      );
    const expected: readonly [UuidV7, readonly string[]][] = [
      [
        people.agent,
        [
          'ORDER_INTERVENTION_CANCEL',
          'ORDER_INTERVENTION_REFUND',
          'REFUND_PROPOSED',
          'SUPPORT_CASE_RESOLVE',
        ],
      ],
      [people.finance, ['REFUND_APPROVED']],
      [people.trustOperator, ['TRUST_RESTRICTION_PROPOSED']],
      [people.trustApprover, ['TRUST_RESTRICTION_APPROVED']],
      [people.appealDecider, ['TRUST_RESTRICTION_APPEAL_OVERTURNED']],
      [people.delivery, ['ORDER_INTERVENTION_RETURN']],
      [people.commander, ['INCIDENT_CONTROL_ENGAGED', 'INCIDENT_CONTROL_REVOKE']],
    ];
    for (const [actor, actions] of expected) {
      const found = await actionsOf(actor);
      const missing = actions.filter((action) => !found.has(action));
      check(
        missing.length === 0,
        `Resolutions missing from the audit: ${missing.join(', ')} (found ${[...found].join(', ')})`,
      );
    }
    const approval = await audit.search({
      context: as(people.commander),
      filters: {
        approval_reference: refundId,
        from: later(-60),
        to: new Date(Date.now() + 5 * 60_000),
      },
      now: later(90),
    });
    check(
      ['REFUND_PROPOSED', 'REFUND_APPROVED'].every((action) =>
        approval.entries.some((entry) => entry.action === action),
      ),
      'The refund’s proposal and approval are not found by its approval reference',
    );
    let erased = true;
    try {
      await pool.query(
        `DELETE FROM marketplace.operational_audit_events WHERE actor_id=$1 AND action='REFUND_APPROVED'`,
        [people.finance],
      );
    } catch (error) {
      erased = (error as { code?: string }).code !== '55000';
    }
    check(!erased, 'The approver erased their own approval from the audit');
  } finally {
    await Promise.all([
      pool.end(),
      audit.close(),
      control.close(),
      incidents.close(),
      trust.close(),
      support.close(),
      monitor.close(),
      orderMoney.close?.(),
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
