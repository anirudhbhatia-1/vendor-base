import { createHash } from 'node:crypto';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  FieldOpsAuthorizationError,
  FieldOpsConflictError,
  FieldOpsInputError,
  FieldOpsNotFoundError,
  PartnerFieldOpsService,
} from '../src/partner-field-ops.js';
import {
  PartnerLifecycleAuthorizationError,
  PartnerLifecycleConflictError,
  PartnerLifecycleNotFoundError,
  PartnerLifecycleService,
} from '../src/partner-lifecycle.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function partnerContext(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'delivery_partner',
      session_id: createUuidV7(),
    }),
  });
}
function adminContext(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'admin',
      session_id: createUuidV7(),
    }),
  });
}
function systemContext(userId: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: 'system',
      session_id: createUuidV7(),
    }),
  });
}
async function rejects(work: () => Promise<unknown>, kind: new () => Error, message: string) {
  try {
    await work();
  } catch (error) {
    check(error instanceof kind, `${message} (raised ${String(error)})`);
    return;
  }
  throw new Error(message);
}

export async function verifyPartnerLifecycle(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const lifecycle = new PartnerLifecycleService({ connection_string: connectionString });
  const fieldOps = new PartnerFieldOpsService({ connection_string: connectionString });
  const now = new Date();
  const applicantId = createUuidV7();
  const otherPartnerId = createUuidV7();
  const adminId = createUuidV7();
  const systemActorId = createUuidV7();
  try {
    for (const id of [applicantId, otherPartnerId, adminId, systemActorId]) {
      await pool.query(
        "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
        [id],
      );
    }

    // 9.1 -- create application, submit, admin reviews, approves.
    const created = await lifecycle.createApplication({
      context: partnerContext(applicantId),
      identity_reference: 'SYNTH-PARTNER-IDENTITY-P001',
      vehicle_reference: 'SYNTH-PARTNER-VEHICLE-V001',
      vehicle_kind: 'MOTORCYCLE',
      bank_account_reference: 'SYNTH-PARTNER-BANK-B001',
      insurance_reference: 'SYNTH-PARTNER-INSURANCE-I001',
      emergency_contact_reference: 'SYNTH-PARTNER-EMERGENCY-E001',
      training_reference: 'SYNTH-PARTNER-TRAINING-T001',
      home_zone_name: 'SYNTH Jaipur Central',
      now,
    });
    check(created.lifecycle_state === 'DRAFT', 'New application not DRAFT');
    check(created.version === 1, 'New application version not 1');

    // Cannot create a second application for the same partner
    await rejects(
      () =>
        lifecycle.createApplication({
          context: partnerContext(applicantId),
          identity_reference: 'SYNTH-PARTNER-IDENTITY-P002',
          vehicle_reference: 'SYNTH-PARTNER-VEHICLE-V002',
          vehicle_kind: 'BICYCLE',
          bank_account_reference: 'SYNTH-PARTNER-BANK-B002',
          insurance_reference: 'SYNTH-PARTNER-INSURANCE-I002',
          emergency_contact_reference: 'SYNTH-PARTNER-EMERGENCY-E002',
          training_reference: 'SYNTH-PARTNER-TRAINING-T002',
          home_zone_name: 'SYNTH Jaipur East',
        }),
      PartnerLifecycleConflictError,
      'Duplicate partner application was allowed',
    );

    // Cannot start review before submission
    await rejects(
      () =>
        lifecycle.startReview({
          context: adminContext(adminId),
          partner_application_id: created.partner_application_id,
          expected_version: created.version,
        }),
      PartnerLifecycleConflictError,
      'startReview allowed from DRAFT',
    );

    const submitted = await lifecycle.submitApplication({
      context: partnerContext(applicantId),
      partner_application_id: created.partner_application_id,
      expected_version: created.version,
    });
    check(submitted.lifecycle_state === 'SUBMITTED', 'submit did not advance state');
    check(submitted.submitted_at !== null, 'submitted_at not recorded');

    // Cross-partner cannot read another's application
    await rejects(
      () =>
        lifecycle.getApplication({
          context: partnerContext(otherPartnerId),
          partner_application_id: created.partner_application_id,
        }),
      PartnerLifecycleNotFoundError,
      'Another partner read a foreign application',
    );

    const inReview = await lifecycle.startReview({
      context: adminContext(adminId),
      partner_application_id: created.partner_application_id,
      expected_version: submitted.version,
    });
    check(inReview.lifecycle_state === 'UNDER_REVIEW', 'startReview did not transition');
    check(inReview.reviewer_user_id === adminId, 'reviewer not recorded');

    // request changes then re-submit
    const changesRequested = await lifecycle.requestChanges({
      context: adminContext(adminId),
      partner_application_id: created.partner_application_id,
      expected_version: inReview.version,
      reason_code: 'MISSING_INSURANCE',
    });
    check(changesRequested.lifecycle_state === 'CHANGES_REQUIRED', 'changes not requested');
    const resubmitted = await lifecycle.submitApplication({
      context: partnerContext(applicantId),
      partner_application_id: created.partner_application_id,
      expected_version: changesRequested.version,
    });
    const rereview = await lifecycle.startReview({
      context: adminContext(adminId),
      partner_application_id: created.partner_application_id,
      expected_version: resubmitted.version,
    });
    const approved = await lifecycle.approve({
      context: adminContext(adminId),
      partner_application_id: created.partner_application_id,
      expected_version: rereview.version,
      reason_code: 'APPLICATION_COMPLETE',
    });
    check(approved.lifecycle_state === 'APPROVED', 'approve did not transition');
    check(approved.decided_at !== null, 'decided_at not set');

    // Cannot approve an already-decided application (version guard)
    await rejects(
      () =>
        lifecycle.approve({
          context: adminContext(adminId),
          partner_application_id: created.partner_application_id,
          expected_version: rereview.version,
          reason_code: 'APPLICATION_COMPLETE',
        }),
      PartnerLifecycleConflictError,
      'stale approval accepted',
    );

    // Non-admin cannot review
    await rejects(
      () =>
        lifecycle.reject({
          context: partnerContext(applicantId),
          partner_application_id: created.partner_application_id,
          expected_version: approved.version,
          reason_code: 'PARTNER_TRIED_REJECT',
        }),
      PartnerLifecycleAuthorizationError,
      'Partner rejected own application',
    );

    // Application event trail: expect CREATED, SUBMITTED, REVIEW_STARTED,
    // CHANGES_REQUESTED, SUBMITTED, REVIEW_STARTED, APPROVED.
    const events = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM marketplace.partner_application_events
        WHERE partner_application_id=$1`,
      [created.partner_application_id],
    );
    check(events.rows[0]?.count === '7', 'application event trail incomplete');

    // 9.7 -- offline proof. Create a delivery_assignment fixture directly:
    // the assignment aggregate is exercised by verify-assignment-custody.
    const vendorId = createUuidV7();
    const vendorLocationId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.vendors (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id)
       VALUES ($1,'SYNTH Partner Vendor','Synthetic partner test vendor','ACTIVE',$2,$2)`,
      [vendorId, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH Partner Store','Synthetic partner test location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,'FRUIT_VEGETABLE','ACTIVE',$3,$3)`,
      [vendorLocationId, vendorId, createUuidV7()],
    );
    const deliveryAssignmentId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id, source_order_reference, vendor_location_id, partner_user_id,
         assignment_state, custody_state, package_count, approximate_pickup_area,
         approximate_drop_area, request_id, correlation_id)
       VALUES ($1,$2,$3,$4,'PICKED_UP','IN_CUSTODY',2,
         'SYNTH Pickup Area','SYNTH Drop Area',$5,$5)`,
      [
        deliveryAssignmentId,
        `SYNTH-ORDER-${Date.now()}`,
        vendorLocationId,
        applicantId,
        createUuidV7(),
      ],
    );

    const proofDigest = createHash('sha256').update('SYNTH-PROOF-1').digest('hex');
    const proof = await fieldOps.saveOfflineProof({
      context: partnerContext(applicantId),
      delivery_assignment_id: deliveryAssignmentId,
      proof_kind: 'PICKUP',
      encrypted_payload_digest: proofDigest,
      encryption_key_reference: 'SYNTH-PARTNER-KEY-K001',
      captured_at: now,
      reason_code: 'OFFLINE_CAPTURE',
      now,
    });
    check(proof.sync_state === 'PENDING', 'proof not saved as PENDING');

    // Cannot save a second PENDING proof for the same partner
    await rejects(
      () =>
        fieldOps.saveOfflineProof({
          context: partnerContext(applicantId),
          delivery_assignment_id: deliveryAssignmentId,
          proof_kind: 'DELIVERY',
          encrypted_payload_digest: createHash('sha256').update('SYNTH-PROOF-2').digest('hex'),
          encryption_key_reference: 'SYNTH-PARTNER-KEY-K002',
          captured_at: now,
          reason_code: 'OFFLINE_CAPTURE',
          now,
        }),
      FieldOpsConflictError,
      'Second PENDING proof allowed',
    );

    // Digest mismatch rejects the sync
    await rejects(
      () =>
        fieldOps.syncOfflineProof({
          context: partnerContext(applicantId),
          partner_offline_proof_id: proof.partner_offline_proof_id,
          encrypted_payload_digest: createHash('sha256').update('WRONG').digest('hex'),
        }),
      FieldOpsConflictError,
      'wrong digest sync accepted',
    );

    const synced = await fieldOps.syncOfflineProof({
      context: partnerContext(applicantId),
      partner_offline_proof_id: proof.partner_offline_proof_id,
      encrypted_payload_digest: proofDigest,
      now: new Date(now.getTime() + 1_000),
    });
    check(synced.sync_state === 'SYNCED', 'sync did not transition');
    check(synced.synced_at !== null, 'synced_at not recorded');

    // Idempotent: replaying sync on already-synced proof returns the row
    const replay = await fieldOps.syncOfflineProof({
      context: partnerContext(applicantId),
      partner_offline_proof_id: proof.partner_offline_proof_id,
      encrypted_payload_digest: proofDigest,
      now: new Date(now.getTime() + 2_000),
    });
    check(replay.sync_state === 'SYNCED', 'sync replay changed state');

    // Now a second PENDING proof can be saved (previous is SYNCED)
    await fieldOps.saveOfflineProof({
      context: partnerContext(applicantId),
      delivery_assignment_id: deliveryAssignmentId,
      proof_kind: 'DELIVERY',
      encrypted_payload_digest: createHash('sha256').update('SYNTH-PROOF-3').digest('hex'),
      encryption_key_reference: 'SYNTH-PARTNER-KEY-K003',
      captured_at: now,
      reason_code: 'OFFLINE_CAPTURE',
      now,
    });

    // 9.7 -- expiry sweeper
    const expiredIds = await fieldOps.expireOfflineProofs({
      context: systemContext(systemActorId),
      older_than: new Date(now.getTime() + 60 * 60_000),
      now: new Date(now.getTime() + 60 * 60_000),
    });
    check(expiredIds.length >= 1, 'expiry sweeper did not expire any proof');

    // Non-partner cannot save proof
    await rejects(
      () =>
        fieldOps.saveOfflineProof({
          context: adminContext(adminId),
          delivery_assignment_id: deliveryAssignmentId,
          proof_kind: 'PICKUP',
          encrypted_payload_digest: proofDigest,
          encryption_key_reference: 'SYNTH-PARTNER-KEY-K099',
          captured_at: now,
          reason_code: 'OFFLINE_CAPTURE',
        }),
      FieldOpsAuthorizationError,
      'admin saved an offline proof as a partner',
    );

    // 9.8 -- guided exceptions
    const openException = await fieldOps.raiseException({
      context: partnerContext(applicantId),
      delivery_assignment_id: deliveryAssignmentId,
      exception_kind: 'UNREACHABLE_CUSTOMER',
      reason_code: 'CUSTOMER_NOT_RESPONDING',
      now,
    });
    check(openException.resolution_state === 'OPEN', 'exception not OPEN');
    // Emergency kinds are recorded with the same shape
    await fieldOps.raiseException({
      context: partnerContext(applicantId),
      delivery_assignment_id: deliveryAssignmentId,
      exception_kind: 'ACCIDENT',
      reason_code: 'ROADSIDE_INCIDENT',
      now,
    });
    // Resolve the open UNREACHABLE_CUSTOMER exception
    const resolvedException = await fieldOps.resolveException({
      context: partnerContext(applicantId),
      delivery_assignment_id: deliveryAssignmentId,
      exception_kind: 'UNREACHABLE_CUSTOMER',
      resolution_state: 'RETURN_TO_VENDOR',
      reason_code: 'CUSTOMER_UNREACHABLE_AFTER_ATTEMPTS',
    });
    check(resolvedException.resolution_state === 'RETURN_TO_VENDOR', 'resolution not recorded');

    // Resolving with no matching OPEN raises NotFound
    await rejects(
      () =>
        fieldOps.resolveException({
          context: partnerContext(applicantId),
          delivery_assignment_id: deliveryAssignmentId,
          exception_kind: 'PROHIBITED_GOODS',
          resolution_state: 'CANCEL',
          reason_code: 'NEVER_OPENED',
        }),
      FieldOpsNotFoundError,
      'resolve without open exception accepted',
    );

    // Rejects invalid resolution state input
    await rejects(
      () =>
        fieldOps.resolveException({
          context: partnerContext(applicantId),
          delivery_assignment_id: deliveryAssignmentId,
          exception_kind: 'UNREACHABLE_CUSTOMER',
          resolution_state: 'BOGUS' as unknown as 'RETRY',
          reason_code: 'BAD_INPUT',
        }),
      FieldOpsInputError,
      'invalid resolution state accepted',
    );

    // Immutable history
    let immutable = false;
    try {
      await pool.query(
        `UPDATE marketplace.partner_exception_events SET evidence_note='tampered' WHERE partner_exception_event_id=$1`,
        [openException.partner_exception_event_id],
      );
    } catch (error) {
      immutable =
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === '55000';
    }
    check(immutable, 'exception history mutable');

    // 9.10 -- earnings + disputes
    const earnings = await lifecycle.recordEarnings({
      context: systemContext(systemActorId),
      delivery_assignment_id: deliveryAssignmentId,
      partner_user_id: applicantId,
      outcome: 'DELIVERED',
      base_minor: 4000,
      distance_minor: 1500,
      time_minor: 500,
      wait_minor: 200,
      incentive_minor: 300,
      tip_minor: 250,
    });
    check(earnings.net_minor === 4000 + 1500 + 500 + 200 + 300 + 250, 'net_minor mismatch');
    check(earnings.outcome === 'DELIVERED', 'outcome not persisted');

    // Cannot record earnings for the same assignment twice
    await rejects(
      () =>
        lifecycle.recordEarnings({
          context: systemContext(systemActorId),
          delivery_assignment_id: deliveryAssignmentId,
          partner_user_id: applicantId,
          outcome: 'DELIVERED',
          base_minor: 100,
        }),
      PartnerLifecycleConflictError,
      'duplicate earnings recorded',
    );

    // Partner opens a dispute on DISTANCE
    const dispute = await lifecycle.openDispute({
      context: partnerContext(applicantId),
      partner_earnings_record_id: earnings.partner_earnings_record_id,
      disputed_component: 'DISTANCE',
      proposed_amount_minor: 2500,
      evidence_note: 'SYNTH -- odometer reads 6.3km, not 4.2km.',
    });
    check(dispute.lifecycle_state === 'OPEN', 'dispute not OPEN');
    check(dispute.disputed_amount_minor === 1500, 'disputed_amount_minor not sourced from record');

    // Cannot open a second open dispute on same component
    await rejects(
      () =>
        lifecycle.openDispute({
          context: partnerContext(applicantId),
          partner_earnings_record_id: earnings.partner_earnings_record_id,
          disputed_component: 'DISTANCE',
          proposed_amount_minor: 2000,
          evidence_note: 'Duplicate dispute.',
        }),
      PartnerLifecycleConflictError,
      'duplicate open dispute accepted',
    );

    // Another partner cannot open a dispute on someone else's record
    await rejects(
      () =>
        lifecycle.openDispute({
          context: partnerContext(otherPartnerId),
          partner_earnings_record_id: earnings.partner_earnings_record_id,
          disputed_component: 'BASE',
          proposed_amount_minor: 5000,
          evidence_note: 'Foreign attempt.',
        }),
      PartnerLifecycleNotFoundError,
      'foreign partner opened a dispute',
    );

    // Admin resolves with a specific amount
    const resolved = await lifecycle.resolveDispute({
      context: adminContext(adminId),
      partner_dispute_case_id: dispute.partner_dispute_case_id,
      resolution: 'RESOLVED',
      resolution_reason_code: 'ODOMETER_MATCHES',
      resolved_amount_minor: 2000,
    });
    check(resolved.lifecycle_state === 'RESOLVED', 'dispute not resolved');
    check(resolved.resolved_amount_minor === 2000, 'resolved amount not recorded');

    // A new dispute on a different component now works
    const secondDispute = await lifecycle.openDispute({
      context: partnerContext(applicantId),
      partner_earnings_record_id: earnings.partner_earnings_record_id,
      disputed_component: 'TIP',
      proposed_amount_minor: 500,
      evidence_note: 'SYNTH -- tip should be 500.',
    });
    // Partner can withdraw their own dispute
    const withdrawn = await lifecycle.resolveDispute({
      context: partnerContext(applicantId),
      partner_dispute_case_id: secondDispute.partner_dispute_case_id,
      resolution: 'WITHDRAWN',
    });
    check(withdrawn.lifecycle_state === 'WITHDRAWN', 'withdraw did not succeed');

    // Earnings listing filtered to caller
    const list = await lifecycle.listEarnings({ context: partnerContext(applicantId) });
    check(list.length === 1, 'earnings list wrong length');
    check(list[0]?.partner_user_id === applicantId, 'earnings not scoped to partner');
    const empty = await lifecycle.listEarnings({ context: partnerContext(otherPartnerId) });
    check(empty.length === 0, 'other partner saw earnings');
  } finally {
    await fieldOps.close();
    await lifecycle.close();
    await pool.end();
  }
}
