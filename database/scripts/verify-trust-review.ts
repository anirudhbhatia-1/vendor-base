import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { AdminControlPlaneService } from '../src/admin-control-plane.js';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { CheckoutConflictError, GroupedCheckoutService } from '../src/grouped-checkout.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { SupportCaseService } from '../src/support-cases.js';
import {
  TrustReviewAuthorizationError,
  TrustReviewInputError,
  TrustReviewNotFoundError,
  TrustReviewService,
  TrustReviewStateError,
} from '../src/trust-review.js';
import { VendorFulfilmentService } from '../src/vendor-fulfilment.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import {
  adminContext,
  check,
  customerContext,
  partnerContext,
  rejects,
  systemContext,
  vendorContext,
} from './verify-support.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 11.4 -- trust and safety review, from a signal to an appeal.
 *
 * A customer orders from two shops. A partner carrying the first order is
 * rated low by two customers and reported by support; the partner reports a
 * threat at the customer's door; the customer rates the first shop low and
 * complains of a missing item. Collecting those signals restricts nothing.
 * The partner's evidence is strong and a restriction is approved by a second
 * person -- the goods the partner holds stay theirs to deliver. The customer
 * rests on one report, so a restriction needs evidence a person attached;
 * in force at one shop, it blocks their next order there and nowhere else,
 * and it is overturned on appeal by someone who took no part. A category
 * restriction on the second shop stops new sales, turns a live quote stale,
 * lets its accepted order be picked, and expires on time. Each step is
 * also tried by the wrong person, stale, and with the wrong inputs.
 */
export async function verifyTrustReview(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4, application_name: 'trust-review-verifier' });
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
  const support = new SupportCaseService({ connection_string: connectionString });
  const control = new AdminControlPlaneService({ connection_string: connectionString });
  const trust = new TrustReviewService({ connection_string: connectionString });
  // The walk's clock starts behind the wall clock, as the other walks' do.
  const now = new Date(Date.now() - 2 * MINUTE);
  const later = (ms: number) => new Date(now.getTime() + ms);
  const people = {
    customer: createUuidV7(),
    rater: createUuidV7(),
    secondRater: createUuidV7(),
    partner: createUuidV7(),
    agent: createUuidV7(),
    operator: createUuidV7(),
    supportOperator: createUuidV7(),
    approver: createUuidV7(),
    appealDecider: createUuidV7(),
    outsider: createUuidV7(),
    system: createUuidV7(),
  };
  const grantAdmin = async (user: UuidV7, role: string) => {
    const assignment = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, granted_by_user_id,
          request_id, correlation_id, retention_review_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$5,$6,$4,$4)`,
      [assignment, user, role, later(-HOUR), createUuidV7(), later(365 * DAY)],
    );
    await pool.query(
      `INSERT INTO marketplace.admin_membership_scopes
         (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
       VALUES ($1,$2,$3,'GLOBAL',NULL,$4)`,
      [createUuidV7(), assignment, user, later(-HOUR)],
    );
    return assignment;
  };
  const grantRole = async (user: UuidV7, role: string) => {
    const assignment = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id,user_id,role_key,state,valid_from,granted_by_user_id,
          request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,$3,'ACTIVE',$4,$5,$6,$6,$4,$4)`,
      [assignment, user, role, later(-HOUR), people.system, createUuidV7()],
    );
    return assignment;
  };
  const operator = adminContext(people.operator);
  const supportOperator = adminContext(people.supportOperator);
  const approver = adminContext(people.approver);
  const appealDecider = adminContext(people.appealDecider);
  const outsider = adminContext(people.outsider);
  const shopper = customerContext(people.customer);
  const rater = customerContext(people.rater);
  const caseRow = async (id: string) =>
    (
      await pool.query<{
        lifecycle_state: string;
        evidence_quality: string;
        decided_by_user_id: string | null;
        decision_reason_code: string | null;
        effective_until: Date;
        review_at: Date;
        last_review_outcome: string | null;
        version: number;
      }>('SELECT * FROM marketplace.trust_restriction_cases WHERE trust_restriction_case_id=$1', [
        id,
      ])
    ).rows[0];
  const restricts = async (kind: string, reference: string, location: string | null, at: Date) =>
    (
      await pool.query<{ restricted: boolean }>(
        'SELECT marketplace.trust_restricts($1,$2,$3::uuid,NULL,$4) AS restricted',
        [kind, reference, location, at],
      )
    ).rows[0]?.restricted === true;
  const events = async (id: string) =>
    (
      await pool.query<{ event_type: string }>(
        `SELECT event_type FROM marketplace.trust_case_events WHERE trust_restriction_case_id=$1
          ORDER BY occurred_at, trust_case_event_id`,
        [id],
      )
    ).rows.map((row) => row.event_type);

  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) SELECT unnest($1::uuid[]),'ACTIVE','RESTRICTED'",
      [Object.values(people)],
    );
    await grantAdmin(people.agent, 'SUPPORT_AGENT');
    await grantAdmin(people.operator, 'TRUST_OPERATOR');
    await grantAdmin(people.supportOperator, 'TRUST_OPERATOR');
    await grantAdmin(people.supportOperator, 'SUPPORT_AGENT');
    await grantAdmin(people.approver, 'TRUST_APPROVER');
    await grantAdmin(people.appealDecider, 'TRUST_APPROVER');
    await grantAdmin(people.outsider, 'CONFIG_OPERATOR');
    for (const user of [people.customer, people.rater, people.secondRater])
      await grantRole(user, 'CUSTOMER');
    const partnerRole = await grantRole(people.partner, 'DELIVERY_PARTNER');
    await pool.query(
      `INSERT INTO marketplace.partner_eligibilities
        (partner_eligibility_id,role_assignment_id,user_id,state,eligible_from,reason_code,updated_at)
       VALUES ($1,$2,$3,'ELIGIBLE',$4,'SYNTH_TRUST_VERIFIED',$4)`,
      [createUuidV7(), partnerRole, people.partner, later(-HOUR)],
    );

    // Two shops, one product each, and a basket helper for any customer.
    const stores = await Promise.all(
      ['M', 'N'].map((suffix, index) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Trust Store ${suffix}`,
          latitude: 26.941 + index * 0.001,
          longitude: 75.841,
          fulfilment_modes: ['PLATFORM_DELIVERY'],
        }),
      ),
    );
    const [storeM, storeN] = stores;
    check(storeM && storeN, 'Store fixtures failed');
    const variants: UuidV7[] = [];
    for (const [index, store] of stores.entries()) {
      const suffix = `${Date.now()}${index}`;
      const product = await catalogue.createProduct({
        context: vendorContext(store.ownerUserId),
        vendor_location_id: store.locationId,
        product_reference: `SYNTH-PROD-TRU${suffix}`,
        title: `SYNTH Trust Product ${index}`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-TRU${suffix}`,
        variant_title: `SYNTH Trust Variant ${index}`,
        price_minor: 12_000,
        initial_stock_quantity: 20,
        low_stock_threshold: 1,
        now,
      });
      variants.push(product.catalogue_variant_id as UuidV7);
    }
    const basket = async (user: UuidV7, at: Date) => {
      const context = customerContext(user);
      const addressId = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.customer_addresses
          (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
         VALUES ($1,$2,'SYNTH-ADDRESS-TRUST-' || $4,'SYNTH Trust Home','302020',
           ST_SetSRID(ST_MakePoint(75.845,26.941),4326)::geography,$3,$3)`,
        [
          addressId,
          user,
          createUuidV7(),
          createUuidV7().replaceAll('-', '').slice(-12).toUpperCase(),
        ],
      );
      const cart = await carts.currentCart({ context, now: at });
      await carts.setCartAddress({ context, customer_address_id: addressId, now: at });
      for (const [index, store] of stores.entries())
        await carts.addLine({
          context,
          vendor_location_id: store.locationId,
          catalogue_variant_id: variants[index] as UuidV7,
          quantity: 1,
          now: at,
        });
      return cart.cart_id as UuidV7;
    };
    const blockedReasons = async (quoteId: string) =>
      (
        await pool.query<{ vendor_location_id: string; reason_code: string }>(
          `SELECT vendor_location_id, reason_code FROM marketplace.checkout_quote_blocked_groups
            WHERE checkout_quote_id=$1`,
          [quoteId],
        )
      ).rows;

    // The customer's order from both shops.
    const firstCart = await basket(people.customer, now);
    const firstQuote = await checkout.createQuote({ context: shopper, cart_id: firstCart, now });
    const placed = await checkout.place({
      context: shopper,
      checkout_quote_id: firstQuote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: `trust-${people.customer}`,
      now: later(1_000),
    });
    const orderM = placed.orders.find((order) => order.vendor_location_id === storeM.locationId);
    const orderN = placed.orders.find((order) => order.vendor_location_id === storeN.locationId);
    check(orderM && orderN, 'The fixture did not place an order at each shop');
    // Shop N accepts its order before anything is restricted.
    const acceptedN = await fulfilment.accept({
      context: vendorContext(storeN.ownerUserId),
      vendor_order_id: orderN.vendor_order_id,
      vendor_location_id: storeN.locationId,
      expected_version: orderN.version,
      preparation_estimate_seconds: 600,
      now: later(1_500),
    });
    const lineM = (
      await pool.query<{ id: UuidV7 }>(
        'SELECT vendor_order_line_id AS id FROM marketplace.vendor_order_lines WHERE vendor_order_id=$1 LIMIT 1',
        [orderM.vendor_order_id],
      )
    ).rows[0]?.id;
    check(lineM, 'Order M has no line');

    // The partner's deliveries: two done and rated low, one with the goods in hand.
    const attempt = async (state: string, custody: string, at: Date) => {
      const id = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.delivery_assignments
          (delivery_assignment_id,source_order_reference,vendor_location_id,vendor_order_id,
           partner_user_id,assignment_state,custody_state,package_count,approximate_pickup_area,
           approximate_drop_area,request_id,correlation_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1,'SYNTH Trust Store','SYNTH Trust Drop',$8,$8,$9,$9)`,
        [
          id,
          orderM.order_reference,
          orderM.vendor_location_id,
          orderM.vendor_order_id,
          people.partner,
          state,
          custody,
          createUuidV7(),
          at,
        ],
      );
      return id;
    };
    const ratedOne = await attempt('REASSIGNED', 'NONE', later(2_000));
    const ratedTwo = await attempt('REASSIGNED', 'NONE', later(3_000));
    const carrying = await attempt('RETURN_REQUIRED', 'IN_CUSTODY', later(4_000));
    await pool.query(
      `INSERT INTO marketplace.return_tasks
        (return_task_id,delivery_assignment_id,return_state,return_reason_code,expected_package_count)
       VALUES ($1,$2,'REQUIRED','DELIVERY_FAILED',1)`,
      [createUuidV7(), carrying],
    );
    for (const [id, customer, stars] of [
      [ratedOne, people.rater, 2],
      [ratedTwo, people.secondRater, 1],
    ] as const)
      await pool.query(
        `INSERT INTO marketplace.delivery_assignment_ratings
           (delivery_assignment_id,customer_user_id,partner_user_id,stars,request_id,correlation_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$5,$6)`,
        [id, customer, people.partner, stars, createUuidV7(), later(5_000)],
      );
    // The partner reports a threat at this customer's door.
    await pool.query(
      `INSERT INTO marketplace.partner_exception_events
         (partner_exception_event_id,delivery_assignment_id,partner_user_id,exception_kind,
          resolution_state,reason_code,request_id,correlation_id,occurred_at)
       VALUES ($1,$2,$3,'THREAT','OPEN','CUSTOMER_THREATENED',$4,$4,$5)`,
      [createUuidV7(), carrying, people.partner, createUuidV7(), later(6_000)],
    );
    // Support reports the partner's conduct; the customer rates shop M low
    // and says an item was missing.
    const conduct = await support.open({
      context: adminContext(people.agent),
      vendor_order_id: orderM.vendor_order_id,
      category: 'PARTNER_CONDUCT',
      description: 'SYNTH the partner was rude at the door.',
      now: later(7_000),
    });
    await pool.query(
      `INSERT INTO marketplace.vendor_order_ratings
         (vendor_order_id,customer_user_id,stars,request_id,correlation_id,created_at)
       VALUES ($1,$2,1,$3,$3,$4)`,
      [orderM.vendor_order_id, people.customer, createUuidV7(), later(8_000)],
    );
    await support.open({
      context: shopper,
      vendor_order_id: orderM.vendor_order_id,
      category: 'MISSING_ITEM',
      description: 'SYNTH no apples.',
      vendor_order_line_id: lineM,
      now: later(9_000),
    });

    // 1. Signals are collected once, and restrict nothing.
    const collectedAt = later(MINUTE);
    const collected = await trust.collectSignals({
      context: systemContext(people.system),
      now: collectedAt,
    });
    const again = await trust.collectSignals({
      context: systemContext(people.system),
      now: collectedAt,
    });
    const carryingAfter = await pool.query<{ custody_state: string; assignment_state: string }>(
      'SELECT custody_state, assignment_state FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1',
      [carrying],
    );
    const cases = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.trust_restriction_cases
        WHERE subject_reference = ANY($1::text[])`,
      [[people.partner, people.customer, storeM.locationId]],
    );
    // Other walks leave signals of their own; count this walk's subjects.
    const ours = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.trust_signals
        WHERE subject_reference = ANY($1::text[])`,
      [[people.partner, people.customer, storeM.locationId]],
    );
    check(
      collected.collected >= 6 &&
        ours.rows[0]?.count === '6' &&
        again.collected === 0 &&
        cases.rows[0]?.count === '0' &&
        !(await restricts('PARTNER', people.partner, null, collectedAt)) &&
        !(await restricts('CUSTOMER', people.customer, storeM.locationId, collectedAt)) &&
        carryingAfter.rows[0]?.custody_state === 'IN_CUSTODY',
      `Collecting signals was not once-only, or it acted on its own (${JSON.stringify({ collected, again, cases: cases.rows })})`,
    );
    await rejects(
      () => trust.collectSignals({ context: shopper }),
      TrustReviewAuthorizationError,
      'A customer collected trust signals',
    );

    // 2. The queue ranks subjects and says how good their evidence is.
    const queue = await trust.queue({ context: operator, now: later(2 * MINUTE) });
    const entry = (kind: string, reference: string) =>
      queue.subjects.find(
        (subject) => subject.subject_kind === kind && subject.subject_reference === reference,
      );
    check(
      entry('PARTNER', people.partner)?.evidence_quality === 'STRONG' &&
        entry('CUSTOMER', people.customer)?.evidence_quality === 'SINGLE_SIGNAL' &&
        entry('VENDOR_LOCATION', storeM.locationId)?.evidence_quality === 'UNCORROBORATED',
      `The queue misjudged the evidence (${JSON.stringify(queue.subjects.slice(0, 5))})`,
    );
    await rejects(
      () => trust.queue({ context: outsider }),
      TrustReviewAuthorizationError,
      'Someone outside trust read the signal queue',
    );

    // 3. The dossier shows what this reviewer may open, and what the subject has under way.
    const dossier = await trust.dossier({
      context: operator,
      subject_kind: 'PARTNER',
      subject_reference: people.partner,
      now: later(2 * MINUTE),
    });
    const withSupport = await trust.dossier({
      context: supportOperator,
      subject_kind: 'PARTNER',
      subject_reference: people.partner,
      now: later(2 * MINUTE),
    });
    const caseSignal = (view: typeof dossier) =>
      view.signals.find((signal) => signal.signal_kind === 'PARTNER_CONDUCT_CASE');
    const viewed = await pool.query(
      `SELECT 1 FROM marketplace.operational_audit_events
        WHERE action='TRUST_SUBJECT_VIEWED' AND actor_id=$1`,
      [people.operator],
    );
    check(
      dossier.signals.length === 3 &&
        caseSignal(dossier)?.source === null &&
        dossier.withheld_sources.SUPPORT_CASE === 1 &&
        dossier.withheld_sources.DELIVERY_RATING === 2 &&
        caseSignal(withSupport)?.source?.reference === conduct.support_case_id &&
        withSupport.signals
          .filter((signal) => signal.source_kind === 'DELIVERY_RATING')
          .every((signal) => signal.source === null) &&
        dossier.in_flight.goods_in_custody === 1 &&
        viewed.rows.length === 1,
      `The dossier linked what the reviewer may not open, or missed the work under way (${JSON.stringify({ withheld: dossier.withheld_sources, in_flight: dossier.in_flight })})`,
    );

    // 4. A proposal names a real subject, an allowed scope, a bounded time, and its evidence.
    const partnerSignals = dossier.signals.map((signal) => signal.trust_signal_id as UuidV7);
    const customerDossier = await trust.dossier({
      context: operator,
      subject_kind: 'CUSTOMER',
      subject_reference: people.customer,
      now: later(2 * MINUTE),
    });
    const threat = customerDossier.signals[0]?.trust_signal_id as UuidV7;
    const proposeAt = later(3 * MINUTE);
    const proposal = (fields: Record<string, unknown> = {}, context = operator) =>
      trust.propose({
        context,
        subject_kind: 'PARTNER',
        subject_reference: people.partner,
        scope_kind: 'GLOBAL',
        scope_reference: 'GLOBAL',
        reason_code: 'REPEATED_CONDUCT_REPORTS',
        policy_reference: 'SYNTH-POLICY-CONDUCT-1',
        signal_ids: partnerSignals,
        effective_until: new Date(proposeAt.getTime() + 14 * DAY),
        review_at: new Date(proposeAt.getTime() + 7 * DAY),
        now: proposeAt,
        ...fields,
      });
    await rejects(
      () => proposal({ subject_reference: 'SYNTH-PARTNER-0001' }),
      TrustReviewInputError,
      'A restriction named its subject by a free reference',
    );
    await rejects(
      () =>
        proposal({
          subject_reference: createUuidV7(),
          signal_ids: [],
          evidence_reference: 'SYNTH-EVIDENCE-X-0001',
        }),
      TrustReviewNotFoundError,
      'A restriction was proposed on a partner that does not exist',
    );
    await rejects(
      () => proposal({ scope_kind: 'CATEGORY', scope_reference: 'FRUIT_VEGETABLE' }),
      TrustReviewInputError,
      'A partner was restricted in a scope partners do not have',
    );
    await rejects(
      () => proposal({ effective_until: new Date(proposeAt.getTime() + 91 * DAY) }),
      TrustReviewInputError,
      'A restriction ran past the longest allowed',
    );
    await rejects(
      () =>
        proposal({
          effective_until: new Date(proposeAt.getTime() + 5 * DAY),
          review_at: new Date(proposeAt.getTime() + 6 * DAY),
        }),
      TrustReviewInputError,
      'A review fell after the restriction ended',
    );
    await rejects(
      () => proposal({ signal_ids: [] }),
      TrustReviewInputError,
      'A restriction rested on nothing',
    );
    await rejects(
      () => proposal({ signal_ids: [threat] }),
      TrustReviewInputError,
      "A restriction rested on another subject's signal",
    );
    await rejects(
      () => proposal({}, approver),
      TrustReviewAuthorizationError,
      'An approver proposed a restriction',
    );
    const partnerCase = await proposal();
    check(
      partnerCase.evidence_quality === 'STRONG' && partnerCase.approvable,
      `Strong evidence was not recorded as strong (${JSON.stringify(partnerCase)})`,
    );
    await rejects(
      () => proposal(),
      TrustReviewStateError,
      'A second restriction was opened on the same subject and scope',
    );

    // 5. Approval by a second person; the goods the partner holds are untouched.
    const partnerId = partnerCase.trust_restriction_case_id;
    const decideAt = later(4 * MINUTE);
    const act = (
      context: ReturnType<typeof adminContext>,
      id: UuidV7,
      action: string,
      version: number,
      at: Date,
      fields: Record<string, unknown> = {},
    ) =>
      trust.act({
        context,
        trust_restriction_case_id: id,
        action,
        expected_version: version,
        reason_code: `SYNTH_${action}`,
        now: at,
        ...fields,
      });
    await rejects(
      () => act(operator, partnerId, 'APPROVE', 1, decideAt),
      TrustReviewAuthorizationError,
      'An operator without the approval capability approved a restriction',
    );
    await rejects(
      () => act(approver, partnerId, 'APPROVE', 9, decideAt),
      TrustReviewStateError,
      'A restriction was approved against a stale version',
    );
    const approved = await act(approver, partnerId, 'APPROVE', 1, decideAt);
    const approvedEvent = await pool.query<{
      payload: { in_flight?: { goods_in_custody?: number } };
    }>(
      `SELECT payload FROM marketplace.trust_case_events
        WHERE trust_restriction_case_id=$1 AND event_type='APPROVED'`,
      [partnerId],
    );
    const stillCarrying = await pool.query<{ custody_state: string }>(
      'SELECT custody_state FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1',
      [carrying],
    );
    check(
      approved.lifecycle_state === 'ACTIVE' &&
        (await caseRow(partnerId))?.decided_by_user_id === people.approver &&
        approvedEvent.rows[0]?.payload.in_flight?.goods_in_custody === 1 &&
        stillCarrying.rows[0]?.custody_state === 'IN_CUSTODY' &&
        (await restricts('PARTNER', people.partner, null, later(5 * MINUTE))),
      `Approval did not take force, record the work it leaves running, or it touched the goods (${JSON.stringify(approvedEvent.rows)})`,
    );

    // 6. One report is a reason to look: attached evidence makes it a decision.
    const customerProposal = (fields: Record<string, unknown> = {}) =>
      trust.propose({
        context: operator,
        subject_kind: 'CUSTOMER',
        subject_reference: people.customer,
        scope_kind: 'VENDOR_LOCATION',
        scope_reference: storeM.locationId,
        reason_code: 'THREAT_AT_DOOR',
        policy_reference: 'SYNTH-POLICY-SAFETY-1',
        signal_ids: [threat],
        effective_until: new Date(proposeAt.getTime() + 10 * DAY),
        review_at: new Date(proposeAt.getTime() + 5 * DAY),
        now: proposeAt,
        ...fields,
      });
    const weak = await customerProposal();
    check(
      weak.evidence_quality === 'SINGLE_SIGNAL' && !weak.approvable,
      'One report was treated as enough',
    );
    await rejects(
      () => act(approver, weak.trust_restriction_case_id, 'APPROVE', 1, decideAt),
      TrustReviewStateError,
      'A restriction on one automated report was approved',
    );
    await act(approver, weak.trust_restriction_case_id, 'REJECT', 1, decideAt);
    const customerCase = await customerProposal({ evidence_reference: 'SYNTH-EVIDENCE-DOOR-CAM' });
    const customerId = customerCase.trust_restriction_case_id;
    await act(approver, customerId, 'APPROVE', 1, decideAt);

    // In force at shop M: the next basket is blocked there alone; the
    // customer's orders already placed are not touched.
    const orderMState = await pool.query<{ lifecycle_state: string }>(
      'SELECT lifecycle_state FROM marketplace.vendor_orders WHERE vendor_order_id=$1',
      [orderM.vendor_order_id],
    );
    const secondCart = await basket(people.customer, later(6 * MINUTE));
    const restrictedQuote = await checkout.createQuote({
      context: shopper,
      cart_id: secondCart,
      now: later(6 * MINUTE),
    });
    const reasons = await blockedReasons(restrictedQuote.checkout_quote_id);
    check(
      orderMState.rows[0]?.lifecycle_state === 'PLACED' &&
        reasons.length === 1 &&
        reasons[0]?.vendor_location_id === storeM.locationId &&
        reasons[0]?.reason_code === 'CUSTOMER_RESTRICTED',
      `The customer restriction did not block shop M alone, or touched a placed order (${JSON.stringify(reasons)})`,
    );

    // 7. A category restriction on shop N, on attached evidence: a live
    // quote turns stale, the next one blocks the line, and N's order already
    // placed can still be accepted.
    const raterCart = await basket(people.rater, later(7 * MINUTE));
    const liveQuote = await checkout.createQuote({
      context: rater,
      cart_id: raterCart,
      now: later(7 * MINUTE),
    });
    check(
      (await blockedReasons(liveQuote.checkout_quote_id)).length === 0,
      'The rater was blocked',
    );
    const shopCase = await trust.propose({
      context: operator,
      subject_kind: 'VENDOR_LOCATION',
      subject_reference: storeN.locationId,
      scope_kind: 'CATEGORY',
      scope_reference: 'FRUIT_VEGETABLE',
      reason_code: 'UNSAFE_PRODUCE_REPORT',
      policy_reference: 'SYNTH-POLICY-PRODUCE-1',
      evidence_reference: 'SYNTH-EVIDENCE-INSPECTION-1',
      effective_until: new Date(proposeAt.getTime() + 3 * DAY),
      review_at: new Date(proposeAt.getTime() + 2 * DAY),
      now: proposeAt,
    });
    const shopId = shopCase.trust_restriction_case_id;
    check(
      shopCase.evidence_quality === 'NONE' && shopCase.approvable,
      'Attached evidence was not enough',
    );
    await act(approver, shopId, 'APPROVE', 1, later(7 * MINUTE + 30_000));
    await rejects(
      () =>
        checkout.place({
          context: rater,
          checkout_quote_id: liveQuote.checkout_quote_id,
          provider_scenario: 'SUCCESS',
          idempotency_key: `trust-rater-${people.rater}`,
          now: later(8 * MINUTE),
        }),
      CheckoutConflictError,
      'A quote from before the restriction was placed after it',
    );
    const requote = await checkout.createQuote({
      context: rater,
      cart_id: raterCart,
      now: later(8 * MINUTE),
    });
    const requoteReasons = await blockedReasons(requote.checkout_quote_id);
    const picking = await fulfilment.startPicking({
      context: vendorContext(storeN.ownerUserId),
      vendor_order_id: orderN.vendor_order_id,
      vendor_location_id: storeN.locationId,
      expected_version: acceptedN.version,
    });
    check(
      requoteReasons.length === 1 &&
        requoteReasons[0]?.vendor_location_id === storeN.locationId &&
        requoteReasons[0]?.reason_code === 'LINE_UNAVAILABLE' &&
        picking.lifecycle_state === 'PICKING',
      `The category restriction did not stop new sales, or stopped the order already placed (${JSON.stringify(requoteReasons)})`,
    );

    // 8. A review keeps, shortens, or lifts -- within the rules.
    const reviewAt = later(10 * MINUTE);
    const partnerNow = await caseRow(partnerId);
    check(partnerNow, 'The partner case disappeared');
    await rejects(
      () => act(approver, partnerId, 'REVIEW', partnerNow.version, reviewAt, { outcome: 'KEEP' }),
      TrustReviewInputError,
      'A kept restriction set no next review',
    );
    await rejects(
      () =>
        act(approver, partnerId, 'REVIEW', partnerNow.version, reviewAt, {
          outcome: 'KEEP',
          review_at: new Date(partnerNow.effective_until.getTime() + DAY),
        }),
      TrustReviewInputError,
      'A review was set after the restriction ends',
    );
    const kept = await act(approver, partnerId, 'REVIEW', partnerNow.version, reviewAt, {
      outcome: 'KEEP',
      review_at: new Date(reviewAt.getTime() + 3 * DAY),
    });
    await rejects(
      () =>
        act(approver, partnerId, 'REVIEW', kept.version, reviewAt, {
          outcome: 'SHORTEN',
          effective_until: later(-MINUTE),
        }),
      TrustReviewInputError,
      'A restriction was shortened into the past',
    );
    const shortenedUntil = new Date(reviewAt.getTime() + 4 * DAY);
    const shortened = await act(approver, partnerId, 'REVIEW', kept.version, reviewAt, {
      outcome: 'SHORTEN',
      effective_until: shortenedUntil,
    });
    const afterReview = await caseRow(partnerId);
    check(
      kept.review_at === new Date(reviewAt.getTime() + 3 * DAY).toISOString() &&
        shortened.effective_until === shortenedUntil.toISOString() &&
        afterReview?.last_review_outcome === 'SHORTEN' &&
        afterReview.lifecycle_state === 'ACTIVE',
      `The review did not keep and then shorten the restriction (${JSON.stringify(afterReview)})`,
    );

    // 9. Appeals: by the person restricted, once, decided by someone independent.
    const own = await trust.ownRestrictions({ context: shopper, now: later(11 * MINUTE) });
    check(
      own.restrictions.some(
        (restriction) =>
          restriction.trust_restriction_case_id === customerId &&
          restriction.in_force &&
          restriction.appealable &&
          restriction.policy_reference === 'SYNTH-POLICY-SAFETY-1',
      ) &&
        !own.restrictions.some(
          (restriction) => restriction.trust_restriction_case_id === weak.trust_restriction_case_id,
        ),
      `The customer did not see their restriction to appeal, or saw a rejected proposal (${JSON.stringify(own)})`,
    );
    await rejects(
      () =>
        trust.appeal({
          context: rater,
          trust_restriction_case_id: customerId,
          statement: 'SYNTH not mine',
        }),
      TrustReviewNotFoundError,
      "Someone appealed another person's restriction",
    );
    const appeal = await trust.appeal({
      context: shopper,
      trust_restriction_case_id: customerId,
      statement: 'SYNTH I did not threaten anyone; the partner had the wrong door.',
      now: later(11 * MINUTE),
    });
    await rejects(
      () =>
        trust.appeal({
          context: shopper,
          trust_restriction_case_id: customerId,
          statement: 'SYNTH again',
          now: later(11 * MINUTE),
        }),
      TrustReviewStateError,
      'A second appeal was opened while one was open',
    );
    const dashboard = await control.dashboard({ context: appealDecider, now: later(12 * MINUTE) });
    check(
      dashboard.items.some(
        (item) => item.object_id === customerId && item.next_action === 'DECIDE_APPEAL',
      ),
      'The open appeal is not on the dashboard',
    );
    const customerNow = await caseRow(customerId);
    check(customerNow, 'The customer case disappeared');
    await rejects(
      () =>
        act(approver, customerId, 'DECIDE_APPEAL', customerNow.version, later(12 * MINUTE), {
          outcome: 'OVERTURN',
        }),
      TrustReviewStateError,
      'The approver decided the appeal against their own decision',
    );
    const overturned = await act(
      appealDecider,
      customerId,
      'DECIDE_APPEAL',
      customerNow.version,
      later(12 * MINUTE),
      { outcome: 'OVERTURN' },
    );
    const thirdCart = await basket(people.customer, later(13 * MINUTE));
    const freed = await checkout.createQuote({
      context: shopper,
      cart_id: thirdCart,
      now: later(13 * MINUTE),
    });
    const appealRow = await pool.query<{ lifecycle_state: string; case_version: number }>(
      'SELECT lifecycle_state, case_version FROM marketplace.trust_appeals WHERE trust_appeal_id=$1',
      [appeal.trust_appeal_id],
    );
    check(
      overturned.lifecycle_state === 'REVOKED' &&
        appealRow.rows[0]?.lifecycle_state === 'OVERTURNED' &&
        appealRow.rows[0].case_version === 2 &&
        !(await blockedReasons(freed.checkout_quote_id)).some(
          (reason) => reason.reason_code === 'CUSTOMER_RESTRICTED',
        ) &&
        (await events(customerId)).join(',') === 'PROPOSED,APPROVED,APPEAL_FILED,APPEAL_OVERTURNED',
      `The overturned appeal did not lift the restriction on its record (${JSON.stringify(appealRow.rows)})`,
    );
    // The partner appeals too; upheld, the restriction stands.
    const partnerOwn = await trust.ownRestrictions({ context: partnerContext(people.partner) });
    check(partnerOwn.restrictions[0]?.appealable === true, 'The partner could not appeal');
    await trust.appeal({
      context: partnerContext(people.partner),
      trust_restriction_case_id: partnerId,
      statement: 'SYNTH the ratings were about the store.',
      now: later(14 * MINUTE),
    });
    const upheld = await act(
      appealDecider,
      partnerId,
      'DECIDE_APPEAL',
      shortened.version,
      later(15 * MINUTE),
      { outcome: 'UPHOLD' },
    );
    check(upheld.lifecycle_state === 'ACTIVE', 'An upheld appeal lifted the restriction');
    // The shop's owner sees and may appeal theirs; another shop's owner may not.
    const shopOwn = await trust.ownRestrictions({
      context: vendorContext(storeN.ownerUserId),
      vendor_location_id: storeN.locationId,
    });
    check(
      shopOwn.restrictions.some((restriction) => restriction.trust_restriction_case_id === shopId),
      "The shop's owner does not see its restriction",
    );
    await rejects(
      () =>
        trust.ownRestrictions({
          context: vendorContext(storeM.ownerUserId),
          vendor_location_id: storeN.locationId,
        }),
      TrustReviewNotFoundError,
      "Another shop's owner read this shop's restrictions",
    );

    // 10. A lapsed restriction expires on its record, and stops restricting.
    const expireAt = new Date(proposeAt.getTime() + 3 * DAY + MINUTE);
    const expired = await trust.expireLapsed({
      context: systemContext(people.system),
      now: expireAt,
    });
    const shopAfter = await caseRow(shopId);
    check(
      expired.expired >= 1 &&
        shopAfter?.lifecycle_state === 'EXPIRED' &&
        shopAfter.decision_reason_code === 'EFFECTIVE_PERIOD_ENDED' &&
        (await events(shopId)).at(-1) === 'EXPIRED' &&
        !(
          await pool.query<{ r: boolean }>(
            "SELECT marketplace.trust_restricts('VENDOR_LOCATION',$1,$2::uuid,'FRUIT_VEGETABLE',$3) AS r",
            [storeN.locationId, storeN.locationId, expireAt],
          )
        ).rows[0]?.r,
      `The lapsed restriction did not expire on its record (${JSON.stringify(shopAfter)})`,
    );

    const afterExpiry = new Date(expireAt.getTime() + MINUTE);

    // 10c. A category restricted at one shop: a live quote turns stale, and
    // the next one blocks that line at that shop alone.
    const categoryCart = await basket(people.secondRater, afterExpiry);
    const secondRater = customerContext(people.secondRater);
    const categoryQuote = await checkout.createQuote({
      context: secondRater,
      cart_id: categoryCart,
      now: afterExpiry,
    });
    const categoryCase = await trust.propose({
      context: operator,
      subject_kind: 'CATEGORY',
      subject_reference: 'FRUIT_VEGETABLE',
      scope_kind: 'VENDOR_LOCATION',
      scope_reference: storeM.locationId,
      reason_code: 'UNSAFE_PRODUCE_REPORT',
      policy_reference: 'SYNTH-POLICY-PRODUCE-2',
      evidence_reference: 'SYNTH-EVIDENCE-INSPECTION-2',
      effective_until: new Date(afterExpiry.getTime() + 5 * DAY),
      review_at: new Date(afterExpiry.getTime() + 2 * DAY),
      now: afterExpiry,
    });
    await act(approver, categoryCase.trust_restriction_case_id, 'APPROVE', 1, afterExpiry);
    const categoryAt = new Date(afterExpiry.getTime() + MINUTE);
    await rejects(
      () =>
        checkout.place({
          context: secondRater,
          checkout_quote_id: categoryQuote.checkout_quote_id,
          provider_scenario: 'SUCCESS',
          idempotency_key: `trust-category-${people.secondRater}`,
          now: categoryAt,
        }),
      CheckoutConflictError,
      'A quote from before a category restriction was placed after it',
    );
    const categoryRequote = await checkout.createQuote({
      context: secondRater,
      cart_id: categoryCart,
      now: categoryAt,
    });
    const categoryReasons = await blockedReasons(categoryRequote.checkout_quote_id);
    check(
      categoryReasons.length === 1 &&
        categoryReasons[0]?.vendor_location_id === storeM.locationId &&
        categoryReasons[0]?.reason_code === 'LINE_UNAVAILABLE',
      `The category restriction did not block its line at that shop alone (${JSON.stringify(categoryReasons)})`,
    );

    // 11. A signal set aside stops counting and cannot be used.
    const vendorDossier = await trust.dossier({
      context: operator,
      subject_kind: 'VENDOR_LOCATION',
      subject_reference: storeM.locationId,
      now: later(16 * MINUTE),
    });
    const rating = vendorDossier.signals.find(
      (signal) => signal.signal_kind === 'LOW_ORDER_RATING',
    );
    check(rating, 'The order rating signal is missing');
    await trust.dismissSignal({
      context: operator,
      trust_signal_id: rating.trust_signal_id as UuidV7,
      reason_code: 'RATING_ABOUT_DELIVERY',
      now: later(16 * MINUTE),
    });
    await rejects(
      () =>
        trust.dismissSignal({
          context: operator,
          trust_signal_id: rating.trust_signal_id as UuidV7,
          reason_code: 'RATING_ABOUT_DELIVERY',
        }),
      TrustReviewStateError,
      'A signal was set aside twice',
    );
    const afterDismiss = await trust.queue({ context: operator, now: later(16 * MINUTE) });
    await rejects(
      () =>
        trust.propose({
          context: operator,
          subject_kind: 'VENDOR_LOCATION',
          subject_reference: storeM.locationId,
          scope_kind: 'GLOBAL',
          scope_reference: 'GLOBAL',
          reason_code: 'LOW_RATINGS',
          policy_reference: 'SYNTH-POLICY-QUALITY-1',
          signal_ids: [rating.trust_signal_id as UuidV7],
          effective_until: later(5 * DAY),
          review_at: later(2 * DAY),
          now: later(16 * MINUTE),
        }),
      TrustReviewInputError,
      'A signal set aside was used as evidence',
    );
    check(
      afterDismiss.subjects.find((subject) => subject.subject_reference === storeM.locationId)
        ?.evidence_quality === 'SINGLE_SIGNAL',
      'A signal set aside still counted',
    );

    // 12. Lifting on review ends it; the partner is free again.
    const lifted = await act(approver, partnerId, 'REVIEW', upheld.version, later(17 * MINUTE), {
      outcome: 'LIFT',
    });
    check(
      lifted.lifecycle_state === 'REVOKED' &&
        !(await restricts('PARTNER', people.partner, null, later(18 * MINUTE))),
      'Lifting on review did not end the restriction',
    );

    // 13. The schema keeps the record honest.
    let undecided = false;
    try {
      await pool.query(
        `UPDATE marketplace.trust_restriction_cases SET decided_by_user_id=NULL
          WHERE trust_restriction_case_id=$1`,
        [partnerId],
      );
    } catch (error) {
      undecided = (error as { code?: string }).code === '23514';
    }
    let rewritten = false;
    try {
      await pool.query(
        `UPDATE marketplace.trust_case_events SET reason_code='SYNTH_REWRITTEN'
          WHERE trust_restriction_case_id=$1`,
        [partnerId],
      );
    } catch (error) {
      rewritten = (error as { code?: string }).code === '55000';
    }
    const audit = await pool.query<{ action: string }>(
      `SELECT DISTINCT action FROM marketplace.operational_audit_events
        WHERE target_kind='TRUST_RESTRICTION' AND target_reference = ANY($1::text[])`,
      [[partnerId, customerId]],
    );
    const actions = new Set(audit.rows.map((row) => row.action));
    check(
      undecided &&
        rewritten &&
        [
          'TRUST_RESTRICTION_PROPOSED',
          'TRUST_RESTRICTION_APPROVED',
          'TRUST_RESTRICTION_REVIEWED',
          'TRUST_RESTRICTION_APPEAL_UPHELD',
          'TRUST_RESTRICTION_APPEAL_OVERTURNED',
        ].every((action) => actions.has(action)),
      `The record is not protected, or the audit is missing steps (${[...actions].join(', ')})`,
    );
  } finally {
    await Promise.all([
      pool.end(),
      trust.close(),
      control.close(),
      support.close(),
      fulfilment.close(),
      checkout.close(),
      carts.close(),
      catalogue.close(),
      inventory.close(),
    ]);
  }
}
