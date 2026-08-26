import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';

/**
 * Builds one published, discoverable vendor location with an active service
 * zone, so Phase 6 verifiers can test discovery, search, storefront, and cart
 * behaviour without re-deriving the full vendor onboarding/publication state
 * machine each time. Returns the ids the caller will need.
 */
export async function createDiscoverableStoreFixture(
  pool: Pool,
  input: {
    readonly location_name: string;
    readonly latitude: number;
    readonly longitude: number;
    /** MULTIPOLYGON WKT covering the given point unless `zone_wkt` is supplied. */
    readonly zone_wkt?: string;
    readonly fulfilment_modes?: readonly (
      'CUSTOMER_PICKUP' | 'PLATFORM_DELIVERY' | 'VENDOR_DELIVERY'
    )[];
  },
): Promise<{
  readonly vendorId: UuidV7;
  readonly locationId: UuidV7;
  readonly ownerUserId: UuidV7;
  readonly approverUserId: UuidV7;
}> {
  const vendorId = createUuidV7();
  const locationId = createUuidV7();
  const ownerUserId = createUuidV7();
  const approverUserId = createUuidV7();
  const onboardingCaseId = createUuidV7();
  const publicationCaseId = createUuidV7();
  const requestId = createUuidV7();
  const now = new Date();

  for (const userId of [ownerUserId, approverUserId]) {
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [userId],
    );
  }
  await pool.query(
    `INSERT INTO marketplace.vendors
       (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id)
     VALUES ($1,'SYNTH Discoverable Vendor','Synthetic discoverable vendor','ACTIVE',$2,$2)`,
    [vendorId, requestId],
  );
  await pool.query(
    `INSERT INTO marketplace.vendor_locations
       (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
        coordinates,category,lifecycle_state,minimum_order_minor,request_id,correlation_id)
     VALUES ($1,$2,$3,'Synthetic discoverable location','Asia/Kolkata',
       ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,
       'FRUIT_VEGETABLE','ACTIVE',5000,$6,$6)`,
    [locationId, vendorId, input.location_name, input.longitude, input.latitude, requestId],
  );
  const zoneWkt =
    input.zone_wkt ??
    `MULTIPOLYGON(((${input.longitude - 0.2} ${input.latitude - 0.2}, ${input.longitude + 0.2} ${input.latitude - 0.2}, ${input.longitude + 0.2} ${input.latitude + 0.2}, ${input.longitude - 0.2} ${input.latitude + 0.2}, ${input.longitude - 0.2} ${input.latitude - 0.2})))`;
  await pool.query(
    `INSERT INTO marketplace.vendor_service_zones
       (service_zone_id,vendor_location_id,zone_name,operating_timezone,boundary,
        lifecycle_state,request_id,correlation_id)
     VALUES ($1,$2,'SYNTH Discoverable Zone','Asia/Kolkata',
       ST_SetSRID(ST_GeomFromText($3),4326)::geography,'ACTIVE',$4,$4)`,
    [createUuidV7(), locationId, zoneWkt, requestId],
  );
  for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
    await pool.query(
      `INSERT INTO marketplace.vendor_location_operating_hours
         (operating_hour_id, vendor_location_id, weekday, opens_at, closes_at)
       VALUES ($1,$2,$3,'00:00:00','23:59:00')`,
      [createUuidV7(), locationId, weekday],
    );
  }
  for (const mode of input.fulfilment_modes ?? ['PLATFORM_DELIVERY']) {
    await pool.query(
      `INSERT INTO marketplace.vendor_location_fulfilment_modes
         (vendor_location_id, fulfilment_mode, approved_by_user_id, approved_at, request_id, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$5)`,
      [locationId, mode, approverUserId, now, requestId],
    );
  }
  await pool.query(
    `INSERT INTO marketplace.vendor_onboarding_cases
       (onboarding_case_id, entry_kind, lifecycle_state, vendor_id, vendor_location_id,
        current_reason_code, request_id, correlation_id, approved_at)
     VALUES ($1,'LEAD','APPROVED',$2,$3,'SYNTH_FIXTURE_APPROVED',$4,$4,$5)`,
    [onboardingCaseId, vendorId, locationId, requestId, now],
  );
  await pool.query(
    `INSERT INTO marketplace.vendor_publication_cases
       (publication_case_id, onboarding_case_id, vendor_id, vendor_location_id, lifecycle_state,
        proposed_by_user_id, approved_by_user_id, current_reason_code, current_note,
        request_id, correlation_id, approved_at, published_at)
     VALUES ($1,$2,$3,$4,'PUBLISHED',$5,$6,'SYNTH_FIXTURE_PUBLISHED','Synthetic fixture publication',
       $7,$7,$8,$8)`,
    [
      publicationCaseId,
      onboardingCaseId,
      vendorId,
      locationId,
      ownerUserId,
      approverUserId,
      requestId,
      now,
    ],
  );

  return { vendorId, locationId, ownerUserId, approverUserId };
}
