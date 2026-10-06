import { createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  AdminOnboardingActiveObligationsError,
  AdminOnboardingConflictError,
  AdminOnboardingInputError,
  AdminOnboardingService,
} from '../src/admin-onboarding.js';
import { IdentityPasswordService } from '../src/identity-password.js';
import { adminContext, check, rejects } from './verify-support.js';

const HASH_KEY = 'synthetic-admin-onboarding-hash-key-material-0123456789';
const PASSWORD_HASH_KEY = 'synthetic-admin-onboarding-password-key-material-0123456789';

/**
 * Admin-provisioned vendors and partners: the account, the role and the
 * access event land together, and suspension respects the store's open
 * obligations. The role grant runs through the shared `grantRoleAssignment`,
 * so this is also where the `ROLE_GRANTED` event is proven for the admin path.
 */
export async function verifyAdminOnboarding(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const passwords = new IdentityPasswordService({
    connection_string: connectionString,
    hash_key: PASSWORD_HASH_KEY,
  });
  const service = new AdminOnboardingService({
    connection_string: connectionString,
    hash_key: HASH_KEY,
    password_service: passwords,
  });
  const now = new Date();
  const adminId = createUuidV7();
  const suffix = createUuidV7().slice(-12).toUpperCase();
  const vendorPhone = `SYNTH-PHONE-ADMIN-VENDOR-${suffix}`;
  const partnerPhone = `SYNTH-PHONE-ADMIN-PARTNER-${suffix}`;
  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id, state, data_classification) VALUES ($1,'ACTIVE','RESTRICTED')",
      [adminId],
    );

    // --- Vendor provisioning -------------------------------------------------
    await rejects(
      () =>
        service.provisionVendor({
          context: adminContext(adminId),
          actor_user_id: adminId,
          phone_identifier: 'not-a-phone',
          business_name: 'SYNTH Bad Phone Store',
          location_name: 'SYNTH Bad Phone Location',
          latitude: 26.9,
          longitude: 75.8,
          now,
        }),
      AdminOnboardingInputError,
      'Vendor provisioning accepted an invalid phone identifier',
    );
    await rejects(
      () =>
        service.provisionVendor({
          context: adminContext(adminId),
          actor_user_id: adminId,
          phone_identifier: vendorPhone,
          business_name: 'SYNTH Bad Coordinate Store',
          location_name: 'SYNTH Bad Coordinate Location',
          latitude: 120,
          longitude: 75.8,
          now,
        }),
      AdminOnboardingInputError,
      'Vendor provisioning accepted an out-of-range latitude',
    );
    // A category the network does not take is refused by name, not by the table.
    await rejects(
      () =>
        service.provisionVendor({
          context: adminContext(adminId),
          actor_user_id: adminId,
          phone_identifier: vendorPhone,
          business_name: 'SYNTH All Mart',
          location_name: 'SYNTH All Mart Location',
          latitude: 26.9,
          longitude: 75.8,
          category: 'all mart',
          now,
        }),
      AdminOnboardingInputError,
      'Vendor provisioning accepted a category the network does not take',
    );

    const vendor = await service.provisionVendor({
      context: adminContext(adminId),
      actor_user_id: adminId,
      phone_identifier: vendorPhone,
      business_name: `SYNTH Admin Provisioned Store ${suffix}`,
      location_name: 'SYNTH Admin Provisioned Location',
      latitude: 26.9124,
      longitude: 75.7873,
      password: 'synthetic-vendor-password-001',
      now,
    });
    check(vendor.password_set === true, 'Vendor password was not recorded as set');

    const vendorRow = await pool.query<{ lifecycle_state: string; version: number }>(
      'SELECT lifecycle_state, version FROM marketplace.vendors WHERE vendor_id=$1',
      [vendor.vendor_id],
    );
    check(vendorRow.rows[0]?.lifecycle_state === 'ACTIVE', 'Provisioned vendor is not ACTIVE');
    check(vendorRow.rows[0]?.version === 1, 'Provisioned vendor version is not 1');

    const ownerRole = await pool.query<{ role_key: string; state: string }>(
      'SELECT role_key, state FROM marketplace.role_assignments WHERE role_assignment_id=$1',
      [vendor.role_assignment_id],
    );
    check(ownerRole.rows[0]?.role_key === 'VENDOR_OWNER', 'Vendor owner role was not granted');
    check(ownerRole.rows[0]?.state === 'ACTIVE', 'Vendor owner role is not ACTIVE');

    const grantEvent = await pool.query(
      `SELECT 1 FROM marketplace.access_membership_events
        WHERE role_assignment_id=$1 AND event_type='ROLE_GRANTED'`,
      [vendor.role_assignment_id],
    );
    check(grantEvent.rowCount === 1, 'Vendor owner grant did not write a ROLE_GRANTED event');

    const location = await pool.query<{ lifecycle_state: string }>(
      'SELECT lifecycle_state FROM marketplace.vendor_locations WHERE vendor_location_id=$1',
      [vendor.vendor_location_id],
    );
    check(location.rows[0]?.lifecycle_state === 'ACTIVE', 'Provisioned location is not ACTIVE');

    // The same phone cannot own a second vendor.
    await rejects(
      () =>
        service.provisionVendor({
          context: adminContext(adminId),
          actor_user_id: adminId,
          phone_identifier: vendorPhone,
          business_name: 'SYNTH Duplicate Store',
          location_name: 'SYNTH Duplicate Location',
          latitude: 26.9,
          longitude: 75.8,
          now,
        }),
      AdminOnboardingConflictError,
      'A second vendor was provisioned for the same phone',
    );

    // --- Vendor lifecycle ----------------------------------------------------
    await rejects(
      () =>
        service.suspendVendor({
          context: adminContext(adminId),
          actor_user_id: adminId,
          vendor_id: vendor.vendor_id,
          expected_version: 99,
          reason_code: 'ADMIN_SUSPENSION',
          now,
        }),
      AdminOnboardingConflictError,
      'Vendor suspension accepted a stale version',
    );
    await rejects(
      () =>
        service.suspendVendor({
          context: adminContext(adminId),
          actor_user_id: adminId,
          vendor_id: vendor.vendor_id,
          expected_version: 1,
          reason_code: 'bad reason',
          now,
        }),
      AdminOnboardingInputError,
      'Vendor suspension accepted an invalid reason code',
    );
    await rejects(
      () =>
        service.reinstateVendor({
          context: adminContext(adminId),
          actor_user_id: adminId,
          vendor_id: vendor.vendor_id,
          expected_version: 1,
          reason_code: 'ADMIN_REINSTATEMENT',
          now,
        }),
      AdminOnboardingConflictError,
      'An active vendor was reinstated',
    );

    const suspended = await service.suspendVendor({
      context: adminContext(adminId),
      actor_user_id: adminId,
      vendor_id: vendor.vendor_id,
      expected_version: 1,
      reason_code: 'ADMIN_SUSPENSION',
      now,
    });
    check(suspended.lifecycle_state === 'SUSPENDED', 'Vendor was not suspended');
    check(suspended.version === 2, 'Vendor suspension did not advance the version');
    const paused = await pool.query<{ lifecycle_state: string }>(
      'SELECT lifecycle_state FROM marketplace.vendor_locations WHERE vendor_location_id=$1',
      [vendor.vendor_location_id],
    );
    check(paused.rows[0]?.lifecycle_state === 'PAUSED', 'Suspension did not pause the location');

    // Suspending again at the current version is a no-op, not a conflict.
    const replayed = await service.suspendVendor({
      context: adminContext(adminId),
      actor_user_id: adminId,
      vendor_id: vendor.vendor_id,
      expected_version: 2,
      reason_code: 'ADMIN_SUSPENSION',
      now,
    });
    check(replayed.version === 2, 'Replayed suspension advanced the version');

    const reinstated = await service.reinstateVendor({
      context: adminContext(adminId),
      actor_user_id: adminId,
      vendor_id: vendor.vendor_id,
      expected_version: 2,
      reason_code: 'ADMIN_REINSTATEMENT',
      now,
    });
    check(reinstated.lifecycle_state === 'ACTIVE', 'Vendor was not reinstated');
    check(reinstated.version === 3, 'Vendor reinstatement did not advance the version');
    const resumed = await pool.query<{ lifecycle_state: string }>(
      'SELECT lifecycle_state FROM marketplace.vendor_locations WHERE vendor_location_id=$1',
      [vendor.vendor_location_id],
    );
    check(
      resumed.rows[0]?.lifecycle_state === 'ACTIVE',
      'Reinstatement did not resume the paused location',
    );

    // An open reservation is an obligation; the store cannot be suspended around it.
    const itemId = createUuidV7();
    const reservationId = createUuidV7();
    const ids = adminContext(adminId);
    await pool.query(
      `INSERT INTO marketplace.inventory_items
         (inventory_item_id, vendor_location_id, product_reference, display_name, quantity_basis,
          availability_state, exact_available_quantity, low_stock_threshold, last_confirmed_at,
          request_id, correlation_id)
       VALUES ($1,$2,$3,'SYNTH Admin Obligation Item','COUNTED','AVAILABLE',5,1,$4,$5,$6)`,
      [
        itemId,
        vendor.vendor_location_id,
        `SYNTH-PROD-ADMIN-${suffix}`,
        now,
        ids.request_id,
        ids.correlation_id,
      ],
    );
    await pool.query(
      `INSERT INTO marketplace.inventory_reservations
         (reservation_id, inventory_item_id, vendor_location_id, source_reference,
          reservation_state, quantity, counted_stock_applied, expires_at, request_id, correlation_id)
       VALUES ($1,$2,$3,$4,'SOFT_HELD',1,false,$5,$6,$7)`,
      [
        reservationId,
        itemId,
        vendor.vendor_location_id,
        `SYNTH-CHECKOUT-ADMIN-${suffix}`,
        new Date(now.getTime() + 600_000),
        ids.request_id,
        ids.correlation_id,
      ],
    );
    try {
      await rejects(
        () =>
          service.suspendVendor({
            context: adminContext(adminId),
            actor_user_id: adminId,
            vendor_id: vendor.vendor_id,
            expected_version: 3,
            reason_code: 'ADMIN_SUSPENSION',
            now,
          }),
        AdminOnboardingActiveObligationsError,
        'A vendor with an open reservation was suspended',
      );
    } finally {
      await pool.query(
        `UPDATE marketplace.inventory_reservations SET reservation_state='RELEASED', version=version+1
          WHERE reservation_id=$1`,
        [reservationId],
      );
    }

    // --- Partner provisioning and lifecycle ----------------------------------
    const partner = await service.provisionPartner({
      context: adminContext(adminId),
      actor_user_id: adminId,
      phone_identifier: partnerPhone,
      display_name: `SYNTH Admin Provisioned Partner ${suffix}`,
      now,
    });
    check(partner.password_set === false, 'Partner without a password reported one set');
    const partnerRole = await pool.query<{ role_key: string }>(
      'SELECT role_key FROM marketplace.role_assignments WHERE role_assignment_id=$1',
      [partner.role_assignment_id],
    );
    check(
      partnerRole.rows[0]?.role_key === 'DELIVERY_PARTNER',
      'Delivery partner role was not granted',
    );
    const partnerGrant = await pool.query(
      `SELECT 1 FROM marketplace.access_membership_events
        WHERE role_assignment_id=$1 AND event_type='ROLE_GRANTED'`,
      [partner.role_assignment_id],
    );
    check(partnerGrant.rowCount === 1, 'Partner grant did not write a ROLE_GRANTED event');
    const eligibility = await pool.query<{ state: string; version: number }>(
      'SELECT state, version FROM marketplace.partner_eligibilities WHERE user_id=$1',
      [partner.user_id],
    );
    check(eligibility.rows[0]?.state === 'ELIGIBLE', 'Provisioned partner is not ELIGIBLE');
    const eligibilityVersion = eligibility.rows[0]?.version ?? 0;
    check(eligibilityVersion >= 1, 'Partner eligibility has no version');

    await rejects(
      () =>
        service.provisionPartner({
          context: adminContext(adminId),
          actor_user_id: adminId,
          phone_identifier: partnerPhone,
          display_name: 'SYNTH Duplicate Partner',
          now,
        }),
      AdminOnboardingConflictError,
      'The same phone was provisioned as a partner twice',
    );

    await rejects(
      () =>
        service.suspendPartner({
          context: adminContext(adminId),
          actor_user_id: adminId,
          user_id: partner.user_id,
          expected_version: eligibilityVersion + 1,
          reason_code: 'ADMIN_SUSPENSION',
          now,
        }),
      AdminOnboardingConflictError,
      'Partner suspension accepted a stale version',
    );
    const partnerSuspended = await service.suspendPartner({
      context: adminContext(adminId),
      actor_user_id: adminId,
      user_id: partner.user_id,
      expected_version: eligibilityVersion,
      reason_code: 'ADMIN_SUSPENSION',
      now,
    });
    check(partnerSuspended.lifecycle_state === 'SUSPENDED', 'Partner was not suspended');
    check(
      partnerSuspended.version === eligibilityVersion + 1,
      'Partner suspension did not advance the version',
    );
    await rejects(
      () =>
        service.suspendPartner({
          context: adminContext(adminId),
          actor_user_id: adminId,
          user_id: createUuidV7(),
          expected_version: 1,
          reason_code: 'ADMIN_SUSPENSION',
          now,
        }),
      AdminOnboardingInputError,
      'Suspending an unknown partner did not fail',
    );
    const partnerReinstated = await service.reinstatePartner({
      context: adminContext(adminId),
      actor_user_id: adminId,
      user_id: partner.user_id,
      expected_version: partnerSuspended.version,
      reason_code: 'ADMIN_REINSTATEMENT',
      now,
    });
    check(partnerReinstated.lifecycle_state === 'ELIGIBLE', 'Partner was not reinstated');
    check(
      partnerReinstated.version === partnerSuspended.version + 1,
      'Partner reinstatement did not advance the version',
    );
    await rejects(
      () =>
        service.reinstatePartner({
          context: adminContext(adminId),
          actor_user_id: adminId,
          user_id: partner.user_id,
          expected_version: partnerReinstated.version,
          reason_code: 'ADMIN_REINSTATEMENT',
          now,
        }),
      AdminOnboardingConflictError,
      'An eligible partner was reinstated',
    );

    // --- Supabase-identity provisioning --------------------------------------
    const supabaseVendor = await service.provisionVendorFromSupabase({
      context: adminContext(adminId),
      actor_user_id: adminId,
      supabase_user_id: createUuidV7(),
      email: `synth-vendor-${suffix.toLowerCase()}@example.test`,
      business_name: `SYNTH Supabase Store ${suffix}`,
      location_name: 'SYNTH Supabase Location',
      latitude: 26.92,
      longitude: 75.79,
      now,
    });
    const supabaseOwner = await pool.query<{ role_key: string }>(
      'SELECT role_key FROM marketplace.role_assignments WHERE role_assignment_id=$1',
      [supabaseVendor.role_assignment_id],
    );
    check(
      supabaseOwner.rows[0]?.role_key === 'VENDOR_OWNER',
      'Supabase vendor owner role was not granted',
    );
    const supabasePartner = await service.provisionPartnerFromSupabase({
      context: adminContext(adminId),
      actor_user_id: adminId,
      supabase_user_id: createUuidV7(),
      email: `synth-partner-${suffix.toLowerCase()}@example.test`,
      display_name: `SYNTH Supabase Partner ${suffix}`,
      now,
    });
    const supabaseEligibility = await pool.query<{ state: string }>(
      'SELECT state FROM marketplace.partner_eligibilities WHERE user_id=$1',
      [supabasePartner.user_id],
    );
    check(
      supabaseEligibility.rows[0]?.state === 'ELIGIBLE',
      'Supabase partner was not made eligible',
    );
  } finally {
    await service.close();
    await passwords.close();
    await pool.end();
  }
}
