import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { CheckoutConflictError, GroupedCheckoutService } from '../src/grouped-checkout.js';
import {
  IncidentControlAuthorizationError,
  IncidentControlInputError,
  IncidentControlNotFoundError,
  IncidentControlService,
  IncidentControlStateError,
} from '../src/incident-controls.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import { FulfilmentConflictError, VendorFulfilmentService } from '../src/vendor-fulfilment.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import { adminContext, check, customerContext, rejects, vendorContext } from './verify-support.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * 11.7 -- incident controls, walked.
 *
 * Two shops. Before anything is paused, one customer checks out both (order
 * A at the first, B at the second), A is packed and handed to a partner, and
 * a second customer orders from the first shop (order C). The first shop is
 * paused with a preview of what stops and what carries on, a reason, owner,
 * banner, expiry and review: a new checkout there is blocked, while C is
 * accepted and packed and A stays with its partner. The pause is reviewed,
 * cannot be lifted before its recovery checklist is worked, and is lifted.
 * Engaging and lifting it wrote no money, cancelled nothing and moved no
 * goods. Grouped checkout and a payment method are paused only once a second
 * person approves, and each stops only what it names; substitutions are
 * refused while paused; paused delivery leaves pickup's alternative; a
 * category pause expires on its own record. Every engagement is its own
 * record, and a closed one stays closed.
 */
export async function verifyIncidentControls(connectionString: string): Promise<void> {
  const pool = new Pool({
    connectionString,
    max: 4,
    application_name: 'incident-controls-verifier',
  });
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
  const incidents = new IncidentControlService({ connection_string: connectionString });
  const now = new Date(Date.now() - 2 * MINUTE);
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1_000);
  const people = {
    commander: createUuidV7(),
    second: createUuidV7(),
    outsider: createUuidV7(),
    rider: createUuidV7(),
    first: createUuidV7(),
    other: createUuidV7(),
    third: createUuidV7(),
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
  const commander = adminContext(people.commander);
  const second = adminContext(people.second);
  const engage = (fields: Record<string, unknown>, at: Date, context = commander) =>
    incidents.engage({
      context,
      control_key: 'VENDOR_PAUSE',
      scope_kind: 'VENDOR_LOCATION',
      scope_reference: '',
      reason_code: 'STORE_POWER_CUT',
      banner: 'SYNTH This shop is not taking new orders for now.',
      expires_at: new Date(at.getTime() + 2 * HOUR),
      review_at: new Date(at.getTime() + 30 * MINUTE),
      now: at,
      ...fields,
    });
  const lift = async (id: string, at: Date) => {
    let control: { version: number; recovery_checklist: readonly unknown[] } =
      await incidents.detail({
        context: commander,
        incident_control_id: id as UuidV7,
        now: at,
      });
    for (const [index] of control.recovery_checklist.entries()) {
      control = await incidents.act({
        context: commander,
        incident_control_id: id as UuidV7,
        action: 'CHECK',
        item_index: index,
        expected_version: control.version,
        reason_code: 'CHECKED',
        now: at,
      });
    }
    return incidents.act({
      context: commander,
      incident_control_id: id as UuidV7,
      action: 'REVOKE',
      expected_version: control.version,
      reason_code: 'CAUSE_FIXED',
      now: at,
    });
  };

  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) SELECT unnest($1::uuid[]),'ACTIVE','RESTRICTED'",
      [Object.values(people)],
    );
    await grant(people.commander, 'INCIDENT_COMMANDER');
    await grant(people.second, 'INCIDENT_COMMANDER');
    await grant(people.outsider, 'FINANCE_OPERATOR');

    const stores = await Promise.all(
      ['P', 'Q'].map((suffix, index) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Incident Store ${suffix}`,
          latitude: 26.931 + index * 0.001,
          longitude: 75.831,
          fulfilment_modes: ['PLATFORM_DELIVERY', 'CUSTOMER_PICKUP'],
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
        product_reference: `SYNTH-PROD-INC${suffix}`,
        title: `SYNTH Incident Product ${index}`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-INC${suffix}`,
        variant_title: `SYNTH Incident Variant ${index}`,
        price_minor: 15_000,
        initial_stock_quantity: 20,
        low_stock_threshold: 1,
        now,
      });
      variants.push(product.catalogue_variant_id as UuidV7);
    }
    const variantP = variants[0];
    check(variantP, 'The first shop has no product');
    const basket = async (customer: UuidV7, storeIndexes: readonly number[], at: Date) => {
      const addressId = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.customer_addresses
          (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
         VALUES ($1,$2,'SYNTH-ADDRESS-INCIDENT-' || $4,'SYNTH Incident Home','302020',
           ST_SetSRID(ST_MakePoint(75.835,26.931),4326)::geography,$3,$3)`,
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
        check(store && variant, 'Basket fixture store missing');
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
    const snapshot = async () => {
      const ledger = await pool.query<{ n: string; total: string }>(
        `SELECT count(*)::text AS n, COALESCE(sum(debit_minor - credit_minor),0)::text || '/' || COALESCE(sum(debit_minor),0)::text AS total FROM marketplace.ledger_entries`,
      );
      const orders = await pool.query<{ vendor_order_id: string; lifecycle_state: string }>(
        `SELECT vendor_order_id, lifecycle_state FROM marketplace.vendor_orders
          WHERE vendor_location_id = ANY($1::uuid[]) ORDER BY vendor_order_id`,
        [[storeP.locationId, storeQ.locationId]],
      );
      const custody = await pool.query<{
        delivery_assignment_id: string;
        partner_user_id: string;
        custody_state: string;
        assignment_state: string;
      }>(
        `SELECT delivery_assignment_id, partner_user_id, custody_state, assignment_state
           FROM marketplace.delivery_assignments WHERE vendor_location_id = ANY($1::uuid[])
          ORDER BY delivery_assignment_id`,
        [[storeP.locationId, storeQ.locationId]],
      );
      const money = await pool.query<{ payment_state: string; amount_minor: string }>(
        `SELECT p.payment_state, p.amount_minor::text FROM marketplace.payment_transactions p
           JOIN marketplace.checkout_groups g ON g.payment_transaction_id = p.payment_transaction_id
           JOIN marketplace.vendor_orders o ON o.checkout_group_id = g.checkout_group_id
          WHERE o.vendor_location_id = ANY($1::uuid[]) ORDER BY p.payment_transaction_id`,
        [[storeP.locationId, storeQ.locationId]],
      );
      return JSON.stringify({
        ledger: ledger.rows,
        orders: orders.rows,
        custody: custody.rows,
        money: money.rows,
      });
    };

    // 1. Who may, and what may be paused.
    await rejects(
      () =>
        incidents.preview({
          context: adminContext(people.outsider),
          control_key: 'VENDOR_PAUSE',
          scope_kind: 'VENDOR_LOCATION',
          scope_reference: storeP.locationId,
          now: later(10),
        }),
      IncidentControlAuthorizationError,
      'Someone outside incident command previewed a pause',
    );
    const refused: readonly [Record<string, unknown>, new (...args: never[]) => Error, string][] = [
      [
        { control_key: 'PROMOTION_PAUSE', scope_kind: 'GLOBAL' },
        IncidentControlInputError,
        'A promotion pause was engaged where no promotions exist',
      ],
      [
        { scope_kind: 'GLOBAL' },
        IncidentControlInputError,
        'A shop pause was engaged over everything',
      ],
      [
        { scope_reference: createUuidV7() },
        IncidentControlNotFoundError,
        'A pause was engaged on a shop that does not exist',
      ],
      [
        { scope_reference: storeP.locationId, expires_at: later(8 * 86_400) },
        IncidentControlInputError,
        'A pause was engaged for more than a week',
      ],
      [
        { scope_reference: storeP.locationId, review_at: later(3 * 3_600) },
        IncidentControlInputError,
        'A pause was engaged with its review after its expiry',
      ],
      [
        { scope_reference: storeP.locationId, banner: 'short' },
        IncidentControlInputError,
        'A pause was engaged without a banner people can read',
      ],
    ];
    for (const [fields, error, message] of refused)
      await rejects(() => engage(fields, later(10)), error, message);

    // 2. Before the pause: A and B checked out together, A packed and with its
    // partner; C ordered from the same shop.
    const firstBasket = await basket(people.first, [0, 1], later(5));
    const firstQuote = await checkout.createQuote({
      context: firstBasket.shopper,
      cart_id: firstBasket.cart_id,
      now: later(5),
    });
    const firstPlaced = await checkout.place({
      context: firstBasket.shopper,
      checkout_quote_id: firstQuote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: `incident-${people.first}`,
      now: later(6),
    });
    const orderA = firstPlaced.orders.find(
      (order) => order.vendor_location_id === storeP.locationId,
    );
    check(
      orderA && firstPlaced.orders.length === 2,
      'The grouped fixture did not place two orders',
    );
    const vendorP = vendorContext(storeP.ownerUserId);
    const pack = async (order: { vendor_order_id: UuidV7; version: number }, at: Date) => {
      const accepted = await fulfilment.accept({
        context: vendorP,
        vendor_order_id: order.vendor_order_id,
        vendor_location_id: storeP.locationId,
        expected_version: order.version,
        preparation_estimate_seconds: 600,
        now: at,
      });
      const picking = await fulfilment.startPicking({
        context: vendorP,
        vendor_order_id: order.vendor_order_id,
        vendor_location_id: storeP.locationId,
        expected_version: accepted.version,
      });
      const lines = await pool.query<{
        vendor_order_line_id: UuidV7;
        quantity: number;
        unit_price_minor: string;
      }>(
        `SELECT vendor_order_line_id, quantity, unit_price_minor::text FROM marketplace.vendor_order_lines WHERE vendor_order_id=$1`,
        [order.vendor_order_id],
      );
      for (const line of lines.rows)
        await fulfilment.markLineFound({
          context: vendorP,
          vendor_order_id: order.vendor_order_id,
          vendor_location_id: storeP.locationId,
          vendor_order_line_id: line.vendor_order_line_id,
          actual_quantity: line.quantity,
          actual_unit_price_minor: Number(line.unit_price_minor),
          expected_version: 0,
        });
      return fulfilment.markReady({
        context: vendorP,
        vendor_order_id: order.vendor_order_id,
        vendor_location_id: storeP.locationId,
        expected_version: picking.version,
        package_count: 1,
      });
    };
    await pack(orderA, later(20));
    // A's goods are with its partner.
    const attemptId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id,source_order_reference,vendor_location_id,vendor_order_id,
         partner_user_id,assignment_state,custody_state,package_count,approximate_pickup_area,
         approximate_drop_area,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'RETURN_REQUIRED','IN_CUSTODY',1,'SYNTH Incident Store','SYNTH Incident Drop',$6,$6,$7,$7)`,
      [
        attemptId,
        orderA.order_reference,
        storeP.locationId,
        orderA.vendor_order_id,
        people.rider,
        createUuidV7(),
        later(25),
      ],
    );
    await pool.query(
      `INSERT INTO marketplace.return_tasks
        (return_task_id,delivery_assignment_id,return_state,return_reason_code,expected_package_count)
       VALUES ($1,$2,'REQUIRED','DELIVERY_FAILED',1)`,
      [createUuidV7(), attemptId],
    );
    const thirdBasket = await basket(people.third, [0], later(30));
    const thirdQuote = await checkout.createQuote({
      context: thirdBasket.shopper,
      cart_id: thirdBasket.cart_id,
      now: later(30),
    });
    const thirdPlaced = await checkout.place({
      context: thirdBasket.shopper,
      checkout_quote_id: thirdQuote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: `incident-${people.third}`,
      now: later(31),
    });
    const orderC = thirdPlaced.orders[0];
    check(orderC, 'The single-shop fixture did not place an order');

    // A quote made before the pause, to be placed under it.
    const earlyCustomer = createUuidV7();
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [earlyCustomer],
    );
    const earlyBasket = await basket(earlyCustomer, [0], later(35));
    const earlyQuote = await checkout.createQuote({
      context: earlyBasket.shopper,
      cart_id: earlyBasket.cart_id,
      now: later(35),
    });

    // 3. The preview: what stops, what carries on, and whether it needs a second person.
    const preview = await incidents.preview({
      context: commander,
      control_key: 'VENDOR_PAUSE',
      scope_kind: 'VENDOR_LOCATION',
      scope_reference: storeP.locationId,
      now: later(40),
    });
    const counted = (list: readonly { label: string; count: number }[], label: string) =>
      list.find((entry) => entry.label.startsWith(label))?.count ?? -1;
    check(
      !preview.approval_required &&
        counted(preview.stops.counts, 'Shops taking no new orders') === 1 &&
        counted(preview.continues.counts, 'Open orders that continue') === 2 &&
        counted(preview.continues.counts, 'Deliveries under way') === 1 &&
        preview.continues.rules.length > 0 &&
        preview.checklist.length >= 3,
      `The preview did not show what stops and what carries on (${JSON.stringify(preview)})`,
    );

    // 4. Engaged: owner, reason, banner, expiry, review; one live per shop.
    const before = await snapshot();
    const paused = await engage({ scope_reference: storeP.locationId }, later(60));
    check(
      paused.state === 'ACTIVE' &&
        paused.owner_user_id === people.commander &&
        paused.reason_code === 'STORE_POWER_CUT' &&
        paused.checklist_open === paused.recovery_checklist.length,
      `The pause was not engaged with its owner, reason and checklist (${JSON.stringify(paused)})`,
    );
    check((await snapshot()) === before, 'Engaging a pause changed an order, money or custody');
    await rejects(
      () => engage({ scope_reference: storeP.locationId }, later(61), second),
      IncidentControlStateError,
      'A second pause on the same shop was engaged beside the first',
    );
    const banners = await incidents.banners({ now: later(62) });
    check(
      banners.banners.some(
        (banner) =>
          banner.scope_reference === storeP.locationId &&
          banner.message.includes('not taking new orders'),
      ),
      'The paused shop has no banner',
    );

    // 5. New flows stop; obligations continue.
    const otherBasket = await basket(people.other, [0, 1], later(70));
    const otherQuote = await checkout.createQuote({
      context: otherBasket.shopper,
      cart_id: otherBasket.cart_id,
      now: later(70),
    });
    check(
      otherQuote.groups.length === 1 &&
        otherQuote.blocked_groups.some(
          (group) =>
            group.vendor_location_id === storeP.locationId &&
            group.reason_code === 'INCIDENT_PAUSED',
        ),
      `A new checkout at the paused shop was not blocked with its reason (${JSON.stringify(otherQuote.blocked_groups)})`,
    );
    let earlyCode: string | undefined;
    try {
      await checkout.place({
        context: earlyBasket.shopper,
        checkout_quote_id: earlyQuote.checkout_quote_id,
        provider_scenario: 'SUCCESS',
        idempotency_key: `incident-early-${earlyCustomer}`,
        now: later(75),
      });
    } catch (error) {
      earlyCode = (error as CheckoutConflictError).code;
    }
    check(
      earlyCode === 'QUOTE_CHANGED',
      `A quote made before the pause was placed under it (${earlyCode})`,
    );
    const packedC = await pack(orderC, later(80));
    check(
      packedC.lifecycle_state === 'READY',
      'An order placed before the pause could not be packed under it',
    );

    // 6. Reviewed; not lifted before the checklist is worked; lifted.
    await rejects(
      () =>
        incidents.act({
          context: commander,
          incident_control_id: paused.incident_control_id as UuidV7,
          action: 'REVIEW',
          review_at: later(60 + 2 * 86_400),
          expires_at: later(60 + 3 * 86_400),
          expected_version: paused.version,
          reason_code: 'STILL_OUT',
          now: later(90),
        }),
      IncidentControlInputError,
      'A review was put off for more than a day',
    );
    const reviewed = await incidents.act({
      context: second,
      incident_control_id: paused.incident_control_id as UuidV7,
      action: 'REVIEW',
      review_at: later(90 + 3_600),
      expected_version: paused.version,
      reason_code: 'STILL_OUT',
      now: later(90),
    });
    await rejects(
      () =>
        incidents.act({
          context: commander,
          incident_control_id: paused.incident_control_id as UuidV7,
          action: 'CHECK',
          item_index: 0,
          expected_version: paused.version,
          reason_code: 'CHECKED',
          now: later(95),
        }),
      IncidentControlStateError,
      'A pause was changed against a stale version',
    );
    await rejects(
      () =>
        incidents.act({
          context: commander,
          incident_control_id: paused.incident_control_id as UuidV7,
          action: 'REVOKE',
          expected_version: reviewed.version,
          reason_code: 'CAUSE_FIXED',
          now: later(95),
        }),
      IncidentControlStateError,
      'A pause was lifted before its recovery checklist was worked',
    );
    const beforeLift = await snapshot();
    const lifted = await lift(paused.incident_control_id, later(100));
    check(
      lifted.state === 'REVOKED' && lifted.closed_by === people.commander,
      'The pause was not lifted',
    );
    // 7. Lifting it cancelled nothing, moved no goods and rewrote no money.
    const afterLift = await snapshot();
    const orders = await pool.query<{ vendor_order_id: string; lifecycle_state: string }>(
      'SELECT vendor_order_id, lifecycle_state FROM marketplace.vendor_orders WHERE vendor_order_id = ANY($1::uuid[])',
      [[orderA.vendor_order_id, orderC.vendor_order_id]],
    );
    const custody = await pool.query<{ partner_user_id: string; custody_state: string }>(
      'SELECT partner_user_id, custody_state FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1',
      [attemptId],
    );
    check(
      afterLift === beforeLift &&
        orders.rows.every((order) => order.lifecycle_state === 'READY') &&
        custody.rows[0]?.partner_user_id === people.rider &&
        custody.rows[0].custody_state === 'IN_CUSTODY',
      `Lifting the pause cancelled an order, moved goods or rewrote money (${JSON.stringify({ orders: orders.rows, custody: custody.rows })})`,
    );
    const requote = await checkout.createQuote({
      context: otherBasket.shopper,
      cart_id: otherBasket.cart_id,
      now: later(110),
    });
    check(
      requote.groups.length === 2,
      'The shop still refused new orders after the pause was lifted',
    );
    const history = await incidents.detail({
      context: commander,
      incident_control_id: paused.incident_control_id as UuidV7,
      now: later(110),
    });
    check(
      history.history.map((event) => event.event_type).join(',') ===
        [
          'ACTIVATED',
          'REVIEWED',
          ...history.recovery_checklist.map(() => 'CHECKLIST_ITEM_DONE'),
          'REVOKED',
        ].join(','),
      `The pause's history is not its steps (${JSON.stringify(history.history)})`,
    );
    const audited = await pool.query<{ action: string }>(
      `SELECT action FROM marketplace.operational_audit_events
        WHERE target_kind='INCIDENT_CONTROL' AND target_reference=$1 ORDER BY occurred_at`,
      [paused.incident_control_id],
    );
    check(
      audited.rows[0]?.action === 'INCIDENT_CONTROL_ENGAGED' &&
        audited.rows.at(-1)?.action === 'INCIDENT_CONTROL_REVOKE',
      'Engaging and lifting the pause were not audited',
    );

    // 8. Grouped checkout, paused only once a second person approves.
    const grouped = await engage(
      {
        control_key: 'GROUPED_CHECKOUT_PAUSE',
        scope_kind: 'GLOBAL',
        scope_reference: 'global',
        banner: 'SYNTH Ordering from more than one shop at once is paused.',
      },
      later(120),
    );
    check(
      grouped.state === 'PENDING_APPROVAL' && grouped.approval_required,
      'A global pause took force without approval',
    );
    const whilePending = await checkout.createQuote({
      context: otherBasket.shopper,
      cart_id: otherBasket.cart_id,
      now: later(125),
    });
    check(whilePending.groups.length === 2, 'A pause awaiting approval already paused checkout');
    await rejects(
      () =>
        incidents.act({
          context: commander,
          incident_control_id: grouped.incident_control_id as UuidV7,
          action: 'APPROVE',
          expected_version: grouped.version,
          reason_code: 'SELF_APPROVED',
          now: later(126),
        }),
      IncidentControlStateError,
      'A pause was approved by the person who proposed it',
    );
    const groupedOn = await incidents.act({
      context: second,
      incident_control_id: grouped.incident_control_id as UuidV7,
      action: 'APPROVE',
      expected_version: grouped.version,
      reason_code: 'SPLIT_RISK_CONFIRMED',
      now: later(130),
    });
    let groupedPlaceCode: string | undefined;
    try {
      await checkout.place({
        context: otherBasket.shopper,
        checkout_quote_id: whilePending.checkout_quote_id,
        provider_scenario: 'SUCCESS',
        idempotency_key: `incident-${people.other}`,
        now: later(135),
      });
    } catch (error) {
      groupedPlaceCode = (error as CheckoutConflictError).code;
    }
    check(
      groupedPlaceCode === 'GROUPED_CHECKOUT_PAUSED',
      `A grouped quote was placed while grouped checkout was paused (${groupedPlaceCode})`,
    );
    let groupedCode: string | undefined;
    try {
      await checkout.createQuote({
        context: otherBasket.shopper,
        cart_id: otherBasket.cart_id,
        now: later(136),
      });
    } catch (error) {
      groupedCode = (error as CheckoutConflictError).code;
    }
    check(
      groupedCode === 'GROUPED_CHECKOUT_PAUSED',
      `A grouped basket was quoted while grouped checkout was paused (${groupedCode})`,
    );
    // One shop still checks out -- and a paused way of paying does not.
    const storeQLine = await pool.query<{ cart_line_id: UuidV7 }>(
      `SELECT cl.cart_line_id FROM marketplace.cart_lines cl
         JOIN marketplace.cart_vendor_groups g USING (cart_vendor_group_id)
        WHERE g.cart_id=$1 AND g.vendor_location_id=$2 AND cl.lifecycle_state='ACTIVE'`,
      [otherBasket.cart_id, storeQ.locationId],
    );
    const lineQ = storeQLine.rows[0];
    check(lineQ, 'The second shop has no line to remove');
    await carts.removeLine({
      context: otherBasket.shopper,
      cart_line_id: lineQ.cart_line_id,
      now: later(137),
    });
    const single = await checkout.createQuote({
      context: otherBasket.shopper,
      cart_id: otherBasket.cart_id,
      now: later(138),
    });
    check(
      single.groups.length === 1,
      'A single shop could not check out while grouped checkout was paused',
    );

    // 9. A payment method: money, so a second person approves at any scope.
    const upi = await engage(
      {
        control_key: 'PAYMENT_PAUSE',
        scope_kind: 'PAYMENT_METHOD',
        scope_reference: 'UPI',
        banner: 'SYNTH UPI payments are paused; please pay another way.',
      },
      later(140),
    );
    check(upi.state === 'PENDING_APPROVAL', 'A payment pause took force without approval');
    await incidents.act({
      context: second,
      incident_control_id: upi.incident_control_id as UuidV7,
      action: 'APPROVE',
      expected_version: upi.version,
      reason_code: 'PROVIDER_UPI_DOWN',
      now: later(141),
    });
    let paymentCode: string | undefined;
    try {
      await checkout.place({
        context: otherBasket.shopper,
        checkout_quote_id: single.checkout_quote_id,
        provider_scenario: 'SUCCESS',
        payment_method: 'UPI',
        idempotency_key: `incident-upi-${people.other}`,
        now: later(142),
      });
    } catch (error) {
      paymentCode = (error as CheckoutConflictError).code;
    }
    const byCard = await checkout.place({
      context: otherBasket.shopper,
      checkout_quote_id: single.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      payment_method: 'CARD',
      idempotency_key: `incident-card-${people.other}`,
      now: later(143),
    });
    check(
      paymentCode === 'PAYMENT_PAUSED' && byCard.orders.length === 1,
      `The paused method was taken, or another was refused (${paymentCode})`,
    );
    await lift(groupedOn.incident_control_id, later(150));
    await lift(upi.incident_control_id, later(151));

    // 10. Substitutions: a shop cannot propose one while paused.
    const substitutions = await engage(
      {
        control_key: 'SUBSTITUTION_PAUSE',
        scope_reference: storeP.locationId,
        banner: 'SYNTH Substitutions are paused at this shop.',
      },
      later(160),
    );
    let substitutionRefusal = '';
    try {
      await fulfilment.proposeSubstitution({
        context: vendorP,
        vendor_order_id: orderC.vendor_order_id,
        vendor_location_id: storeP.locationId,
        vendor_order_line_id: createUuidV7(),
        substitution_variant_id: variantP,
        proposed_quantity: 1,
        proposed_unit_price_minor: 15_000,
        reason_note: 'SYNTH out of the usual',
        expected_version: 0,
        now: later(161),
      });
    } catch (error) {
      substitutionRefusal =
        error instanceof FulfilmentConflictError ? error.message : String(error);
    }
    check(
      /Substitutions are paused/.test(substitutionRefusal),
      `A substitution was proposed while substitutions were paused (${substitutionRefusal})`,
    );
    await lift(substitutions.incident_control_id, later(162));

    // 11. Paused delivery leaves pickup: the delivery group is blocked by method.
    const delivery = await engage(
      {
        control_key: 'DELIVERY_PAUSE',
        scope_reference: storeQ.locationId,
        banner: 'SYNTH Delivery from this shop is paused; pickup is open.',
      },
      later(170),
    );
    const fourth = createUuidV7();
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [fourth],
    );
    const fourthBasket = await basket(fourth, [0, 1], later(172));
    const underDelivery = await checkout.createQuote({
      context: fourthBasket.shopper,
      cart_id: fourthBasket.cart_id,
      now: later(172),
    });
    check(
      underDelivery.blocked_groups.some(
        (group) =>
          group.vendor_location_id === storeQ.locationId &&
          group.reason_code === 'FULFILMENT_METHOD_UNAVAILABLE',
      ) && underDelivery.groups.length === 1,
      `Paused delivery did not block the delivery group by its method (${JSON.stringify(underDelivery.blocked_groups)})`,
    );
    await lift(delivery.incident_control_id, later(173));

    // 12. A category pause expires on its own record, with no operator.
    const category = await engage(
      {
        control_key: 'CATEGORY_PAUSE',
        scope_kind: 'CATEGORY',
        scope_reference: 'FRUIT_VEGETABLE',
        banner: 'SYNTH Fresh produce is paused everywhere for a short while.',
        expires_at: later(180 + 600),
        review_at: later(180 + 300),
      },
      later(180),
    );
    let categoryBlocked = false;
    try {
      await checkout.createQuote({
        context: fourthBasket.shopper,
        cart_id: fourthBasket.cart_id,
        now: later(185),
      });
    } catch (error) {
      categoryBlocked = error instanceof CheckoutConflictError;
    }
    await incidents.expireDue({ context: commander, now: later(180 + 601) });
    const expired = await incidents.detail({
      context: commander,
      incident_control_id: category.incident_control_id as UuidV7,
      now: later(182 + 600),
    });
    check(
      categoryBlocked &&
        expired.state === 'EXPIRED' &&
        expired.history.at(-1)?.event_type === 'EXPIRED' &&
        expired.history.at(-1)?.actor_id === null,
      `The category pause did not stop its items, or did not expire on its record (${categoryBlocked}/${expired.state})`,
    );

    // 13. Each engagement is its own record; a closed one stays closed.
    const again = await engage(
      { scope_reference: storeP.locationId, reason_code: 'SECOND_OUTAGE' },
      later(200),
    );
    const records = await pool.query<{ lifecycle_state: string; reason_code: string }>(
      `SELECT lifecycle_state, reason_code FROM marketplace.incident_controls
        WHERE control_key='VENDOR_PAUSE' AND scope_reference=$1 ORDER BY created_at`,
      [storeP.locationId],
    );
    check(
      records.rows.length === 2 &&
        records.rows[0]?.lifecycle_state === 'REVOKED' &&
        records.rows[0].reason_code === 'STORE_POWER_CUT' &&
        records.rows[1]?.reason_code === 'SECOND_OUTAGE',
      `Re-engaging overwrote the earlier engagement (${JSON.stringify(records.rows)})`,
    );
    await lift(again.incident_control_id, later(201));
    let reopened = false;
    try {
      await pool.query(
        `UPDATE marketplace.incident_controls SET lifecycle_state='ACTIVE' WHERE incident_control_id=$1`,
        [paused.incident_control_id],
      );
    } catch (error) {
      reopened = (error as { code?: string }).code === '23514';
    }
    let selfApproved = false;
    try {
      await pool.query(
        `UPDATE marketplace.incident_controls SET approved_by=proposed_by WHERE incident_control_id=$1`,
        [grouped.incident_control_id],
      );
    } catch (error) {
      selfApproved = (error as { code?: string }).code === '23514';
    }
    check(
      reopened && selfApproved,
      'A closed pause reopened, or a pause was recorded as approved by its proposer',
    );
    const live = await pool.query(
      `SELECT 1 FROM marketplace.incident_controls c
        WHERE c.lifecycle_state IN ('ACTIVE','PENDING_APPROVAL')
          AND c.incident_control_id = ANY($1::uuid[])`,
      [
        [paused, grouped, upi, substitutions, delivery, category, again].map(
          (control) => control.incident_control_id,
        ),
      ],
    );
    check(live.rows.length === 0, 'The walk left a pause in force');
  } finally {
    await Promise.all([
      pool.end(),
      incidents.close(),
      fulfilment.close(),
      checkout.close(),
      carts.close(),
      catalogue.close(),
      inventory.close(),
    ]);
  }
}
