import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type ActorKind,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  AssignmentConflictError,
  AssignmentCustodyService,
  AssignmentNotFoundError,
} from '../src/assignment-custody.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function context(kind: ActorKind, actorId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: actorId,
      actor_kind: kind,
      session_id: createUuidV7(),
    }),
  });
}

export async function verifyAssignmentCustody(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const service = new AssignmentCustodyService({ connection_string: connectionString });
  const adminId = createUuidV7();
  const partnerOneId = createUuidV7();
  const partnerTwoId = createUuidV7();
  const vendorId = createUuidV7();
  const locationId = createUuidV7();
  const now = new Date('2026-08-24T10:00:00.000Z');
  const admin = context('admin', adminId);
  const partnerOne = context('delivery_partner', partnerOneId);
  const partnerTwo = context('delivery_partner', partnerTwoId);
  const system = context('system', createUuidV7());
  try {
    for (const userId of [adminId, partnerOneId, partnerTwoId]) {
      await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1)', [userId]);
    }
    for (const [partnerId, suffix] of [
      [partnerOneId, 'ONE'],
      [partnerTwoId, 'TWO'],
    ] as const) {
      const roleId = createUuidV7();
      const requestId = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.role_assignments
          (role_assignment_id,user_id,role_key,state,valid_from,valid_until,
           granted_by_user_id,request_id,correlation_id,created_at,updated_at)
         VALUES ($1,$2,'DELIVERY_PARTNER','ACTIVE',$3,$4,$5,$6,$6,$3,$3)`,
        [roleId, partnerId, now, new Date(now.getTime() + 86_400_000), adminId, requestId],
      );
      await pool.query(
        `INSERT INTO marketplace.partner_eligibilities
          (partner_eligibility_id,role_assignment_id,user_id,state,eligible_from,
           eligible_until,reason_code,updated_at)
         VALUES ($1,$2,$3,'ELIGIBLE',$4,$5,$6,$4)`,
        [
          createUuidV7(),
          roleId,
          partnerId,
          now,
          new Date(now.getTime() + 86_400_000),
          `SYNTH_PARTNER_${suffix}`,
        ],
      );
    }
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id)
       VALUES ($1,'SYNTH Assignment Verification','Synthetic assignment test vendor','ACTIVE',$2,$2)`,
      [vendorId, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH Assignment Store','Synthetic assignment location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3)`,
      [locationId, vendorId, createUuidV7()],
    );

    const first = await service.create({
      approximate_drop_area: 'SYNTH Vaishali Nagar Jaipur',
      approximate_pickup_area: 'SYNTH Jain Stores Jaipur',
      command_reference: 'SYNTH-CMD-CREATE-A001',
      context: admin,
      handling_flags: ['FRAGILE'],
      now,
      package_count: 2,
      reason_code: 'SYNTH_ASSIGNMENT_CREATED',
      source_order_reference: 'SYNTH-ORDER-DELIVERY-A001',
      vendor_location_id: locationId,
    });
    const offered = await service.offer({
      command_reference: 'SYNTH-CMD-OFFER-A001',
      context: admin,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: first.version,
      expires_at: new Date(now.getTime() + 30_000),
      now,
      partner_user_id: partnerOneId,
      reason_code: 'SYNTH_OFFER_CREATED',
    });
    const accepted = await service.accept({
      command_reference: 'SYNTH-CMD-ACCEPT-A001',
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: offered.version,
      now: new Date(now.getTime() + 5_000),
      reason_code: 'PARTNER_ACCEPTED',
    });
    const acceptedReplay = await service.accept({
      command_reference: 'SYNTH-CMD-ACCEPT-A001',
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: offered.version,
      now: new Date(now.getTime() + 6_000),
      reason_code: 'PARTNER_ACCEPTED',
    });
    check(acceptedReplay.version === accepted.version, 'Accept retry did not replay exactly');

    let wrongPartnerHidden = false;
    try {
      await service.get({
        context: partnerTwo,
        delivery_assignment_id: first.delivery_assignment_id,
      });
    } catch (error) {
      wrongPartnerHidden = error instanceof AssignmentNotFoundError;
    }
    check(wrongPartnerHidden, 'Assignment leaked to another partner');

    const atVendor = await service.arriveAtVendor({
      command_reference: 'SYNTH-CMD-ARRIVE-VENDOR-A001',
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: accepted.version,
      now: new Date(now.getTime() + 10_000),
      reason_code: 'TRUSTED_VENDOR_ARRIVAL',
    });
    let packageMismatchRejected = false;
    try {
      await service.confirmPickup({
        command_reference: 'SYNTH-CMD-BAD-PICKUP-A001',
        context: partnerOne,
        delivery_assignment_id: first.delivery_assignment_id,
        expected_version: atVendor.version,
        now: new Date(now.getTime() + 11_000),
        package_count: 1,
        proof_reference: 'SYNTH-PROOF-PICKUP-BAD-A001',
        reason_code: 'PICKUP_VERIFIED',
        vendor_confirmed: true,
      });
    } catch (error) {
      packageMismatchRejected = error instanceof AssignmentConflictError;
    }
    check(packageMismatchRejected, 'Mismatched package count started custody');
    const pickedUp = await service.confirmPickup({
      command_reference: 'SYNTH-CMD-PICKUP-A001',
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: atVendor.version,
      now: new Date(now.getTime() + 12_000),
      package_count: 2,
      proof_reference: 'SYNTH-PROOF-PICKUP-GOOD-A001',
      reason_code: 'PICKUP_VERIFIED',
      vendor_confirmed: true,
    });
    check(pickedUp.custody_state === 'IN_CUSTODY', 'Pickup did not start custody');

    let postPickupCancellationRejected = false;
    try {
      await service.endBeforePickup({
        command_reference: 'SYNTH-CMD-CANCEL-AFTER-PICKUP-A001',
        context: admin,
        delivery_assignment_id: first.delivery_assignment_id,
        expected_version: pickedUp.version,
        now: new Date(now.getTime() + 13_000),
        reason_code: 'CUSTOMER_CANCELLED_BEFORE_PICKUP',
        resulting_state: 'CANCELLED',
      });
    } catch (error) {
      postPickupCancellationRejected = error instanceof AssignmentConflictError;
    }
    check(postPickupCancellationRejected, 'Cancellation bypassed active custody');

    const enRoute = await service.beginRoute({
      command_reference: 'SYNTH-CMD-ROUTE-A001',
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: pickedUp.version,
      now: new Date(now.getTime() + 14_000),
      reason_code: 'ROUTE_STARTED',
    });
    const arrived = await service.arriveAtCustomer({
      command_reference: 'SYNTH-CMD-ARRIVE-CUSTOMER-A001',
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: enRoute.version,
      now: new Date(now.getTime() + 15_000),
      reason_code: 'CUSTOMER_LOCATION_ARRIVAL',
    });
    const delivered = await service.deliver({
      command_reference: 'SYNTH-CMD-DELIVER-A001',
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: arrived.version,
      now: new Date(now.getTime() + 16_000),
      proof_reference: 'SYNTH-PROOF-DELIVERY-A001',
      reason_code: 'DELIVERY_PROOF_VERIFIED',
    });
    check(
      delivered.assignment_state === 'DELIVERED' && delivered.custody_state === 'DELIVERED',
      'Delivery did not close custody',
    );

    const returnedSeed = await service.create({
      approximate_drop_area: 'SYNTH Mansarovar Jaipur',
      approximate_pickup_area: 'SYNTH Jain Stores Jaipur',
      command_reference: 'SYNTH-CMD-CREATE-RETURN-B001',
      context: admin,
      handling_flags: ['PERISHABLE'],
      now: new Date(now.getTime() + 20_000),
      package_count: 1,
      reason_code: 'SYNTH_ASSIGNMENT_CREATED',
      source_order_reference: 'SYNTH-ORDER-RETURN-B001',
      vendor_location_id: locationId,
    });
    const returnOffer = await service.offer({
      command_reference: 'SYNTH-CMD-OFFER-RETURN-B001',
      context: admin,
      delivery_assignment_id: returnedSeed.delivery_assignment_id,
      expected_version: returnedSeed.version,
      expires_at: new Date(now.getTime() + 50_000),
      now: new Date(now.getTime() + 20_000),
      partner_user_id: partnerTwoId,
      reason_code: 'SYNTH_OFFER_CREATED',
    });
    let state = await service.accept({
      command_reference: 'SYNTH-CMD-ACCEPT-RETURN-B001',
      context: partnerTwo,
      delivery_assignment_id: returnedSeed.delivery_assignment_id,
      expected_version: returnOffer.version,
      now: new Date(now.getTime() + 21_000),
      reason_code: 'PARTNER_ACCEPTED',
    });
    state = await service.arriveAtVendor({
      command_reference: 'SYNTH-CMD-ARRIVE-RETURN-B001',
      context: partnerTwo,
      delivery_assignment_id: state.delivery_assignment_id,
      expected_version: state.version,
      now: new Date(now.getTime() + 22_000),
      reason_code: 'TRUSTED_VENDOR_ARRIVAL',
    });
    state = await service.confirmPickup({
      command_reference: 'SYNTH-CMD-PICKUP-RETURN-B001',
      context: partnerTwo,
      delivery_assignment_id: state.delivery_assignment_id,
      expected_version: state.version,
      now: new Date(now.getTime() + 23_000),
      package_count: 1,
      proof_reference: 'SYNTH-PROOF-PICKUP-RETURN-B001',
      reason_code: 'PICKUP_VERIFIED',
      vendor_confirmed: true,
    });
    state = await service.failDelivery({
      command_reference: 'SYNTH-CMD-FAIL-RETURN-B001',
      context: partnerTwo,
      delivery_assignment_id: state.delivery_assignment_id,
      expected_version: state.version,
      now: new Date(now.getTime() + 24_000),
      reason_code: 'CUSTOMER_UNREACHABLE',
    });
    state = await service.requireReturn({
      command_reference: 'SYNTH-CMD-REQUIRE-RETURN-B001',
      context: partnerTwo,
      delivery_assignment_id: state.delivery_assignment_id,
      expected_version: state.version,
      now: new Date(now.getTime() + 25_000),
      reason_code: 'CUSTOMER_UNREACHABLE',
    });
    state = await service.authorizeReturn({
      command_reference: 'SYNTH-CMD-AUTHORIZE-RETURN-B001',
      context: admin,
      delivery_assignment_id: state.delivery_assignment_id,
      destination_reference: 'SYNTH-RETURN-JAIN-STORES-B001',
      expected_version: state.version,
      now: new Date(now.getTime() + 26_000),
      reason_code: 'RETURN_AUTHORIZED_BY_OPERATIONS',
    });
    state = await service.beginReturn({
      command_reference: 'SYNTH-CMD-BEGIN-RETURN-B001',
      context: partnerTwo,
      delivery_assignment_id: state.delivery_assignment_id,
      expected_version: state.version,
      now: new Date(now.getTime() + 27_000),
      reason_code: 'RETURN_ROUTE_STARTED',
    });
    state = await service.completeReturn({
      command_reference: 'SYNTH-CMD-COMPLETE-RETURN-B001',
      context: partnerTwo,
      delivery_assignment_id: state.delivery_assignment_id,
      expected_version: state.version,
      now: new Date(now.getTime() + 28_000),
      proof_reference: 'SYNTH-PROOF-RETURN-B001',
      reason_code: 'RETURN_PROOF_VERIFIED',
    });
    check(state.custody_state === 'RETURNED', 'Controlled return did not close custody');

    const expiring = await service.create({
      approximate_drop_area: 'SYNTH C Scheme Jaipur',
      approximate_pickup_area: 'SYNTH Jain Stores Jaipur',
      command_reference: 'SYNTH-CMD-CREATE-EXPIRY-C001',
      context: admin,
      handling_flags: [],
      now: new Date(now.getTime() + 30_000),
      package_count: 1,
      reason_code: 'SYNTH_ASSIGNMENT_CREATED',
      source_order_reference: 'SYNTH-ORDER-EXPIRY-C001',
      vendor_location_id: locationId,
    });
    await service.offer({
      command_reference: 'SYNTH-CMD-OFFER-EXPIRY-C001',
      context: admin,
      delivery_assignment_id: expiring.delivery_assignment_id,
      expected_version: expiring.version,
      expires_at: new Date(now.getTime() + 40_000),
      now: new Date(now.getTime() + 30_000),
      partner_user_id: partnerOneId,
      reason_code: 'SYNTH_OFFER_CREATED',
    });
    const expiredCount = await service.expireOffers({
      command_prefix: 'SYNTH-CMD-EXPIRE',
      context: system,
      now: new Date(now.getTime() + 41_000),
    });
    check(expiredCount === 1, 'Server-time offer expiry did not close exactly one offer');

    const activeMemberships = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.partner_assignment_memberships
        WHERE state='ACTIVE'`,
    );
    check(activeMemberships.rows[0]?.count === '0', 'Terminal work left an active membership');
    let historyProtected = false;
    try {
      await pool.query("UPDATE marketplace.assignment_events SET reason_code='TAMPERED'");
    } catch {
      historyProtected = true;
    }
    check(historyProtected, 'Assignment history was not append-only');
  } finally {
    await service.close();
    await pool
      .query(
        `TRUNCATE marketplace.return_tasks, marketplace.custody_events,
        marketplace.assignment_events, marketplace.delivery_assignments CASCADE`,
      )
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.access_membership_events WHERE user_id=ANY($1)', [
        [partnerOneId, partnerTwoId],
      ])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.partner_eligibilities WHERE user_id=ANY($1)', [
        [partnerOneId, partnerTwoId],
      ])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.role_assignments WHERE user_id=ANY($1)', [
        [partnerOneId, partnerTwoId],
      ])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.vendor_locations WHERE vendor_id=$1', [vendorId])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.vendors WHERE vendor_id=$1', [vendorId])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.users WHERE user_id=ANY($1)', [
        [adminId, partnerOneId, partnerTwoId],
      ])
      .catch(() => undefined);
    await pool.end();
  }
}
