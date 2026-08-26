import {
  createRequestContext,
  createRequestId,
  createUuidV7,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  VendorPublicationAuthorizationError,
  VendorPublicationIncompleteError,
  VendorPublicationService,
} from '../src/vendor-publication.js';

const TABLES = `marketplace.finance_exceptions, marketplace.provider_statement_rows,
marketplace.payouts, marketplace.settlements, marketplace.ledger_entries,
marketplace.ledger_transactions, marketplace.refund_events, marketplace.refunds,
marketplace.payment_events, marketplace.payment_allocations, marketplace.payment_transactions,
marketplace.return_tasks, marketplace.custody_events,
marketplace.assignment_events, marketplace.delivery_assignments,
marketplace.catalogue_moderation_events, marketplace.catalogue_moderation_cases,
marketplace.catalogue_product_substitutions, marketplace.catalogue_product_images,
marketplace.catalogue_prices, marketplace.catalogue_product_variants,
marketplace.catalogue_import_rows, marketplace.catalogue_imports, marketplace.catalogue_products,
marketplace.inventory_events, marketplace.inventory_reservations,
marketplace.inventory_items, marketplace.vendor_publication_events, marketplace.vendor_publication_cases,
  marketplace.vendor_document_reviews, marketplace.vendor_onboarding_appeals,
  marketplace.vendor_onboarding_events, marketplace.vendor_verification_documents,
  marketplace.vendor_onboarding_cases, marketplace.vendor_network_events,
  marketplace.vendor_location_fulfilment_modes, marketplace.vendor_service_zones,
  marketplace.vendor_location_temporary_closures, marketplace.vendor_location_calendar_exceptions,
  marketplace.vendor_location_operating_hours, marketplace.staff_memberships,
  marketplace.vendor_locations, marketplace.vendors`;

function context(actorId: UuidV7) {
  return createRequestContext({
    actor: { actor_id: actorId, actor_kind: 'admin', session_id: createUuidV7() },
  });
}

async function expectError(
  operation: () => Promise<unknown>,
  type: new (...args: never[]) => Error,
) {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  if (!(caught instanceof type)) throw new Error(`Expected ${type.name}`);
}

export async function verifyVendorPublication(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const publication = new VendorPublicationService({ connection_string: connectionString });
  const operator = createUuidV7();
  const reviewer = createUuidV7();
  const applicant = createUuidV7();
  const vendorId = createUuidV7();
  const locationId = createUuidV7();
  const onboardingId = createUuidV7();
  const requestId = createRequestId();
  const now = new Date('2026-08-24T08:00:00.000Z');
  try {
    await pool.query(`TRUNCATE ${TABLES}`);
    await pool.query('INSERT INTO marketplace.users (user_id) VALUES ($1),($2),($3)', [
      operator,
      reviewer,
      applicant,
    ]);
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,'SYNTH Publication Produce','Synthetic publication profile.',$2,$2,$3,$3)`,
      [vendorId, requestId, now],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,'SYNTH Publication Vaishali','Synthetic location profile.','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.7873,26.9124),4326)::geography,'FRUIT_VEGETABLE',$3,$3,$4,$4)`,
      [locationId, vendorId, requestId, now],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_onboarding_cases
        (onboarding_case_id,entry_kind,lifecycle_state,applicant_user_id,created_by_user_id,
         business_profile_reference,payout_profile_reference,proposed_business_name,
         proposed_location_name,proposed_profile_description,proposed_operating_timezone,
         proposed_coordinates,proposed_category,proposed_minimum_order_minor,proposed_currency,
         proposed_preparation_seconds,vendor_id,vendor_location_id,current_reason_code,version,
         request_id,correlation_id,submitted_at,review_started_at,approved_at,created_at,updated_at)
       VALUES ($1,'APPLICATION','APPROVED',$2,NULL,'SYNTH-BIZ-PUBLICATION-0001',
         'SYNTH-PAYOUT-PUBLICATION-0001','SYNTH Publication Produce','SYNTH Publication Vaishali',
         'Synthetic location profile.','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.7873,26.9124),4326)::geography,'FRUIT_VEGETABLE',10000,'INR',
         1200,$3,$4,'SYNTHETIC_ONBOARDING_APPROVED',1,$5,$5,$6,$6,$6,$6,$6)`,
      [onboardingId, applicant, vendorId, locationId, requestId, now],
    );
    for (const [kind, documentId] of [
      ['BUSINESS_REGISTRATION', createUuidV7()],
      ['FOOD_SAFETY_DECLARATION', createUuidV7()],
    ] as const) {
      await pool.query(
        `INSERT INTO marketplace.vendor_verification_documents
          (verification_document_id,onboarding_case_id,document_kind,document_version,
           lifecycle_state,object_key,content_sha256,content_length,media_type,scan_state,
           affected_capability,uploaded_by_user_id,request_id,correlation_id,created_at,updated_at)
         VALUES ($1,$2,$3,1,'APPROVED',$4,$5,64,'application/pdf','CLEAN',
                 'VENDOR_PUBLICATION',$6,$7,$7,$8,$8)`,
        [
          documentId,
          onboardingId,
          kind,
          `vendor-onboarding/${onboardingId}/${documentId}/object`,
          'a'.repeat(64),
          applicant,
          requestId,
          now,
        ],
      );
    }

    const caseId = await publication.create({
      context: context(operator),
      onboarding_case_id: onboardingId,
    });
    let current = await publication.get({
      context: context(operator),
      publication_case_id: caseId,
    });
    if (current.ready) throw new Error('Incomplete publication draft was marked ready');
    await expectError(
      () =>
        publication.submit({
          context: context(operator),
          expected_version: current.version,
          note: 'Submit synthetic launch proof.',
          publication_case_id: caseId,
          reason_code: 'PUBLICATION_READY_FOR_REVIEW',
        }),
      VendorPublicationIncompleteError,
    );

    await pool.query(
      `INSERT INTO marketplace.vendor_location_operating_hours
        (operating_hour_id,vendor_location_id,weekday,opens_at,closes_at)
       VALUES ($1,$2,1,'08:00','20:00')`,
      [createUuidV7(), locationId],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_service_zones
        (service_zone_id,vendor_location_id,zone_name,operating_timezone,boundary,request_id,correlation_id)
       VALUES ($1,$2,'Synthetic Vaishali zone','Asia/Kolkata',
         ST_Multi(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[75.77,26.90],[75.81,26.90],[75.81,26.93],[75.77,26.93],[75.77,26.90]]]}'))::geography,$3,$3)`,
      [createUuidV7(), locationId, requestId],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_location_fulfilment_modes
        (vendor_location_id,fulfilment_mode,approved_by_user_id,approved_at,request_id,correlation_id)
       VALUES ($1,'CUSTOMER_PICKUP',$2,$3,$4,$4)`,
      [locationId, reviewer, now, requestId],
    );
    const evaluated = await publication.evaluate({
      context: context(operator),
      expected_version: current.version,
      publication_case_id: caseId,
    });
    if (!evaluated.ready) throw new Error('Complete publication case was not ready');
    let version = await publication.submit({
      context: context(operator),
      expected_version: evaluated.version,
      note: 'Synthetic launch strip is complete.',
      publication_case_id: caseId,
      reason_code: 'PUBLICATION_READY_FOR_REVIEW',
    });
    await expectError(
      () =>
        publication.decide({
          context: context(operator),
          decision: 'APPROVED',
          evidence_reference: 'SYNTH-EVIDENCE-PUBLICATION-SELF',
          expected_version: version,
          note: 'Self approval must fail.',
          publication_case_id: caseId,
          reason_code: 'PUBLICATION_APPROVED',
        }),
      VendorPublicationAuthorizationError,
    );
    version = await publication.decide({
      context: context(reviewer),
      decision: 'APPROVED',
      evidence_reference: 'SYNTH-EVIDENCE-PUBLICATION-OK',
      expected_version: version,
      note: 'Independent synthetic publication review passed.',
      publication_case_id: caseId,
      reason_code: 'PUBLICATION_APPROVED',
    });
    version = await publication.publish({
      context: context(operator),
      expected_version: version,
      note: 'Publish synthetic storefront.',
      publication_case_id: caseId,
      reason_code: 'STOREFRONT_PUBLISHED',
    });
    version = await publication.pause({
      context: context(operator),
      expected_version: version,
      note: 'Pause synthetic storefront.',
      publication_case_id: caseId,
      reason_code: 'STOREFRONT_PAUSED',
    });
    version = await publication.publish({
      context: context(operator),
      expected_version: version,
      note: 'Restore synthetic storefront.',
      publication_case_id: caseId,
      reason_code: 'STOREFRONT_RESTORED',
    });
    version = await publication.unpublish({
      context: context(operator),
      expected_version: version,
      note: 'Unpublish synthetic storefront.',
      publication_case_id: caseId,
      reason_code: 'STOREFRONT_UNPUBLISHED',
    });
    current = await publication.get({ context: context(operator), publication_case_id: caseId });
    const network = await pool.query<{ location_state: string; vendor_state: string }>(
      'SELECT l.lifecycle_state location_state,v.lifecycle_state vendor_state FROM marketplace.vendor_locations l JOIN marketplace.vendors v USING (vendor_id) WHERE l.vendor_location_id=$1',
      [locationId],
    );
    if (
      current.lifecycle_state !== 'UNPUBLISHED' ||
      current.version !== version ||
      network.rows[0]?.location_state !== 'PAUSED' ||
      network.rows[0].vendor_state !== 'SUSPENDED'
    )
      throw new Error('Unpublish did not contain the storefront');
    let immutable = false;
    try {
      await pool.query("UPDATE marketplace.vendor_publication_events SET note='tampered'");
    } catch (error: unknown) {
      immutable =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '55000';
    }
    if (!immutable) throw new Error('Publication evidence was mutable');
  } finally {
    await pool.query(`TRUNCATE ${TABLES}`).catch(() => undefined);
    await pool
      .query('DELETE FROM marketplace.users WHERE user_id=ANY($1::uuid[])', [
        [operator, reviewer, applicant],
      ])
      .catch(() => undefined);
    await publication.close();
    await pool.end();
  }
}
