import { createHash } from 'node:crypto';
import { createUuidV7 } from '@neighbourhood-store/domain-types';
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
  PartnerLifecycleInputError,
  PartnerLifecycleNotFoundError,
  PartnerLifecycleService,
} from '../src/partner-lifecycle.js';
import {
  PartnerAvailabilityConflictError,
  PartnerAvailabilityService,
} from '../src/partner-availability.js';
import { check, rejects, adminContext, partnerContext, systemContext } from './verify-support.js';

export async function verifyPartnerLifecycle(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const lifecycle = new PartnerLifecycleService({ connection_string: connectionString });
  const fieldOps = new PartnerFieldOpsService({ connection_string: connectionString });
  const availability = new PartnerAvailabilityService({ connection_string: connectionString });
  const now = new Date();
  const DAY = 86_400_000;
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
      // The identity document and the vehicle registration run a year; the
      // insurance lapses in a month, which is what the expiry walk below uses.
      identity_expires_at: new Date(now.getTime() + 365 * DAY),
      vehicle_expires_at: new Date(now.getTime() + 400 * DAY),
      insurance_expires_at: new Date(now.getTime() + 30 * DAY),
      now,
    });
    check(created.lifecycle_state === 'DRAFT', 'New application not DRAFT');
    check(created.version === 1, 'New application version not 1');
    check(
      created.identity_expires_at?.getTime() === now.getTime() + 365 * DAY &&
        created.insurance_expires_at?.getTime() === now.getTime() + 30 * DAY,
      'The application did not record when its documents expire',
    );
    // 9.1 -- a document already expired is not a document.
    await rejects(
      () =>
        lifecycle.createApplication({
          context: partnerContext(otherPartnerId),
          identity_reference: 'SYNTH-PARTNER-IDENTITY-P003',
          vehicle_reference: 'SYNTH-PARTNER-VEHICLE-V003',
          vehicle_kind: 'BICYCLE',
          bank_account_reference: 'SYNTH-PARTNER-BANK-B003',
          insurance_reference: 'SYNTH-PARTNER-INSURANCE-I003',
          emergency_contact_reference: 'SYNTH-PARTNER-EMERGENCY-E003',
          training_reference: 'SYNTH-PARTNER-TRAINING-T003',
          home_zone_name: 'SYNTH Jaipur East',
          identity_expires_at: new Date(now.getTime() - DAY),
          vehicle_expires_at: new Date(now.getTime() + 400 * DAY),
          insurance_expires_at: new Date(now.getTime() + 30 * DAY),
          now,
        }),
      PartnerLifecycleInputError,
      'An application was accepted with a document that had already expired',
    );
    // 9.1 -- the exact blockers: nobody without an application, and an
    // applicant whose application is not yet approved, is told so by name.
    const noApplication = await lifecycle.onlineEligibility({
      context: partnerContext(otherPartnerId),
      now,
    });
    const draftBlockers = await lifecycle.onlineEligibility({
      context: partnerContext(applicantId),
      now,
    });
    check(
      !noApplication.can_go_online &&
        noApplication.blockers.some((blocker) => blocker.code === 'NO_APPLICATION') &&
        !draftBlockers.can_go_online &&
        draftBlockers.blockers.some(
          (blocker) => blocker.code === 'APPLICATION_NOT_APPROVED' && blocker.detail === 'DRAFT',
        ),
      `The blockers before approval are not named (${JSON.stringify({ noApplication, draftBlockers })})`,
    );

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
          identity_expires_at: new Date(now.getTime() + 365 * DAY),
          vehicle_expires_at: new Date(now.getTime() + 400 * DAY),
          insurance_expires_at: new Date(now.getTime() + 30 * DAY),
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

    // A submitted application has to be discoverable. Review was reachable only
    // by typing a case id, and nothing in the product shows one to a reviewer,
    // so an application submitted through the app waited on a decision nobody
    // could find.
    const queue = await lifecycle.listApplicationsForAdmin({ context: adminContext(adminId) });
    const queued = queue.find(
      (entry) => entry.partner_application_id === submitted.partner_application_id,
    );
    check(queued !== undefined, 'A submitted partner application was not in the review queue');
    check(queued?.awaiting_review === true, 'A submitted application was not marked for review');
    // A draft belongs to the applicant, not to a reviewer's inbox.
    check(
      queue.every((entry) => entry.lifecycle_state !== 'DRAFT'),
      'Draft applications leaked into the review queue',
    );

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

    // Onboarding -> access loop: approval must grant the applicant the
    // DELIVERY_PARTNER role and mark them ELIGIBLE, so they can go online and
    // receive offers without an out-of-band grant.
    const partnerGrant = await pool.query<{ role_count: string; eligible: string }>(
      `SELECT
         (SELECT count(*)::text FROM marketplace.role_assignments
           WHERE user_id=$1 AND role_key='DELIVERY_PARTNER' AND state='ACTIVE') AS role_count,
         (SELECT count(*)::text FROM marketplace.partner_eligibilities
           WHERE user_id=$1 AND state='ELIGIBLE') AS eligible`,
      [applicantId],
    );
    check(
      partnerGrant.rows[0]?.role_count === '1' && partnerGrant.rows[0]?.eligible === '1',
      'Partner approval did not grant DELIVERY_PARTNER role + ELIGIBLE eligibility',
    );
    // The grant is in the access history, attributed to the approval. It was
    // not: approval inserted the role directly and wrote no ROLE_GRANTED event,
    // so a partner's access record began with nothing.
    const partnerGrantEvent = await pool.query<{ reason_code: string; role_key: string }>(
      `SELECT e.reason_code, ra.role_key
         FROM marketplace.access_membership_events e
         JOIN marketplace.role_assignments ra USING (role_assignment_id)
        WHERE e.user_id=$1 AND e.event_type='ROLE_GRANTED' AND ra.role_key='DELIVERY_PARTNER'`,
      [applicantId],
    );
    check(
      partnerGrantEvent.rows.length === 1 &&
        partnerGrantEvent.rows[0]?.reason_code === 'APPLICATION_COMPLETE',
      'Partner approval left no ROLE_GRANTED event carrying the approval reason',
    );

    // 9.1 -- approved, with every document valid: nothing blocks going
    // online, and the standing says so document by document.
    const clean = await lifecycle.onlineEligibility({
      context: partnerContext(applicantId),
      now: new Date(now.getTime() + 1_000),
    });
    check(
      clean.can_go_online &&
        clean.blockers.length === 0 &&
        clean.documents.length === 3 &&
        clean.documents.every(
          (document) => document.state === 'VALID' || document.state === 'EXPIRING',
        ) &&
        clean.documents.find((document) => document.document_kind === 'INSURANCE')?.state ===
          'EXPIRING' &&
        clean.warnings.some((warning) => warning.detail === 'INSURANCE'),
      `An approved partner with valid documents is blocked, or the month-out insurance is not a warning (${JSON.stringify(clean)})`,
    );

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

    // 9.1 -- expiry and reverification. The insurance lapses a month in;
    // the sweep restricts the partner from new work, going online is refused
    // with the code that sends them to their profile, dispatch stops offering
    // them, and the delivery already in their custody is untouched. A renewal
    // is reviewed; rejected leaves the restriction, approved lifts it. Until
    // audit run 56 nothing expired and nothing was reverified.
    const online = await availability.set({
      context: partnerContext(applicantId),
      state: 'ONLINE',
      latitude: 26.91,
      longitude: 75.81,
      reason_code: 'SHIFT_START',
      now: new Date(now.getTime() + 2_000),
    });
    check(online.availability_state === 'ONLINE', 'An eligible partner could not go online');
    const offeredBefore = await availability.eligible({
      context: adminContext(adminId),
      vendor_location_id: vendorLocationId,
      radius_meters: 2_000,
      now: new Date(now.getTime() + 3_000),
    });
    check(
      offeredBefore.some((candidate) => candidate.partner_user_id === applicantId),
      'An eligible online partner was not offered work',
    );
    const lapsedAt = new Date(now.getTime() + 31 * DAY);
    // Dispatch reads the lapse directly: a partner still ONLINE from before
    // is not offered work at the store even before the sweep has run.
    await availability.set({
      context: partnerContext(applicantId),
      state: 'ONLINE',
      latitude: 26.91,
      longitude: 75.81,
      reason_code: 'SHIFT_START',
      now: new Date(now.getTime() + 30 * DAY - 30_000),
    });
    const offeredLapsed = await availability.eligible({
      context: adminContext(adminId),
      vendor_location_id: vendorLocationId,
      radius_meters: 2_000,
      now: new Date(now.getTime() + 30 * DAY + 1_000),
    });
    check(
      !offeredLapsed.some((candidate) => candidate.partner_user_id === applicantId),
      'A partner with a lapsed document was still offered work',
    );
    const earlySweep = await lifecycle.sweepExpiredDocuments({
      context: systemContext(systemActorId),
      now: new Date(now.getTime() + 29 * DAY),
    });
    check(
      !earlySweep.some((id) => id === applicantId),
      'The sweep restricted a partner whose documents had not lapsed',
    );
    const swept = await lifecycle.sweepExpiredDocuments({
      context: systemContext(systemActorId),
      now: lapsedAt,
    });
    const sweptAgain = await lifecycle.sweepExpiredDocuments({
      context: systemContext(systemActorId),
      now: new Date(lapsedAt.getTime() + 1_000),
    });
    check(
      swept.some((id) => id === applicantId) && !sweptAgain.some((id) => id === applicantId),
      `The sweep did not restrict the partner once, for the lapsed insurance (${swept.length}/${sweptAgain.length})`,
    );
    const restrictedStanding = await pool.query<{
      state: string;
      reason: string;
      note: string | null;
    }>(
      `SELECT e.state, e.reason_code AS reason,
              (SELECT ev.note FROM marketplace.partner_application_events ev
                WHERE ev.partner_application_id=$2 AND ev.event_type='DOCUMENT_EXPIRED'
                ORDER BY ev.occurred_at DESC LIMIT 1) AS note
         FROM marketplace.partner_eligibilities e WHERE e.user_id=$1`,
      [applicantId, created.partner_application_id],
    );
    check(
      restrictedStanding.rows[0]?.state === 'RESTRICTED' &&
        restrictedStanding.rows[0]?.reason === 'DOCUMENT_EXPIRED' &&
        restrictedStanding.rows[0]?.note === 'INSURANCE',
      `The lapsed document did not restrict the partner with its reason on record (${JSON.stringify(restrictedStanding.rows)})`,
    );
    const lapsedBlockers = await lifecycle.onlineEligibility({
      context: partnerContext(applicantId),
      now: lapsedAt,
    });
    check(
      !lapsedBlockers.can_go_online &&
        lapsedBlockers.blockers.some(
          (blocker) => blocker.code === 'DOCUMENT_EXPIRED' && blocker.detail === 'INSURANCE',
        ) &&
        lapsedBlockers.blockers.some(
          (blocker) =>
            blocker.code === 'ELIGIBILITY_RESTRICTED' && blocker.detail === 'DOCUMENT_EXPIRED',
        ),
      `The blockers do not name the lapsed document (${JSON.stringify(lapsedBlockers.blockers)})`,
    );
    let refusedOnline: unknown = null;
    try {
      await availability.set({
        context: partnerContext(applicantId),
        state: 'ONLINE',
        latitude: 26.91,
        longitude: 75.81,
        reason_code: 'SHIFT_START',
        now: lapsedAt,
      });
    } catch (error) {
      refusedOnline = error;
    }
    check(
      refusedOnline instanceof PartnerAvailabilityConflictError &&
        refusedOnline.code === 'PARTNER_NOT_ELIGIBLE',
      `Going online with a lapsed document was not refused as PARTNER_NOT_ELIGIBLE (${String(refusedOnline)})`,
    );
    // The delivery already in their custody is theirs to finish.
    const custody = await pool.query<{ state: string; custody: string; partner: string }>(
      `SELECT assignment_state AS state, custody_state AS custody, partner_user_id AS partner
         FROM marketplace.delivery_assignments WHERE delivery_assignment_id=$1`,
      [deliveryAssignmentId],
    );
    check(
      custody.rows[0]?.state === 'PICKED_UP' &&
        custody.rows[0]?.custody === 'IN_CUSTODY' &&
        custody.rows[0]?.partner === applicantId,
      `The restriction touched a delivery in custody (${JSON.stringify(custody.rows)})`,
    );

    // Renewal: one in review per document; a rejection keeps the
    // restriction; an approval writes the new document and lifts it.
    const renewal = await lifecycle.submitDocumentRenewal({
      context: partnerContext(applicantId),
      document_kind: 'INSURANCE',
      document_reference: 'SYNTH-PARTNER-INSURANCE-I001-R1',
      expires_at: new Date(lapsedAt.getTime() + 400 * DAY),
      now: lapsedAt,
    });
    await rejects(
      () =>
        lifecycle.submitDocumentRenewal({
          context: partnerContext(applicantId),
          document_kind: 'INSURANCE',
          document_reference: 'SYNTH-PARTNER-INSURANCE-I001-R1B',
          expires_at: new Date(lapsedAt.getTime() + 400 * DAY),
          now: new Date(lapsedAt.getTime() + 1_000),
        }),
      PartnerLifecycleConflictError,
      'A second renewal of the same document was accepted while one was in review',
    );
    await rejects(
      () =>
        lifecycle.reviewDocumentRenewal({
          context: partnerContext(applicantId),
          partner_document_renewal_id: renewal.partner_document_renewal_id,
          decision: 'APPROVED',
          reason_code: 'SELF_APPROVED',
        }),
      PartnerLifecycleAuthorizationError,
      'A partner reviewed their own renewal',
    );
    const rejectedRenewal = await lifecycle.reviewDocumentRenewal({
      context: adminContext(adminId),
      partner_document_renewal_id: renewal.partner_document_renewal_id,
      decision: 'REJECTED',
      reason_code: 'DOCUMENT_UNREADABLE',
      now: new Date(lapsedAt.getTime() + 2_000),
    });
    const stillRestricted = await lifecycle.onlineEligibility({
      context: partnerContext(applicantId),
      now: new Date(lapsedAt.getTime() + 3_000),
    });
    check(
      rejectedRenewal.lifecycle_state === 'REJECTED' &&
        !stillRestricted.can_go_online &&
        stillRestricted.blockers.some((blocker) => blocker.code === 'DOCUMENT_EXPIRED'),
      'A rejected renewal lifted the restriction',
    );
    const renewalAgain = await lifecycle.submitDocumentRenewal({
      context: partnerContext(applicantId),
      document_kind: 'INSURANCE',
      document_reference: 'SYNTH-PARTNER-INSURANCE-I001-R2',
      expires_at: new Date(lapsedAt.getTime() + 400 * DAY),
      now: new Date(lapsedAt.getTime() + 4_000),
    });
    const renewalQueue = await lifecycle.listDocumentRenewalsForAdmin({
      context: adminContext(adminId),
    });
    check(
      renewalQueue.some(
        (entry) => entry.partner_document_renewal_id === renewalAgain.partner_document_renewal_id,
      ) &&
        !renewalQueue.some(
          (entry) => entry.partner_document_renewal_id === renewal.partner_document_renewal_id,
        ),
      'The review queue does not hold the renewal in review, or still holds the decided one',
    );
    const approvedRenewal = await lifecycle.reviewDocumentRenewal({
      context: adminContext(adminId),
      partner_document_renewal_id: renewalAgain.partner_document_renewal_id,
      decision: 'APPROVED',
      reason_code: 'DOCUMENT_VERIFIED',
      now: new Date(lapsedAt.getTime() + 5_000),
    });
    await rejects(
      () =>
        lifecycle.reviewDocumentRenewal({
          context: adminContext(adminId),
          partner_document_renewal_id: renewalAgain.partner_document_renewal_id,
          decision: 'REJECTED',
          reason_code: 'DOCUMENT_VERIFIED',
        }),
      PartnerLifecycleConflictError,
      'A decided renewal was decided again',
    );
    const renewedApplication = await lifecycle.getOwnApplication({
      context: partnerContext(applicantId),
    });
    const lifted = await lifecycle.onlineEligibility({
      context: partnerContext(applicantId),
      now: new Date(lapsedAt.getTime() + 6_000),
    });
    check(
      approvedRenewal.lifecycle_state === 'APPROVED' &&
        renewedApplication?.insurance_reference === 'SYNTH-PARTNER-INSURANCE-I001-R2' &&
        renewedApplication?.insurance_expires_at?.getTime() === lapsedAt.getTime() + 400 * DAY &&
        lifted.can_go_online &&
        lifted.blockers.length === 0 &&
        lifted.documents.find((document) => document.document_kind === 'INSURANCE')?.state ===
          'VALID',
      `An approved renewal did not write the document and lift the restriction (${JSON.stringify({ renewedApplication, lifted })})`,
    );
    const backOnline = await availability.set({
      context: partnerContext(applicantId),
      state: 'ONLINE',
      latitude: 26.91,
      longitude: 75.81,
      reason_code: 'SHIFT_START',
      now: new Date(lapsedAt.getTime() + 7_000),
    });
    check(backOnline.availability_state === 'ONLINE', 'A renewed partner could not go online');

    // 9.1 -- capability-specific restrictions: a GLOBAL restriction keeps
    // the partner off the road and off every offer; one scoped to a store
    // keeps them off that store's offers alone. Until audit run 56 a
    // restriction restricted nothing.
    const restrictionAt = new Date(lapsedAt.getTime() + 8_000);
    const globalRestrictionId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.trust_restriction_cases
         (trust_restriction_case_id, subject_kind, subject_reference, scope_kind, scope_reference,
          lifecycle_state, reason_code, evidence_reference, policy_reference, proposed_by_user_id,
          approved_by_user_id, effective_until, review_at, request_id, correlation_id)
       VALUES ($1,'PARTNER',$2,'GLOBAL','global','ACTIVE','SAFETY_REVIEW','SYNTH-EVIDENCE-P9-1',
               'SYNTH-POLICY-P9-1',$3,$4,$5,$5,$6,$6)`,
      [
        globalRestrictionId,
        String(applicantId),
        adminId,
        systemActorId,
        new Date(restrictionAt.getTime() + 7 * DAY),
        createUuidV7(),
      ],
    );
    const globallyRestricted = await lifecycle.onlineEligibility({
      context: partnerContext(applicantId),
      now: restrictionAt,
    });
    let refusedByRestriction: unknown = null;
    try {
      await availability.set({
        context: partnerContext(applicantId),
        state: 'ONLINE',
        latitude: 26.91,
        longitude: 75.81,
        reason_code: 'SHIFT_START',
        now: restrictionAt,
      });
    } catch (error) {
      refusedByRestriction = error;
    }
    const offeredUnderGlobal = await availability.eligible({
      context: adminContext(adminId),
      vendor_location_id: vendorLocationId,
      radius_meters: 2_000,
      now: restrictionAt,
    });
    check(
      !globallyRestricted.can_go_online &&
        globallyRestricted.blockers.some(
          (blocker) =>
            blocker.code === 'RESTRICTION_ACTIVE' && blocker.detail === 'GLOBAL:SAFETY_REVIEW',
        ) &&
        refusedByRestriction instanceof PartnerAvailabilityConflictError &&
        refusedByRestriction.code === 'PARTNER_NOT_ELIGIBLE' &&
        !offeredUnderGlobal.some((candidate) => candidate.partner_user_id === applicantId),
      `A GLOBAL restriction did not keep the partner off the road and off offers (${JSON.stringify({ blockers: globallyRestricted.blockers, refused: String(refusedByRestriction) })})`,
    );
    await pool.query(
      `UPDATE marketplace.trust_restriction_cases SET lifecycle_state='EXPIRED', version=version+1
        WHERE trust_restriction_case_id=$1`,
      [globalRestrictionId],
    );
    const otherLocationId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id)
       VALUES ($1,$2,'SYNTH Partner Store Two','Synthetic partner test location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.812,26.912),4326)::geography,'FRUIT_VEGETABLE','ACTIVE',$3,$3)`,
      [otherLocationId, vendorId, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.trust_restriction_cases
         (trust_restriction_case_id, subject_kind, subject_reference, scope_kind, scope_reference,
          lifecycle_state, reason_code, evidence_reference, policy_reference, proposed_by_user_id,
          approved_by_user_id, effective_until, review_at, request_id, correlation_id)
       VALUES ($1,'PARTNER',$2,'VENDOR_LOCATION',$3,'ACTIVE','STORE_COMPLAINT','SYNTH-EVIDENCE-P9-2',
               'SYNTH-POLICY-P9-2',$4,$5,$6,$6,$7,$7)`,
      [
        createUuidV7(),
        String(applicantId),
        String(vendorLocationId),
        adminId,
        systemActorId,
        new Date(restrictionAt.getTime() + 7 * DAY),
        createUuidV7(),
      ],
    );
    const scopedAt = new Date(restrictionAt.getTime() + 1_000);
    const scopedStanding = await lifecycle.onlineEligibility({
      context: partnerContext(applicantId),
      now: scopedAt,
    });
    const offeredAtRestrictedStore = await availability.eligible({
      context: adminContext(adminId),
      vendor_location_id: vendorLocationId,
      radius_meters: 2_000,
      now: scopedAt,
    });
    const offeredElsewhere = await availability.eligible({
      context: adminContext(adminId),
      vendor_location_id: otherLocationId,
      radius_meters: 2_000,
      now: scopedAt,
    });
    check(
      scopedStanding.can_go_online &&
        !offeredAtRestrictedStore.some((candidate) => candidate.partner_user_id === applicantId) &&
        offeredElsewhere.some((candidate) => candidate.partner_user_id === applicantId),
      `A store-scoped restriction did not apply to that store alone (${JSON.stringify({ online: scopedStanding.can_go_online, atStore: offeredAtRestrictedStore.length, elsewhere: offeredElsewhere.length })})`,
    );

    // Two documents lapsed: renewing one does not lift the restriction the
    // other keeps; renewing both does.
    await pool.query(
      `UPDATE marketplace.trust_restriction_cases SET lifecycle_state='EXPIRED', version=version+1
        WHERE subject_reference=$1 AND lifecycle_state='ACTIVE'`,
      [String(applicantId)],
    );
    const bothLapsedAt = new Date(now.getTime() + 401 * DAY);
    const sweptBoth = await lifecycle.sweepExpiredDocuments({
      context: systemContext(systemActorId),
      now: bothLapsedAt,
    });
    check(
      sweptBoth.some((id) => id === applicantId),
      'Two lapsed documents did not restrict',
    );
    const identityRenewal = await lifecycle.submitDocumentRenewal({
      context: partnerContext(applicantId),
      document_kind: 'IDENTITY',
      document_reference: 'SYNTH-PARTNER-IDENTITY-P001-R1',
      expires_at: new Date(bothLapsedAt.getTime() + 365 * DAY),
      now: bothLapsedAt,
    });
    await lifecycle.reviewDocumentRenewal({
      context: adminContext(adminId),
      partner_document_renewal_id: identityRenewal.partner_document_renewal_id,
      decision: 'APPROVED',
      reason_code: 'DOCUMENT_VERIFIED',
      now: new Date(bothLapsedAt.getTime() + 1_000),
    });
    const halfRenewed = await lifecycle.onlineEligibility({
      context: partnerContext(applicantId),
      now: new Date(bothLapsedAt.getTime() + 2_000),
    });
    check(
      !halfRenewed.can_go_online &&
        halfRenewed.blockers.some(
          (blocker) => blocker.code === 'DOCUMENT_EXPIRED' && blocker.detail === 'VEHICLE',
        ) &&
        halfRenewed.blockers.some((blocker) => blocker.code === 'ELIGIBILITY_RESTRICTED'),
      `Renewing one of two lapsed documents lifted the restriction (${JSON.stringify(halfRenewed.blockers)})`,
    );
    const vehicleRenewal = await lifecycle.submitDocumentRenewal({
      context: partnerContext(applicantId),
      document_kind: 'VEHICLE',
      document_reference: 'SYNTH-PARTNER-VEHICLE-V001-R1',
      expires_at: new Date(bothLapsedAt.getTime() + 365 * DAY),
      now: new Date(bothLapsedAt.getTime() + 3_000),
    });
    await lifecycle.reviewDocumentRenewal({
      context: adminContext(adminId),
      partner_document_renewal_id: vehicleRenewal.partner_document_renewal_id,
      decision: 'APPROVED',
      reason_code: 'DOCUMENT_VERIFIED',
      now: new Date(bothLapsedAt.getTime() + 4_000),
    });
    const fullyRenewed = await lifecycle.onlineEligibility({
      context: partnerContext(applicantId),
      now: new Date(bothLapsedAt.getTime() + 5_000),
    });
    check(
      fullyRenewed.can_go_online && fullyRenewed.blockers.length === 0,
      `Renewing both lapsed documents did not lift the restriction (${JSON.stringify(fullyRenewed.blockers)})`,
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
    // 9.1 -- an unsynced proof is a named blocker too.
    const proofBlocked = await lifecycle.onlineEligibility({
      context: partnerContext(applicantId),
      now: new Date(now.getTime() + 40 * DAY),
    });
    check(
      proofBlocked.blockers.some((blocker) => blocker.code === 'OFFLINE_PROOF_PENDING'),
      `An unsynced proof is not named as a blocker (${JSON.stringify(proofBlocked.blockers)})`,
    );

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
    const standingSql = `SELECT e.state,
              (SELECT count(*) FROM marketplace.trust_restriction_cases r
                WHERE r.subject_kind='PARTNER' AND r.subject_reference=$2)::text AS restrictions
         FROM marketplace.partner_eligibilities e WHERE e.user_id=$1`;
    const standingBefore = await pool.query<{ state: string; restrictions: string }>(standingSql, [
      applicantId,
      String(applicantId),
    ]);
    const openException = await fieldOps.raiseException({
      context: partnerContext(applicantId),
      delivery_assignment_id: deliveryAssignmentId,
      exception_kind: 'UNREACHABLE_CUSTOMER',
      evidence_note: 'SYNTH rang twice, gate locked, no answer on the bell',
      reason_code: 'CUSTOMER_NOT_RESPONDING',
      now,
    });
    check(openException.resolution_state === 'OPEN', 'exception not OPEN');
    // 9.8 -- the report carries the partner's evidence and says who wrote it.
    check(
      openException.actor_kind === 'delivery_partner' &&
        openException.evidence_note === 'SYNTH rang twice, gate locked, no answer on the bell',
      `The report did not carry its evidence and author (${JSON.stringify(openException)})`,
    );
    // Emergency kinds are recorded with the same shape
    await fieldOps.raiseException({
      context: partnerContext(applicantId),
      delivery_assignment_id: deliveryAssignmentId,
      exception_kind: 'ACCIDENT',
      reason_code: 'ROADSIDE_INCIDENT',
      now,
    });
    // A partner reports; operations direct. Returning, cancelling and
    // reassigning move custody and money, so they are not the reporter's to
    // record even on their own assignment (DLP-40).
    await rejects(
      () =>
        fieldOps.resolveException({
          context: partnerContext(applicantId),
          delivery_assignment_id: deliveryAssignmentId,
          exception_kind: 'UNREACHABLE_CUSTOMER',
          resolution_state: 'RETURN_TO_VENDOR',
          reason_code: 'CUSTOMER_UNREACHABLE_AFTER_ATTEMPTS',
        }),
      FieldOpsAuthorizationError,
      'A partner was allowed to direct a return on their own assignment',
    );
    // 9.8 -- an instruction is operations' to give, in words, on their own row.
    await rejects(
      () =>
        fieldOps.resolveException({
          context: partnerContext(applicantId),
          delivery_assignment_id: deliveryAssignmentId,
          exception_kind: 'UNREACHABLE_CUSTOMER',
          resolution_state: 'RETRY',
          instruction: 'SYNTH I will decide for myself',
          reason_code: 'PARTNER_RESOLVED',
        }),
      FieldOpsAuthorizationError,
      'A partner wrote an instruction',
    );
    const resolvedException = await fieldOps.resolveException({
      context: adminContext(adminId),
      delivery_assignment_id: deliveryAssignmentId,
      exception_kind: 'UNREACHABLE_CUSTOMER',
      resolution_state: 'RETURN_TO_VENDOR',
      instruction: 'SYNTH Take it back to the store; the customer will collect tomorrow.',
      reason_code: 'CUSTOMER_UNREACHABLE_AFTER_ATTEMPTS',
    });
    check(resolvedException.resolution_state === 'RETURN_TO_VENDOR', 'resolution not recorded');
    check(
      resolvedException.actor_kind === 'admin' &&
        resolvedException.instruction ===
          'SYNTH Take it back to the store; the customer will collect tomorrow.',
      `The direction did not carry who gave it and what they said (${JSON.stringify(resolvedException)})`,
    );
    // 9.8 -- no automatic guilt: a report, even an emergency, moves no
    // eligibility and opens no restriction on the partner who made it.
    const standingAfter = await pool.query<{ state: string; restrictions: string }>(standingSql, [
      applicantId,
      String(applicantId),
    ]);
    check(
      standingAfter.rows[0]?.state === standingBefore.rows[0]?.state &&
        standingAfter.rows[0]?.restrictions === standingBefore.rows[0]?.restrictions,
      `A report changed the partner's standing on its own (${JSON.stringify({ before: standingBefore.rows[0], after: standingAfter.rows[0] })})`,
    );

    // Resolving with no matching OPEN raises NotFound. Authorization is checked
    // before the lookup — a caller who may not direct a cancellation must not
    // learn from the error whether an exception exists — so this uses an
    // operations context to reach the lookup at all.
    await rejects(
      () =>
        fieldOps.resolveException({
          context: adminContext(adminId),
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
    await availability.close();
    await lifecycle.close();
    await pool.end();
  }
}
