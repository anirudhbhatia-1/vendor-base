import {
  createAuthenticatedActor,
  createRequestContext,
  createRequestId,
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
  DeliveryOtpExpiredError,
  type DeliveryAssignmentRecord,
} from '../src/assignment-custody.js';
import { handoverCodeDigest } from '../src/handover-code.js';
import { PartnerWaitConflictError, PartnerWaitPolicyService } from '../src/partner-wait-policy.js';
import { PartnerFieldOpsService } from '../src/partner-field-ops.js';
import {
  activateConfigurationVersion,
  approveConfigurationVersion,
  createConfigurationDraft,
  scheduleConfigurationVersion,
  validateConfigurationVersion,
} from '../src/versioned-configuration.js';
import { check } from './verify-support.js';

/** The store sits at (75.81, 26.91); these fixes are measured from it. */
const AT_THE_COUNTER = { latitude: 26.9103, longitude: 75.81, accuracy_meters: 15 };
const ACROSS_TOWN = { latitude: 26.93, longitude: 75.81, accuracy_meters: 10 };
const BAD_FIX = { latitude: 26.9101, longitude: 75.81, accuracy_meters: 400 };
const DOWN_THE_ROAD = { latitude: 26.9127, longitude: 75.81, accuracy_meters: 10 };

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
  const waits = new PartnerWaitPolicyService({ connection_string: connectionString });
  const fieldOps = new PartnerFieldOpsService({ connection_string: connectionString });
  const adminId = createUuidV7();
  const partnerOneId = createUuidV7();
  const partnerTwoId = createUuidV7();
  const vendorId = createUuidV7();
  const locationId = createUuidV7();
  const counterStaffId = createUuidV7();
  const otherStoreStaffId = createUuidV7();
  const counterStaff = context('vendor_staff', counterStaffId);
  const otherStoreStaff = context('vendor_staff', otherStoreStaffId);
  const now = new Date('2026-08-24T10:00:00.000Z');
  const admin = context('admin', adminId);
  const partnerOne = context('delivery_partner', partnerOneId);
  const partnerTwo = context('delivery_partner', partnerTwoId);
  const system = context('system', createUuidV7());
  try {
    for (const userId of [adminId, partnerOneId, partnerTwoId, counterStaffId, otherStoreStaffId]) {
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

    // 9.4 -- the store's landmark: the written way to find it.
    await pool.query(
      `UPDATE marketplace.vendor_locations SET landmark=$2 WHERE vendor_location_id=$1`,
      [locationId, 'SYNTH opposite the SBI ATM'],
    );
    // Vendor staff: one at this store, one at another store of the same vendor.
    const otherLocationId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH Assignment Second Store','Synthetic second location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.83,26.93),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3)`,
      [otherLocationId, vendorId, createUuidV7()],
    );
    for (const [staffId, storeId] of [
      [counterStaffId, locationId],
      [otherStoreStaffId, otherLocationId],
    ] as const) {
      const roleId = createUuidV7();
      await pool.query(
        `INSERT INTO marketplace.role_assignments
          (role_assignment_id,user_id,role_key,state,valid_from,valid_until,
           granted_by_user_id,request_id,correlation_id,created_at,updated_at)
         VALUES ($1,$2,'VENDOR_PICKER','ACTIVE',$3,NULL,$4,$5,$5,$3,$3)`,
        [roleId, staffId, now, adminId, createUuidV7()],
      );
      await pool.query(
        `INSERT INTO marketplace.staff_memberships
          (staff_membership_id,role_assignment_id,user_id,vendor_location_id)
         VALUES ($1,$2,$3,$4)`,
        [createUuidV7(), roleId, staffId, storeId],
      );
    }

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

    // 9.4 -- once the job is theirs, the partner has the store itself: its
    // name, its landmark and its point. The offer had only the area.
    const headingThere = (
      await service.listActiveForPartner({ partner_user_id: partnerOneId })
    ).find((job) => job.delivery_assignment_id === first.delivery_assignment_id);
    check(
      headingThere?.pickup_location?.name === 'SYNTH Assignment Store' &&
        headingThere.pickup_location.landmark === 'SYNTH opposite the SBI ATM' &&
        Math.abs(headingThere.pickup_location.latitude - 26.91) < 1e-6 &&
        Math.abs(headingThere.pickup_location.longitude - 75.81) < 1e-6,
      `The assigned partner was not given the store's location and landmark (${JSON.stringify(headingThere?.pickup_location)})`,
    );

    // 9.4 -- arrival is trusted by position: a fix at the counter records the
    // arrival as TRUSTED_LOCATION with its distance.
    const atVendor = await service.arriveAtVendor({
      command_reference: 'SYNTH-CMD-ARRIVE-VENDOR-A001',
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: accepted.version,
      now: new Date(now.getTime() + 10_000),
      position: AT_THE_COUNTER,
      reason_code: 'PARTNER_CONFIRMED',
    });
    const trustedEvent = await pool.query<{ reason_code: string }>(
      `SELECT reason_code FROM marketplace.assignment_events
        WHERE delivery_assignment_id=$1 AND event_type='AT_VENDOR'`,
      [first.delivery_assignment_id],
    );
    check(
      atVendor.assignment_state === 'AT_VENDOR' &&
        atVendor.arrival_kind === 'TRUSTED_LOCATION' &&
        atVendor.arrival_distance_metres !== null &&
        atVendor.arrival_distance_metres > 20 &&
        atVendor.arrival_distance_metres < 45 &&
        atVendor.arrival_claim === null &&
        trustedEvent.rows[0]?.reason_code === 'TRUSTED_VENDOR_ARRIVAL',
      `A fix at the counter was not recorded as a trusted arrival (${JSON.stringify({ atVendor, event: trustedEvent.rows[0] })})`,
    );
    // 9.5 -- the arrival opened the wait itself, under the policy.
    const waitOpened = await pool.query<{ wait_state: string; started_at: Date }>(
      `SELECT wait_state, started_at FROM marketplace.partner_wait_timers
        WHERE delivery_assignment_id=$1 AND partner_user_id=$2`,
      [first.delivery_assignment_id, partnerOneId],
    );
    check(
      waitOpened.rows[0]?.wait_state === 'RUNNING' &&
        waitOpened.rows[0].started_at.getTime() === now.getTime() + 10_000,
      `A trusted arrival did not open the wait (${JSON.stringify(waitOpened.rows[0])})`,
    );
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
    // 9.5 -- and the handover closed it: two seconds waited, nothing owed, on record.
    const waitClosed = await pool.query<{ wait_state: string; amount_minor: string | null }>(
      `SELECT timer.wait_state, owed.amount_minor::text
         FROM marketplace.partner_wait_timers timer
         LEFT JOIN marketplace.partner_wait_earning_adjustments owed USING (partner_wait_timer_id)
        WHERE timer.delivery_assignment_id=$1 AND timer.partner_user_id=$2`,
      [first.delivery_assignment_id, partnerOneId],
    );
    check(
      waitClosed.rows[0]?.wait_state === 'RESOLVED' && waitClosed.rows[0].amount_minor === '0',
      `The handover did not close the wait (${JSON.stringify(waitClosed.rows[0])})`,
    );
    const carrying = (await service.listActiveForPartner({ partner_user_id: partnerOneId })).find(
      (job) => job.delivery_assignment_id === first.delivery_assignment_id,
    );
    check(
      carrying !== undefined && carrying.pickup_location === undefined,
      'The store stayed on the record after the goods left it',
    );

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
    // 9.6 -- an attempt with no order has no door to measure against: the
    // arrival stands UNVERIFIED with that reason, the partner proceeds, and
    // waiting pay at the door is refused until the door is known.
    const arrived = await service.arriveAtCustomer({
      command_reference: 'SYNTH-CMD-ARRIVE-CUSTOMER-A001',
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      expected_version: enRoute.version,
      now: new Date(now.getTime() + 15_000),
      position: AT_THE_COUNTER,
      reason_code: 'CUSTOMER_LOCATION_ARRIVAL',
    });
    const arrivedEvent = await pool.query<{ reason_code: string }>(
      `SELECT reason_code FROM marketplace.assignment_events
        WHERE delivery_assignment_id=$1 AND event_type='ARRIVED'`,
      [first.delivery_assignment_id],
    );
    check(
      arrived.assignment_state === 'ARRIVED' &&
        arrived.customer_arrival_kind === 'UNVERIFIED' &&
        arrived.customer_arrival_claim_reason === 'NO_DESTINATION' &&
        arrivedEvent.rows[0]?.reason_code === 'UNVERIFIED_CUSTOMER_ARRIVAL',
      `An arrival with no door to measure against was not recorded as unverified (${JSON.stringify({ arrived, event: arrivedEvent.rows[0] })})`,
    );
    let doorWaitRefused = false;
    try {
      await waits.start({
        context: partnerOne,
        delivery_assignment_id: first.delivery_assignment_id,
        command_reference: 'SYNTH-CMD-WAIT-DOOR-A001',
        reason_code: 'CUSTOMER_WAIT_STARTED',
        now: new Date(now.getTime() + 15_100),
      });
    } catch (error) {
      doorWaitRefused = error instanceof PartnerWaitConflictError;
    }
    check(doorWaitRefused, 'Paid waiting at the door started on an unverified arrival');
    let noCustomerToNudge = false;
    try {
      await service.customerNudge({
        context: partnerOne,
        delivery_assignment_id: first.delivery_assignment_id,
        kind: 'AT_DOOR',
        now: new Date(now.getTime() + 15_200),
      });
    } catch (error) {
      noCustomerToNudge = error instanceof AssignmentConflictError;
    }
    check(noCustomerToNudge, 'A nudge was admitted for an attempt with no customer');
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

    // 9.6 -- completion happens exactly once. Two deliveries of the same code
    // arriving together (a double tap with two command references) are held
    // on the row from a third session until both are queued; one completes
    // and the other is refused, with one DELIVERED event and one closure.
    const deliverBlocker = await pool.connect();
    let deliverRace: readonly PromiseSettledResult<DeliveryAssignmentRecord>[] = [];
    try {
      await deliverBlocker.query('BEGIN');
      await deliverBlocker.query(
        'SELECT 1 FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1 FOR UPDATE',
        [first.delivery_assignment_id],
      );
      const attempts = ['SYNTH-CMD-DELIVER-A001', 'SYNTH-CMD-DELIVER-A002'].map(
        (commandReference) =>
          service.deliver({
            command_reference: commandReference,
            context: partnerOne,
            delivery_assignment_id: first.delivery_assignment_id,
            expected_version: arrived.version,
            now: new Date(now.getTime() + 16_000),
            otp: deliveryOtp,
            proof_reference: 'SYNTH-PROOF-DELIVERY-A001',
            reason_code: 'DELIVERY_PROOF_VERIFIED',
          }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await deliverBlocker.query('COMMIT');
      deliverRace = await Promise.allSettled(attempts);
    } finally {
      deliverBlocker.release();
    }
    const deliveredOnce = deliverRace.filter(
      (result): result is PromiseFulfilledResult<DeliveryAssignmentRecord> =>
        result.status === 'fulfilled',
    );
    const deliverTrail = await pool.query<{ events: string; closures: string }>(
      `SELECT (SELECT count(*) FROM marketplace.assignment_events
                WHERE delivery_assignment_id=$1 AND event_type='DELIVERED')::text AS events,
              (SELECT count(*) FROM marketplace.custody_events
                WHERE delivery_assignment_id=$1 AND custody_state='DELIVERED')::text AS closures`,
      [first.delivery_assignment_id],
    );
    check(
      deliveredOnce.length === 1 &&
        deliverTrail.rows[0]?.events === '1' &&
        deliverTrail.rows[0].closures === '1',
      `A contested delivery did not complete exactly once (${JSON.stringify({ outcomes: deliverRace.map((r) => (r.status === 'rejected' ? String(r.reason) : 'ok')), trail: deliverTrail.rows[0] })})`,
    );
    const delivered = (deliveredOnce[0] as PromiseFulfilledResult<DeliveryAssignmentRecord>).value;
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
    // 9.6 -- the customer's code read to the partner is the door: the
    // unverified arrival is confirmed by it.
    check(
      delivered.customer_arrival_kind === 'CUSTOMER_CONFIRMED' &&
        delivered.customer_arrival_claim_reason === null,
      `The customer's code did not confirm the arrival (${JSON.stringify(delivered)})`,
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
    // 9.4 -- no fix: the arrival is a claim, the attempt stays ASSIGNED, and
    // nothing that needs the partner at the counter can happen until the
    // counter says they are.
    state = await service.arriveAtVendor({
      command_reference: 'SYNTH-CMD-ARRIVE-RETURN-B001',
      context: partnerTwo,
      delivery_assignment_id: state.delivery_assignment_id,
      expected_version: state.version,
      now: new Date(now.getTime() + 22_000),
      reason_code: 'PARTNER_CONFIRMED',
    });
    const claimEvent = await pool.query<{ event_type: string; reason_code: string }>(
      `SELECT event_type, reason_code FROM marketplace.assignment_events
        WHERE delivery_assignment_id=$1 ORDER BY assignment_version DESC LIMIT 1`,
      [state.delivery_assignment_id],
    );
    check(
      state.assignment_state === 'ASSIGNED' &&
        state.arrival_kind === null &&
        state.arrival_claim?.reason === 'NO_LOCATION' &&
        claimEvent.rows[0]?.event_type === 'ARRIVAL_CLAIMED' &&
        claimEvent.rows[0].reason_code === 'NO_LOCATION',
      `An arrival with no fix was not recorded as a claim (${JSON.stringify({ state, event: claimEvent.rows[0] })})`,
    );
    let pickupBeforeConfirmationRefused = false;
    try {
      await service.confirmPickup({
        command_reference: 'SYNTH-CMD-PICKUP-EARLY-B001',
        context: partnerTwo,
        delivery_assignment_id: state.delivery_assignment_id,
        expected_version: state.version,
        now: new Date(now.getTime() + 22_100),
        package_count: 1,
        proof_reference: 'SYNTH-PROOF-PICKUP-EARLY-B001',
        reason_code: 'PICKUP_VERIFIED',
        vendor_confirmed: true,
      });
    } catch (error) {
      pickupBeforeConfirmationRefused = error instanceof AssignmentConflictError;
    }
    check(pickupBeforeConfirmationRefused, 'A claimed, unconfirmed arrival allowed a pickup');
    let partnerCannotConfirmOwnArrival = false;
    try {
      await service.confirmPartnerArrival({
        command_reference: 'SYNTH-CMD-CONFIRM-SELF-B001',
        context: partnerTwo,
        delivery_assignment_id: state.delivery_assignment_id,
        expected_version: state.version,
        now: new Date(now.getTime() + 22_200),
        vendor_location_id: locationId,
      });
    } catch (error) {
      partnerCannotConfirmOwnArrival = error instanceof AssignmentAuthorizationError;
    }
    check(partnerCannotConfirmOwnArrival, 'A partner confirmed their own arrival');
    let otherStoreCannotConfirm = false;
    try {
      await service.confirmPartnerArrival({
        command_reference: 'SYNTH-CMD-CONFIRM-OTHER-B001',
        context: otherStoreStaff,
        delivery_assignment_id: state.delivery_assignment_id,
        expected_version: state.version,
        now: new Date(now.getTime() + 22_300),
        vendor_location_id: locationId,
      });
    } catch (error) {
      otherStoreCannotConfirm = error instanceof AssignmentAuthorizationError;
    }
    check(otherStoreCannotConfirm, 'Staff of another store confirmed an arrival at this one');
    const confirmInput = {
      command_reference: 'SYNTH-CMD-CONFIRM-ARRIVAL-B001',
      context: counterStaff,
      delivery_assignment_id: state.delivery_assignment_id,
      expected_version: state.version,
      now: new Date(now.getTime() + 22_400),
      vendor_location_id: locationId,
    };
    state = await service.confirmPartnerArrival(confirmInput);
    const confirmedAgain = await service.confirmPartnerArrival({
      ...confirmInput,
      now: new Date(now.getTime() + 22_500),
    });
    const confirmEvent = await pool.query<{ actor_kind: string; reason_code: string }>(
      `SELECT actor_kind, reason_code FROM marketplace.assignment_events
        WHERE delivery_assignment_id=$1 AND event_type='AT_VENDOR'`,
      [state.delivery_assignment_id],
    );
    check(
      state.assignment_state === 'AT_VENDOR' &&
        state.arrival_kind === 'VENDOR_CONFIRMED' &&
        state.arrival_claim === null &&
        confirmedAgain.version === state.version &&
        confirmEvent.rows[0]?.actor_kind === 'vendor_staff' &&
        confirmEvent.rows[0].reason_code === 'VENDOR_CONFIRMED_ARRIVAL',
      `The counter's confirmation did not record the arrival exactly once (${JSON.stringify({ state, event: confirmEvent.rows[0] })})`,
    );
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

    // 9.4 -- what the position has to be. A fix worse than the accuracy bar
    // or outside the radius is a claim with its reason; the radius is a
    // setting, and a fix that was out of range under the default is trusted
    // once operations widen it.
    const geofenced = await service.create({
      approximate_drop_area: 'SYNTH Bapu Nagar Jaipur',
      approximate_pickup_area: 'SYNTH Jain Stores Jaipur',
      command_reference: 'SYNTH-CMD-CREATE-FENCE-E001',
      context: admin,
      handling_flags: [],
      now: new Date(now.getTime() + 60_000),
      package_count: 1,
      reason_code: 'SYNTH_ASSIGNMENT_CREATED',
      source_order_reference: 'SYNTH-ORDER-FENCE-E001',
      vendor_location_id: locationId,
    });
    const fenceOffer = await service.offer({
      command_reference: 'SYNTH-CMD-OFFER-FENCE-E001',
      context: admin,
      delivery_assignment_id: geofenced.delivery_assignment_id,
      expected_version: geofenced.version,
      expires_at: new Date(now.getTime() + 90_000),
      now: new Date(now.getTime() + 60_000),
      partner_user_id: partnerTwoId,
      reason_code: 'SYNTH_OFFER_CREATED',
    });
    let fence = await service.accept({
      command_reference: 'SYNTH-CMD-ACCEPT-FENCE-E001',
      context: partnerTwo,
      delivery_assignment_id: geofenced.delivery_assignment_id,
      expected_version: fenceOffer.version,
      now: new Date(now.getTime() + 61_000),
      reason_code: 'PARTNER_ACCEPTED',
    });
    fence = await service.arriveAtVendor({
      command_reference: 'SYNTH-CMD-ARRIVE-BAD-FIX-E001',
      context: partnerTwo,
      delivery_assignment_id: fence.delivery_assignment_id,
      expected_version: fence.version,
      now: new Date(now.getTime() + 62_000),
      position: BAD_FIX,
      reason_code: 'PARTNER_CONFIRMED',
    });
    check(
      fence.assignment_state === 'ASSIGNED' && fence.arrival_claim?.reason === 'POOR_ACCURACY',
      `A 400 m fix at the store was taken as presence (${JSON.stringify(fence)})`,
    );
    fence = await service.arriveAtVendor({
      command_reference: 'SYNTH-CMD-ARRIVE-FAR-E001',
      context: partnerTwo,
      delivery_assignment_id: fence.delivery_assignment_id,
      expected_version: fence.version,
      now: new Date(now.getTime() + 63_000),
      position: ACROSS_TOWN,
      reason_code: 'PARTNER_CONFIRMED',
    });
    check(
      fence.assignment_state === 'ASSIGNED' &&
        fence.arrival_claim?.reason === 'OUT_OF_RANGE' &&
        fence.arrival_distance_metres !== null &&
        fence.arrival_distance_metres > 2_000,
      `A fix across town was taken as presence (${JSON.stringify(fence)})`,
    );
    fence = await service.arriveAtVendor({
      command_reference: 'SYNTH-CMD-ARRIVE-ROAD-E001',
      context: partnerTwo,
      delivery_assignment_id: fence.delivery_assignment_id,
      expected_version: fence.version,
      now: new Date(now.getTime() + 64_000),
      position: DOWN_THE_ROAD,
      reason_code: 'PARTNER_CONFIRMED',
    });
    check(
      fence.assignment_state === 'ASSIGNED' &&
        fence.arrival_claim?.reason === 'OUT_OF_RANGE' &&
        fence.arrival_distance_metres !== null &&
        fence.arrival_distance_metres > 250 &&
        fence.arrival_distance_metres < 350,
      `A fix 300 m away was trusted under the default radius (${JSON.stringify(fence)})`,
    );
    const fenceProposer = createUuidV7();
    const fenceApprover = createUuidV7();
    for (const actorId of [fenceProposer, fenceApprover]) {
      await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1)', [actorId]);
    }
    const fenceDraft = await createConfigurationDraft(pool, {
      actor_id: fenceProposer,
      configuration_key: 'assignment.arrival_radius_metres',
      configuration_kind: 'SETTING',
      configuration_value: 400,
      correlation_id: createUuidV7(),
      request_id: createRequestId(),
      scope: { kind: 'GLOBAL', reference: 'global' },
    });
    await validateConfigurationVersion(pool, {
      actor_id: fenceProposer,
      configuration_version_id: fenceDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await approveConfigurationVersion(pool, {
      actor_id: fenceApprover,
      configuration_version_id: fenceDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await scheduleConfigurationVersion(pool, {
      actor_id: fenceApprover,
      configuration_version_id: fenceDraft.configuration_version_id,
      effective_from: new Date(now.getTime() + 64_500),
      request_id: createRequestId(),
    });
    await activateConfigurationVersion(pool, {
      actor_id: fenceApprover,
      at: new Date(now.getTime() + 64_500),
      configuration_version_id: fenceDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    fence = await service.arriveAtVendor({
      command_reference: 'SYNTH-CMD-ARRIVE-ROAD-WIDER-E001',
      context: partnerTwo,
      delivery_assignment_id: fence.delivery_assignment_id,
      expected_version: fence.version,
      now: new Date(now.getTime() + 65_000),
      position: DOWN_THE_ROAD,
      reason_code: 'PARTNER_CONFIRMED',
    });
    check(
      fence.assignment_state === 'AT_VENDOR' &&
        fence.arrival_kind === 'TRUSTED_LOCATION' &&
        fence.arrival_claim === null,
      `The configured arrival radius was not applied (${JSON.stringify(fence)})`,
    );
    // 9.5 -- leaving the store under the policy. Before the leave threshold
    // the partner stays; at it they may go: the wait closes with its pay on
    // record, the attempt returns to the pool, and the partner who left is
    // not offered it again. The next partner's wait is their own.
    let earlyLeaveRefused = false;
    try {
      await service.leaveStoreAfterWait({
        command_reference: 'SYNTH-CMD-LEAVE-EARLY-E001',
        context: partnerTwo,
        delivery_assignment_id: fence.delivery_assignment_id,
        expected_version: fence.version,
        now: new Date(now.getTime() + 65_000 + 9 * 60_000),
        reason_code: 'PARTNER_LEFT_AFTER_WAIT',
      });
    } catch (error) {
      earlyLeaveRefused = error instanceof AssignmentConflictError;
    }
    check(earlyLeaveRefused, 'A partner left the store before the leave threshold');
    const leaveInput = {
      command_reference: 'SYNTH-CMD-LEAVE-E001',
      context: partnerTwo,
      delivery_assignment_id: fence.delivery_assignment_id,
      expected_version: fence.version,
      now: new Date(now.getTime() + 65_000 + 11 * 60_000),
      reason_code: 'PARTNER_LEFT_AFTER_WAIT',
    } as const;
    const left = await service.leaveStoreAfterWait(leaveInput);
    const leftAgain = await service.leaveStoreAfterWait({
      ...leaveInput,
      now: new Date(now.getTime() + 65_000 + 12 * 60_000),
    });
    const leftTrail = await pool.query<{
      wait_state: string;
      amount_minor: string | null;
      eligible_wait_seconds: number | null;
      memberships: string;
      event_partner: string | null;
    }>(
      `SELECT timer.wait_state, owed.amount_minor::text, owed.eligible_wait_seconds,
              (SELECT count(*) FROM marketplace.partner_assignment_memberships
                WHERE delivery_assignment_id=$1 AND state='ACTIVE')::text AS memberships,
              (SELECT partner_user_id FROM marketplace.assignment_events
                WHERE delivery_assignment_id=$1 AND event_type='LEFT_AFTER_WAIT') AS event_partner
         FROM marketplace.partner_wait_timers timer
         LEFT JOIN marketplace.partner_wait_earning_adjustments owed USING (partner_wait_timer_id)
        WHERE timer.delivery_assignment_id=$1 AND timer.partner_user_id=$2`,
      [fence.delivery_assignment_id, partnerTwoId],
    );
    check(
      left.assignment_state === 'UNASSIGNED' &&
        left.partner_user_id === null &&
        left.arrival_kind === null &&
        leftAgain.version === left.version &&
        leftTrail.rows[0]?.wait_state === 'LEFT_POLICY' &&
        leftTrail.rows[0].eligible_wait_seconds === 660 &&
        leftTrail.rows[0].amount_minor === '600' &&
        leftTrail.rows[0].memberships === '0' &&
        leftTrail.rows[0].event_partner === partnerTwoId,
      `Leaving under the policy did not return the attempt with the wait paid on record (${JSON.stringify({ left, trail: leftTrail.rows[0] })})`,
    );
    const afterLeave = await service.offerHistory({
      delivery_assignment_id: fence.delivery_assignment_id,
    });
    check(
      afterLeave.declined.includes(partnerTwoId),
      'A partner who left under the policy could be offered the same attempt again',
    );
    // Operations lengthen the leave threshold; the next wait opens under it,
    // and it is the next partner's own row on the same attempt.
    const leaveProposer = createUuidV7();
    const leaveApprover = createUuidV7();
    for (const actorId of [leaveProposer, leaveApprover]) {
      await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1)', [actorId]);
    }
    const leaveDraft = await createConfigurationDraft(pool, {
      actor_id: leaveProposer,
      configuration_key: 'assignment.wait_leave_seconds',
      configuration_kind: 'SETTING',
      configuration_value: 900,
      correlation_id: createUuidV7(),
      request_id: createRequestId(),
      scope: { kind: 'GLOBAL', reference: 'global' },
    });
    await validateConfigurationVersion(pool, {
      actor_id: leaveProposer,
      configuration_version_id: leaveDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await approveConfigurationVersion(pool, {
      actor_id: leaveApprover,
      configuration_version_id: leaveDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await scheduleConfigurationVersion(pool, {
      actor_id: leaveApprover,
      configuration_version_id: leaveDraft.configuration_version_id,
      effective_from: new Date(now.getTime() + 65_000 + 13 * 60_000),
      request_id: createRequestId(),
    });
    await activateConfigurationVersion(pool, {
      actor_id: leaveApprover,
      at: new Date(now.getTime() + 65_000 + 13 * 60_000),
      configuration_version_id: leaveDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    const secondOffer = await service.offer({
      command_reference: 'SYNTH-CMD-OFFER-FENCE-E002',
      context: admin,
      delivery_assignment_id: fence.delivery_assignment_id,
      expected_version: left.version,
      expires_at: new Date(now.getTime() + 65_000 + 15 * 60_000),
      now: new Date(now.getTime() + 65_000 + 14 * 60_000),
      partner_user_id: partnerOneId,
      reason_code: 'SYNTH_OFFER_CREATED',
    });
    fence = await service.accept({
      command_reference: 'SYNTH-CMD-ACCEPT-FENCE-E002',
      context: partnerOne,
      delivery_assignment_id: fence.delivery_assignment_id,
      expected_version: secondOffer.version,
      now: new Date(now.getTime() + 65_000 + 14 * 60_000 + 1_000),
      reason_code: 'PARTNER_ACCEPTED',
    });
    fence = await service.arriveAtVendor({
      command_reference: 'SYNTH-CMD-ARRIVE-FENCE-E002',
      context: partnerOne,
      delivery_assignment_id: fence.delivery_assignment_id,
      expected_version: fence.version,
      now: new Date(now.getTime() + 65_000 + 14 * 60_000 + 2_000),
      position: AT_THE_COUNTER,
      reason_code: 'PARTNER_CONFIRMED',
    });
    const secondWait = await pool.query<{ leave_threshold_seconds: number; count: string }>(
      `SELECT leave_threshold_seconds,
              (SELECT count(*) FROM marketplace.partner_wait_timers
                WHERE delivery_assignment_id=$1)::text AS count
         FROM marketplace.partner_wait_timers
        WHERE delivery_assignment_id=$1 AND partner_user_id=$2`,
      [fence.delivery_assignment_id, partnerOneId],
    );
    check(
      fence.assignment_state === 'AT_VENDOR' &&
        secondWait.rows[0]?.leave_threshold_seconds === 900 &&
        secondWait.rows[0].count === '2',
      `The next partner's wait was not their own, under the configured leave threshold (${JSON.stringify(secondWait.rows[0])})`,
    );

    // Leave nothing active: the operator takes the attempt back.
    await service.reassign({
      command_reference: 'SYNTH-CMD-REASSIGN-FENCE-E001',
      compensation_minor: 0,
      context: admin,
      delivery_assignment_id: fence.delivery_assignment_id,
      expected_version: fence.version,
      now: new Date(now.getTime() + 65_000 + 15 * 60_000),
      reason_code: 'OPERATOR_REASSIGNED',
    });

    // 9.7 -- a completion held offline. The customer read their code at a door
    // with no signal; the device held the completion; signal came back after
    // the code had lapsed. The held completion is accepted when the code was
    // current at capture and signal returned within the grace, consuming the
    // proof the device registered on reconnect -- once, whatever the retries.
    const heldSeed = await service.create({
      approximate_drop_area: 'SYNTH Jhotwara Jaipur',
      approximate_pickup_area: 'SYNTH Jain Stores Jaipur',
      command_reference: 'SYNTH-CMD-CREATE-HELD-G001',
      context: admin,
      handling_flags: [],
      now: new Date(now.getTime() + 90_000),
      package_count: 1,
      reason_code: 'SYNTH_ASSIGNMENT_CREATED',
      source_order_reference: 'SYNTH-ORDER-HELD-G001',
      vendor_location_id: locationId,
    });
    const heldOffer = await service.offer({
      command_reference: 'SYNTH-CMD-OFFER-HELD-G001',
      context: admin,
      delivery_assignment_id: heldSeed.delivery_assignment_id,
      expected_version: heldSeed.version,
      expires_at: new Date(now.getTime() + 120_000),
      now: new Date(now.getTime() + 90_000),
      partner_user_id: partnerTwoId,
      reason_code: 'SYNTH_OFFER_CREATED',
    });
    let heldJob = await service.accept({
      command_reference: 'SYNTH-CMD-ACCEPT-HELD-G001',
      context: partnerTwo,
      delivery_assignment_id: heldSeed.delivery_assignment_id,
      expected_version: heldOffer.version,
      now: new Date(now.getTime() + 91_000),
      reason_code: 'PARTNER_ACCEPTED',
    });
    heldJob = await service.arriveAtVendor({
      command_reference: 'SYNTH-CMD-ARRIVE-HELD-G001',
      context: partnerTwo,
      delivery_assignment_id: heldJob.delivery_assignment_id,
      expected_version: heldJob.version,
      now: new Date(now.getTime() + 92_000),
      position: AT_THE_COUNTER,
      reason_code: 'PARTNER_CONFIRMED',
    });
    heldJob = await service.confirmPickup({
      command_reference: 'SYNTH-CMD-PICKUP-HELD-G001',
      context: partnerTwo,
      delivery_assignment_id: heldJob.delivery_assignment_id,
      expected_version: heldJob.version,
      now: new Date(now.getTime() + 93_000),
      package_count: 1,
      proof_reference: 'SYNTH-PROOF-PICKUP-HELD-G001',
      reason_code: 'PICKUP_VERIFIED',
      vendor_confirmed: true,
    });
    heldJob = await service.beginRoute({
      command_reference: 'SYNTH-CMD-ROUTE-HELD-G001',
      context: partnerTwo,
      delivery_assignment_id: heldJob.delivery_assignment_id,
      expected_version: heldJob.version,
      now: new Date(now.getTime() + 94_000),
      reason_code: 'ROUTE_STARTED',
    });
    heldJob = await service.arriveAtCustomer({
      command_reference: 'SYNTH-CMD-ARRIVE-CUSTOMER-HELD-G001',
      context: partnerTwo,
      delivery_assignment_id: heldJob.delivery_assignment_id,
      expected_version: heldJob.version,
      now: new Date(now.getTime() + 95_000),
      reason_code: 'CUSTOMER_LOCATION_ARRIVAL',
    });
    // The code lapses at +995 s; the device captured the completion at
    // +100 s and signal returned at +2000 s.
    const heldOtp = '737373';
    const heldExpiresAt = new Date(now.getTime() + 995_000);
    const capturedAt = new Date(now.getTime() + 100_000);
    const signalBack = new Date(now.getTime() + 2_000_000);
    await pool.query(
      `UPDATE marketplace.delivery_assignments
          SET delivery_otp_hash = $2, delivery_otp_expires_at = $3, delivery_otp_attempts = 0
        WHERE delivery_assignment_id = $1`,
      [heldJob.delivery_assignment_id, handoverCodeDigest(HASH_KEY, heldOtp), heldExpiresAt],
    );
    const refusedAs = async (input: Parameters<typeof service.deliver>[0]) =>
      service
        .deliver(input)
        .then(() => 'accepted')
        .catch((error: unknown) =>
          error instanceof DeliveryOtpExpiredError
            ? 'expired'
            : error instanceof AssignmentConflictError
              ? 'conflict'
              : `other:${String(error)}`,
        );
    const heldBase = {
      context: partnerTwo,
      delivery_assignment_id: heldJob.delivery_assignment_id,
      expected_version: heldJob.version,
      otp: heldOtp,
      proof_reference: 'SYNTH-PROOF-DELIVERY-HELD-G001',
      reason_code: 'DELIVERY_PROOF_VERIFIED',
    } as const;
    // Live, after expiry: refused, as before.
    check(
      (await refusedAs({
        ...heldBase,
        command_reference: 'SYNTH-CMD-DELIVER-LATE-LIVE-G001',
        now: signalBack,
      })) === 'expired',
      'A lapsed code entered live was accepted',
    );
    // Held, but captured after the code had lapsed: refused.
    check(
      (await refusedAs({
        ...heldBase,
        command_reference: 'SYNTH-CMD-DELIVER-HELD-LATE-G001',
        held_since: new Date(now.getTime() + 1_000_000),
        now: signalBack,
      })) === 'expired',
      'A completion captured after the code lapsed was accepted',
    );
    // Held in time, but signal back after the grace: refused.
    check(
      (await refusedAs({
        ...heldBase,
        command_reference: 'SYNTH-CMD-DELIVER-HELD-STALE-G001',
        held_since: capturedAt,
        now: new Date(capturedAt.getTime() + 25 * 60 * 60_000),
      })) === 'expired',
      'A held completion beyond the grace window was accepted',
    );
    // The proof the device registered on reconnect; another attempt's cannot
    // be consumed by this completion.
    const registered = await fieldOps.saveOfflineProof({
      context: partnerTwo,
      delivery_assignment_id: heldJob.delivery_assignment_id,
      proof_kind: 'DELIVERY',
      encrypted_payload_digest: 'a'.repeat(64),
      encryption_key_reference: 'SYNTH-PARTNER-KEY-HELD-G001',
      captured_at: capturedAt,
      reason_code: 'PARTNER_OFFLINE_CAPTURE',
      now: signalBack,
    });
    const strayProof = await fieldOps.saveOfflineProof({
      context: partnerOne,
      delivery_assignment_id: first.delivery_assignment_id,
      proof_kind: 'DELIVERY',
      encrypted_payload_digest: 'b'.repeat(64),
      encryption_key_reference: 'SYNTH-PARTNER-KEY-STRAY-G001',
      captured_at: capturedAt,
      reason_code: 'PARTNER_OFFLINE_CAPTURE',
      now: signalBack,
    });
    check(
      (await refusedAs({
        ...heldBase,
        command_reference: 'SYNTH-CMD-DELIVER-HELD-STRAY-G001',
        held_since: capturedAt,
        now: signalBack,
        offline_proof_id: strayProof.partner_offline_proof_id,
      })) === 'conflict',
      'A held completion consumed another attempt’s proof',
    );
    const heldInput = {
      ...heldBase,
      command_reference: 'SYNTH-CMD-DELIVER-HELD-G001',
      held_since: capturedAt,
      now: signalBack,
      offline_proof_id: registered.partner_offline_proof_id,
    } as const;
    const heldDelivered = await service.deliver(heldInput);
    const heldReplayed = await service.deliver({
      ...heldInput,
      now: new Date(signalBack.getTime() + 5_000),
    });
    const heldTrail = await pool.query<{
      reason_code: string;
      sync_state: string;
      consumed_by: string | null;
      delivered_events: string;
    }>(
      `SELECT (SELECT reason_code FROM marketplace.assignment_events
                WHERE delivery_assignment_id=$1 AND event_type='DELIVERED') AS reason_code,
              proof.sync_state, proof.consumed_by_command_reference AS consumed_by,
              (SELECT count(*) FROM marketplace.assignment_events
                WHERE delivery_assignment_id=$1 AND event_type='DELIVERED')::text AS delivered_events
         FROM marketplace.partner_offline_proofs proof
        WHERE proof.partner_offline_proof_id=$2`,
      [heldJob.delivery_assignment_id, registered.partner_offline_proof_id],
    );
    check(
      heldDelivered.assignment_state === 'DELIVERED' &&
        heldReplayed.version === heldDelivered.version &&
        heldTrail.rows[0]?.reason_code === 'DELIVERY_PROOF_HELD_OFFLINE' &&
        heldTrail.rows[0].sync_state === 'SYNCED' &&
        heldTrail.rows[0].consumed_by === 'SYNTH-CMD-DELIVER-HELD-G001' &&
        heldTrail.rows[0].delivered_events === '1',
      `A held completion did not complete the delivery exactly once with its proof consumed (${JSON.stringify(heldTrail.rows[0])})`,
    );
    // Operations shorten the grace to an hour: the setting resolves at its instant.
    const graceProposer = createUuidV7();
    const graceApprover = createUuidV7();
    for (const actorId of [graceProposer, graceApprover]) {
      await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1)', [actorId]);
    }
    const graceDraft = await createConfigurationDraft(pool, {
      actor_id: graceProposer,
      configuration_key: 'assignment.offline_proof_grace_seconds',
      configuration_kind: 'SETTING',
      configuration_value: 3_600,
      correlation_id: createUuidV7(),
      request_id: createRequestId(),
      scope: { kind: 'GLOBAL', reference: 'global' },
    });
    await validateConfigurationVersion(pool, {
      actor_id: graceProposer,
      configuration_version_id: graceDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await approveConfigurationVersion(pool, {
      actor_id: graceApprover,
      configuration_version_id: graceDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    await scheduleConfigurationVersion(pool, {
      actor_id: graceApprover,
      configuration_version_id: graceDraft.configuration_version_id,
      effective_from: new Date(signalBack.getTime() + 10_000),
      request_id: createRequestId(),
    });
    await activateConfigurationVersion(pool, {
      actor_id: graceApprover,
      at: new Date(signalBack.getTime() + 10_000),
      configuration_version_id: graceDraft.configuration_version_id,
      request_id: createRequestId(),
    });
    check(
      (await service.offlineProofGraceSeconds(new Date(signalBack.getTime() + 20_000))) === 3_600 &&
        (await service.offlineProofGraceSeconds(capturedAt)) === 86_400,
      'The configured offline-proof grace was not applied',
    );
    // The stray proof is left expired, as the worker would leave it, so the
    // partner's pending count is clear for the modules that follow.
    await pool.query(
      `UPDATE marketplace.partner_offline_proofs SET sync_state='EXPIRED', updated_at=$2
        WHERE partner_offline_proof_id=$1`,
      [strayProof.partner_offline_proof_id, new Date(signalBack.getTime() + 20_000)],
    );

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
    await waits.close();
    await fieldOps.close();
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
      .query('DELETE FROM marketplace.staff_memberships WHERE user_id=ANY($1)', [
        [counterStaffId, otherStoreStaffId],
      ])
      .catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.role_assignments WHERE user_id=ANY($1)', [
        [counterStaffId, otherStoreStaffId],
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
        [adminId, partnerOneId, partnerTwoId, counterStaffId, otherStoreStaffId],
      ])
      .catch(() => undefined);
    await pool.end();
  }
}
