import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type ActorKind,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  AssignmentAuthorizationError,
  AssignmentConflictError,
  AssignmentCustodyService,
  AssignmentInputError,
  AssignmentNotFoundError,
  AssignmentVersionError,
} from '../src/assignment-custody.js';
import { handoverCodeDigest } from '../src/handover-code.js';
import { check } from './verify-support.js';

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
  const HASH_KEY = 'synthetic-verifier-handover-code-material';
  const service = new AssignmentCustodyService({
    connection_string: connectionString,
    hash_key: HASH_KEY,
  });
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
    // Delivery now completes only against the customer's code (DLP-30). The
    // hash is planted directly here because this script builds assignments
    // without a customer session; the control being exercised is the
    // validation, not who asked for the code.
    const deliveryOtp = '424242';
    await pool.query(
      `UPDATE marketplace.delivery_assignments
          SET delivery_otp_hash = $2, delivery_otp_expires_at = $3, delivery_otp_attempts = 0
        WHERE delivery_assignment_id = $1`,
      [
        first.delivery_assignment_id,
        handoverCodeDigest(HASH_KEY, deliveryOtp),
        new Date(now.getTime() + 900_000),
      ],
    );

    let wrongCodeRejected = false;
    try {
      await service.deliver({
        command_reference: 'SYNTH-CMD-DELIVER-WRONG-A001',
        context: partnerOne,
        delivery_assignment_id: first.delivery_assignment_id,
        expected_version: arrived.version,
        now: new Date(now.getTime() + 15_500),
        otp: '000000',
        proof_reference: 'SYNTH-PROOF-DELIVERY-A001',
        reason_code: 'DELIVERY_PROOF_VERIFIED',
      });
    } catch {
      wrongCodeRejected = true;
    }
    check(wrongCodeRejected, 'A delivery completed without the customer’s code');
    const attempts = await pool.query<{ delivery_otp_attempts: number }>(
      'SELECT delivery_otp_attempts FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1',
      [first.delivery_assignment_id],
    );
    check(
      attempts.rows[0]?.delivery_otp_attempts === 1,
      'A failed code attempt was not durably counted',
    );

    const delivered = await service.deliver({
      command_reference: 'SYNTH-CMD-DELIVER-A001',
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: arrived.version,
      now: new Date(now.getTime() + 16_000),
      otp: deliveryOtp,
      proof_reference: 'SYNTH-PROOF-DELIVERY-A001',
      reason_code: 'DELIVERY_PROOF_VERIFIED',
    });
    const spent = await pool.query<{ delivery_otp_hash: string | null }>(
      'SELECT delivery_otp_hash FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1',
      [first.delivery_assignment_id],
    );
    check(
      spent.rows[0]?.delivery_otp_hash === null,
      'The delivery code survived a completed handoff and could be replayed',
    );
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
    // 9.3 -- reassignment is for attempts nobody has collected yet. Once the
    // bag is in a partner's hands the way out is the custody path, not a
    // return to the pool.
    let custodyReassignRefused = false;
    try {
      await service.reassign({
        command_reference: 'SYNTH-CMD-REASSIGN-IN-CUSTODY-B001',
        compensation_minor: 0,
        context: admin,
        delivery_assignment_id: state.delivery_assignment_id,
        expected_version: state.version,
        now: new Date(now.getTime() + 23_500),
        reason_code: 'OPERATOR_REASSIGNED',
      });
    } catch (error) {
      custodyReassignRefused = error instanceof AssignmentConflictError;
    }
    check(custodyReassignRefused, 'An attempt in custody was reassigned away from its partner');

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

    // A command reference the schema would refuse is refused here first, as
    // input. The domain's check was wider than `assignment_event_command_shape`
    // (it allowed underscores and any prefix), so the partner console's
    // `SYNTH-CMD-ARRIVE_VENDOR-…` reached the database and came back as a 500
    // -- "Something went wrong at our end" -- on every attempt to mark arrival.
    let refusedAsInput = false;
    try {
      await service.create({
        approximate_drop_area: 'SYNTH C Scheme Jaipur',
        approximate_pickup_area: 'SYNTH Jain Stores Jaipur',
        command_reference: 'SYNTH-CMD-ARRIVE_VENDOR-MFXQ1',
        context: admin,
        handling_flags: [],
        now: new Date(now.getTime() + 29_000),
        package_count: 1,
        reason_code: 'SYNTH_ASSIGNMENT_CREATED',
        source_order_reference: 'SYNTH-ORDER-SHAPE-C001',
        vendor_location_id: locationId,
      });
    } catch (error) {
      refusedAsInput = error instanceof AssignmentInputError;
      check(
        refusedAsInput,
        `A command reference the schema refuses was not refused as input (raised ${String(error)})`,
      );
    }
    check(refusedAsInput, 'A command reference the schema refuses was accepted');

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

    // 9.3 -- acceptance is atomic. Two accepts of the same offer arriving
    // together (a double tap that produced two command references) are held
    // on the row lock; one wins and the other sees a stale version. The
    // arrival is forced by holding the row from a third session until both
    // are queued, since an unforced race passes with any implementation.
    const contested = await service.create({
      approximate_drop_area: 'SYNTH Malviya Nagar Jaipur',
      approximate_pickup_area: 'SYNTH Jain Stores Jaipur',
      command_reference: 'SYNTH-CMD-CREATE-CONTEST-D001',
      context: admin,
      handling_flags: [],
      now: new Date(now.getTime() + 50_000),
      package_count: 1,
      reason_code: 'SYNTH_ASSIGNMENT_CREATED',
      source_order_reference: 'SYNTH-ORDER-CONTEST-D001',
      vendor_location_id: locationId,
    });
    const contestedOffer = await service.offer({
      command_reference: 'SYNTH-CMD-OFFER-CONTEST-D001',
      context: admin,
      delivery_assignment_id: contested.delivery_assignment_id,
      expected_version: contested.version,
      expires_at: new Date(now.getTime() + 80_000),
      now: new Date(now.getTime() + 50_000),
      partner_user_id: partnerOneId,
      reason_code: 'SYNTH_OFFER_CREATED',
    });
    const blocker = await pool.connect();
    let raced: readonly PromiseSettledResult<unknown>[] = [];
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        'SELECT 1 FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1 FOR UPDATE',
        [contested.delivery_assignment_id],
      );
      const attempts = ['SYNTH-CMD-ACCEPT-CONTEST-D001', 'SYNTH-CMD-ACCEPT-CONTEST-D002'].map(
        (commandReference) =>
          service.accept({
            command_reference: commandReference,
            context: partnerOne,
            delivery_assignment_id: contested.delivery_assignment_id,
            expected_version: contestedOffer.version,
            now: new Date(now.getTime() + 51_000),
            reason_code: 'PARTNER_ACCEPTED',
          }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await blocker.query('COMMIT');
      raced = await Promise.allSettled(attempts);
    } finally {
      blocker.release();
    }
    const won = raced.filter((result) => result.status === 'fulfilled');
    const lost = raced.filter(
      (result): result is PromiseRejectedResult =>
        result.status === 'rejected' &&
        (result.reason instanceof AssignmentVersionError ||
          result.reason instanceof AssignmentConflictError),
    );
    check(
      won.length === 1 && lost.length === 1,
      `A contested accept did not settle to exactly one winner (${JSON.stringify(raced.map((r) => (r.status === 'rejected' ? String(r.reason) : 'ok')))})`,
    );
    const contestedTrail = await pool.query<{ accepted: string; memberships: string }>(
      `SELECT (SELECT count(*) FROM marketplace.assignment_events
                WHERE delivery_assignment_id=$1 AND event_type='ACCEPTED')::text AS accepted,
              (SELECT count(*) FROM marketplace.partner_assignment_memberships
                WHERE delivery_assignment_id=$1 AND state='ACTIVE')::text AS memberships`,
      [contested.delivery_assignment_id],
    );
    check(
      contestedTrail.rows[0]?.accepted === '1' && contestedTrail.rows[0]?.memberships === '1',
      `A contested accept left ${JSON.stringify(contestedTrail.rows[0])}`,
    );

    // 9.3 -- an operator can take an accepted attempt off its partner: the
    // reason and the compensation decided are recorded against the partner,
    // the attempt goes back to the pool, and that partner is not offered it
    // again. Until audit run 58 "REASSIGNED" only stranded the order.
    const contestedWinner = (won[0] as PromiseFulfilledResult<{ version: number }>).value;
    let partnerCannotReassign = false;
    try {
      await service.reassign({
        command_reference: 'SYNTH-CMD-REASSIGN-BY-PARTNER-D001',
        compensation_minor: 500,
        context: partnerTwo,
        delivery_assignment_id: contested.delivery_assignment_id,
        expected_version: contestedWinner.version,
        now: new Date(now.getTime() + 52_000),
        reason_code: 'OPERATOR_REASSIGNED',
      });
    } catch (error) {
      partnerCannotReassign = error instanceof AssignmentAuthorizationError;
    }
    check(partnerCannotReassign, 'A partner reassigned another partner’s attempt');
    let amountBounded = false;
    try {
      await service.reassign({
        command_reference: 'SYNTH-CMD-REASSIGN-TOO-MUCH-D001',
        compensation_minor: 100_001,
        context: admin,
        delivery_assignment_id: contested.delivery_assignment_id,
        expected_version: contestedWinner.version,
        now: new Date(now.getTime() + 52_000),
        reason_code: 'OPERATOR_REASSIGNED',
      });
    } catch (error) {
      amountBounded = error instanceof AssignmentInputError;
    }
    check(amountBounded, 'An unbounded compensation was accepted');
    const reassignInput = {
      command_reference: 'SYNTH-CMD-REASSIGN-D001',
      compensation_minor: 2_500,
      context: admin,
      delivery_assignment_id: contested.delivery_assignment_id,
      expected_version: contestedWinner.version,
      note: 'SYNTH partner reports a puncture; attempt moved on',
      now: new Date(now.getTime() + 53_000),
      reason_code: 'PARTNER_VEHICLE_BREAKDOWN',
    } as const;
    const reassigned = await service.reassign(reassignInput);
    const reassignedReplay = await service.reassign({
      ...reassignInput,
      now: new Date(now.getTime() + 54_000),
    });
    check(
      reassigned.assignment_state === 'UNASSIGNED' &&
        reassigned.partner_user_id === null &&
        reassigned.custody_state === 'NONE' &&
        reassigned.offer_expires_at === null &&
        reassignedReplay.version === reassigned.version,
      `Reassignment did not return the attempt to the pool exactly once (${JSON.stringify({ reassigned, reassignedReplay })})`,
    );
    const reassignTrail = await pool.query<{
      event_partner: string | null;
      memberships: string;
      compensations: string;
      amount_minor: string | null;
      displaced_from: string | null;
      decided_by_user_id: string | null;
      note: string | null;
    }>(
      `SELECT
         (SELECT partner_user_id FROM marketplace.assignment_events
           WHERE delivery_assignment_id=$1 AND event_type='REASSIGNED') AS event_partner,
         (SELECT count(*) FROM marketplace.partner_assignment_memberships
           WHERE delivery_assignment_id=$1 AND state='ACTIVE')::text AS memberships,
         (SELECT count(*) FROM marketplace.partner_attempt_compensations
           WHERE delivery_assignment_id=$1)::text AS compensations,
         c.amount_minor::text, c.displaced_from, c.decided_by_user_id, c.note
         FROM marketplace.partner_attempt_compensations c
        WHERE c.delivery_assignment_id=$1 AND c.partner_user_id=$2`,
      [contested.delivery_assignment_id, partnerOneId],
    );
    const trail = reassignTrail.rows[0];
    check(
      trail?.event_partner === partnerOneId &&
        trail.memberships === '0' &&
        trail.compensations === '1' &&
        trail.amount_minor === '2500' &&
        trail.displaced_from === 'ASSIGNED' &&
        trail.decided_by_user_id === adminId &&
        trail.note === reassignInput.note,
      `Reassignment did not record who was displaced, from what, and what they are owed (${JSON.stringify(trail)})`,
    );
    const history = await service.offerHistory({
      delivery_assignment_id: contested.delivery_assignment_id,
    });
    check(
      history.declined.includes(partnerOneId),
      'A partner an operator displaced could be offered the same attempt again',
    );
    const owedToOne = await service.listCompensationsForPartner({ context: partnerOne });
    const owedToTwo = await service.listCompensationsForPartner({ context: partnerTwo });
    check(
      owedToOne.length === 1 &&
        owedToOne[0]?.amount_minor === 2_500 &&
        owedToOne[0].delivery_assignment_id === contested.delivery_assignment_id &&
        owedToTwo.length === 0,
      `Compensation history is not the displaced partner’s own (${JSON.stringify({ owedToOne, owedToTwo })})`,
    );
    let compensationProtected = false;
    try {
      await pool.query('UPDATE marketplace.partner_attempt_compensations SET amount_minor=0');
    } catch {
      compensationProtected = true;
    }
    check(compensationProtected, 'Compensation history was not append-only');
    let poolReassignRefused = false;
    try {
      await service.reassign({
        command_reference: 'SYNTH-CMD-REASSIGN-POOLED-D001',
        compensation_minor: 0,
        context: admin,
        delivery_assignment_id: contested.delivery_assignment_id,
        expected_version: reassigned.version,
        now: new Date(now.getTime() + 55_000),
        reason_code: 'OPERATOR_REASSIGNED',
      });
    } catch (error) {
      poolReassignRefused = error instanceof AssignmentConflictError;
    }
    check(poolReassignRefused, 'An attempt with no partner was "reassigned"');

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
