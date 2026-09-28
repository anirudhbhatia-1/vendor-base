import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { AdminControlPlaneService } from '../src/admin-control-plane.js';
import { AssignmentCustodyService } from '../src/assignment-custody.js';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { GroupedCheckoutService } from '../src/grouped-checkout.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { MoneyLifecycleService } from '../src/money-lifecycle.js';
import { OrderMoneyOrchestrator } from '../src/order-money-orchestrator.js';
import { OrderMonitorService } from '../src/order-monitor.js';
import {
  SupportCaseAuthorizationError,
  SupportCaseInputError,
  SupportCaseNotFoundError,
  SupportCaseService,
  SupportCaseStateError,
} from '../src/support-cases.js';
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * 11.3 -- a support case from the customer's report to its quality review.
 *
 * One checkout group, two shops; order A is packed, captured and handed to a
 * delivery that comes back. The customer reports a missing item twice and it
 * is one case; the worker opens a case on the returned delivery and the
 * customer can read it. Operations assign, note, reply, ask, and escalate;
 * the customer answers; evidence is attached; the case resolves only with an
 * approved refund and is reviewed by someone else; the customer's reply
 * reopens it on its own timeline; a duplicate is merged and the customer's
 * words follow it. Each step is also tried in the wrong state, stale, by the
 * wrong person, and with the wrong inputs.
 */
export async function verifySupportCases(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4, application_name: 'support-case-verifier' });
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
  const control = new AdminControlPlaneService({ connection_string: connectionString });
  const cases = new SupportCaseService({ connection_string: connectionString });
  const now = new Date();
  const later = (ms: number) => new Date(now.getTime() + ms);
  const people = {
    customer: createUuidV7(),
    stranger: createUuidV7(),
    agent: createUuidV7(),
    reviewer: createUuidV7(),
    commander: createUuidV7(),
    finance: createUuidV7(),
    approver: createUuidV7(),
    outsider: createUuidV7(),
    trainee: createUuidV7(),
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
      [assignment, user, role, later(-HOUR), createUuidV7(), later(365 * 24 * HOUR)],
    );
    await pool.query(
      `INSERT INTO marketplace.admin_membership_scopes
         (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
       VALUES ($1,$2,$3,'GLOBAL',NULL,$4)`,
      [createUuidV7(), assignment, user, later(-HOUR)],
    );
  };
  const agent = adminContext(people.agent);
  const reviewer = adminContext(people.reviewer);
  const commander = adminContext(people.commander);
  const outsider = adminContext(people.outsider);
  const trainee = adminContext(people.trainee);
  const shopper = customerContext(people.customer);
  const stranger = customerContext(people.stranger);
  const row = async (id: string) =>
    (
      await pool.query<{
        lifecycle_state: string;
        severity: string;
        awaiting: string;
        owner_user_id: string | null;
        owner_team: string | null;
        response_due_at: Date | null;
        response_clock_started_at: Date | null;
        first_responded_at: Date | null;
        customer_user_id: string;
        delivery_assignment_id: string | null;
        merged_into_case_id: string | null;
        resolution_code: string | null;
        resolution_refund_id: string | null;
        resolved_by_user_id: string | null;
        quality_review_outcome: string | null;
        reopen_count: number;
        version: number;
      }>('SELECT * FROM marketplace.support_cases WHERE support_case_id=$1', [id])
    ).rows[0];
  const events = async (id: string) =>
    (
      await pool.query<{ event_type: string }>(
        `SELECT event_type FROM marketplace.support_case_events WHERE support_case_id=$1
          ORDER BY occurred_at, support_case_event_id`,
        [id],
      )
    ).rows.map((entry) => entry.event_type);
  const notices = async (id: string) =>
    (
      await pool.query<{ template_key: string; recipient_user_id: string }>(
        `SELECT template_key, recipient_user_id FROM marketplace.notification_intents
          WHERE source_kind='support_case' AND source_id=$1 ORDER BY created_at`,
        [id],
      )
    ).rows;

  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) SELECT unnest($1::uuid[]),'ACTIVE','RESTRICTED'",
      [Object.values(people)],
    );
    await grant(people.agent, 'SUPPORT_AGENT');
    await grant(people.reviewer, 'SUPPORT_AGENT');
    await grant(people.commander, 'INCIDENT_COMMANDER');
    await grant(people.finance, 'FINANCE_OPERATOR');
    await grant(people.approver, 'FINANCE_APPROVER');
    await grant(people.outsider, 'CONFIG_OPERATOR');
    // Someone who works cases but has not been cleared to review them.
    await pool.query(
      `INSERT INTO marketplace.roles (role_key, actor_kind, assignment_scope, description)
       VALUES ('SYNTH_SUPPORT_TRAINEE','ADMIN','ADMIN_SCOPE','SYNTH support trainee')
       ON CONFLICT (role_key) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO marketplace.role_capabilities (role_key, capability_key)
       VALUES ('SYNTH_SUPPORT_TRAINEE','admin.support.case_manage') ON CONFLICT DO NOTHING`,
    );
    await grant(people.trainee, 'SYNTH_SUPPORT_TRAINEE');

    // One group, two shops; A is packed and captured.
    const stores = await Promise.all(
      ['S', 'T'].map((suffix, index) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Support Store ${suffix}`,
          latitude: 26.931 + index * 0.001,
          longitude: 75.831,
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
        product_reference: `SYNTH-PROD-SUP${suffix}`,
        title: `SYNTH Support Product ${index}`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-SUP${suffix}`,
        variant_title: `SYNTH Support Variant ${index}`,
        price_minor: 12_000,
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
       VALUES ($1,$2,'SYNTH-ADDRESS-SUPPORT-' || $4,'SYNTH Support Home','302020',
         ST_SetSRID(ST_MakePoint(75.835,26.931),4326)::geography,$3,$3)`,
      [
        addressId,
        people.customer,
        createUuidV7(),
        people.customer.replaceAll('-', '').slice(-10).toUpperCase(),
      ],
    );
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
      idempotency_key: `support-${people.customer}`,
      now: later(1_000),
    });
    const [orderA, orderB] = placed.orders;
    check(orderA && orderB, 'The fixture did not place two orders');
    const storeA = stores.find((store) => store.locationId === orderA.vendor_location_id);
    check(storeA, 'Store fixture lookup failed');
    const vendorA = vendorContext(storeA.ownerUserId);
    const accepted = await fulfilment.accept({
      context: vendorA,
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: orderA.version,
      preparation_estimate_seconds: 600,
      now: later(5_000),
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
    const lineA = lines.rows[0]?.vendor_order_line_id;
    check(lineA, 'Order A has no line');
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
    // B is called off while A is packed, so A's payment can be captured alone.
    const cancelB = await monitor.preview({
      context: agent,
      vendor_order_id: orderB.vendor_order_id,
      kind: 'CANCEL',
    });
    await monitor.intervene({
      context: agent,
      vendor_order_id: orderB.vendor_order_id,
      kind: 'CANCEL',
      reason_code: 'SHOP_UNREACHABLE',
      confirm: true,
      expected_order_version: cancelB.expected.order_version,
      now: later(50_000),
    });
    const captured = await orderMoney.settleAuthorizationForOrder({
      context: systemContext(people.system),
      vendor_order_id: orderA.vendor_order_id,
      now: later(60_000),
    });
    check(captured === 'CAPTURED', `A's payment was not captured (${captured})`);
    // A refund on A, proposed by finance, waits for a second person.
    const refundPreview = await monitor.preview({
      context: adminContext(people.finance),
      vendor_order_id: orderA.vendor_order_id,
      kind: 'REFUND',
      params: { amount_minor: 1_000 },
    });
    const proposed = await monitor.intervene({
      context: adminContext(people.finance),
      vendor_order_id: orderA.vendor_order_id,
      kind: 'REFUND',
      reason_code: 'ITEM_MISSING',
      confirm: true,
      expected_order_version: refundPreview.expected.order_version,
      params: { amount_minor: 1_000 },
      now: later(61_000),
    });
    const refundId = proposed.result['refund_id'] as UuidV7;
    const attemptA = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id,source_order_reference,vendor_location_id,vendor_order_id,
         partner_user_id,assignment_state,custody_state,package_count,approximate_pickup_area,
         approximate_drop_area,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'RETURN_REQUIRED','IN_CUSTODY',1,'SYNTH Support Store',
         'SYNTH Support Drop',$6,$6,$7,$7)`,
      [
        attemptA,
        orderA.order_reference,
        orderA.vendor_location_id,
        orderA.vendor_order_id,
        people.rider,
        createUuidV7(),
        later(70_000),
      ],
    );
    await pool.query(
      `INSERT INTO marketplace.return_tasks
        (return_task_id,delivery_assignment_id,return_state,return_reason_code,expected_package_count)
       VALUES ($1,$2,'REQUIRED','DELIVERY_FAILED',1)`,
      [createUuidV7(), attemptA],
    );

    // 1. A structured case: categories, severity and the subject are the server's.
    const t0 = later(2 * MINUTE);
    const openAs = (context = shopper, fields: Record<string, unknown> = {}) =>
      cases.open({
        context,
        vendor_order_id: orderA.vendor_order_id,
        category: 'MISSING_ITEM',
        description: 'SYNTH the apples were not in the bag.',
        vendor_order_line_id: lineA,
        now: t0,
        ...fields,
      });
    await rejects(
      () => openAs(shopper, { category: 'NOT_A_CATEGORY' }),
      SupportCaseInputError,
      'A made-up category opened a case',
    );
    await rejects(
      () => openAs(shopper, { category: 'PAYMENT_ISSUE', vendor_order_line_id: null }),
      SupportCaseInputError,
      "A customer opened a case in operations' own category",
    );
    await rejects(
      () => openAs(shopper, { severity: 'CRITICAL' }),
      SupportCaseInputError,
      'A customer chose the severity of their case',
    );
    await rejects(
      () => openAs(shopper, { category: 'LATE_DELIVERY' }),
      SupportCaseInputError,
      'A late delivery was attached to an item instead of the delivery',
    );
    await rejects(
      () => openAs(stranger),
      SupportCaseNotFoundError,
      "A customer opened a case on someone else's order",
    );
    await rejects(
      () => openAs(outsider, { severity: 'LOW' }),
      SupportCaseAuthorizationError,
      'An admin without the support capability opened a case',
    );
    const first = await openAs();
    const opened = await row(first.support_case_id);
    check(
      !first.deduplicated &&
        opened?.severity === 'MEDIUM' &&
        opened.owner_team === 'QUEUE_OWNER' &&
        opened.awaiting === 'OPERATIONS' &&
        opened.customer_user_id === people.customer &&
        opened.response_due_at?.getTime() === t0.getTime() + 4 * HOUR &&
        opened.response_clock_started_at?.getTime() === t0.getTime(),
      `The case did not open at medium with the queue owner and the P2 deadline (${JSON.stringify(opened)})`,
    );
    const orderEvent = await pool.query<{ actor_kind: string }>(
      `SELECT actor_kind FROM marketplace.vendor_order_events
        WHERE vendor_order_id=$1 AND event_type='SUPPORT_CASE_OPENED'`,
      [orderA.vendor_order_id],
    );
    check(
      orderEvent.rows.length === 1 && orderEvent.rows[0]?.actor_kind === 'customer',
      "The order's history does not say a case was opened",
    );

    // 2. The same trouble again is the same case, with what was said kept.
    const again = await openAs(shopper, {
      description: 'SYNTH still no apples.',
      now: later(3 * MINUTE),
    });
    const openCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.support_cases
        WHERE vendor_order_id=$1 AND category='MISSING_ITEM' AND lifecycle_state IN ('OPEN','IN_PROGRESS')`,
      [orderA.vendor_order_id],
    );
    const duplicateNote = await pool.query<{ audience: string; message_kind: string }>(
      `SELECT audience, message_kind FROM marketplace.support_case_messages WHERE support_case_id=$1`,
      [first.support_case_id],
    );
    check(
      again.deduplicated &&
        again.support_case_id === first.support_case_id &&
        again.version === 2 &&
        openCount.rows[0]?.count === '1' &&
        duplicateNote.rows.some(
          (entry) => entry.audience === 'PARTICIPANT' && entry.message_kind === 'DUPLICATE_REPORT',
        ) &&
        (await events(first.support_case_id)).includes('DUPLICATE_REPORTED'),
      `A second report opened another case or lost what was said (${JSON.stringify(again)})`,
    );
    // Two operators reporting the same thing at once still make one case.
    const racing = await Promise.all(
      [agent, reviewer].map((context) =>
        cases.open({
          context,
          vendor_order_id: orderB.vendor_order_id,
          category: 'ORDER_HELP',
          description: 'SYNTH the customer called about B.',
          now: later(3 * MINUTE),
        }),
      ),
    );
    check(
      racing[0]?.support_case_id === racing[1]?.support_case_id &&
        racing.filter((entry) => entry.deduplicated).length === 1,
      `Two reports at once opened two cases (${JSON.stringify(racing)})`,
    );
    const caseB = racing[0]?.support_case_id as UuidV7;
    let duplicateRefused = false;
    try {
      await pool.query(
        `INSERT INTO marketplace.support_cases
           (support_case_id, vendor_order_id, customer_user_id, opened_by_user_id, category,
            description, response_due_at, response_clock_started_at, request_id, correlation_id)
         VALUES ($1,$2,$3,$3,'ORDER_HELP','SYNTH bypass',now() + interval '1 hour',now(),$4,$4)`,
        [createUuidV7(), orderB.vendor_order_id, people.customer, createUuidV7()],
      );
    } catch (error) {
      duplicateRefused = (error as { code?: string }).code === '23505';
    }
    check(duplicateRefused, 'The schema allowed two open cases about the same thing');

    // 3. The worker's case on the returned delivery: high, on the attempt, the customer's to read.
    const returned = await cases.open({
      context: systemContext(people.system),
      vendor_order_id: orderA.vendor_order_id,
      category: 'DELIVERY_RETURNED',
      description: 'SYNTH delivery came back to the store.',
      now: later(4 * MINUTE),
    });
    const returnedRow = await row(returned.support_case_id);
    const shopperCases = await cases.customerList({ context: shopper });
    check(
      returnedRow?.severity === 'HIGH' &&
        returnedRow.delivery_assignment_id === attemptA &&
        returnedRow.owner_team === 'OPERATIONS_LEAD' &&
        returnedRow.response_due_at?.getTime() === later(4 * MINUTE).getTime() + 15 * MINUTE &&
        shopperCases.some((entry) => entry.support_case_id === returned.support_case_id) &&
        shopperCases.some((entry) => entry.support_case_id === caseB),
      `A case operations opened is not high, on the delivery, or visible to its customer (${JSON.stringify(returnedRow)})`,
    );
    check(
      (await cases.customerList({ context: stranger })).length === 0,
      "Another customer sees this customer's cases",
    );

    // 4. The queue ranks the high case first; the case reads apart; the look is recorded.
    const queue = await cases.queue({ context: agent, now: later(5 * MINUTE) });
    const positions = [returned.support_case_id, first.support_case_id].map((id) =>
      queue.cases.findIndex((entry) => entry.support_case_id === id),
    );
    check(
      (positions[0] ?? -1) >= 0 &&
        (positions[0] ?? -1) < (positions[1] ?? -1) &&
        queue.cases.find((entry) => entry.support_case_id === first.support_case_id)
          ?.next_action === 'FIRST_RESPONSE',
      `The queue did not rank the high case over the medium one (${JSON.stringify(positions)})`,
    );
    await rejects(
      () => cases.queue({ context: outsider }),
      SupportCaseAuthorizationError,
      'An admin without the support capability read the queue',
    );
    const read = await cases.detail({
      context: agent,
      support_case_id: first.support_case_id,
      now: later(5 * MINUTE),
    });
    const viewed = await pool.query(
      `SELECT 1 FROM marketplace.operational_audit_events
        WHERE action='SUPPORT_CASE_VIEWED' AND target_reference=$1 AND actor_id=$2`,
      [first.support_case_id, people.agent],
    );
    check(
      read.subject.kind === 'LINE' &&
        read.participant_thread.length === 1 &&
        read.internal_notes.length === 0 &&
        !read.allowed_actions.includes('REOPEN') &&
        !read.allowed_actions.includes('QUALITY_REVIEW') &&
        viewed.rows.length === 1,
      `The case did not read as operations work it (${JSON.stringify(read.allowed_actions)})`,
    );

    // 5. Assigned to someone who can work it, against the version read.
    const act = (
      context: ReturnType<typeof adminContext>,
      action: string,
      version: number,
      at: Date,
      fields: Record<string, unknown> = {},
      caseId: UuidV7 = first.support_case_id,
    ) =>
      cases.act({
        context,
        support_case_id: caseId,
        action,
        expected_version: version,
        reason_code: `SYNTH_${action}`,
        now: at,
        ...fields,
      });
    await rejects(
      () =>
        act(agent, 'ASSIGN', read.version, later(6 * MINUTE), { owner_user_id: people.outsider }),
      SupportCaseInputError,
      'A case was assigned to someone who cannot work support cases',
    );
    await rejects(
      () => act(agent, 'ASSIGN', 1, later(6 * MINUTE), { owner_user_id: people.agent }),
      SupportCaseStateError,
      'A step was taken against a stale version',
    );
    await rejects(
      () => act(agent, 'ASSIGN', read.version, later(6 * MINUTE), { owner_team: 'EVERYONE' }),
      SupportCaseInputError,
      'A case went to a team that does not exist',
    );
    const assigned = await act(agent, 'ASSIGN', read.version, later(6 * MINUTE), {
      owner_user_id: people.agent,
    });
    check(
      assigned.lifecycle_state === 'IN_PROGRESS' &&
        (await row(first.support_case_id))?.owner_user_id === people.agent,
      'Assigning did not give the case an owner',
    );

    // 6. A note stays inside; a reply reaches the customer and moves the deadline to the update cadence.
    const noted = await act(agent, 'NOTE', assigned.version, later(7 * MINUTE), {
      body: 'SYNTH store says the apples were packed.',
    });
    const replyAt = later(8 * MINUTE);
    await act(agent, 'MESSAGE', noted.version, replyAt, {
      body: 'SYNTH we are checking with the store.',
    });
    const afterReply = await row(first.support_case_id);
    const customerView = await cases.customerDetail({
      context: shopper,
      support_case_id: first.support_case_id,
    });
    check(
      afterReply?.first_responded_at?.getTime() === replyAt.getTime() &&
        afterReply.response_due_at?.getTime() === replyAt.getTime() + 24 * HOUR &&
        customerView.messages.length === 2 &&
        customerView.messages.every((entry) => !('author_user_id' in entry)) &&
        customerView.messages[1]?.from === 'SUPPORT' &&
        !customerView.messages.some((entry) => entry.body.includes('packed')) &&
        (await notices(first.support_case_id)).some(
          (notice) =>
            notice.template_key === 'support_case.replied' &&
            notice.recipient_user_id === people.customer,
        ),
      `The note leaked, the reply did not reach the customer, or the deadline did not move (${JSON.stringify(customerView.messages)})`,
    );

    // 7. Asking the customer makes it their turn; their answer makes it support's again.
    // The customer writes while support owe only the daily update: a reply is owed sooner.
    const nudgedAt = later(8 * MINUTE + 30_000);
    await cases.customerReply({
      context: shopper,
      support_case_id: first.support_case_id,
      body: 'SYNTH please hurry.',
      now: nudgedAt,
    });
    const nudged = await row(first.support_case_id);
    check(
      nudged?.awaiting === 'OPERATIONS' &&
        nudged.response_due_at?.getTime() === nudgedAt.getTime() + 4 * HOUR &&
        nudged.response_clock_started_at?.getTime() === nudgedAt.getTime(),
      `The customer writing did not bring support's reply forward (${JSON.stringify(nudged)})`,
    );
    const askedAt = later(9 * MINUTE);
    const asked = await act(agent, 'REQUEST_RESPONSE', nudged.version, askedAt, {
      body: 'SYNTH was the bag sealed?',
      respond_within_seconds: 6 * 3_600,
    });
    const waiting = await cases.customerList({ context: shopper });
    const askedQueue = await cases.queue({ context: agent, now: later(10 * MINUTE) });
    check(
      asked.awaiting === 'PARTICIPANT' &&
        asked.response_due_at === new Date(askedAt.getTime() + 6 * HOUR).toISOString() &&
        waiting.find((entry) => entry.support_case_id === first.support_case_id)?.awaiting_you ===
          true &&
        askedQueue.cases.find((entry) => entry.support_case_id === first.support_case_id)
          ?.next_action === 'AWAIT_CUSTOMER' &&
        (await notices(first.support_case_id)).some(
          (notice) => notice.template_key === 'support_case.response_requested',
        ),
      `Asking the customer did not make it their turn (${JSON.stringify(asked)})`,
    );
    await rejects(
      () =>
        act(agent, 'REQUEST_RESPONSE', asked.version, askedAt, {
          body: 'x',
          respond_within_seconds: 60,
        }),
      SupportCaseInputError,
      'A customer was given a minute to answer',
    );
    const answeredAt = later(20 * MINUTE);
    await rejects(
      () =>
        cases.customerReply({
          context: stranger,
          support_case_id: first.support_case_id,
          body: 'SYNTH not mine',
          now: answeredAt,
        }),
      SupportCaseNotFoundError,
      "A customer wrote on someone else's case",
    );
    await cases.customerReply({
      context: shopper,
      support_case_id: first.support_case_id,
      body: 'SYNTH yes, sealed.',
      now: answeredAt,
    });
    const afterAnswer = await row(first.support_case_id);
    check(
      afterAnswer?.awaiting === 'OPERATIONS' &&
        afterAnswer.response_due_at?.getTime() === answeredAt.getTime() + 4 * HOUR &&
        afterAnswer.response_clock_started_at?.getTime() === answeredAt.getTime(),
      `The customer's answer did not put support on the clock (${JSON.stringify(afterAnswer)})`,
    );

    // 8. Escalation raises the severity, hands the case to its owner and tightens the deadline.
    const escalatedAt = later(21 * MINUTE);
    await rejects(
      () => act(agent, 'ESCALATE', afterAnswer.version, escalatedAt, { severity: 'LOW' }),
      SupportCaseInputError,
      'An escalation lowered the severity',
    );
    const escalated = await act(agent, 'ESCALATE', afterAnswer.version, escalatedAt);
    const afterEscalation = await row(first.support_case_id);
    check(
      escalated.severity === 'HIGH' &&
        afterEscalation?.owner_team === 'OPERATIONS_LEAD' &&
        afterEscalation.owner_user_id === null &&
        afterEscalation.lifecycle_state === 'OPEN' &&
        afterEscalation.response_due_at?.getTime() === escalatedAt.getTime() + 15 * MINUTE,
      `Escalation did not raise, hand over and tighten (${JSON.stringify(afterEscalation)})`,
    );
    // The returned delivery goes to critical: the incident commander works it, and it goes no higher.
    const toCritical = await act(
      agent,
      'ESCALATE',
      returnedRow.version,
      later(22 * MINUTE),
      { severity: 'CRITICAL' },
      returned.support_case_id,
    );
    const commanded = await act(
      commander,
      'NOTE',
      toCritical.version,
      later(23 * MINUTE),
      { body: 'SYNTH incident commander has it.' },
      returned.support_case_id,
    );
    check(
      (await row(returned.support_case_id))?.owner_team === 'INCIDENT_COMMANDER',
      'A critical case did not go to the incident commander',
    );
    await rejects(
      () =>
        act(
          commander,
          'ESCALATE',
          commanded.version,
          later(24 * MINUTE),
          {},
          returned.support_case_id,
        ),
      SupportCaseStateError,
      'A critical case was escalated past critical',
    );

    // 9. Evidence is classified, once, and never reaches the customer.
    const evidenced = await act(agent, 'EVIDENCE', escalated.version, later(25 * MINUTE), {
      evidence_reference: 'SYNTH-EVIDENCE-BAG-PHOTO',
      classification: 'RESTRICTED',
    });
    await rejects(
      () =>
        act(agent, 'EVIDENCE', evidenced.version, later(25 * MINUTE), {
          evidence_reference: 'SYNTH-EVIDENCE-BAG-PHOTO',
        }),
      SupportCaseStateError,
      'The same evidence was attached twice',
    );
    await rejects(
      () =>
        act(agent, 'EVIDENCE', evidenced.version, later(25 * MINUTE), {
          evidence_reference: 'photo.jpg',
        }),
      SupportCaseInputError,
      'Evidence without a reference was attached',
    );
    const shopperDetail = await cases.customerDetail({
      context: shopper,
      support_case_id: first.support_case_id,
    });
    check(
      !JSON.stringify(shopperDetail).includes('SYNTH-EVIDENCE'),
      'Evidence reached the customer',
    );

    // 10. Resolving names what was done; a refund only once a second person approved it.
    const resolveAt = later(30 * MINUTE);
    const resolveWith = (fields: Record<string, unknown>) =>
      act(agent, 'RESOLVE', evidenced.version, resolveAt, {
        body: 'SYNTH we refunded the apples.',
        ...fields,
      });
    await rejects(
      () => resolveWith({}),
      SupportCaseInputError,
      'A case resolved with no resolution',
    );
    await rejects(
      () => resolveWith({ resolution_code: 'REFUNDED' }),
      SupportCaseInputError,
      'A refund resolution named no refund',
    );
    await rejects(
      () => resolveWith({ resolution_code: 'CUSTOMER_UNRESPONSIVE' }),
      SupportCaseStateError,
      'A case was closed as unresponsive while the customer had answered',
    );
    await rejects(
      () => resolveWith({ resolution_code: 'REFUNDED', refund_id: refundId }),
      SupportCaseStateError,
      'A refund still waiting for approval resolved a case',
    );
    await rejects(
      () => resolveWith({ resolution_code: 'EXPLAINED', refund_id: refundId }),
      SupportCaseInputError,
      'A resolution that is not a refund named a refund',
    );
    const refundVersion = await pool.query<{ version: number }>(
      'SELECT version FROM marketplace.refunds WHERE refund_id=$1',
      [refundId],
    );
    await money.approveAndSubmitRefund({
      command_reference: `SYNTH-CMD-SUPPORT-APPROVE-${people.customer.slice(-8).toUpperCase()}`,
      context: adminContext(people.approver),
      expected_version: refundVersion.rows[0]?.version ?? 1,
      refund_id: refundId,
      now: later(62_000),
    });
    const resolved = await resolveWith({ resolution_code: 'REFUNDED', refund_id: refundId });
    const afterResolve = await row(first.support_case_id);
    const sample = await cases.queue({ context: reviewer, view: 'QUALITY_SAMPLE' });
    const ownSample = await cases.queue({ context: agent, view: 'QUALITY_SAMPLE' });
    check(
      resolved.lifecycle_state === 'RESOLVED' &&
        afterResolve?.resolution_refund_id === refundId &&
        afterResolve.resolved_by_user_id === people.agent &&
        afterResolve.awaiting === 'NONE' &&
        (
          await cases.customerDetail({ context: shopper, support_case_id: first.support_case_id })
        ).messages.at(-1)?.message_kind === 'RESOLUTION' &&
        (await notices(first.support_case_id)).some(
          (notice) => notice.template_key === 'support_case.resolved',
        ) &&
        sample.cases.some((entry) => entry.support_case_id === first.support_case_id) &&
        !ownSample.cases.some((entry) => entry.support_case_id === first.support_case_id),
      `The resolution was not recorded, told, or offered to someone else for review (${JSON.stringify(afterResolve)})`,
    );
    await rejects(
      () =>
        act(agent, 'RESOLVE', resolved.version, resolveAt, {
          resolution_code: 'EXPLAINED',
          body: 'again',
        }),
      SupportCaseStateError,
      'A resolved case was resolved again',
    );

    // 11. The quality review is someone else's, once.
    await rejects(
      () => act(agent, 'QUALITY_REVIEW', resolved.version, later(31 * MINUTE), { outcome: 'PASS' }),
      SupportCaseStateError,
      'The resolver reviewed their own resolution',
    );
    await rejects(
      () =>
        act(outsider, 'QUALITY_REVIEW', resolved.version, later(31 * MINUTE), { outcome: 'PASS' }),
      SupportCaseAuthorizationError,
      'Someone without the review capability reviewed a case',
    );
    await rejects(
      () =>
        act(trainee, 'QUALITY_REVIEW', resolved.version, later(31 * MINUTE), { outcome: 'PASS' }),
      SupportCaseAuthorizationError,
      'Someone who works cases but may not review them reviewed a case',
    );
    await rejects(
      () =>
        act(reviewer, 'QUALITY_REVIEW', resolved.version, later(31 * MINUTE), { outcome: 'FAIL' }),
      SupportCaseInputError,
      'A failed review said nothing about why',
    );
    const reviewed = await act(reviewer, 'QUALITY_REVIEW', resolved.version, later(31 * MINUTE), {
      outcome: 'PASS',
    });
    await rejects(
      () =>
        act(reviewer, 'QUALITY_REVIEW', reviewed.version, later(32 * MINUTE), { outcome: 'PASS' }),
      SupportCaseStateError,
      'A resolution was reviewed twice',
    );
    let selfReviewRefused = false;
    try {
      await pool.query(
        `UPDATE marketplace.support_cases SET quality_reviewed_by_user_id = resolved_by_user_id
          WHERE support_case_id = $1`,
        [first.support_case_id],
      );
    } catch (error) {
      selfReviewRefused = (error as { code?: string }).code === '23514';
    }
    check(selfReviewRefused, 'The schema let a resolver review their own resolution');

    // 12. The customer's reply reopens the case on its own timeline.
    const reopenedAt = later(40 * MINUTE);
    await cases.customerReply({
      context: shopper,
      support_case_id: first.support_case_id,
      body: 'SYNTH the refund has not arrived.',
      now: reopenedAt,
    });
    const reopened = await row(first.support_case_id);
    const timeline = await events(first.support_case_id);
    check(
      reopened?.lifecycle_state === 'OPEN' &&
        reopened.reopen_count === 1 &&
        reopened.resolution_code === null &&
        reopened.quality_review_outcome === null &&
        reopened.response_due_at?.getTime() === reopenedAt.getTime() + 15 * MINUTE &&
        timeline.includes('RESOLVED') &&
        timeline.includes('QUALITY_REVIEWED') &&
        timeline.lastIndexOf('REOPENED') > timeline.lastIndexOf('QUALITY_REVIEWED'),
      `The customer's reply did not reopen the case with its history (${JSON.stringify({ reopened, timeline })})`,
    );
    await rejects(
      () => act(agent, 'REOPEN', reopened.version, later(41 * MINUTE)),
      SupportCaseStateError,
      'An open case was reopened',
    );

    // 13. A duplicate on the same order merges in; one about another order does not.
    const extra = await cases.open({
      context: agent,
      vendor_order_id: orderA.vendor_order_id,
      category: 'ORDER_HELP',
      description: 'SYNTH customer also rang about the apples.',
      severity: 'LOW',
      now: later(42 * MINUTE),
    });
    await rejects(
      () =>
        act(
          agent,
          'MERGE',
          extra.version,
          later(43 * MINUTE),
          { target_case_id: caseB },
          extra.support_case_id,
        ),
      SupportCaseStateError,
      'Cases about different orders were merged',
    );
    await rejects(
      () =>
        act(
          agent,
          'MERGE',
          extra.version,
          later(43 * MINUTE),
          { target_case_id: extra.support_case_id },
          extra.support_case_id,
        ),
      SupportCaseInputError,
      'A case was merged into itself',
    );
    const merged = await act(
      agent,
      'MERGE',
      extra.version,
      later(43 * MINUTE),
      { target_case_id: first.support_case_id },
      extra.support_case_id,
    );
    const afterMerge = await row(extra.support_case_id);
    check(
      merged.lifecycle_state === 'WITHDRAWN' &&
        afterMerge?.merged_into_case_id === first.support_case_id &&
        (await events(first.support_case_id)).includes('MERGE_RECEIVED') &&
        (await cases.detail({ context: agent, support_case_id: extra.support_case_id }))
          .allowed_actions.length === 0,
      `The merge did not close the duplicate into the case that stays (${JSON.stringify(afterMerge)})`,
    );
    // The case that stays merges again: what was merged into it follows.
    const wrong = await cases.open({
      context: shopper,
      vendor_order_id: orderA.vendor_order_id,
      category: 'WRONG_ITEM',
      description: 'SYNTH and a pear I did not order.',
      vendor_order_line_id: lineA,
      now: later(44 * MINUTE),
    });
    const current = await row(first.support_case_id);
    check(current, 'The case disappeared');
    await act(
      agent,
      'MERGE',
      current.version,
      later(45 * MINUTE),
      { target_case_id: wrong.support_case_id },
      first.support_case_id,
    );
    check(
      (await row(extra.support_case_id))?.merged_into_case_id === wrong.support_case_id,
      'A case merged into a case that was merged again was left pointing at a closed case',
    );
    const followed = await cases.customerReply({
      context: shopper,
      support_case_id: extra.support_case_id,
      body: 'SYNTH any news?',
      now: later(46 * MINUTE),
    });
    const afterFollow = await row(wrong.support_case_id);
    check(
      followed.support_case_id === wrong.support_case_id &&
        afterFollow?.severity === 'HIGH' &&
        afterFollow.awaiting === 'OPERATIONS',
      `The customer's words did not follow the merge, or the case that stays lost the severity (${JSON.stringify({ followed, afterFollow })})`,
    );

    // 14. Closed as unresponsive only once the customer was asked and the time passed.
    const wrongRow = await row(wrong.support_case_id);
    check(wrongRow, 'The merged-into case disappeared');
    const askedAgain = await act(
      agent,
      'REQUEST_RESPONSE',
      wrongRow.version,
      later(50 * MINUTE),
      { body: 'SYNTH can you send a photo?', respond_within_seconds: 3_600 },
      wrong.support_case_id,
    );
    const unresponsive = (at: Date) =>
      act(
        agent,
        'RESOLVE',
        askedAgain.version,
        at,
        { resolution_code: 'CUSTOMER_UNRESPONSIVE', body: 'SYNTH closing; reply to reopen.' },
        wrong.support_case_id,
      );
    await rejects(
      () => unresponsive(later(80 * MINUTE)),
      SupportCaseStateError,
      'A case was closed as unresponsive before the customer had their time',
    );
    const closed = await unresponsive(later(111 * MINUTE));
    check(closed.lifecycle_state === 'RESOLVED', 'The unresponsive case did not close');

    // 15. The dashboard carries the case's own deadline and escalates from when its clock started.
    const bRow = await row(caseB);
    check(bRow, 'Case B disappeared');
    await act(
      agent,
      'MESSAGE',
      bRow.version,
      later(60 * MINUTE),
      { body: 'SYNTH we are on it.' },
      caseB,
    );
    const dashboard = await control.dashboard({ context: agent, now: later(61 * MINUTE) });
    const restarted = dashboard.items.find((item) => item.object_id === caseB);
    check(
      restarted?.sla_due_at === new Date(later(60 * MINUTE).getTime() + 24 * HOUR).toISOString() &&
        restarted.escalate_at ===
          new Date(later(60 * MINUTE).getTime() + Math.floor(24 * HOUR * 0.75)).toISOString(),
      `The dashboard escalates from the case's creation, not from when its clock restarted (${JSON.stringify(restarted)})`,
    );
    const critical = dashboard.items.find((item) => item.object_id === returned.support_case_id);
    const criticalRow = await row(returned.support_case_id);
    check(
      critical &&
        criticalRow?.response_due_at &&
        criticalRow.response_clock_started_at &&
        critical.sla_due_at === criticalRow.response_due_at.toISOString() &&
        critical.escalate_at ===
          new Date(
            criticalRow.response_clock_started_at.getTime() +
              Math.floor(
                (criticalRow.response_due_at.getTime() -
                  criticalRow.response_clock_started_at.getTime()) *
                  0.75,
              ),
          ).toISOString() &&
        critical.severity === 'CRITICAL',
      `The dashboard does not carry the case's deadline and escalation (${JSON.stringify(critical)})`,
    );

    // 16. Every step is on the audit with the state before and after.
    const audit = await pool.query<{ action: string; before_value: { version?: number } | null }>(
      `SELECT action, before_value FROM marketplace.operational_audit_events
        WHERE target_kind='SUPPORT_CASE' AND target_reference=$1`,
      [first.support_case_id],
    );
    const actions = new Set(audit.rows.map((entry) => entry.action));
    check(
      [
        'SUPPORT_CASE_OPENED',
        'SUPPORT_CASE_DUPLICATE_REPORTED',
        'SUPPORT_CASE_ASSIGN',
        'SUPPORT_CASE_NOTE',
        'SUPPORT_CASE_MESSAGE',
        'SUPPORT_CASE_REQUEST_RESPONSE',
        'SUPPORT_CASE_ESCALATE',
        'SUPPORT_CASE_EVIDENCE',
        'SUPPORT_CASE_RESOLVE',
        'SUPPORT_CASE_QUALITY_REVIEW',
        'SUPPORT_CASE_MERGE_RECEIVED',
        'SUPPORT_CASE_MERGE',
        'SUPPORT_CASE_VIEWED',
      ].every((action) => actions.has(action)) &&
        audit.rows
          .filter((entry) => entry.action === 'SUPPORT_CASE_ASSIGN')
          .every((entry) => typeof entry.before_value?.version === 'number'),
      `The audit is missing steps (${[...actions].join(', ')})`,
    );
    // The trainee role was the walk's own; the reviewed catalog stays as it was.
    await pool.query(
      `DELETE FROM marketplace.admin_membership_scopes WHERE role_assignment_id IN
         (SELECT role_assignment_id FROM marketplace.role_assignments
           WHERE role_key = 'SYNTH_SUPPORT_TRAINEE')`,
    );
    await pool.query(
      "DELETE FROM marketplace.role_assignments WHERE role_key = 'SYNTH_SUPPORT_TRAINEE'",
    );
    await pool.query(
      "DELETE FROM marketplace.role_capabilities WHERE role_key = 'SYNTH_SUPPORT_TRAINEE'",
    );
    await pool.query("DELETE FROM marketplace.roles WHERE role_key = 'SYNTH_SUPPORT_TRAINEE'");
  } finally {
    await Promise.all([
      pool.end(),
      cases.close(),
      control.close(),
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
