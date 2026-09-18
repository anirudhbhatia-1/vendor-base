import { createHash } from 'node:crypto';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  parseUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  AssignmentConflictError,
  AssignmentCustodyService,
  AssignmentNotFoundError,
} from '../src/assignment-custody.js';
import { CatalogueProductService } from '../src/catalogue-products.js';
import { CompleteMoneyLifecycleService } from '../src/complete-money-lifecycle.js';
import {
  MoneyAuthorizationError,
  MoneyLifecycleService,
  MoneyNotFoundError,
  MoneyStateError,
} from '../src/money-lifecycle.js';
import { OrderMoneyOrchestrator } from '../src/order-money-orchestrator.js';
import { CustomerCartService } from '../src/customer-cart.js';
import { DeliveryDispatchOrchestrator } from '../src/delivery-dispatch.js';
import { PartnerAvailabilityService } from '../src/partner-availability.js';
import { GroupedCheckoutService } from '../src/grouped-checkout.js';
import { IdentityAccessService } from '../src/identity-access.js';
import { InventoryReservationService } from '../src/inventory-reservations.js';
import {
  DEFAULT_ACCEPT_DEADLINE_SECONDS,
  FulfilmentAuthorizationError,
  FulfilmentConflictError,
  FulfilmentInputError,
  PickupOtpAlreadyIssuedError,
  FulfilmentNotFoundError,
  PickupOtpMismatchError,
  PickupOtpMissingError,
  VendorDeliveryOtpMismatchError,
  VendorFulfilmentService,
} from '../src/vendor-fulfilment.js';
import { createDiscoverableStoreFixture } from './verify-discoverable-store-fixture.js';
import {
  check,
  rejects,
  customerContext,
  vendorContext,
  adminContext,
  partnerContext,
  systemContext,
} from './verify-support.js';

export async function verifyVendorFulfilment(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const access = new IdentityAccessService({ connection_string: connectionString });
  const inventory = new InventoryReservationService({ connection_string: connectionString });
  const catalogue = new CatalogueProductService({ connection_string: connectionString });
  const carts = new CustomerCartService({ connection_string: connectionString });
  const checkout = new GroupedCheckoutService({ connection_string: connectionString });
  const fulfilment = new VendorFulfilmentService({
    connection_string: connectionString,
    inventory,
  });
  const assignments = new AssignmentCustodyService({ connection_string: connectionString });
  const now = new Date();
  const customerId = createUuidV7();
  const strangerCustomerId = createUuidV7();
  const systemActorId = createUuidV7();
  try {
    for (const userId of [customerId, strangerCustomerId, systemActorId]) {
      await pool.query(
        "INSERT INTO marketplace.users (user_id,state,data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
        [userId],
      );
    }

    // Build two stores, add stock, drop items into a cart, quote, and place.
    // This gives us two vendor_orders in a single checkout_group and lets
    // Phase 8 exercise its sibling-isolation invariants.
    const stores = await Promise.all(
      ['P', 'Q'].map((suffix, index) =>
        createDiscoverableStoreFixture(pool, {
          location_name: `SYNTH Fulfilment Store ${suffix}`,
          latitude: 26.911 + index * 0.001,
          longitude: 75.811,
          // Store P has one order delivered by a partner, one collected at the
          // counter and one carried by its own staff, so it must offer all
          // three; the cart now refuses a group at a store that lacks the
          // method (CUS-33).
          fulfilment_modes: ['PLATFORM_DELIVERY', 'CUSTOMER_PICKUP', 'VENDOR_DELIVERY'],
        }),
      ),
    );
    const products = [];
    for (const [index, store] of stores.entries()) {
      const suffix = `${Date.now()}${index}`;
      const product = await catalogue.createProduct({
        context: vendorContext(store.ownerUserId),
        vendor_location_id: store.locationId,
        product_reference: `SYNTH-PROD-F${suffix}`,
        title: `SYNTH Fulfilment Product ${index}`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-F${suffix}`,
        variant_title: `SYNTH Fulfilment Variant ${index}`,
        price_minor: 20_000,
        // Counted stock is provisioned with the product. Supplying it here is
        // what makes the auto-provisioned inventory row COUNTED rather than
        // VENDOR_CONFIRMS, which is the basis the rest of this fixture needs.
        initial_stock_quantity: 8,
        low_stock_threshold: 2,
        now,
      });
      products.push(product);
      // No separate createItem: `createProduct` provisions the inventory row
      // keyed by (vendor_location_id, product_reference) so discovery does not
      // treat a new product as stale, and creating one here duplicated that
      // key — which is why this fixture stopped working.
      const provisioned = await pool.query<{ quantity_basis: string }>(
        `SELECT quantity_basis FROM marketplace.inventory_items
          WHERE vendor_location_id=$1 AND product_reference=$2`,
        [store.locationId, `SYNTH-PROD-F${suffix}`],
      );
      check(
        provisioned.rows[0]?.quantity_basis === 'COUNTED',
        'Creating a catalogue product with initial stock did not provision a counted item',
      );
    }
    const addressId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.customer_addresses
        (customer_address_id,user_id,address_reference,label,pin_code,coordinates,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH-ADDRESS-FULFIL','SYNTH Fulfilment Home','302020',
         ST_SetSRID(ST_MakePoint(75.811,26.911),4326)::geography,$3,$3)`,
      [addressId, customerId, createUuidV7()],
    );
    const cart = await carts.currentCart({ context: customerContext(customerId), now });
    await carts.setCartAddress({
      context: customerContext(customerId),
      customer_address_id: addressId,
      now,
    });
    for (const [index, store] of stores.entries()) {
      const product = products[index];
      check(product !== undefined, 'Fixture product missing');
      await carts.addLine({
        context: customerContext(customerId),
        vendor_location_id: store.locationId,
        catalogue_variant_id: product.catalogue_variant_id,
        quantity: 2,
        now,
      });
    }
    const quote = await checkout.createQuote({
      context: customerContext(customerId),
      cart_id: cart.cart_id,
      now,
    });
    const placed = await checkout.place({
      context: customerContext(customerId),
      checkout_quote_id: quote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: 'phase8-place-001',
      now: new Date(now.getTime() + 1_000),
    });
    check(placed.orders.length === 2, 'Fixture must place two vendor_orders');
    const [orderA, orderB] = placed.orders;
    check(orderA !== undefined && orderB !== undefined, 'Placed orders missing');
    const storeA = stores.find((s) => s.locationId === orderA.vendor_location_id);
    const storeB = stores.find((s) => s.locationId === orderB.vendor_location_id);
    check(storeA !== undefined && storeB !== undefined, 'Store fixture lookup failed');

    // 8.1 -- placement itself sets the shop's response deadline. The ladder
    // used to issue the deadlines here, through a method nothing in production
    // called, so this passed while every real order sat without one.
    const placedAt = new Date(now.getTime() + 1_000);
    const expectedAcceptBy = placedAt.getTime() + DEFAULT_ACCEPT_DEADLINE_SECONDS * 1000;
    check(
      placed.orders.every(
        (order) =>
          order.accept_by instanceof Date && order.accept_by.getTime() === expectedAcceptBy,
      ),
      `Placing an order did not set accept_by to placement + ${DEFAULT_ACCEPT_DEADLINE_SECONDS}s (${JSON.stringify(placed.orders.map((order) => order.accept_by))})`,
    );

    // 8.2 -- vendor B declines their order. Sibling A must stay PLACED with
    // its holds intact.
    const declined = await fulfilment.decline({
      context: vendorContext(storeB.ownerUserId),
      vendor_order_id: orderB.vendor_order_id,
      vendor_location_id: storeB.locationId,
      expected_version: orderB.version,
      reason_code: 'OUT_OF_STOCK',
      note: 'SYNTH decline for sibling-isolation test.',
      now: new Date(now.getTime() + 3_000),
    });
    check(declined.lifecycle_state === 'CANCELLED', 'Decline did not cancel the order');
    const siblingCheck = await fulfilment.getOrder({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
    });
    check(
      siblingCheck.lifecycle_state === 'PLACED',
      'Sibling vendor order was affected by a decline elsewhere',
    );
    const siblingHold = await pool.query<{ state: string }>(
      `SELECT ir.reservation_state AS state FROM marketplace.vendor_order_lines l
         JOIN marketplace.inventory_reservations ir ON ir.reservation_id=l.inventory_reservation_id
        WHERE l.vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(
      siblingHold.rows.every((row) => row.state === 'PROVISIONAL'),
      'Sibling reservations were released by an unrelated decline',
    );
    const declinedHold = await pool.query<{ state: string }>(
      `SELECT ir.reservation_state AS state FROM marketplace.vendor_order_lines l
         JOIN marketplace.inventory_reservations ir ON ir.reservation_id=l.inventory_reservation_id
        WHERE l.vendor_order_id=$1`,
      [orderB.vendor_order_id],
    );
    check(
      declinedHold.rows.every((row) => row.state === 'RELEASED'),
      'Declined order did not release its own reservations',
    );

    // 8.2 -- vendor A accepts. Version guard rejects stale expected_version.
    await rejects(
      () =>
        fulfilment.accept({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          expected_version: orderA.version + 100,
          preparation_estimate_seconds: 900,
          now: new Date(now.getTime() + 4_000),
        }),
      FulfilmentConflictError,
      'A stale expected_version was allowed to accept',
    );
    const accepted = await fulfilment.accept({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: orderA.version,
      preparation_estimate_seconds: 900,
      now: new Date(now.getTime() + 5_000),
    });
    check(
      accepted.lifecycle_state === 'ACCEPTED' && accepted.preparation_estimate_seconds === 900,
      'Accept did not persist prep estimate',
    );

    // 8.2 -- another vendor cannot touch this order.
    await rejects(
      () =>
        fulfilment.startPicking({
          context: vendorContext(storeB.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeB.locationId,
          expected_version: accepted.version,
        }),
      FulfilmentNotFoundError,
      'Cross-vendor access to an order was permitted',
    );

    // 8.3 -- picking. Line must be marked before ready succeeds.
    const picking = await fulfilment.startPicking({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: accepted.version,
      now: new Date(now.getTime() + 6_000),
    });
    const lineRow = await pool.query<{ id: string }>(
      `SELECT vendor_order_line_id AS id FROM marketplace.vendor_order_lines
        WHERE vendor_order_id=$1 LIMIT 1`,
      [orderA.vendor_order_id],
    );
    const vendorOrderLineId = lineRow.rows[0]?.id;
    check(typeof vendorOrderLineId === 'string', 'Fixture vendor_order_lines missing');

    // Attempting to mark ready before the line is picked must fail, and must say
    // which kind of failure it is.
    //
    // Asserting only the error class let the refusal carry any code, and it
    // carried the one that reads "Something changed while you were working.
    // Refresh and try again." A reported session shows a vendor pressing Mark
    // ready five times in a minute against that advice: nothing had changed, and
    // refreshing resolves no pick line. The code is what decides the sentence the
    // vendor reads, so the code is what this asserts.
    let readyRefusal: string | undefined;
    try {
      await fulfilment.markReady({
        context: vendorContext(storeA.ownerUserId),
        vendor_order_id: orderA.vendor_order_id,
        vendor_location_id: storeA.locationId,
        expected_version: picking.version,
        package_count: 1,
      });
    } catch (error: unknown) {
      readyRefusal =
        error instanceof FulfilmentConflictError ? error.code : `unexpected:${String(error)}`;
    }
    check(
      readyRefusal === 'PICKING_INCOMPLETE',
      `Unresolved lines did not report themselves as unfinished picking (got ${readyRefusal})`,
    );

    // A genuinely stale version still says so, because refreshing does fix that.
    let staleRefusal: string | undefined;
    try {
      await fulfilment.markReady({
        context: vendorContext(storeA.ownerUserId),
        vendor_order_id: orderA.vendor_order_id,
        vendor_location_id: storeA.locationId,
        expected_version: picking.version + 99,
        package_count: 1,
      });
    } catch (error: unknown) {
      staleRefusal =
        error instanceof FulfilmentConflictError ? error.code : `unexpected:${String(error)}`;
    }
    check(
      staleRefusal === 'VERSION_CONFLICT',
      `A stale expected_version did not report a version conflict (got ${staleRefusal})`,
    );

    const found = await fulfilment.markLineFound({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      vendor_order_line_id: vendorOrderLineId as UuidV7,
      actual_quantity: 2,
      actual_unit_price_minor: 20_000,
      now: new Date(now.getTime() + 7_000),
    });
    check(found.pick_state === 'FOUND', 'Line pick did not persist FOUND state');

    // The pick list is the store's own. Store B's owner is a real vendor member
    // and could read A's pick list by order id under B's location -- the route
    // guard proved membership at B and the read never checked whose order it was.
    const ownPicks = await fulfilment.listPicks({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
    });
    check(
      ownPicks.some((pick) => pick.pick_state === 'FOUND'),
      'The store could not read its own pick list',
    );
    await rejects(
      () =>
        fulfilment.listPicks({
          context: vendorContext(storeB.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeB.locationId,
        }),
      FulfilmentNotFoundError,
      "Another store's member read this store's pick list",
    );

    // 8.5 -- ready succeeds now that every line is resolved.
    const ready = await fulfilment.markReady({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: picking.version,
      package_count: 1,
      package_condition_note: 'One sealed synthetic crate.',
      now: new Date(now.getTime() + 8_000),
    });
    check(
      ready.lifecycle_state === 'READY' && ready.package_count === 1,
      'Ready did not persist package count',
    );

    // 8.5b -- a platform delivery is handed to its partner, and to nobody else.
    //
    // The console asked the shopkeeper for a "customer's collection code" on
    // this order, while its partner was still being offered the job. Nobody
    // held such a code: the customer was at home with a delivery code for the
    // door, and the partner had nothing to present at all. A vendor who typed
    // a guess was told "that step is not available yet", the same sentence as
    // every other refusal. The handover below is the one the workflow
    // describes (6.7.5-6): the partner arrives, presents a code minted on their
    // own assignment, and the shop validates it.
    await rejects(
      () =>
        fulfilment.issueCustomerPickupOtp({
          context: customerContext(customerId),
          vendor_order_id: orderA.vendor_order_id,
          now: new Date(now.getTime() + 8_500),
        }),
      FulfilmentConflictError,
      'A customer minted a collection code for an order a partner is delivering',
    );
    // With no partner at the counter the shop can neither hand over nor issue a
    // fallback, and the refusal has to say why -- not "something changed".
    const refusalCode = async (work: () => Promise<unknown>): Promise<string> => {
      try {
        await work();
        return 'accepted';
      } catch (error: unknown) {
        return error instanceof FulfilmentConflictError
          ? error.code
          : `unexpected:${String(error)}`;
      }
    };
    const noPartnerYet = await refusalCode(() =>
      fulfilment.completePickup({
        context: vendorContext(storeA.ownerUserId),
        vendor_order_id: orderA.vendor_order_id,
        vendor_location_id: storeA.locationId,
        otp: '000000',
        now: new Date(now.getTime() + 8_600),
      }),
    );
    check(
      noPartnerYet === 'PARTNER_NOT_PRESENT',
      `Handover with no partner was not refused as PARTNER_NOT_PRESENT (got ${noPartnerYet})`,
    );
    const noPartnerFallback = await refusalCode(() =>
      fulfilment.issuePickupOtp({
        context: vendorContext(storeA.ownerUserId),
        reason_code: 'PARTNER_DEVICE_UNAVAILABLE',
        vendor_order_id: orderA.vendor_order_id,
        vendor_location_id: storeA.locationId,
        now: new Date(now.getTime() + 8_700),
      }),
    );
    check(
      noPartnerFallback === 'PARTNER_NOT_PRESENT',
      `A fallback code was issued with no partner present (got ${noPartnerFallback})`,
    );

    // The delivery leg begins here rather than after the handover, because the
    // handover is part of it.
    const partnerId = createUuidV7();
    const adminId = createUuidV7();
    const partner = partnerContext(partnerId);
    const partnerAdmin = createRequestContext({
      actor: createAuthenticatedActor({
        actor_id: adminId,
        actor_kind: 'admin',
        session_id: createUuidV7(),
      }),
    });
    for (const userId of [partnerId, adminId]) {
      await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1)', [userId]);
    }
    const roleId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.role_assignments
        (role_assignment_id,user_id,role_key,state,valid_from,valid_until,
         granted_by_user_id,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,'DELIVERY_PARTNER','ACTIVE',$3,$4,$5,$6,$6,$3,$3)`,
      [roleId, partnerId, now, new Date(now.getTime() + 86_400_000), adminId, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.partner_eligibilities
        (partner_eligibility_id,role_assignment_id,user_id,state,eligible_from,
         eligible_until,reason_code,updated_at)
       VALUES ($1,$2,$3,'ELIGIBLE',$4,$5,'SYNTH_PARTNER_DELIVERY',$4)`,
      [createUuidV7(), roleId, partnerId, now, new Date(now.getTime() + 86_400_000)],
    );

    const created = await assignments.create({
      approximate_drop_area: 'SYNTH Vaishali Nagar Jaipur',
      approximate_pickup_area: 'SYNTH Fulfilment Store Jaipur',
      command_reference: 'SYNTH-CMD-CREATE-DELIVERY-CLOSURE',
      context: partnerAdmin,
      handling_flags: [],
      now: new Date(now.getTime() + 60_000),
      package_count: 1,
      reason_code: 'ORDER_PLACED_AUTO_DISPATCH',
      source_order_reference: orderA.order_reference,
      vendor_location_id: storeA.locationId,
      vendor_order_id: orderA.vendor_order_id,
    });
    const offered = await assignments.offer({
      command_reference: 'SYNTH-CMD-OFFER-DELIVERY-CLOSURE',
      context: partnerAdmin,
      delivery_assignment_id: created.delivery_assignment_id,
      expected_version: created.version,
      expires_at: new Date(now.getTime() + 120_000),
      now: new Date(now.getTime() + 61_000),
      partner_user_id: partnerId,
      reason_code: 'SYNTH_OFFER_CREATED',
    });
    const acceptedOffer = await assignments.accept({
      command_reference: 'SYNTH-CMD-ACCEPT-DELIVERY-CLOSURE',
      context: partner,
      delivery_assignment_id: created.delivery_assignment_id,
      expected_version: offered.version,
      now: new Date(now.getTime() + 62_000),
      reason_code: 'PARTNER_ACCEPTED',
    });

    // The partner is assigned but on the road: no code from there, and the
    // shop still cannot hand over.
    await rejects(
      () =>
        fulfilment.issuePartnerPickupOtp({
          context: partner,
          delivery_assignment_id: created.delivery_assignment_id,
          now: new Date(now.getTime() + 62_500),
        }),
      FulfilmentConflictError,
      'A partner minted a pickup code before arriving at the store',
    );
    const stillOnTheRoad = await refusalCode(() =>
      fulfilment.completePickup({
        context: vendorContext(storeA.ownerUserId),
        vendor_order_id: orderA.vendor_order_id,
        vendor_location_id: storeA.locationId,
        otp: '000000',
        now: new Date(now.getTime() + 62_600),
      }),
    );
    check(
      stillOnTheRoad === 'PARTNER_NOT_PRESENT',
      `Handover before arrival was not refused as PARTNER_NOT_PRESENT (got ${stillOnTheRoad})`,
    );
    const atVendor = await assignments.arriveAtVendor({
      command_reference: 'SYNTH-CMD-AT-VENDOR-DELIVERY-CLOSURE',
      context: partner,
      delivery_assignment_id: created.delivery_assignment_id,
      expected_version: acceptedOffer.version,
      now: new Date(now.getTime() + 63_000),
      reason_code: 'VENDOR_LOCATION_ARRIVAL',
    });
    const beforeCustody = await assignments.listActiveForPartner({
      partner_user_id: partnerId,
    });
    check(
      beforeCustody.some(
        (entry) => entry.delivery_assignment_id === created.delivery_assignment_id,
      ),
      'An accepted assignment did not appear in the partner’s active list',
    );
    check(
      beforeCustody.every((entry) => !entry.drop_address),
      'The customer’s address was disclosed before the partner took custody',
    );

    // 8.10 -- the shop can see who is collecting.
    //
    // A packed order showed READY whether a partner was riding over, standing
    // at the counter, or had already left after waiting — so an order needing
    // re-dispatch looked identical to one about to be collected. Asserted on
    // the real assignment while it is genuinely at the counter, with a wait
    // timer at the threshold the shop most needs to see.
    await pool.query(
      `INSERT INTO marketplace.partner_wait_timers
         (partner_wait_timer_id, delivery_assignment_id, partner_user_id, wait_state, started_at,
          first_threshold_seconds, leave_threshold_seconds, max_credit_seconds,
          rate_minor_per_minute, request_id, correlation_id)
       VALUES ($1,$2,$3,'THRESHOLD_TWO',$4,300,600,900,200,$5,$5)`,
      [createUuidV7(), created.delivery_assignment_id, partnerId, now, createUuidV7()],
    );
    const board = await fulfilment.listVendorOrders({
      context: vendorContext(storeA.ownerUserId),
      vendor_location_id: storeA.locationId,
    });
    const withPartner = board.find((entry) => entry.vendor_order_id === orderA.vendor_order_id);
    check(
      withPartner?.collection?.assignment_state === 'AT_VENDOR',
      'The vendor board did not show that a partner is at the counter',
    );
    check(
      withPartner?.fulfilment_method === 'PLATFORM_DELIVERY',
      'The vendor board did not say a partner delivers this order',
    );
    check(
      withPartner?.collection?.wait_state === 'THRESHOLD_TWO' &&
        withPartner?.collection?.partner_waiting_since !== null,
      'The vendor board did not show that the partner is waiting and may leave',
    );
    check(
      board.every((entry) => !('partner_user_id' in entry)),
      "The vendor board exposed the partner's identity",
    );
    // The wait ends with the handover below; closing it keeps the fixture's
    // record honest for the wait-policy reads later in the ladder.
    await pool.query(
      `UPDATE marketplace.partner_wait_timers SET wait_state='RESOLVED', ended_at=$2
        WHERE delivery_assignment_id=$1`,
      [created.delivery_assignment_id, new Date(now.getTime() + 63_050)],
    );

    // 8.6 -- at the counter. A stranger cannot mint on this assignment; the
    // shop cannot complete against a code nobody has issued; the partner's
    // code, once issued, is as canonical as a customer's.
    // A real, known partner -- not an unknown id, which the event's foreign key
    // would refuse before the ownership check was ever reached.
    const strangerPartnerId = createUuidV7();
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [strangerPartnerId],
    );
    await rejects(
      () =>
        fulfilment.issuePartnerPickupOtp({
          context: partnerContext(strangerPartnerId),
          delivery_assignment_id: created.delivery_assignment_id,
          now: new Date(now.getTime() + 63_100),
        }),
      FulfilmentNotFoundError,
      "A stranger minted a pickup code on another partner's assignment",
    );
    await rejects(
      () =>
        fulfilment.completePickup({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          otp: '000000',
          now: new Date(now.getTime() + 63_200),
        }),
      PickupOtpMissingError,
      'Handover with no code issued was not refused as a missing code',
    );
    const partnerCode = await fulfilment.issuePartnerPickupOtp({
      context: partner,
      delivery_assignment_id: created.delivery_assignment_id,
      now: new Date(now.getTime() + 63_300),
    });
    check(/^[0-9]{6}$/.test(partnerCode.plaintext_otp), 'Partner pickup code shape wrong');
    const partnerIssuer = await pool.query<{ issuer: string; hash: string }>(
      `SELECT pickup_otp_issued_by AS issuer, pickup_otp_hash AS hash
           FROM marketplace.vendor_orders WHERE vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(
      partnerIssuer.rows[0]?.issuer === 'PARTNER' &&
        partnerIssuer.rows[0]?.hash ===
          createHash('sha256').update(partnerCode.plaintext_otp).digest('hex'),
      "The partner's code was not stored as the partner's, hashed",
    );
    const partnerIssueEvent = await pool.query<{ actor_kind: string; reason_code: string }>(
      `SELECT actor_kind, reason_code FROM marketplace.vendor_order_events
          WHERE vendor_order_id=$1 AND event_type='PICKUP_OTP_ISSUED'
          ORDER BY occurred_at DESC LIMIT 1`,
      [orderA.vendor_order_id],
    );
    check(
      partnerIssueEvent.rows[0]?.actor_kind === 'delivery_partner' &&
        partnerIssueEvent.rows[0]?.reason_code === 'PARTNER_PICKUP_OTP_ISSUED',
      'The partner-issued code was not attributed to the partner on the order record',
    );
    await rejects(
      () =>
        fulfilment.issuePickupOtp({
          context: vendorContext(storeA.ownerUserId),
          reason_code: 'PARTNER_DEVICE_UNAVAILABLE',
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          now: new Date(now.getTime() + 63_400),
        }),
      PickupOtpAlreadyIssuedError,
      "A vendor fallback code displaced the partner's live pickup code",
    );

    // Wrong code: counted, and refused as a mismatch rather than a state.
    await rejects(
      () =>
        fulfilment.completePickup({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          otp: partnerCode.plaintext_otp === '000000' ? '000001' : '000000',
          now: new Date(now.getTime() + 63_500),
        }),
      PickupOtpMismatchError,
      'A wrong OTP was accepted',
    );
    const attemptCheck = await pool.query<{ count: number }>(
      `SELECT pickup_otp_attempts::int AS count FROM marketplace.vendor_orders WHERE vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(
      attemptCheck.rows[0]?.count === 1,
      'Failed OTP attempt did not increment the attempt counter',
    );

    const pickedUp = await fulfilment.completePickup({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderA.vendor_order_id,
      vendor_location_id: storeA.locationId,
      otp: partnerCode.plaintext_otp,
      proof_note: 'Handed to the delivery partner.',
      now: new Date(now.getTime() + 63_600),
    });
    check(
      pickedUp.lifecycle_state === 'PICKED_UP' && pickedUp.picked_up_at !== null,
      'Pickup did not complete',
    );
    // The record says a partner took it. Written as a customer collection, the
    // one fact support reads first would have been wrong.
    const handoverRecord = await pool.query<{ reason_code: string; transition_reason: string }>(
      `SELECT e.reason_code,
                (SELECT t.reason_code FROM marketplace.aggregate_transitions t
                  WHERE t.aggregate_type='vendor_order' AND t.aggregate_id=e.vendor_order_id
                    AND t.to_state='PICKED_UP'
                  ORDER BY t.occurred_at DESC LIMIT 1) AS transition_reason
           FROM marketplace.vendor_order_events e
          WHERE e.vendor_order_id=$1 AND e.event_type='PICKED_UP'`,
      [orderA.vendor_order_id],
    );
    check(
      handoverRecord.rows[0]?.reason_code === 'PARTNER_PICKUP_COMPLETED' &&
        handoverRecord.rows[0]?.transition_reason === 'PARTNER_PICKUP_COMPLETED',
      `A partner handover was recorded as ${handoverRecord.rows[0]?.reason_code} / ${handoverRecord.rows[0]?.transition_reason}`,
    );

    // 8.6 -- an already-completed order cannot pickup again, and its OTP is cleared.
    const cleared = await pool.query<{ hash: string | null }>(
      `SELECT pickup_otp_hash AS hash FROM marketplace.vendor_orders WHERE vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(cleared.rows[0]?.hash === null, 'Pickup did not clear the OTP hash');
    await rejects(
      () =>
        fulfilment.completePickup({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          otp: partnerCode.plaintext_otp,
          now: new Date(now.getTime() + 63_700),
        }),
      FulfilmentConflictError,
      'A completed order accepted a second pickup',
    );

    // 8.6 -- inventory holds committed via the outbox-triggered path.
    const committed = await fulfilment.settleInventoryOnPickup({
      context: systemContext(systemActorId),
      vendor_order_id: orderA.vendor_order_id,
      now: new Date(now.getTime() + 13_000),
    });
    check(committed >= 1, 'Inventory commit for pickup did not run');
    const finalState = await pool.query<{ state: string }>(
      `SELECT ir.reservation_state AS state FROM marketplace.vendor_order_lines l
         JOIN marketplace.inventory_reservations ir ON ir.reservation_id=l.inventory_reservation_id
        WHERE l.vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(
      finalState.rows.every((row) => row.state === 'COMMITTED'),
      'Reservations were not committed on pickup',
    );

    // 8.5c -- a collected order: the customer's code is canonical and the
    // vendor cannot displace it (CUS-51, VEN-35).
    //
    // These assertions used to run on orderA, which a partner delivers -- the
    // customer minted a "collection code" for an order they were never going
    // to collect, and the walk got through the counter on a fallback issued
    // for a customer whose phone was fine. They now run on an order the
    // customer actually collects.
    //
    // Both issuers wrote `pickup_otp_hash` on the same row, so whichever ran
    // last silently invalidated the other: a customer who opened their code and
    // then met a shopkeeper who tapped "Issue pickup code" was refused at the
    // counter, with nothing on either screen explaining why.
    const collectionBase = new Date(now.getTime() + 20_000);
    const collectionProduct = products[stores.indexOf(storeA)];
    check(collectionProduct !== undefined, 'Collection fixture product missing');
    const collectionCart = await carts.currentCart({
      context: customerContext(customerId),
      now: collectionBase,
    });
    await carts.setCartAddress({
      context: customerContext(customerId),
      customer_address_id: addressId,
      now: collectionBase,
    });
    const withLine = await carts.addLine({
      context: customerContext(customerId),
      vendor_location_id: storeA.locationId,
      catalogue_variant_id: collectionProduct.catalogue_variant_id,
      quantity: 1,
      now: collectionBase,
    });
    const collectionGroup = withLine.groups.find(
      (group) => group.vendor_location_id === storeA.locationId,
    );
    check(collectionGroup !== undefined, 'Collection cart group missing');
    await carts.setGroupFulfilmentMethod({
      context: customerContext(customerId),
      cart_vendor_group_id: collectionGroup.cart_vendor_group_id,
      expected_version: collectionGroup.version,
      fulfilment_method: 'CUSTOMER_PICKUP',
      now: collectionBase,
    });
    const collectionQuote = await checkout.createQuote({
      context: customerContext(customerId),
      cart_id: collectionCart.cart_id,
      now: collectionBase,
    });
    const collectionPlaced = await checkout.place({
      context: customerContext(customerId),
      checkout_quote_id: collectionQuote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: 'phase8-collection-001',
      now: new Date(collectionBase.getTime() + 1_000),
    });
    const orderP = collectionPlaced.orders[0];
    check(
      orderP !== undefined && collectionPlaced.orders.length === 1,
      'Collection fixture must place exactly one vendor order',
    );
    const acceptedP = await fulfilment.accept({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderP.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: orderP.version,
      preparation_estimate_seconds: 600,
      now: new Date(collectionBase.getTime() + 2_000),
    });
    // A transition's own response says how the order leaves the shop. The
    // RETURNING projection it used to answer with reported every order as a
    // platform delivery, so the console acted on the wrong method until it
    // polled again.
    check(
      acceptedP.fulfilment_method === 'CUSTOMER_PICKUP',
      `Accepting a collection order answered fulfilment_method ${acceptedP.fulfilment_method}`,
    );
    const pickingP = await fulfilment.startPicking({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderP.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: acceptedP.version,
      now: new Date(collectionBase.getTime() + 3_000),
    });
    const collectionLine = await pool.query<{ id: string }>(
      `SELECT vendor_order_line_id AS id FROM marketplace.vendor_order_lines
        WHERE vendor_order_id=$1 LIMIT 1`,
      [orderP.vendor_order_id],
    );
    check(typeof collectionLine.rows[0]?.id === 'string', 'Collection order line missing');
    await fulfilment.markLineFound({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderP.vendor_order_id,
      vendor_location_id: storeA.locationId,
      vendor_order_line_id: collectionLine.rows[0].id as UuidV7,
      actual_quantity: 1,
      actual_unit_price_minor: 20_000,
      now: new Date(collectionBase.getTime() + 4_000),
    });
    const readyP = await fulfilment.markReady({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderP.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: pickingP.version,
      package_count: 1,
      now: new Date(collectionBase.getTime() + 5_000),
    });
    check(readyP.lifecycle_state === 'READY', 'Collection order did not reach READY');
    // While it is READY -- so that the method check, not the state check, is
    // what refuses it -- a collected order cannot be sent out with store staff.
    await rejects(
      () =>
        fulfilment.startVendorDelivery({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderP.vendor_order_id,
          vendor_location_id: storeA.locationId,
          expected_version: readyP.version,
          now: new Date(collectionBase.getTime() + 5_050),
        }),
      FulfilmentConflictError,
      'A collected order was sent out with store staff',
    );
    const stillReady = await fulfilment.getOrder({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderP.vendor_order_id,
    });
    check(
      stillReady.lifecycle_state === 'READY' && stillReady.version === readyP.version,
      'A refused self-delivery start still changed the collected order',
    );
    const onBoard = await fulfilment.getOrder({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderP.vendor_order_id,
    });
    check(
      onBoard.fulfilment_method === 'CUSTOMER_PICKUP',
      `The vendor board did not say the customer collects this order (got ${onBoard.fulfilment_method})`,
    );

    const customerCode = await fulfilment.issueCustomerPickupOtp({
      context: customerContext(customerId),
      vendor_order_id: orderP.vendor_order_id,
      now: new Date(collectionBase.getTime() + 6_000),
    });
    await rejects(
      () =>
        fulfilment.issuePickupOtp({
          context: vendorContext(storeA.ownerUserId),
          reason_code: 'CUSTOMER_DEVICE_UNAVAILABLE',
          vendor_order_id: orderP.vendor_order_id,
          vendor_location_id: storeA.locationId,
          now: new Date(collectionBase.getTime() + 6_100),
        }),
      PickupOtpAlreadyIssuedError,
      'A vendor fallback code displaced the live customer collection code',
    );
    const survived = await pool.query<{ hash: string; issuer: string }>(
      `SELECT pickup_otp_hash AS hash, pickup_otp_issued_by AS issuer
         FROM marketplace.vendor_orders WHERE vendor_order_id=$1`,
      [orderP.vendor_order_id],
    );
    check(
      survived.rows[0]?.hash ===
        createHash('sha256').update(customerCode.plaintext_otp).digest('hex') &&
        survived.rows[0]?.issuer === 'CUSTOMER',
      "The customer's collection code did not survive the vendor's attempt",
    );

    // Once that code is gone, the fallback is available — a customer with a
    // dead phone still has to be able to collect (CUS-51 alternative proof).
    await pool.query(
      `UPDATE marketplace.vendor_orders
          SET pickup_otp_hash=NULL, pickup_otp_expires_at=NULL, pickup_otp_issued_by=NULL
        WHERE vendor_order_id=$1`,
      [orderP.vendor_order_id],
    );
    await rejects(
      () =>
        fulfilment.issuePickupOtp({
          context: vendorContext(storeA.ownerUserId),
          reason_code: 'not-a-reason-code',
          vendor_order_id: orderP.vendor_order_id,
          vendor_location_id: storeA.locationId,
          now: new Date(collectionBase.getTime() + 6_200),
        }),
      FulfilmentInputError,
      'A fallback code was issued without a valid reason code',
    );
    const fallback = await fulfilment.issuePickupOtp({
      context: vendorContext(storeA.ownerUserId),
      reason_code: 'CUSTOMER_DEVICE_UNAVAILABLE',
      vendor_order_id: orderP.vendor_order_id,
      vendor_location_id: storeA.locationId,
      now: new Date(collectionBase.getTime() + 6_300),
    });
    const fallbackIssuer = await pool.query<{ issuer: string; reason_code: string }>(
      `SELECT o.pickup_otp_issued_by AS issuer,
              (SELECT e.reason_code FROM marketplace.vendor_order_events e
                WHERE e.vendor_order_id=o.vendor_order_id AND e.event_type='PICKUP_OTP_ISSUED'
                ORDER BY e.occurred_at DESC LIMIT 1) AS reason_code
         FROM marketplace.vendor_orders o WHERE o.vendor_order_id=$1`,
      [orderP.vendor_order_id],
    );
    check(
      fallbackIssuer.rows[0]?.issuer === 'VENDOR_FALLBACK' &&
        fallbackIssuer.rows[0]?.reason_code === 'CUSTOMER_DEVICE_UNAVAILABLE',
      'A vendor-issued code was not recorded as the fallback path with its reason',
    );
    const collected = await fulfilment.completePickup({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderP.vendor_order_id,
      vendor_location_id: storeA.locationId,
      otp: fallback.plaintext_otp,
      proof_note: 'Handed to the customer.',
      now: new Date(collectionBase.getTime() + 7_000),
    });
    const collectionRecord = await pool.query<{ reason_code: string }>(
      `SELECT reason_code FROM marketplace.vendor_order_events
        WHERE vendor_order_id=$1 AND event_type='PICKED_UP'`,
      [orderP.vendor_order_id],
    );
    check(
      collected.lifecycle_state === 'PICKED_UP' &&
        collectionRecord.rows[0]?.reason_code === 'CUSTOMER_PICKUP_COMPLETED',
      'A customer collection was not completed and recorded as one',
    );

    // 8.5d -- vendor self-delivery (VEN-37, workflow 6.7): the shop's own staff
    // carry the order. Before this leg existed a VENDOR_DELIVERY order reached
    // READY and stopped: the console said the step was unavailable, the
    // customer's delivery code needed a delivery assignment the order never
    // had, and the domain accepted a vendor fallback collection code on it --
    // which would have recorded a collection nobody made and left the order at
    // PICKED_UP, where nothing settles.
    const selfBase = new Date(now.getTime() + 30_000);
    const selfCart = await carts.currentCart({
      context: customerContext(customerId),
      now: selfBase,
    });
    await carts.setCartAddress({
      context: customerContext(customerId),
      customer_address_id: addressId,
      now: selfBase,
    });
    await carts.addLine({
      context: customerContext(customerId),
      vendor_location_id: storeA.locationId,
      catalogue_variant_id: collectionProduct.catalogue_variant_id,
      quantity: 1,
      fulfilment_method: 'VENDOR_DELIVERY',
      now: selfBase,
    });
    const selfQuote = await checkout.createQuote({
      context: customerContext(customerId),
      cart_id: selfCart.cart_id,
      now: selfBase,
    });
    const selfQuoteGroup = selfQuote.groups[0];
    check(
      selfQuote.groups.length === 1 &&
        selfQuoteGroup?.fulfilment_method === 'VENDOR_DELIVERY' &&
        selfQuoteGroup.delivery_minor > 0,
      'A self-delivered group was not quoted with a delivery fee',
    );
    const selfPlaced = await checkout.place({
      context: customerContext(customerId),
      checkout_quote_id: selfQuote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: 'phase8-self-delivery-001',
      now: new Date(selfBase.getTime() + 1_000),
    });
    const orderV = selfPlaced.orders[0];
    check(
      orderV !== undefined && selfPlaced.orders.length === 1,
      'Self-delivery fixture must place exactly one vendor order',
    );
    const acceptedV = await fulfilment.accept({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderV.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: orderV.version,
      preparation_estimate_seconds: 600,
      now: new Date(selfBase.getTime() + 2_000),
    });
    check(
      acceptedV.fulfilment_method === 'VENDOR_DELIVERY',
      `Accepting a self-delivery answered fulfilment_method ${acceptedV.fulfilment_method}`,
    );
    const pickingV = await fulfilment.startPicking({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderV.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: acceptedV.version,
      now: new Date(selfBase.getTime() + 3_000),
    });
    const selfLine = await pool.query<{ id: string }>(
      `SELECT vendor_order_line_id AS id FROM marketplace.vendor_order_lines
        WHERE vendor_order_id=$1 LIMIT 1`,
      [orderV.vendor_order_id],
    );
    check(typeof selfLine.rows[0]?.id === 'string', 'Self-delivery order line missing');
    await fulfilment.markLineFound({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderV.vendor_order_id,
      vendor_location_id: storeA.locationId,
      vendor_order_line_id: selfLine.rows[0].id as UuidV7,
      actual_quantity: 1,
      actual_unit_price_minor: 20_000,
      now: new Date(selfBase.getTime() + 4_000),
    });
    const readyV = await fulfilment.markReady({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderV.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: pickingV.version,
      package_count: 1,
      now: new Date(selfBase.getTime() + 5_000),
    });
    check(readyV.lifecycle_state === 'READY', 'Self-delivery order did not reach READY');

    // Nothing is validated at the counter on a self-delivery: neither the
    // customer's collection code nor the vendor's fallback applies, and the
    // customer's delivery code does not exist until the goods have left.
    await rejects(
      () =>
        fulfilment.issueCustomerPickupOtp({
          context: customerContext(customerId),
          vendor_order_id: orderV.vendor_order_id,
          now: new Date(selfBase.getTime() + 5_100),
        }),
      FulfilmentConflictError,
      'A customer minted a collection code for an order the store delivers itself',
    );
    await rejects(
      () =>
        fulfilment.issuePickupOtp({
          context: vendorContext(storeA.ownerUserId),
          reason_code: 'CUSTOMER_DEVICE_UNAVAILABLE',
          vendor_order_id: orderV.vendor_order_id,
          vendor_location_id: storeA.locationId,
          now: new Date(selfBase.getTime() + 5_200),
        }),
      FulfilmentConflictError,
      'A vendor fallback collection code was issued on a self-delivered order',
    );
    await rejects(
      () =>
        fulfilment.issueVendorDeliveryOtp({
          context: customerContext(customerId),
          vendor_order_id: orderV.vendor_order_id,
          now: new Date(selfBase.getTime() + 5_300),
        }),
      FulfilmentConflictError,
      'A delivery code was minted before the order left the shop',
    );
    await rejects(
      () =>
        fulfilment.completeVendorDelivery({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderV.vendor_order_id,
          vendor_location_id: storeA.locationId,
          otp: '123456',
          now: new Date(selfBase.getTime() + 5_400),
        }),
      FulfilmentConflictError,
      'A self-delivery was completed before it started',
    );
    await rejects(
      () =>
        fulfilment.startVendorDelivery({
          context: vendorContext(storeB.ownerUserId),
          vendor_order_id: orderV.vendor_order_id,
          vendor_location_id: storeB.locationId,
          expected_version: readyV.version,
          now: new Date(selfBase.getTime() + 5_500),
        }),
      FulfilmentNotFoundError,
      "Another store's staff started a self-delivery they do not own",
    );
    let staleStart: unknown;
    try {
      await fulfilment.startVendorDelivery({
        context: vendorContext(storeA.ownerUserId),
        vendor_order_id: orderV.vendor_order_id,
        vendor_location_id: storeA.locationId,
        expected_version: readyV.version + 1,
        now: new Date(selfBase.getTime() + 5_600),
      });
    } catch (error) {
      staleStart = error;
    }
    check(
      staleStart instanceof FulfilmentConflictError && staleStart.code === 'VERSION_CONFLICT',
      `A stale self-delivery start was not refused as VERSION_CONFLICT (raised ${String(staleStart)})`,
    );
    const outV = await fulfilment.startVendorDelivery({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderV.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: readyV.version,
      proof_note: 'Left with store staff.',
      now: new Date(selfBase.getTime() + 6_000),
    });
    const startRecord = await pool.query<{
      reason_code: string;
      carrier: string | null;
      out_at: Date | null;
    }>(
      `SELECT e.reason_code, o.vendor_delivery_by_user_id::text AS carrier,
              o.out_for_delivery_at AS out_at
         FROM marketplace.vendor_orders o
         JOIN marketplace.vendor_order_events e
           ON e.vendor_order_id = o.vendor_order_id AND e.event_type = 'PICKED_UP'
        WHERE o.vendor_order_id=$1`,
      [orderV.vendor_order_id],
    );
    check(
      outV.lifecycle_state === 'PICKED_UP' &&
        outV.out_for_delivery_at !== null &&
        startRecord.rows[0]?.reason_code === 'VENDOR_DELIVERY_STARTED' &&
        startRecord.rows[0].carrier === storeA.ownerUserId &&
        startRecord.rows[0].out_at !== null,
      'Starting a self-delivery did not record the goods leaving with a named member of staff',
    );
    const selfInventory = await fulfilment.settleInventoryOnPickup({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderV.vendor_order_id,
      now: new Date(selfBase.getTime() + 6_500),
    });
    check(selfInventory >= 1, 'Inventory commit for a self-delivery did not run');

    // At the door. The customer opens their code; the shop's staff type it.
    const doorCode = await fulfilment.issueVendorDeliveryOtp({
      context: customerContext(customerId),
      vendor_order_id: orderV.vendor_order_id,
      now: new Date(selfBase.getTime() + 7_000),
    });
    await rejects(
      () =>
        fulfilment.issueVendorDeliveryOtp({
          context: customerContext(strangerCustomerId),
          vendor_order_id: orderV.vendor_order_id,
          now: new Date(selfBase.getTime() + 7_050),
        }),
      FulfilmentNotFoundError,
      'Another customer minted a delivery code for an order they do not own',
    );
    const wrongCode = String((Number(doorCode.plaintext_otp) + 1) % 1_000_000).padStart(6, '0');
    await rejects(
      () =>
        fulfilment.completeVendorDelivery({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderV.vendor_order_id,
          vendor_location_id: storeA.locationId,
          otp: wrongCode,
          now: new Date(selfBase.getTime() + 7_100),
        }),
      VendorDeliveryOtpMismatchError,
      'A wrong delivery code completed a self-delivery',
    );
    const counted = await pool.query<{ attempts: number }>(
      `SELECT delivery_otp_attempts AS attempts FROM marketplace.vendor_orders WHERE vendor_order_id=$1`,
      [orderV.vendor_order_id],
    );
    check(counted.rows[0]?.attempts === 1, 'A wrong delivery code was not counted');
    const deliveredV = await fulfilment.completeVendorDelivery({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderV.vendor_order_id,
      vendor_location_id: storeA.locationId,
      otp: doorCode.plaintext_otp,
      proof_note: 'Delivered by store staff.',
      now: new Date(selfBase.getTime() + 8_000),
    });
    const doorRecord = await pool.query<{ reason_code: string; hash: string | null }>(
      `SELECT e.reason_code, o.delivery_otp_hash AS hash
         FROM marketplace.vendor_orders o
         JOIN marketplace.vendor_order_events e
           ON e.vendor_order_id = o.vendor_order_id AND e.event_type = 'DELIVERED'
        WHERE o.vendor_order_id=$1`,
      [orderV.vendor_order_id],
    );
    check(
      deliveredV.lifecycle_state === 'DELIVERED' &&
        doorRecord.rows[0]?.reason_code === 'VENDOR_DELIVERY_COMPLETED' &&
        doorRecord.rows[0].hash === null,
      'A self-delivery was not completed, recorded as one, and its code spent',
    );
    await rejects(
      () =>
        fulfilment.completeVendorDelivery({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderV.vendor_order_id,
          vendor_location_id: storeA.locationId,
          otp: doorCode.plaintext_otp,
          now: new Date(selfBase.getTime() + 8_100),
        }),
      FulfilmentConflictError,
      'A spent delivery code completed a delivered order again',
    );

    // 8.7 -- customer history and receipt.
    const history = await fulfilment.listCustomerOrders({
      context: customerContext(customerId),
    });
    // Looked up by group rather than by position: the collected order above is
    // the most recent, and a history that lists it first is correct.
    const twoStoreGroup = history.find(
      (group) => group.checkout_group_id === placed.checkout_group_id,
    );
    check(
      twoStoreGroup?.vendor_orders.length === 2,
      'Customer history did not list both orders under one checkout group',
    );
    const collectionGroupHistory = history.find(
      (group) => group.checkout_group_id === collectionPlaced.checkout_group_id,
    );
    check(
      collectionGroupHistory?.vendor_orders[0]?.fulfilment_method === 'CUSTOMER_PICKUP' &&
        twoStoreGroup.vendor_orders.every(
          (order) => order.fulfilment_method === 'PLATFORM_DELIVERY',
        ),
      'Customer history did not say which orders are collected and which delivered',
    );
    const receipt = await fulfilment.getReceipt({
      context: customerContext(customerId),
      vendor_order_id: orderA.vendor_order_id,
    });
    check(
      receipt.lines.length === 1 && receipt.lines[0]?.pick_state === 'FOUND',
      'Receipt did not reflect picked state',
    );
    await rejects(
      () =>
        fulfilment.getReceipt({
          context: customerContext(strangerCustomerId),
          vendor_order_id: orderA.vendor_order_id,
        }),
      FulfilmentNotFoundError,
      'Another customer read a receipt they do not own',
    );

    // 8.7 -- rating (once) and support case.
    await fulfilment.submitRating({
      context: customerContext(customerId),
      vendor_order_id: orderA.vendor_order_id,
      stars: 5,
      review_note: 'SYNTH rating - crate arrived intact.',
    });
    await rejects(
      () =>
        fulfilment.submitRating({
          context: customerContext(customerId),
          vendor_order_id: orderA.vendor_order_id,
          stars: 4,
        }),
      FulfilmentConflictError,
      'A second rating was accepted for the same order',
    );
    await fulfilment.openSupportCase({
      context: customerContext(customerId),
      vendor_order_id: orderA.vendor_order_id,
      category: 'MISSING_ITEM',
      description: 'SYNTH support case for coverage.',
    });

    // 8.1 -- system-driven timeout: a fresh PLACED order whose accept_by has
    // passed transitions to EXPIRED. Build a third store fixture so we can
    // add a lightweight order to the existing checkout_group without hitting
    // the (checkout_group_id, vendor_location_id) uniqueness constraint.
    const storeC = await createDiscoverableStoreFixture(pool, {
      location_name: `SYNTH Fulfilment Store T${Date.now()}`,
      latitude: 26.912,
      longitude: 75.812,
    });
    const timeoutOrderId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.vendor_orders
         (vendor_order_id, order_reference, checkout_group_id, vendor_location_id,
          lifecycle_state, total_minor, accept_by)
       VALUES ($1,$2,$3,$4,'PLACED',10000,$5)`,
      [
        timeoutOrderId,
        `SYNTH-ORDER-TIMEOUT-${Date.now()}`,
        placed.checkout_group_id,
        storeC.locationId,
        new Date(now.getTime() + 22_000),
      ],
    );
    const expired = await fulfilment.timeoutOverdueAccepts({
      context: systemContext(systemActorId),
      now: new Date(now.getTime() + 30_000),
    });
    check(
      expired.some((id) => id === timeoutOrderId),
      'System timeout did not expire an overdue order',
    );
    const expiredState = await fulfilment.getOrder({
      context: vendorContext(systemActorId),
      vendor_order_id: timeoutOrderId,
    });
    check(
      expiredState.lifecycle_state === 'EXPIRED' &&
        expiredState.decline_reason_code === 'ACCEPT_DEADLINE_TIMEOUT',
      'Timed-out order did not record its EXPIRED state and reason',
    );

    // 8.2 -- authorization boundary: a customer cannot call vendor routes.
    await rejects(
      () =>
        fulfilment.accept({
          context: customerContext(customerId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          expected_version: 1,
          preparation_estimate_seconds: 900,
        }),
      FulfilmentAuthorizationError,
      'A customer was allowed to call a vendor fulfilment route',
    );

    // 8.5 -- input validation on ready.
    await rejects(
      () =>
        fulfilment.markReady({
          context: vendorContext(storeA.ownerUserId),
          vendor_order_id: orderA.vendor_order_id,
          vendor_location_id: storeA.locationId,
          expected_version: 1,
          package_count: 0,
        }),
      FulfilmentInputError,
      'Zero package count was accepted',
    );

    // 8.4 -- customer decision path (required E2E scenario #4). Build a fresh
    // 3-line order at storeA plus a spare substitution-target variant, then
    // drive substitution->approve, weight->reject, and weight->timeout on
    // separate lines. storeA is already published and in the customer's zone,
    // so no new eligibility setup is needed.
    const decisionBase = new Date(now.getTime() + 40_000);
    const decisionProducts = [];
    for (let index = 0; index < 4; index += 1) {
      const suffix = `${Date.now()}D${index}`;
      const product = await catalogue.createProduct({
        context: vendorContext(storeA.ownerUserId),
        vendor_location_id: storeA.locationId,
        product_reference: `SYNTH-PROD-D${suffix}`,
        title: `SYNTH Decision Product ${index}`,
        category: 'FRUIT_VEGETABLE',
        unit_label: 'EACH',
        tax_basis: 'EXEMPT',
        variable_weight: false,
        sku: `SYNTH-SKU-D${suffix}`,
        variant_title: `SYNTH Decision Variant ${index}`,
        price_minor: 15_000,
        // Same reason as the fulfilment fixture above: the inventory row is
        // provisioned with the product, so it is configured here rather than
        // created a second time under the same unique key.
        initial_stock_quantity: 5,
        low_stock_threshold: 1,
        now: decisionBase,
      });
      decisionProducts.push(product);
    }
    // Products 0-2 become order lines; product 3 is the substitution target.
    const substitutionTarget = decisionProducts[3];
    check(substitutionTarget !== undefined, 'Substitution target variant missing');
    const decisionCart = await carts.currentCart({
      context: customerContext(customerId),
      now: decisionBase,
    });
    await carts.setCartAddress({
      context: customerContext(customerId),
      customer_address_id: addressId,
      now: decisionBase,
    });
    for (let index = 0; index < 3; index += 1) {
      const product = decisionProducts[index];
      check(product !== undefined, 'Decision fixture product missing');
      await carts.addLine({
        context: customerContext(customerId),
        vendor_location_id: storeA.locationId,
        catalogue_variant_id: product.catalogue_variant_id,
        quantity: 1,
        now: decisionBase,
      });
    }
    const decisionQuote = await checkout.createQuote({
      context: customerContext(customerId),
      cart_id: decisionCart.cart_id,
      now: decisionBase,
    });
    const decisionPlaced = await checkout.place({
      context: customerContext(customerId),
      checkout_quote_id: decisionQuote.checkout_quote_id,
      provider_scenario: 'SUCCESS',
      idempotency_key: 'phase8-decision-001',
      now: new Date(decisionBase.getTime() + 1_000),
    });
    const orderC = decisionPlaced.orders.find(
      (o: { readonly vendor_location_id: UuidV7 }) => o.vendor_location_id === storeA.locationId,
    );
    check(orderC !== undefined, 'Decision order was not placed at storeA');
    const acceptedC = await fulfilment.accept({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderC.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: orderC.version,
      preparation_estimate_seconds: 900,
      now: new Date(decisionBase.getTime() + 2_000),
    });
    const pickingC = await fulfilment.startPicking({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderC.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: acceptedC.version,
      now: new Date(decisionBase.getTime() + 3_000),
    });
    const decisionLines = await pool.query<{ id: string }>(
      `SELECT vendor_order_line_id AS id FROM marketplace.vendor_order_lines
        WHERE vendor_order_id=$1 ORDER BY vendor_order_line_id`,
      [orderC.vendor_order_id],
    );
    check(decisionLines.rows.length === 3, 'Decision order did not have three lines');
    const [line1, line2, line3] = decisionLines.rows.map((r) => r.id as UuidV7);
    check(
      line1 !== undefined && line2 !== undefined && line3 !== undefined,
      'Decision line ids missing',
    );

    // Line 1: substitution proposal -> customer APPROVES.
    const subProposal = await fulfilment.proposeSubstitution({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderC.vendor_order_id,
      vendor_location_id: storeA.locationId,
      vendor_order_line_id: line1,
      substitution_variant_id: substitutionTarget.catalogue_variant_id,
      proposed_quantity: 1,
      proposed_unit_price_minor: 18_000,
      reason_note: 'SYNTH out of the exact item, close substitute available.',
      now: new Date(decisionBase.getTime() + 4_000),
    });
    check(
      subProposal.decision.authorization_delta_minor === 3_000,
      'Substitution authorization delta was not recorded (18000 - 15000)',
    );
    // The customer's own pending list is what their app polls on every orders
    // page. It had never been read here, and it was a 500 on every call: the
    // query named a column the order table does not have. No proposal ever
    // reached a customer through it.
    const pendingForCustomer = await fulfilment.listPendingCustomerDecisions({
      context: customerContext(customerId),
    });
    check(
      pendingForCustomer.some(
        (decision) => decision.decision_id === subProposal.decision.decision_id,
      ),
      'The customer could not see the proposal awaiting their decision',
    );
    const pendingForStranger = await fulfilment.listPendingCustomerDecisions({
      context: customerContext(strangerCustomerId),
    });
    check(
      !pendingForStranger.some((decision) => decision.vendor_order_id === orderC.vendor_order_id),
      "Another customer saw this customer's pending decision",
    );
    const paymentBeforeDecision = await pool.query<{ amount_minor: string }>(
      `SELECT payment.amount_minor::text FROM marketplace.payment_transactions payment
        JOIN marketplace.checkout_groups grouping USING(payment_transaction_id)
        JOIN marketplace.vendor_orders orders USING(checkout_group_id)
       WHERE orders.vendor_order_id=$1`,
      [orderC.vendor_order_id],
    );
    const subAnswer = await fulfilment.answerDecision({
      context: customerContext(customerId),
      decision_id: subProposal.decision.decision_id,
      answer: 'APPROVED',
      now: new Date(decisionBase.getTime() + 5_000),
    });
    const pendingAfterAnswer = await fulfilment.listPendingCustomerDecisions({
      context: customerContext(customerId),
    });
    check(
      !pendingAfterAnswer.some(
        (decision) => decision.decision_id === subProposal.decision.decision_id,
      ),
      'An answered decision was still listed as pending',
    );
    check(subAnswer.answer === 'APPROVED', 'Substitution decision was not APPROVED');
    const paymentAfterDecision = await pool.query<{
      amount_minor: string;
      adjustments: string;
    }>(
      `SELECT payment.amount_minor::text,
        (SELECT count(*)::text FROM marketplace.payment_authorization_adjustments adjustment
          WHERE adjustment.decision_id=$2) adjustments
       FROM marketplace.payment_transactions payment
       JOIN marketplace.checkout_groups grouping USING(payment_transaction_id)
       JOIN marketplace.vendor_orders orders USING(checkout_group_id)
       WHERE orders.vendor_order_id=$1`,
      [orderC.vendor_order_id, subProposal.decision.decision_id],
    );
    check(
      Number(paymentAfterDecision.rows[0]?.amount_minor) ===
        Number(paymentBeforeDecision.rows[0]?.amount_minor) + 3_000,
      'Approved substitution did not adjust the synthetic payment authorization',
    );
    check(
      paymentAfterDecision.rows[0]?.adjustments === '1',
      'Approved substitution adjustment was not posted exactly once',
    );
    // Second answer on an already-answered decision is refused.
    await rejects(
      () =>
        fulfilment.answerDecision({
          context: customerContext(customerId),
          decision_id: subProposal.decision.decision_id,
          answer: 'REJECTED',
          now: new Date(decisionBase.getTime() + 5_500),
        }),
      FulfilmentConflictError,
      'A decision was answered twice',
    );

    // Line 2: weight proposal -> customer REJECTS. A foreign customer cannot answer.
    const weightProposal = await fulfilment.proposeWeight({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderC.vendor_order_id,
      vendor_location_id: storeA.locationId,
      vendor_order_line_id: line2,
      proposed_quantity: 1,
      proposed_unit_price_minor: 16_500,
      reason_note: 'SYNTH weighed heavier than ordered.',
      now: new Date(decisionBase.getTime() + 6_000),
    });
    await rejects(
      () =>
        fulfilment.answerDecision({
          context: customerContext(strangerCustomerId),
          decision_id: weightProposal.decision.decision_id,
          answer: 'APPROVED',
          now: new Date(decisionBase.getTime() + 6_500),
        }),
      FulfilmentNotFoundError,
      'A foreign customer answered another customer decision',
    );
    const weightAnswer = await fulfilment.answerDecision({
      context: customerContext(customerId),
      decision_id: weightProposal.decision.decision_id,
      answer: 'REJECTED',
      now: new Date(decisionBase.getTime() + 7_000),
    });
    check(weightAnswer.answer === 'REJECTED', 'Weight decision was not REJECTED');

    // Line 3: weight proposal -> deadline passes -> system times it out.
    const timeoutProposal = await fulfilment.proposeWeight({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderC.vendor_order_id,
      vendor_location_id: storeA.locationId,
      vendor_order_line_id: line3,
      proposed_quantity: 1,
      proposed_unit_price_minor: 16_000,
      reason_note: 'SYNTH weight proposal that the customer never sees.',
      decision_deadline_seconds: 60,
      now: new Date(decisionBase.getTime() + 8_000),
    });
    const timedOut = await fulfilment.timeoutOverdueDecisions({
      context: systemContext(systemActorId),
      now: new Date(decisionBase.getTime() + 80_000),
    });
    check(
      timedOut.some((id) => id === timeoutProposal.decision.decision_id),
      'Overdue decision was not timed out',
    );
    const timedOutState = await pool.query<{ answer: string; pick_state: string }>(
      `SELECT d.answer, p.pick_state
         FROM marketplace.vendor_order_customer_decisions d
         JOIN marketplace.vendor_order_line_picks p USING (pick_id)
        WHERE d.decision_id=$1`,
      [timeoutProposal.decision.decision_id],
    );
    check(
      timedOutState.rows[0]?.answer === 'TIMED_OUT' &&
        timedOutState.rows[0]?.pick_state === 'WEIGHT_REJECTED',
      'Timed-out decision did not roll the pick to a rejected state',
    );

    // All three lines are now resolved, so ready succeeds.
    const readyC = await fulfilment.markReady({
      context: vendorContext(storeA.ownerUserId),
      vendor_order_id: orderC.vendor_order_id,
      vendor_location_id: storeA.locationId,
      expected_version: pickingC.version,
      package_count: 2,
      now: new Date(decisionBase.getTime() + 90_000),
    });
    check(
      readyC.lifecycle_state === 'READY',
      'Order with resolved decisions could not reach ready',
    );

    // Confirm the immutable event trail was written.
    const events = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.vendor_order_events WHERE vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(Number(events.rows[0]?.count) >= 6, 'Fulfilment event trail is too short');

    // 9.1 -- dispatch: an ignored offer moves on to the next partner.
    //
    // Field report: a vendor board reading "Offered to a delivery partner" for
    // an order a newly created partner, online and in range, never saw. Offers
    // are personal and last five minutes; on expiry the worker re-offered to
    // the nearest online partner -- the same one, every time -- because
    // nothing recorded who had let an offer lapse. `offerReadyAssignments` had
    // no verifier at all: the loop that decides who gets a job was untested.
    const availability = new PartnerAvailabilityService({ connection_string: connectionString });
    const dispatch = new DeliveryDispatchOrchestrator({
      assignments,
      availability,
      connection_string: connectionString,
    });
    try {
      const dispatchBase = new Date(decisionBase.getTime() + 120_000);
      // Two fresh partners near storeA (26.911, 75.811): "near" is nearer.
      const riders = { near: createUuidV7(), far: createUuidV7() };
      for (const [name, riderId] of Object.entries(riders)) {
        await pool.query(
          "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
          [riderId],
        );
        const riderRoleId = createUuidV7();
        await pool.query(
          `INSERT INTO marketplace.role_assignments
            (role_assignment_id,user_id,role_key,state,valid_from,valid_until,
             granted_by_user_id,request_id,correlation_id,created_at,updated_at)
           VALUES ($1,$2,'DELIVERY_PARTNER','ACTIVE',$3,$4,$5,$6,$6,$3,$3)`,
          [
            riderRoleId,
            riderId,
            now,
            new Date(now.getTime() + 86_400_000),
            adminId,
            createUuidV7(),
          ],
        );
        await pool.query(
          `INSERT INTO marketplace.partner_eligibilities
            (partner_eligibility_id,role_assignment_id,user_id,state,eligible_from,
             eligible_until,reason_code,updated_at)
           VALUES ($1,$2,$3,'ELIGIBLE',$4,$5,'SYNTH_DISPATCH_ROTATION',$4)`,
          [createUuidV7(), riderRoleId, riderId, now, new Date(now.getTime() + 86_400_000)],
        );
        await availability.set({
          context: partnerContext(riderId),
          state: 'ONLINE',
          latitude: name === 'near' ? 26.9112 : 26.915,
          longitude: 75.811,
          accuracy_meters: 10,
          battery_percent: 90,
          reason_code: 'PARTNER_AVAILABLE',
          now: dispatchBase,
        });
      }
      const attempt = await dispatch.dispatchPlacedOrder({
        context: systemContext(systemActorId),
        event_id: createUuidV7(),
        vendor_order_id: orderC.vendor_order_id,
        now: dispatchBase,
      });
      check(
        attempt?.assignment_state === 'UNASSIGNED',
        'Placement did not reserve a custody attempt for the platform delivery',
      );
      const holder = async () => {
        const row = await pool.query<{ assignment_state: string; partner_user_id: string | null }>(
          `SELECT assignment_state, partner_user_id FROM marketplace.delivery_assignments
            WHERE delivery_assignment_id=$1`,
          [attempt.delivery_assignment_id],
        );
        return row.rows[0];
      };
      const tick = async (label: string, at: Date) => {
        // The apps heartbeat once a minute while online; a tick five minutes
        // after the last one would otherwise find both riders' presence lapsed.
        for (const riderId of Object.values(riders)) {
          await availability.heartbeat({
            context: partnerContext(riderId),
            now: new Date(at.getTime() - 1_000),
          });
        }
        await assignments.expireOffers({
          command_prefix: `SYNTH-CMD-EXPIRE-${label}`,
          context: systemContext(systemActorId),
          now: at,
        });
        return dispatch.offerReadyAssignments({
          command_prefix: `SYNTH-CMD-DISPATCH-${label}`,
          context: systemContext(systemActorId),
          now: at,
        });
      };

      // First tick: the nearest rider is offered the job.
      const first = await tick('T1', new Date(dispatchBase.getTime() + 1_000));
      let held = await holder();
      check(
        first.offered === 1 &&
          held?.assignment_state === 'OFFERED' &&
          held.partner_user_id === riders.near,
        `The first offer did not go to the nearest online partner (${JSON.stringify(held)})`,
      );

      // They ignore it. Five minutes later the offer expires, returns to the
      // pool, and must go to the other rider -- not straight back.
      const second = await tick(
        'T2',
        new Date(dispatchBase.getTime() + 1_000 + 5 * 60_000 + 1_000),
      );
      const lapse = await pool.query<{ partner_user_id: string | null }>(
        `SELECT partner_user_id FROM marketplace.assignment_events
          WHERE delivery_assignment_id=$1 AND event_type='OFFER_EXPIRED'
          ORDER BY occurred_at ASC LIMIT 1`,
        [attempt.delivery_assignment_id],
      );
      check(
        lapse.rows[0]?.partner_user_id === riders.near,
        'The expiry event did not record which partner let the offer lapse',
      );

      held = await holder();
      check(
        second.returned === 1 && second.offered === 1 && held?.partner_user_id === riders.far,
        `An expired offer was not rotated to the second partner (${JSON.stringify({ second, held })})`,
      );
      // They ignore it too. With both on one pass each, the nearest is asked
      // again: a finite pool rotates, it does not strand the order.
      const third = await tick(
        'T3',
        new Date(dispatchBase.getTime() + 1_000 + 10 * 60_000 + 3_000),
      );
      held = await holder();
      check(
        third.offered === 1 && held?.partner_user_id === riders.near,
        `A twice-lapsed attempt did not come back round to the nearest partner (${JSON.stringify(held)})`,
      );

      // A decline is a decision: that rider is not asked again for this attempt.
      const currentOffer = await assignments.get({
        context: partnerContext(riders.near),
        delivery_assignment_id: attempt.delivery_assignment_id,
      });
      const declinedOffer = await assignments.endBeforePickup({
        command_reference: 'SYNTH-CMD-DECLINE-ROTATION',
        context: partnerContext(riders.near),
        delivery_assignment_id: attempt.delivery_assignment_id,
        expected_version: currentOffer.version,
        reason_code: 'PARTNER_DECLINED',
        resulting_state: 'DECLINED',
        now: new Date(dispatchBase.getTime() + 1_000 + 10 * 60_000 + 4_000),
      });
      check(declinedOffer.assignment_state === 'DECLINED', 'Decline did not take');
      const fourth = await tick(
        'T4',
        new Date(dispatchBase.getTime() + 1_000 + 10 * 60_000 + 5_000),
      );
      held = await holder();
      check(
        fourth.returned === 1 && fourth.offered === 1 && held?.partner_user_id === riders.far,
        `A declined attempt was re-offered to the partner who declined it (${JSON.stringify(held)})`,
      );
    } finally {
      await dispatch.close();
      await availability.close();
    }

    // 8.10 -- why a finished order finished (the collection view is asserted
    // above, while the real partner is at the counter).
    //
    // orderB was declined by storeB, so its board must say who ended it and why
    // rather than showing a bare CANCELLED badge.
    const storeBBoard = await fulfilment.listVendorOrders({
      context: vendorContext(storeB.ownerUserId),
      vendor_location_id: storeB.locationId,
    });
    const declinedEntry = storeBBoard.find(
      (entry) => entry.vendor_order_id === orderB.vendor_order_id,
    );
    check(
      declinedEntry?.lifecycle_state === 'CANCELLED' &&
        declinedEntry?.resolution?.ended_by === 'vendor_staff' &&
        typeof declinedEntry?.resolution?.reason_code === 'string',
      'A cancelled order did not carry who ended it and why',
    );

    const inCustody = await assignments.confirmPickup({
      command_reference: 'SYNTH-CMD-CUSTODY-DELIVERY-CLOSURE',
      context: partner,
      delivery_assignment_id: created.delivery_assignment_id,
      expected_version: atVendor.version,
      now: new Date(now.getTime() + 64_000),
      package_count: 1,
      proof_reference: 'SYNTH-PROOF-PICKUP-CLOSURE',
      reason_code: 'VENDOR_HANDOVER_VERIFIED',
      vendor_confirmed: true,
    });
    const inCustodyList = await assignments.listActiveForPartner({
      partner_user_id: partnerId,
    });
    const carried = inCustodyList.find(
      (entry) => entry.delivery_assignment_id === created.delivery_assignment_id,
    );
    check(
      carried?.drop_address?.pin_code !== undefined &&
        typeof carried.drop_address.latitude === 'number' &&
        typeof carried.drop_address.longitude === 'number',
      'A partner holding the goods was not told where to deliver them',
    );

    const enRoute = await assignments.beginRoute({
      command_reference: 'SYNTH-CMD-ROUTE-DELIVERY-CLOSURE',
      context: partner,
      delivery_assignment_id: created.delivery_assignment_id,
      expected_version: inCustody.version,
      now: new Date(now.getTime() + 65_000),
      reason_code: 'ROUTE_STARTED',
    });
    const atCustomer = await assignments.arriveAtCustomer({
      command_reference: 'SYNTH-CMD-ARRIVE-DELIVERY-CLOSURE',
      context: partner,
      delivery_assignment_id: created.delivery_assignment_id,
      expected_version: enRoute.version,
      now: new Date(now.getTime() + 66_000),
      reason_code: 'CUSTOMER_LOCATION_ARRIVAL',
    });
    const deliveryOtp = '515151';
    await pool.query(
      `UPDATE marketplace.delivery_assignments
            SET delivery_otp_hash=$2, delivery_otp_expires_at=$3, delivery_otp_attempts=0
          WHERE delivery_assignment_id=$1`,
      [
        created.delivery_assignment_id,
        createHash('sha256').update(deliveryOtp).digest('hex'),
        new Date(now.getTime() + 900_000),
      ],
    );
    await assignments.deliver({
      command_reference: 'SYNTH-CMD-DELIVER-CLOSURE',
      context: partner,
      delivery_assignment_id: created.delivery_assignment_id,
      expected_version: atCustomer.version,
      now: new Date(now.getTime() + 67_000),
      otp: deliveryOtp,
      proof_reference: 'SYNTH-PROOF-DELIVERY-CLOSURE',
      reason_code: 'DELIVERY_PROOF_VERIFIED',
    });

    const completed = await pool.query<{ lifecycle_state: string; delivered_at: Date | null }>(
      `SELECT lifecycle_state, delivered_at FROM marketplace.vendor_orders
          WHERE vendor_order_id=$1`,
      [orderA.vendor_order_id],
    );
    check(
      completed.rows[0]?.lifecycle_state === 'DELIVERED' &&
        completed.rows[0]?.delivered_at !== null,
      'Delivery did not complete the vendor order',
    );

    // The event is what the money handlers and the notification sweep read.
    // Without it the order would be DELIVERED in the table and invisible to
    // everything that has to react to it.
    const emitted = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.outbox_events
          WHERE aggregate_type='vendor_order' AND aggregate_id=$1
            AND event_type='vendor_order.delivered'`,
      [orderA.vendor_order_id],
    );
    check(emitted.rows[0]?.count === '1', 'Delivery emitted no vendor_order.delivered event');

    const historyRow = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.vendor_order_events
          WHERE vendor_order_id=$1 AND event_type='DELIVERED' AND actor_kind='delivery_partner'`,
      [orderA.vendor_order_id],
    );
    check(
      historyRow.rows[0]?.count === '1',
      'Delivery left no attributable entry in the order history',
    );

    // A repeated confirmation at the door must not complete the order twice.
    await assignments.deliver({
      command_reference: 'SYNTH-CMD-DELIVER-CLOSURE',
      context: partner,
      delivery_assignment_id: created.delivery_assignment_id,
      expected_version: atCustomer.version,
      now: new Date(now.getTime() + 68_000),
      otp: deliveryOtp,
      proof_reference: 'SYNTH-PROOF-DELIVERY-CLOSURE',
      reason_code: 'DELIVERY_PROOF_VERIFIED',
    });
    const replayed = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.outbox_events
          WHERE aggregate_type='vendor_order' AND aggregate_id=$1
            AND event_type='vendor_order.delivered'`,
      [orderA.vendor_order_id],
    );
    check(replayed.rows[0]?.count === '1', 'A replayed delivery emitted a second event');

    // -------------------------------------------------------------------
    // The money follows the lifecycle.
    //
    // This group is the awkward case on purpose: storeB declined orderB
    // while storeA supplied and delivered orderA, and both are funded by one
    // authorization that can only be captured whole. Declining had to shrink
    // the authorization to storeA's share, or capture would take money for
    // goods nobody was ever going to bring.
    // -------------------------------------------------------------------
    // The delivery is rated separately from the shop, so a late rider cannot
    // lower a storefront's score and neither party is judged on the other's
    // work.
    const storeRatingBefore = await pool.query<{ stars: number }>(
      'SELECT stars FROM marketplace.vendor_order_ratings WHERE vendor_order_id=$1',
      [orderA.vendor_order_id],
    );
    await assignments.submitDeliveryRating({
      context: customerContext(customerId),
      delivery_assignment_id: created.delivery_assignment_id,
      review_note: 'Arrived quickly and the crate was intact.',
      stars: 5,
    });
    const partnerRatings = await assignments.partnerRatingSummary({
      partner_user_id: partnerId,
    });
    check(
      partnerRatings.rating_count === 1 && partnerRatings.rating_average === 5,
      'The delivery rating did not reach the partner’s aggregate',
    );
    const storeRatingAfter = await pool.query<{ stars: number }>(
      'SELECT stars FROM marketplace.vendor_order_ratings WHERE vendor_order_id=$1',
      [orderA.vendor_order_id],
    );
    check(
      storeRatingAfter.rows[0]?.stars === storeRatingBefore.rows[0]?.stars,
      'Rating the delivery moved the score of the shop that packed it',
    );
    await rejects(
      () =>
        assignments.submitDeliveryRating({
          context: customerContext(customerId),
          delivery_assignment_id: created.delivery_assignment_id,
          stars: 1,
        }),
      AssignmentConflictError,
      'A delivery accepted a second rating',
    );
    await rejects(
      () =>
        assignments.submitDeliveryRating({
          context: customerContext(strangerCustomerId),
          delivery_assignment_id: created.delivery_assignment_id,
          stars: 1,
        }),
      AssignmentNotFoundError,
      'A stranger rated somebody else’s delivery',
    );

    const money = new MoneyLifecycleService({ connection_string: connectionString });
    const completeMoney = new CompleteMoneyLifecycleService({
      connection_string: connectionString,
    });
    const orderMoney = new OrderMoneyOrchestrator({
      complete_money: completeMoney,
      connection_string: connectionString,
      money,
    });
    try {
      const released = await pool.query<{
        adjustments: string;
        delta_minor: string | null;
      }>(
        `SELECT count(*)::text AS adjustments, min(delta_minor)::text AS delta_minor
             FROM marketplace.payment_authorization_adjustments
            WHERE vendor_order_id=$1 AND adjustment_kind='VENDOR_ORDER_ENDED'`,
        [orderB.vendor_order_id],
      );
      check(
        released.rows[0]?.adjustments === '1' && Number(released.rows[0]?.delta_minor) < 0,
        'Declining did not release the declined order’s share of the authorization',
      );
      const zeroed = await pool.query<{ allocated: string }>(
        `SELECT allocation.allocated_total_minor::text AS allocated
             FROM marketplace.payment_allocations allocation
             JOIN marketplace.vendor_orders orders
               ON orders.order_reference = allocation.source_order_reference
            WHERE orders.vendor_order_id=$1`,
        [orderB.vendor_order_id],
      );
      check(
        zeroed.rows[0] === undefined || zeroed.rows[0].allocated === '0',
        'A declined order kept an allocation of the customer’s money',
      );

      // The quote must carry the version that priced it, resolved from
      // configuration — not the string literal every order used to claim.
      const stamped = await pool.query<{ reference: string }>(
        `SELECT quote.policy_version_reference AS reference
             FROM marketplace.vendor_orders orders
             JOIN marketplace.checkout_groups grouping USING(checkout_group_id)
             JOIN marketplace.checkout_quotes quote
               ON quote.checkout_quote_id = grouping.checkout_quote_id
            WHERE orders.vendor_order_id=$1`,
        [orderA.vendor_order_id],
      );
      check(
        /^SYNTH-POLICY-FIN-V[0-9]+-[0-9A-F]{8}$/.test(stamped.rows[0]?.reference ?? ''),
        `The quote stamped ${stamped.rows[0]?.reference} instead of a resolved policy version`,
      );

      const outcome = await orderMoney.settleAuthorizationForOrder({
        context: systemContext(systemActorId),
        now: new Date(now.getTime() + 70_000),
        vendor_order_id: orderA.vendor_order_id,
      });
      check(outcome === 'CAPTURED', `Authorization settled as ${outcome} instead of CAPTURED`);
      const replayedOutcome = await orderMoney.settleAuthorizationForOrder({
        context: systemContext(systemActorId),
        now: new Date(now.getTime() + 71_000),
        vendor_order_id: orderA.vendor_order_id,
      });
      check(
        replayedOutcome === 'ALREADY_SETTLED',
        'A replayed acceptance event tried to capture a second time',
      );

      const settlementResult = await orderMoney.recordDeliveryEarnings({
        context: systemContext(systemActorId),
        now: new Date(now.getTime() + 72_000),
        vendor_order_id: orderA.vendor_order_id,
      });
      check(
        settlementResult.settled && settlementResult.earning_posted,
        'Delivery produced no settlement or no partner earning',
      );
      const earning = await pool.query<{ net_minor: string; ledger: string | null }>(
        `SELECT net_minor::text, ledger_transaction_id::text AS ledger
             FROM marketplace.partner_earnings_records WHERE partner_user_id=$1`,
        [partnerId],
      );
      check(
        earning.rows.length === 1 &&
          Number(earning.rows[0]?.net_minor) > 0 &&
          earning.rows[0]?.ledger !== null,
        'The partner’s earning was not recorded and posted to the ledger',
      );

      // An order nobody delivered still settles. Settlement ran only on
      // `vendor_order.delivered`, so a collected order -- whose last state is
      // PICKED_UP -- was never divided and the shop was never paid for it; the
      // worker now runs this on pickup for CUSTOMER_PICKUP. A self-delivery
      // ends at DELIVERED like a partner delivery, with no partner to pay.
      for (const [label, order] of [
        ['collected', orderP],
        ['self-delivered', orderV],
      ] as const) {
        const captured = await orderMoney.settleAuthorizationForOrder({
          context: systemContext(systemActorId),
          now: new Date(now.getTime() + 73_000),
          vendor_order_id: order.vendor_order_id,
        });
        check(
          captured === 'CAPTURED',
          `The ${label} order settled as ${captured} instead of CAPTURED`,
        );
        const divided = await orderMoney.recordDeliveryEarnings({
          context: systemContext(systemActorId),
          now: new Date(now.getTime() + 74_000),
          vendor_order_id: order.vendor_order_id,
        });
        check(
          divided.settled && !divided.earning_posted,
          `The ${label} order did not settle without a partner earning (got ${JSON.stringify(divided)})`,
        );
        const settlement = await pool.query<{ count: string; net: string | null }>(
          `SELECT count(*)::text AS count, max(vendor_payable_minor)::text AS net
             FROM marketplace.settlements s
             JOIN marketplace.vendor_orders o ON o.order_reference = s.source_order_reference
            WHERE o.vendor_order_id=$1`,
          [order.vendor_order_id],
        );
        check(
          settlement.rows[0]?.count === '1' && Number(settlement.rows[0].net) > 0,
          `The ${label} order has no settlement paying the shop`,
        );
      }
      const earningsAfter = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM marketplace.partner_earnings_records`,
      );
      check(
        earningsAfter.rows[0]?.count === '1',
        'Settling orders no partner carried posted a partner earning',
      );

      // -----------------------------------------------------------------
      // The four roles reconcile to the same money.
      //
      // Capture, settlement and the partner earning were already asserted
      // above, straight from the ledger. What nothing checked is whether the
      // people involved can *see* it: `customerReceipt`, `vendorStatement`
      // and `partnerStatement` appeared in no verifier, so every role-facing
      // money view was unexercised. A ledger nobody can read is not a
      // reconciliation, and this is the same checkout group, the same
      // delivered order and the same declined sibling throughout.
      // -----------------------------------------------------------------
      const references = await pool.query<{ vendor_order_id: string; order_reference: string }>(
        `SELECT vendor_order_id, order_reference FROM marketplace.vendor_orders
            WHERE checkout_group_id = $1`,
        [placed.checkout_group_id],
      );
      const referenceOf = (vendorOrderId: string) =>
        references.rows.find((row) => row.vendor_order_id === vendorOrderId)?.order_reference;
      const referenceA = referenceOf(orderA.vendor_order_id);
      const referenceB = referenceOf(orderB.vendor_order_id);
      check(
        referenceA !== undefined && referenceB !== undefined && referenceA !== referenceB,
        'The two vendor orders did not carry distinct order references',
      );

      const receipt = await completeMoney.customerReceipt({
        checkout_group_id: placed.checkout_group_id,
        context: customerContext(customerId),
      });
      const receiptOrders = receipt.orders as readonly {
        readonly order_reference: string;
        readonly state: string;
        readonly total_minor: number;
      }[];
      // Every order in the group, no more and no fewer. Asserting a fixed count
      // was wrong: by this point the walk has added a third order to the same
      // group for the acceptance-timeout case, and the receipt reports it
      // correctly. The invariant is that the receipt mirrors the group.
      check(
        receiptOrders.length === references.rows.length,
        `The receipt did not mirror the group's orders: ${JSON.stringify(receipt.orders)}`,
      );
      check(
        references.rows.every((row) =>
          receiptOrders.some((order) => order.order_reference === row.order_reference),
        ),
        'The receipt omitted an order that belongs to this checkout group',
      );
      check(
        receiptOrders.find((order) => order.order_reference === referenceA)?.state === 'DELIVERED',
        'The receipt did not show the delivered order as delivered',
      );
      check(
        receiptOrders.find((order) => order.order_reference === referenceB)?.state !== 'DELIVERED',
        'The receipt showed the declined sibling as delivered',
      );

      // Sibling isolation, in money rather than lifecycle terms: whatever the
      // decline did to storeB's share, it must not have moved storeA's.
      const receiptRefunds = receipt.refunds as readonly { readonly order_reference: string }[];
      check(
        !receiptRefunds.some((refund) => refund.order_reference === referenceA),
        'A refund was allocated against the delivered order',
      );

      // A receipt belongs to the customer who paid. The query scopes on
      // customer_user_id, and nothing proved that scoping held.
      await rejects(
        () =>
          completeMoney.customerReceipt({
            checkout_group_id: placed.checkout_group_id,
            context: customerContext(createUuidV7()),
          }),
        MoneyNotFoundError,
        'Another customer read this checkout group’s receipt',
      );

      // The vendor sees the settlement for their own location, and only that --
      // in the shape the console renders. The earlier assertion cast the raw
      // rows to whatever it wanted to check, which is how a statement of raw
      // `settlements.*` columns passed here and crashed the payouts page on
      // the first settlement a real store ever had.
      const statement = await completeMoney.vendorStatement({
        context: vendorContext(storeA.ownerUserId),
        vendor_location_id: storeA.locationId,
      });
      const ledgerSettlement = await pool.query<{
        vendor_payable_minor: string;
        platform_remainder_minor: string;
        settlement_state: string;
      }>(
        `SELECT vendor_payable_minor::text, platform_remainder_minor::text, settlement_state
           FROM marketplace.settlements WHERE source_order_reference=$1`,
        [orderA.order_reference],
      );
      const ownSettlement = statement.settlements.find(
        (entry) => entry.reference === orderA.order_reference,
      );
      check(
        statement.vendor_location_id === storeA.locationId &&
          statement.settlements.length >= 1 &&
          ownSettlement !== undefined,
        'The vendor statement did not carry the settlement for the delivered order',
      );
      check(
        ownSettlement.net_minor === Number(ledgerSettlement.rows[0]?.vendor_payable_minor) &&
          ownSettlement.platform_fee_minor ===
            Number(ledgerSettlement.rows[0]?.platform_remainder_minor) &&
          ownSettlement.gross_minor - ownSettlement.platform_fee_minor ===
            ownSettlement.net_minor &&
          ownSettlement.lifecycle_state === ledgerSettlement.rows[0]?.settlement_state &&
          typeof ownSettlement.eligible_at === 'string',
        `The vendor statement does not reconcile to the settlement (${JSON.stringify(ownSettlement)})`,
      );
      check(
        statement.pending_minor + statement.eligible_minor + statement.settled_minor ===
          statement.settlements.reduce((sum, entry) => sum + entry.net_minor, 0),
        'The vendor statement totals do not add up to its settlements',
      );
      await rejects(
        () =>
          completeMoney.vendorStatement({
            context: vendorContext(storeB.ownerUserId),
            vendor_location_id: storeA.locationId,
          }),
        MoneyNotFoundError,
        'A vendor read another store’s settlement statement',
      );

      // The partner sees the earning the ledger already recorded, under their
      // own identity.
      const partnerMoney = await completeMoney.partnerStatement({
        context: partnerContext(partnerId),
      });
      const ownEarning = partnerMoney.earnings[0];
      check(
        partnerMoney.earnings.length === 1 &&
          ownEarning !== undefined &&
          ownEarning.reference === orderA.order_reference &&
          ownEarning.total_minor === Number(earning.rows[0]?.net_minor) &&
          ownEarning.lifecycle_state === 'EARNED' &&
          typeof ownEarning.posted_at === 'string',
        `The partner statement did not report the earning the ledger holds (${JSON.stringify(ownEarning)})`,
      );
      check(
        partnerMoney.total_earned_minor === ownEarning.total_minor &&
          partnerMoney.pending_minor === ownEarning.total_minor &&
          partnerMoney.paid_minor === 0,
        'The partner statement totals do not follow from its earnings',
      );
      const strangerEarnings = await completeMoney.partnerStatement({
        context: partnerContext(createUuidV7()),
      });
      check(
        strangerEarnings.earnings.length === 0 && strangerEarnings.total_earned_minor === 0,
        'A stranger read this partner’s earnings',
      );

      // -----------------------------------------------------------------
      // G10: a partial refund on the delivered order.
      //
      // Refunds were asserted only negatively above -- that none had landed
      // on the delivered order. That is a true statement about a group where
      // no refund exists, and it would stay true if raising one were broken.
      // This raises a real one and follows it into the receipt, which is the
      // customer-visible half of the money the ledger already holds.
      // -----------------------------------------------------------------
      // Two real identities: `refund_proposer_fk` and the approver reference
      // both point at users, and maker/checker separation is only meaningful
      // between people the database knows about.
      const financeProposerId = createUuidV7();
      const financeApproverId = createUuidV7();
      for (const financeUserId of [financeProposerId, financeApproverId]) {
        await pool.query(
          `INSERT INTO marketplace.users (user_id, state, data_classification)
             VALUES ($1,'ACTIVE','RESTRICTED')`,
          [financeUserId],
        );
      }
      const paymentRow = await pool.query<{ payment_transaction_id: string }>(
        'SELECT payment_transaction_id FROM marketplace.checkout_groups WHERE checkout_group_id=$1',
        [placed.checkout_group_id],
      );
      const paymentTransactionId = paymentRow.rows[0]?.payment_transaction_id;
      check(paymentTransactionId !== undefined, 'The checkout group carried no payment');

      const refundedBefore = Number(receipt.refunded_total_minor);
      const REFUND_ITEM_MINOR = 5_000;
      const proposedRefund = await money.proposeRefund({
        command_reference: 'SYNTH-CMD-REFUND-PARTIAL-0001',
        context: adminContext(financeProposerId),
        delivery_minor: 0,
        discount_reversal_minor: 0,
        item_minor: REFUND_ITEM_MINOR,
        payment_transaction_id: parseUuidV7(paymentTransactionId),
        provider_operation_reference: 'SYNTH-REF-PARTIAL-0001',
        provider_scenario: 'SUCCESS',
        source_order_reference: referenceA as string,
        tax_minor: 0,
        tip_minor: 0,
        trigger_code: 'PARTIAL_ITEM_REFUND',
      });

      // Maker and checker are different people. A proposer approving their own
      // refund is the single control standing between one compromised finance
      // account and arbitrary outbound money.
      await rejects(
        () =>
          money.approveAndSubmitRefund({
            command_reference: 'SYNTH-CMD-REFUND-SELF-APPROVE',
            context: adminContext(financeProposerId),
            expected_version: proposedRefund.version,
            refund_id: proposedRefund.refund_id,
          }),
        MoneyStateError,
        'A finance actor approved the refund they proposed',
      );

      await money.approveAndSubmitRefund({
        command_reference: 'SYNTH-CMD-REFUND-APPROVE-0001',
        context: adminContext(financeApproverId),
        expected_version: proposedRefund.version,
        refund_id: proposedRefund.refund_id,
      });

      // A replayed approval on the version it already consumed must not post a
      // second time. A duplicate correction is how a refund becomes two.
      await rejects(
        () =>
          money.approveAndSubmitRefund({
            command_reference: 'SYNTH-CMD-REFUND-APPROVE-0001',
            context: adminContext(financeApproverId),
            expected_version: proposedRefund.version,
            refund_id: proposedRefund.refund_id,
          }),
        MoneyStateError,
        'A replayed approval posted the refund twice',
      );

      // The receipt is regenerated from settled facts, so the refund has to
      // appear against the order it belongs to and nowhere else.
      const receiptAfter = await completeMoney.customerReceipt({
        checkout_group_id: placed.checkout_group_id,
        context: customerContext(customerId),
      });
      const refundsAfter = receiptAfter.refunds as readonly {
        readonly order_reference: string;
        readonly refund_total_minor: number;
      }[];
      const againstDelivered = refundsAfter.filter(
        (refund) => refund.order_reference === referenceA,
      );
      check(
        againstDelivered.length === 1 &&
          Number(againstDelivered[0]?.refund_total_minor) === REFUND_ITEM_MINOR,
        'The refund did not appear on the receipt against the delivered order',
      );
      check(
        !refundsAfter.some((refund) => refund.order_reference === referenceB),
        'Refunding one order allocated a refund to its sibling',
      );
      check(
        Number(receiptAfter.refunded_total_minor) === refundedBefore + REFUND_ITEM_MINOR,
        'The receipt total did not absorb the refund exactly once',
      );

      // The orders themselves are untouched: a refund adjusts money, not
      // fulfilment, and the delivered order stays delivered.
      const ordersAfter = receiptAfter.orders as readonly {
        readonly order_reference: string;
        readonly state: string;
        readonly total_minor: number;
      }[];
      check(
        ordersAfter.find((order) => order.order_reference === referenceA)?.state === 'DELIVERED',
        'The refund changed the fulfilment state of the delivered order',
      );
      check(
        ordersAfter.every(
          (order) =>
            Number(order.total_minor) ===
            Number(
              receiptOrders.find((before) => before.order_reference === order.order_reference)
                ?.total_minor,
            ),
        ),
        'The refund rewrote an order total instead of posting against it',
      );

      // -----------------------------------------------------------------
      // Admin reconciliation against this order's real provider operations.
      //
      // `importProviderStatement` and `financeQueue` were exercised only by
      // `verify-money-lifecycle.ts`, which invents its own references. So the
      // rule that matters -- reconciliation compares durable provider events
      // to the attempts and ledger this order actually produced -- had never
      // been tested against a real one.
      // -----------------------------------------------------------------
      const refundRow = await pool.query<{ refund_total_minor: string; refund_state: string }>(
        `SELECT refund_total_minor::text, refund_state FROM marketplace.refunds
            WHERE provider_operation_reference = $1`,
        ['SYNTH-REF-PARTIAL-0001'],
      );
      check(
        refundRow.rows[0]?.refund_state === 'SUCCEEDED' &&
          Number(refundRow.rows[0]?.refund_total_minor) === REFUND_ITEM_MINOR,
        'The approved refund did not settle as succeeded for the amount proposed',
      );

      // A statement row that agrees with the refund reconciles silently.
      const matchedImport = await completeMoney.importProviderStatement({
        context: adminContext(financeApproverId),
        rows: [
          {
            amount_minor: REFUND_ITEM_MINOR,
            operation_kind: 'REFUND',
            provider_operation_reference: 'SYNTH-REF-PARTIAL-0001',
            provider_state: 'SUCCEEDED',
          },
        ],
        statement_reference: 'SYNTH-STMT-MATCHED-0001',
      });
      const matchedRows = matchedImport.rows as readonly {
        readonly reconciliation_class: string;
      }[];
      check(
        matchedRows.length === 1 && matchedRows[0]?.reconciliation_class === 'MATCHED',
        'A statement row agreeing with the refund did not reconcile',
      );

      // A statement that disagrees with the captured payment must raise an
      // exception rather than being absorbed. This is the "mismatched provider
      // statement" case: the provider is the source of truth for what moved,
      // and a silent disagreement is how money goes missing unnoticed.
      const paymentRow2 = await pool.query<{
        provider_operation_reference: string;
        amount_minor: string;
      }>(
        `SELECT provider_operation_reference, amount_minor::text
             FROM marketplace.payment_transactions WHERE payment_transaction_id = $1`,
        [paymentTransactionId],
      );
      const paymentReference = paymentRow2.rows[0]?.provider_operation_reference;
      const paymentAmount = Number(paymentRow2.rows[0]?.amount_minor);
      check(
        paymentReference !== undefined && Number.isFinite(paymentAmount),
        'The captured payment carried no provider operation reference',
      );
      const mismatchedImport = await completeMoney.importProviderStatement({
        context: adminContext(financeApproverId),
        rows: [
          {
            amount_minor: paymentAmount + 1,
            operation_kind: 'PAYMENT',
            provider_operation_reference: paymentReference as string,
            provider_state: 'SUCCEEDED',
          },
        ],
        statement_reference: 'SYNTH-STMT-MISMATCH-0001',
      });
      const mismatchedRows = mismatchedImport.rows as readonly {
        readonly reconciliation_class: string;
      }[];
      check(
        mismatchedRows[0]?.reconciliation_class === 'AMOUNT_MISMATCH',
        'A statement disagreeing with the captured amount was accepted as matched',
      );

      // The exception reaches the queue an operator actually reads, naming the
      // operation at risk.
      const queue = await completeMoney.financeQueue({
        context: adminContext(financeApproverId),
      });
      const exceptions = queue.exceptions as readonly {
        readonly exception_kind: string;
        readonly operation_reference: string;
      }[];
      check(
        exceptions.some(
          (row) =>
            row.exception_kind === 'AMOUNT_MISMATCH' &&
            row.operation_reference === paymentReference,
        ),
        'The mismatched statement row raised no finance exception for this payment',
      );

      // Reconciliation reports; it does not move money. A disagreement must not
      // quietly adjust the receipt to match the provider.
      const receiptAfterImport = await completeMoney.customerReceipt({
        checkout_group_id: placed.checkout_group_id,
        context: customerContext(customerId),
      });
      check(
        Number(receiptAfterImport.refunded_total_minor) ===
          Number(receiptAfter.refunded_total_minor),
        'Importing a provider statement changed the customer receipt',
      );

      // The finance queue is an operator surface, not a customer one.
      await rejects(
        () => completeMoney.financeQueue({ context: customerContext(customerId) }),
        MoneyAuthorizationError,
        'A customer read the finance exception queue',
      );

      const settlement = await pool.query<{
        customer_net_minor: string;
        vendor_payable_minor: string;
        partner_payable_minor: string;
        platform_remainder_minor: string;
      }>(
        `SELECT customer_net_minor::text, vendor_payable_minor::text,
                  partner_payable_minor::text, platform_remainder_minor::text
             FROM marketplace.settlements WHERE source_order_reference=$1`,
        [orderA.order_reference],
      );
      const split = settlement.rows[0];
      check(split !== undefined, 'Delivery produced no settlement for the order');
      check(
        Number(split.customer_net_minor) ===
          Number(split.vendor_payable_minor) +
            Number(split.partner_payable_minor) +
            Number(split.platform_remainder_minor),
        'The settlement split does not add up to what the customer paid',
      );

      // The one assertion that catches everything else: whatever was posted,
      // it has to balance.
      const balance = await pool.query<{ debits: string; credits: string }>(
        `SELECT COALESCE(sum(debit_minor),0)::text AS debits,
                  COALESCE(sum(credit_minor),0)::text AS credits
             FROM marketplace.ledger_entries`,
      );
      check(
        balance.rows[0]?.debits === balance.rows[0]?.credits,
        `Ledger does not balance: ${balance.rows[0]?.debits} debits against ${balance.rows[0]?.credits} credits`,
      );
    } finally {
      await orderMoney.close();
      await completeMoney.close();
      await money.close();
    }
  } finally {
    await assignments.close();
    await fulfilment.close();
    await checkout.close();
    await carts.close();
    await catalogue.close();
    await inventory.close();
    await access.close();
    await pool.end();
  }
}
