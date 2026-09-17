import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { LocalProtectedObjectStorage } from '../src/protected-object-storage.js';
import {
  VendorOnboardingAuthorizationError,
  VendorOnboardingIncompleteError,
  VendorOnboardingNotFoundError,
  VendorOnboardingService,
  type VerificationDocumentSummary,
} from '../src/vendor-onboarding.js';
import { check } from './verify-support.js';

async function expectError(
  operation: () => Promise<unknown>,
  expected: new (...args: never[]) => Error,
) {
  try {
    await operation();
  } catch (error) {
    if (error instanceof expected) return;
    throw error;
  }
  throw new Error(`Expected ${expected.name}`);
}

const TABLES = `marketplace.finance_exceptions, marketplace.provider_statement_rows,
marketplace.payouts, marketplace.settlements, marketplace.ledger_entries,
marketplace.ledger_transactions, marketplace.refund_events, marketplace.refunds,
marketplace.payment_events, marketplace.payment_allocations, marketplace.payment_transactions,
marketplace.return_tasks, marketplace.custody_events,
marketplace.assignment_events, marketplace.delivery_assignments,
marketplace.catalogue_moderation_events, marketplace.catalogue_moderation_cases,
marketplace.inventory_events, marketplace.inventory_reservations,
marketplace.inventory_items, marketplace.vendor_publication_events, marketplace.vendor_publication_cases,
  marketplace.cart_events, marketplace.cart_lines, marketplace.cart_vendor_groups, marketplace.carts,
    marketplace.customer_discovery_events, marketplace.customer_recent_searches,
    marketplace.customer_shop_requests, marketplace.customer_preferred_store,
    marketplace.customer_favourite_stores,
  marketplace.catalogue_product_substitutions, marketplace.catalogue_product_images,
  marketplace.catalogue_prices, marketplace.catalogue_product_variants,
  marketplace.catalogue_import_rows, marketplace.catalogue_imports, marketplace.catalogue_products,
  marketplace.vendor_onboarding_events,
  marketplace.vendor_onboarding_appeals,
  marketplace.vendor_document_reviews,
  marketplace.vendor_verification_documents,
  marketplace.vendor_onboarding_cases,
  marketplace.vendor_network_events,
  marketplace.vendor_location_fulfilment_modes,
  marketplace.vendor_service_zones,
  marketplace.vendor_location_temporary_closures,
  marketplace.vendor_location_calendar_exceptions,
  marketplace.vendor_location_operating_hours,
  marketplace.staff_memberships,
  marketplace.vendor_locations,
  marketplace.vendors CASCADE`;

export async function verifyVendorOnboarding(connectionString: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'vendor-onboarding-verifier-'));
  const pool = new Pool({ connectionString, application_name: 'vendor-onboarding-verifier' });
  const storage = new LocalProtectedObjectStorage({
    grant_key: 'synthetic-onboarding-verifier-grant-key-0001',
    root_directory: root,
  });
  const onboarding = new VendorOnboardingService({ connection_string: connectionString, storage });
  const base = new Date('2026-08-24T06:30:00.000Z');
  const operatorId = createUuidV7({ now_ms: base.getTime() });
  const reviewerId = createUuidV7({ now_ms: base.getTime() + 1 });
  const applicantId = createUuidV7({ now_ms: base.getTime() + 2 });
  const otherApplicantId = createUuidV7({ now_ms: base.getTime() + 3 });
  const adminContext = (userId: string) =>
    createRequestContext({
      actor: createAuthenticatedActor({
        actor_id: userId,
        actor_kind: 'admin',
        session_id: createUuidV7(),
      }),
    });
  const applicantContext = () => createRequestContext();
  // Storage sniffs the declared media type against the file's own signature
  // (SEC-08), which this fixture predates: it uploaded plain text while
  // declaring PDF and PNG, so every upload was rejected. The bytes carry the
  // real magic numbers now, with the synthetic marker still in the body.
  const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const content = (label: string, mediaType: 'application/pdf' | 'image/png') =>
    Uint8Array.from([
      ...(mediaType === 'application/pdf' ? PDF_SIGNATURE : PNG_SIGNATURE),
      ...new TextEncoder().encode(
        `SYNTHETIC-VERIFICATION-DOCUMENT\n${label}\nfictional company-test evidence only`,
      ),
    ]);

  try {
    await pool.query(`TRUNCATE ${TABLES}`);
    for (const userId of [operatorId, reviewerId, applicantId, otherApplicantId]) {
      await pool.query(
        `INSERT INTO marketplace.users (user_id, created_at, updated_at)
        VALUES ($1,$2,$2) ON CONFLICT (user_id) DO NOTHING`,
        [userId, base],
      );
    }

    const leadId = await onboarding.createLead({ context: adminContext(operatorId), now: base });
    const lead = await onboarding.getForAdmin({
      context: adminContext(operatorId),
      onboarding_case_id: leadId,
    });
    if (lead.entry_kind !== 'LEAD' || lead.lifecycle_state !== 'LEAD') {
      throw new Error('Lead entry did not preserve its entry source and state');
    }

    const directId = await onboarding.createApplication({
      applicant_user_id: otherApplicantId,
      context: applicantContext(),
      now: base,
    });
    const direct = await onboarding.getForApplicant({
      applicant_user_id: otherApplicantId,
      onboarding_case_id: directId,
    });
    if (direct.entry_kind !== 'APPLICATION' || direct.lifecycle_state !== 'PENDING') {
      throw new Error('Direct application entry did not begin pending');
    }

    const invitationId = await onboarding.createInvitation({
      applicant_user_id: applicantId,
      context: adminContext(operatorId),
      invitation_reference: 'SYNTH-INV-JAIPUR-0001',
      now: base,
    });
    let version = await onboarding.claimInvitation({
      applicant_user_id: applicantId,
      context: applicantContext(),
      expected_version: 1,
      invitation_reference: 'SYNTH-INV-JAIPUR-0001',
      now: base,
    });
    // D-15 asks for an expiring one-use invitation. One-use was enforced -- a claim is
    // refused unless the case is still INVITED -- but nothing expired, and the applicant
    // is optional, so for the ordinary case of inviting a vendor who has not signed up
    // yet the reference was the only credential and it stayed valid forever. Claiming it
    // means becoming the applicant, which on approval grants VENDOR_OWNER membership.
    const expiringInvitationId = await onboarding.createInvitation({
      context: adminContext(operatorId),
      expires_at: new Date(base.getTime() + 60_000),
      invitation_reference: 'SYNTH-INV-EXPIRING-0001',
      now: base,
    });
    let expiredClaimRefused = false;
    try {
      await onboarding.claimInvitation({
        applicant_user_id: otherApplicantId,
        context: applicantContext(),
        expected_version: 1,
        invitation_reference: 'SYNTH-INV-EXPIRING-0001',
        now: new Date(base.getTime() + 61_000),
      });
    } catch (error: unknown) {
      expiredClaimRefused = error instanceof Error && /Invitation has expired/.test(error.message);
    }
    if (!expiredClaimRefused) {
      throw new Error('An expired invitation was still claimable');
    }
    const stillInvited = await onboarding.getForAdmin({
      context: adminContext(operatorId),
      onboarding_case_id: expiringInvitationId,
    });
    if (stillInvited.lifecycle_state !== 'INVITED') {
      throw new Error('A refused claim advanced the invitation anyway');
    }

    // One-use: the reference just claimed above cannot be claimed a second time.
    let replayRefused = false;
    try {
      await onboarding.claimInvitation({
        applicant_user_id: otherApplicantId,
        context: applicantContext(),
        expected_version: 2,
        invitation_reference: 'SYNTH-INV-JAIPUR-0001',
        now: base,
      });
    } catch (error: unknown) {
      replayRefused = error instanceof Error;
    }
    if (!replayRefused) throw new Error('A claimed invitation was claimable again');

    version = await onboarding.submitProfile({
      applicant_user_id: applicantId,
      context: applicantContext(),
      expected_version: version,
      now: base,
      onboarding_case_id: invitationId,
      profile: {
        business_name: 'SYNTH Jaipur Fresh Produce',
        business_profile_reference: 'SYNTH-BIZ-JAIPUR-0001',
        category: 'FRUIT_VEGETABLE',
        latitude: 26.9124,
        location_name: 'SYNTH Vaishali Nagar Produce Store',
        longitude: 75.7873,
        minimum_order_minor: 12_500,
        operating_timezone: 'Asia/Kolkata',
        payout_profile_reference: 'SYNTH-PAYOUT-JAIPUR-0001',
        preparation_seconds: 1_200,
        profile_description: 'Synthetic onboarding profile.',
      },
    });

    await expectError(
      () =>
        onboarding.startReview({
          context: adminContext(operatorId),
          expected_version: version,
          onboarding_case_id: invitationId,
        }),
      VendorOnboardingIncompleteError,
    );
    await expectError(
      () =>
        onboarding.getForApplicant({
          applicant_user_id: otherApplicantId,
          onboarding_case_id: invitationId,
        }),
      VendorOnboardingNotFoundError,
    );

    const documents: VerificationDocumentSummary[] = [];
    for (const [kind, capability, expiry] of [
      ['BUSINESS_REGISTRATION', 'VENDOR_PUBLICATION', '2026-09-10'],
      ['FOOD_SAFETY_DECLARATION', 'VENDOR_PUBLICATION', null],
      ['PAYOUT_ACCOUNT_PROOF', 'VENDOR_PAYOUT', null],
    ] as const) {
      const uploaded = await onboarding.uploadDocument({
        affected_capability: capability,
        applicant_user_id: applicantId,
        content: content(kind, kind === 'PAYOUT_ACCOUNT_PROOF' ? 'image/png' : 'application/pdf'),
        context: applicantContext(),
        document_kind: kind,
        expected_case_version: version,
        expires_on: expiry,
        media_type: kind === 'PAYOUT_ACCOUNT_PROOF' ? 'image/png' : 'application/pdf',
        now: base,
        onboarding_case_id: invitationId,
      });
      documents.push(uploaded);
      version += 1;
    }
    const primaryDocument = documents[0];
    if (!primaryDocument) throw new Error('Required synthetic documents were not uploaded');

    version = await onboarding.startReview({
      context: adminContext(operatorId),
      expected_version: version,
      now: base,
      onboarding_case_id: invitationId,
    });
    await expectError(
      () =>
        onboarding.reviewDocument({
          context: adminContext(operatorId),
          decision: 'APPROVED',
          evidence_reference: 'SYNTH-EVIDENCE-SELF-REVIEW',
          expected_case_version: version,
          onboarding_case_id: invitationId,
          reason_code: 'SYNTHETIC_DOCUMENT_VALID',
          reviewer_note: 'Synthetic document is valid.',
          verification_document_id: primaryDocument.verification_document_id,
        }),
      VendorOnboardingAuthorizationError,
    );

    // The case has to be findable before it can be reviewed. The console could
    // open one by id and nothing else, so self-service vendor onboarding had no
    // usable path to a decision at all.
    const queue = await onboarding.listForAdmin({ context: adminContext(reviewerId) });
    const queued = queue.find((entry) => entry.onboarding_case_id === invitationId);
    check(queued !== undefined, 'An onboarding case awaiting review was not in the queue');
    check(
      (queued?.document_count ?? 0) >= documents.length,
      'The queue did not count the documents waiting on the case',
    );
    // Everything awaiting review sorts ahead of everything decided, so a
    // reviewer opening this screen sees the work first.
    const lastAwaiting = queue.map((entry) => entry.awaiting_review).lastIndexOf(true);
    const firstDecided = queue.map((entry) => entry.awaiting_review).indexOf(false);
    check(
      lastAwaiting === -1 || firstDecided === -1 || lastAwaiting < firstDecided,
      'Cases awaiting review were not ordered ahead of decided ones',
    );

    for (const document of documents) {
      version = await onboarding.reviewDocument({
        context: adminContext(reviewerId),
        decision: 'APPROVED',
        evidence_reference: `SYNTH-EVIDENCE-${document.document_kind.replaceAll('_', '-')}-OK`,
        expected_case_version: version,
        now: base,
        onboarding_case_id: invitationId,
        reason_code: 'SYNTHETIC_DOCUMENT_VALID',
        reviewer_note: 'Synthetic evidence reviewed and accepted.',
        verification_document_id: document.verification_document_id,
      });
    }

    const access = await onboarding.issueDocumentReadGrant({
      context: adminContext(reviewerId),
      verification_document_id: primaryDocument.verification_document_id,
    });
    const read = await onboarding.readDocumentWithGrant({
      context: adminContext(reviewerId),
      grant: access.grant,
      verification_document_id: primaryDocument.verification_document_id,
    });
    if (!new TextDecoder().decode(read.content).includes('BUSINESS_REGISTRATION')) {
      throw new Error('Short-lived protected object read returned wrong evidence');
    }

    const approved = await onboarding.approve({
      context: adminContext(reviewerId),
      evidence_reference: 'SYNTH-EVIDENCE-CASE-APPROVED',
      expected_version: version,
      now: base,
      onboarding_case_id: invitationId,
      reason_code: 'SYNTHETIC_ONBOARDING_APPROVED',
      reviewer_note: 'All synthetic requirements are satisfied.',
    });
    version = approved.version;
    const aggregate = await pool.query<{
      category: string;
      location_state: string;
      vendor_state: string;
    }>(
      `SELECT l.category, l.lifecycle_state AS location_state, v.lifecycle_state AS vendor_state
         FROM marketplace.vendor_locations l JOIN marketplace.vendors v USING (vendor_id)
        WHERE l.vendor_location_id=$1 AND v.vendor_id=$2`,
      [approved.vendor_location_id, approved.vendor_id],
    );
    if (
      aggregate.rows[0]?.category !== 'FRUIT_VEGETABLE' ||
      aggregate.rows[0].location_state !== 'DRAFT' ||
      aggregate.rows[0].vendor_state !== 'DRAFT'
    ) {
      throw new Error('Onboarding approval did not create draft vendor/location aggregates');
    }

    // Onboarding -> access loop: the approved applicant must now hold an active
    // VENDOR_OWNER staff membership at the new location, so they can reach
    // vendor staff/settings/order routes without an out-of-band grant.
    const ownerGrant = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM marketplace.staff_memberships sm
         JOIN marketplace.role_assignments ra USING (role_assignment_id)
        WHERE sm.user_id=$1 AND sm.vendor_location_id=$2
          AND ra.role_key='VENDOR_OWNER' AND ra.state='ACTIVE'`,
      [applicantId, approved.vendor_location_id],
    );
    if (ownerGrant.rows[0]?.count !== '1') {
      throw new Error('Onboarding approval did not grant the applicant a VENDOR_OWNER membership');
    }
    // And the grant is in the access history. It was not: approval inserted
    // the owner role directly and wrote no ROLE_GRANTED event.
    const ownerGrantEvent = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM marketplace.access_membership_events e
         JOIN marketplace.role_assignments ra USING (role_assignment_id)
        WHERE e.user_id=$1 AND e.event_type='ROLE_GRANTED' AND ra.role_key='VENDOR_OWNER'
          AND e.reason_code='ONBOARDING_APPROVED'`,
      [applicantId],
    );
    check(
      ownerGrantEvent.rows[0]?.count === '1',
      'Vendor approval left no ROLE_GRANTED event for the owner it created',
    );

    const expiringChanged = await onboarding.advanceDocumentDeadlines({
      at: new Date('2026-09-01T00:00:00.000Z'),
      context: createRequestContext(),
    });
    if (expiringChanged !== 1) throw new Error('Expiring document was not detected once');
    version += 1;
    let summary = await onboarding.getForApplicant({
      applicant_user_id: applicantId,
      onboarding_case_id: invitationId,
    });
    if (summary.lifecycle_state !== 'EXPIRING')
      throw new Error('Case did not expose expiring state');

    version = await onboarding.grantDocumentGrace({
      context: adminContext(reviewerId),
      expected_case_version: version,
      grace_until: '2026-09-20',
      now: new Date('2026-09-10T00:00:00.000Z'),
      onboarding_case_id: invitationId,
      reason_code: 'SYNTHETIC_GRACE_APPROVED',
      reviewer_note: 'Synthetic grace permits replacement evidence.',
      verification_document_id: primaryDocument.verification_document_id,
    });
    summary = await onboarding.getForApplicant({
      applicant_user_id: applicantId,
      onboarding_case_id: invitationId,
    });
    if (summary.lifecycle_state !== 'GRACE') throw new Error('Case did not expose grace state');

    const reverificationChanged = await onboarding.advanceDocumentDeadlines({
      at: new Date('2026-09-21T00:00:00.000Z'),
      context: createRequestContext(),
    });
    if (reverificationChanged !== 1)
      throw new Error('Expired grace did not require reverification');
    version += 1;
    summary = await onboarding.getForApplicant({
      applicant_user_id: applicantId,
      onboarding_case_id: invitationId,
    });
    if (summary.lifecycle_state !== 'REVERIFICATION') {
      throw new Error('Case did not expose reverification state');
    }

    const appealId = await onboarding.submitAppeal({
      appeal_note: 'Please review replacement evidence.',
      applicant_user_id: applicantId,
      context: applicantContext(),
      evidence_reference: 'SYNTH-EVIDENCE-APPEAL-0001',
      expected_case_version: version,
      now: new Date('2026-09-21T01:00:00.000Z'),
      onboarding_case_id: invitationId,
      reason_code: 'SYNTHETIC_REVERIFICATION_APPEAL',
      verification_document_id: primaryDocument.verification_document_id,
    });
    version += 1;
    version = await onboarding.reviewAppeal({
      context: adminContext(reviewerId),
      decision: 'OVERTURNED',
      expected_case_version: version,
      now: new Date('2026-09-21T02:00:00.000Z'),
      onboarding_appeal_id: appealId,
      onboarding_case_id: invitationId,
      reason_code: 'SYNTHETIC_APPEAL_ACCEPTED',
      reviewer_note: 'Replacement review may proceed.',
    });
    summary = await onboarding.getForApplicant({
      applicant_user_id: applicantId,
      onboarding_case_id: invitationId,
    });
    if (summary.lifecycle_state !== 'PENDING' || summary.version !== version) {
      throw new Error('Successful appeal did not return the case to pending');
    }

    let appendOnlyRejected = false;
    try {
      await pool.query(
        `UPDATE marketplace.vendor_document_reviews SET reviewer_note='tampered'
        WHERE verification_document_id=$1`,
        [primaryDocument.verification_document_id],
      );
    } catch (error: unknown) {
      appendOnlyRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '55000';
    }
    if (!appendOnlyRejected) throw new Error('Document reviewer evidence was mutable');
  } finally {
    await pool.query(`TRUNCATE ${TABLES}`).catch(() => undefined);
    await onboarding.close();
    await pool.end();
    await rm(root, { force: true, recursive: true });
  }
}
