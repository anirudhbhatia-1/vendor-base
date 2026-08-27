import { createRequestContext, createUuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { AccessConflictError, IdentityAccessService } from '../src/identity-access.js';

async function expectConflict(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof AccessConflictError) return;
    throw error;
  }
  throw new Error('Expected access membership conflict');
}

function expectDenied(
  decision: { readonly allowed: boolean; readonly reason?: string },
  label: string,
) {
  if (decision.allowed || decision.reason !== 'DENY_BY_DEFAULT') {
    throw new Error(`${label} did not deny by default`);
  }
}

function expectAllowed(
  decision: { readonly actor_kind?: string; readonly allowed: boolean; readonly role_key?: string },
  actorKind: string,
  roleKey: string,
  label: string,
) {
  if (!decision.allowed || decision.actor_kind !== actorKind || decision.role_key !== roleKey) {
    throw new Error(`${label} did not return its scoped role evidence`);
  }
}

export async function verifyIdentityAccess(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'identity-access-verifier' });
  const access = new IdentityAccessService({ connection_string: connectionString });
  const now = new Date();
  const grantor = createUuidV7();
  const customer = createUuidV7();
  const vendorStaff = createUuidV7();
  const vendorManager = createUuidV7();
  const partner = createUuidV7();
  const financeMaker = createUuidV7();
  const globalSupport = createUuidV7();
  const expiredCustomer = createUuidV7();
  const revokedCustomer = createUuidV7();
  const unassigned = createUuidV7();
  const secondPartner = createUuidV7();
  const onboardingOperator = createUuidV7();
  const onboardingReviewer = createUuidV7();
  const userIds = [
    grantor,
    customer,
    vendorStaff,
    vendorManager,
    partner,
    financeMaker,
    globalSupport,
    expiredCustomer,
    revokedCustomer,
    unassigned,
    secondPartner,
    onboardingOperator,
    onboardingReviewer,
  ];
  const locationA = createUuidV7();
  const locationB = createUuidV7();
  const vendorId = createUuidV7();
  const zoneA = createUuidV7();
  const zoneB = createUuidV7();
  const assignmentA = createUuidV7();
  const assignmentB = createUuidV7();
  const context = () => createRequestContext();

  try {
    await pool.query(
      `TRUNCATE marketplace.finance_exceptions, marketplace.provider_statement_rows,
        marketplace.payouts, marketplace.settlements, marketplace.ledger_entries,
        marketplace.ledger_transactions, marketplace.refund_events, marketplace.refunds,
        marketplace.payment_events, marketplace.payment_allocations, marketplace.payment_transactions,
        marketplace.return_tasks, marketplace.custody_events,
        marketplace.assignment_events, marketplace.delivery_assignments,
        marketplace.access_membership_events,
        marketplace.admin_membership_scopes,
        marketplace.partner_assignment_memberships,
        marketplace.partner_eligibilities,
        marketplace.staff_memberships,
        marketplace.role_assignments,
        marketplace.catalogue_moderation_events, marketplace.catalogue_moderation_cases,
        marketplace.cart_events, marketplace.cart_lines, marketplace.cart_vendor_groups, marketplace.carts,
    marketplace.customer_discovery_events, marketplace.customer_recent_searches,
    marketplace.customer_shop_requests, marketplace.customer_preferred_store,
    marketplace.customer_favourite_stores,
        marketplace.catalogue_product_substitutions, marketplace.catalogue_product_images,
        marketplace.catalogue_prices, marketplace.catalogue_product_variants,
        marketplace.catalogue_import_rows, marketplace.catalogue_imports, marketplace.catalogue_products,
        marketplace.inventory_events, marketplace.inventory_reservations, marketplace.inventory_items,
        marketplace.vendor_publication_events, marketplace.vendor_publication_cases,
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
        marketplace.vendor_locations,
        marketplace.vendors CASCADE
      `,
    );
    for (const userId of userIds) {
      await pool.query(
        `INSERT INTO marketplace.users (user_id, created_at, updated_at)
         VALUES ($1, $2, $2) ON CONFLICT (user_id) DO NOTHING`,
        [userId, now],
      );
    }
    const requestId = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.vendors
         (vendor_id, business_name, request_id, correlation_id, created_at, updated_at)
       VALUES ($1, 'SYNTH Identity Access Vendor', $2, $2, $3, $3)`,
      [vendorId, requestId, now],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
         (vendor_location_id, vendor_id, location_name, operating_timezone, coordinates,
          category, request_id, correlation_id, created_at, updated_at)
       VALUES
         ($1,$3,'SYNTH Access Location A','Asia/Kolkata',
          ST_SetSRID(ST_MakePoint(75.7873,26.9124),4326)::geography,
          'FRUIT_VEGETABLE',$4,$4,$5,$5),
         ($2,$3,'SYNTH Access Location B','Asia/Kolkata',
          ST_SetSRID(ST_MakePoint(75.80,26.93),4326)::geography,
          'FRUIT_VEGETABLE',$4,$4,$5,$5)`,
      [locationA, locationB, vendorId, requestId, now],
    );

    const catalog = await pool.query<{
      capabilities: string;
      roles: string;
      separation_rules: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM marketplace.capabilities) AS capabilities,
         (SELECT count(*)::text FROM marketplace.roles) AS roles,
         (SELECT count(*)::text FROM marketplace.role_separation_rules) AS separation_rules`,
    );
    // 31 capabilities: the 25 identity/vendor/catalogue/finance grants plus
    // customer.address.manage (0019), customer.discovery.use (0020),
    // customer.cart.manage (0021), and vendor.staff.manage/
    // vendor.settings.manage (0022), and customer.checkout.manage (0023).
    if (
      catalog.rows[0]?.capabilities !== '31' ||
      catalog.rows[0].roles !== '19' ||
      catalog.rows[0].separation_rules !== '5'
    ) {
      throw new Error('Reviewed role and capability catalog is incomplete');
    }

    expectDenied(
      await access.evaluate({
        capability: 'customer.account.read',
        now,
        user_id: unassigned,
      }),
      'Unassigned identity',
    );
    const customerRole = await access.grantCustomer({ context: context(), now, user_id: customer });
    expectAllowed(
      await access.evaluate({ capability: 'customer.account.read', now, user_id: customer }),
      'customer',
      'CUSTOMER',
      'Customer account capability',
    );
    expectDenied(
      await access.evaluate({
        capability: 'vendor.location.read',
        now,
        user_id: customer,
        vendor_location_id: locationA,
      }),
      'Customer cross-role capability',
    );

    await access.grantVendorMembership({
      context: context(),
      granted_by_user_id: grantor,
      now,
      role: 'VENDOR_PICKER',
      user_id: vendorStaff,
      vendor_location_id: locationA,
    });
    expectAllowed(
      await access.evaluate({
        capability: 'vendor.order.manage',
        now,
        user_id: vendorStaff,
        vendor_location_id: locationA,
      }),
      'vendor_staff',
      'VENDOR_PICKER',
      'Correct vendor location',
    );
    expectDenied(
      await access.evaluate({
        capability: 'vendor.order.manage',
        now,
        user_id: vendorStaff,
        vendor_location_id: locationB,
      }),
      'Wrong vendor location',
    );
    expectDenied(
      await access.evaluate({
        capability: 'vendor.catalogue.manage',
        now,
        user_id: vendorStaff,
        vendor_location_id: locationA,
      }),
      'Picker capability escalation',
    );

    await access.grantVendorMembership({
      context: context(),
      granted_by_user_id: grantor,
      now,
      role: 'VENDOR_MANAGER',
      user_id: vendorManager,
      vendor_location_id: locationA,
    });
    expectAllowed(
      await access.evaluate({
        capability: 'vendor.catalogue.manage',
        now,
        user_id: vendorManager,
        vendor_location_id: locationA,
      }),
      'vendor_staff',
      'VENDOR_MANAGER',
      'Vendor manager write at own location',
    );
    expectDenied(
      await access.evaluate({
        capability: 'vendor.catalogue.manage',
        now,
        user_id: vendorManager,
        vendor_location_id: locationB,
      }),
      'Cross-vendor catalogue write',
    );

    await access.setPartnerEligibility({
      context: context(),
      granted_by_user_id: grantor,
      now,
      reason_code: 'ONBOARDING_PENDING',
      state: 'PENDING',
      user_id: partner,
    });
    expectDenied(
      await access.evaluate({ capability: 'partner.eligibility.read', now, user_id: partner }),
      'Pending partner',
    );
    await expectConflict(() =>
      access.activatePartnerAssignment({
        context: context(),
        delivery_assignment_id: assignmentA,
        now,
        user_id: partner,
      }),
    );
    await access.setPartnerEligibility({
      context: context(),
      granted_by_user_id: grantor,
      now: new Date(now.getTime() + 1_000),
      reason_code: 'DOCUMENTS_APPROVED',
      state: 'ELIGIBLE',
      user_id: partner,
    });
    expectAllowed(
      await access.evaluate({
        capability: 'partner.eligibility.read',
        now: new Date(now.getTime() + 2_000),
        user_id: partner,
      }),
      'partner',
      'DELIVERY_PARTNER',
      'Eligible partner self capability',
    );
    expectDenied(
      await access.evaluate({
        capability: 'partner.assignment.act',
        delivery_assignment_id: assignmentA,
        now: new Date(now.getTime() + 2_000),
        user_id: partner,
      }),
      'Eligible partner without active assignment',
    );
    await access.activatePartnerAssignment({
      context: context(),
      delivery_assignment_id: assignmentA,
      now: new Date(now.getTime() + 3_000),
      user_id: partner,
    });
    expectAllowed(
      await access.evaluate({
        capability: 'partner.assignment.act',
        delivery_assignment_id: assignmentA,
        now: new Date(now.getTime() + 4_000),
        user_id: partner,
      }),
      'partner',
      'DELIVERY_PARTNER',
      'Current assignment capability',
    );
    expectDenied(
      await access.evaluate({
        capability: 'partner.assignment.act',
        delivery_assignment_id: assignmentB,
        now: new Date(now.getTime() + 4_000),
        user_id: partner,
      }),
      'Wrong partner assignment',
    );
    await expectConflict(() =>
      access.activatePartnerAssignment({
        context: context(),
        delivery_assignment_id: assignmentB,
        now: new Date(now.getTime() + 5_000),
        user_id: partner,
      }),
    );
    await access.setPartnerEligibility({
      context: context(),
      granted_by_user_id: grantor,
      now: new Date(now.getTime() + 5_000),
      reason_code: 'DOCUMENTS_APPROVED',
      state: 'ELIGIBLE',
      user_id: secondPartner,
    });
    await expectConflict(() =>
      access.activatePartnerAssignment({
        context: context(),
        delivery_assignment_id: assignmentA,
        now: new Date(now.getTime() + 6_000),
        user_id: secondPartner,
      }),
    );
    await access.endPartnerAssignment({
      context: context(),
      delivery_assignment_id: assignmentA,
      now: new Date(now.getTime() + 7_000),
      reason_code: 'DELIVERY_COMPLETED',
      user_id: partner,
    });
    expectDenied(
      await access.evaluate({
        capability: 'partner.assignment.act',
        delivery_assignment_id: assignmentA,
        now: new Date(now.getTime() + 8_000),
        user_id: partner,
      }),
      'Ended partner assignment',
    );

    await access.grantAdminMembership({
      context: context(),
      granted_by_user_id: grantor,
      now,
      role: 'FINANCE_OPERATOR',
      scope: { kind: 'ZONE', scope_id: zoneA },
      user_id: financeMaker,
    });
    expectAllowed(
      await access.evaluate({
        admin_scope: { kind: 'ZONE', scope_id: zoneA },
        capability: 'admin.finance.refund_propose',
        now,
        user_id: financeMaker,
      }),
      'admin',
      'FINANCE_OPERATOR',
      'Matching admin scope',
    );
    expectDenied(
      await access.evaluate({
        admin_scope: { kind: 'ZONE', scope_id: zoneB },
        capability: 'admin.finance.refund_propose',
        now,
        user_id: financeMaker,
      }),
      'Wrong admin scope',
    );
    expectDenied(
      await access.evaluate({
        admin_scope: { kind: 'ZONE', scope_id: zoneA },
        capability: 'admin.finance.refund_approve',
        now,
        user_id: financeMaker,
      }),
      'Wrong admin role for approval',
    );
    await expectConflict(() =>
      access.grantAdminMembership({
        context: context(),
        granted_by_user_id: grantor,
        now,
        role: 'FINANCE_APPROVER',
        scope: { kind: 'GLOBAL' },
        user_id: financeMaker,
      }),
    );
    await expectConflict(() =>
      access.grantAdminMembership({
        context: context(),
        granted_by_user_id: globalSupport,
        now,
        role: 'SUPPORT_AGENT',
        scope: { kind: 'GLOBAL' },
        user_id: globalSupport,
      }),
    );
    await access.grantAdminMembership({
      context: context(),
      granted_by_user_id: grantor,
      now,
      role: 'SUPPORT_AGENT',
      scope: { kind: 'GLOBAL' },
      user_id: globalSupport,
    });
    expectAllowed(
      await access.evaluate({
        admin_scope: { kind: 'VENDOR_LOCATION', scope_id: locationB },
        capability: 'admin.support.case_manage',
        now,
        user_id: globalSupport,
      }),
      'admin',
      'SUPPORT_AGENT',
      'Global admin scope',
    );

    await access.grantAdminMembership({
      context: context(),
      granted_by_user_id: grantor,
      now,
      role: 'VENDOR_ONBOARDING_OPERATOR',
      scope: { kind: 'GLOBAL' },
      user_id: onboardingOperator,
    });
    expectAllowed(
      await access.evaluate({
        admin_scope: { kind: 'GLOBAL' },
        capability: 'admin.vendor_onboarding.manage',
        now,
        user_id: onboardingOperator,
      }),
      'admin',
      'VENDOR_ONBOARDING_OPERATOR',
      'Vendor onboarding operator',
    );
    expectDenied(
      await access.evaluate({
        admin_scope: { kind: 'GLOBAL' },
        capability: 'admin.vendor_onboarding.review',
        now,
        user_id: onboardingOperator,
      }),
      'Onboarding operator attempting review',
    );
    await expectConflict(() =>
      access.grantAdminMembership({
        context: context(),
        granted_by_user_id: grantor,
        now,
        role: 'VENDOR_ONBOARDING_REVIEWER',
        scope: { kind: 'GLOBAL' },
        user_id: onboardingOperator,
      }),
    );
    await access.grantAdminMembership({
      context: context(),
      granted_by_user_id: grantor,
      now,
      role: 'VENDOR_ONBOARDING_REVIEWER',
      scope: { kind: 'GLOBAL' },
      user_id: onboardingReviewer,
    });
    expectAllowed(
      await access.evaluate({
        admin_scope: { kind: 'GLOBAL' },
        capability: 'admin.vendor_onboarding.review',
        now,
        user_id: onboardingReviewer,
      }),
      'admin',
      'VENDOR_ONBOARDING_REVIEWER',
      'Vendor onboarding reviewer',
    );

    await access.grantCustomer({
      context: context(),
      now: new Date(now.getTime() - 10_000),
      user_id: expiredCustomer,
    });
    await pool.query(
      `UPDATE marketplace.role_assignments SET valid_until = $2
        WHERE user_id = $1 AND role_key = 'CUSTOMER'`,
      [expiredCustomer, new Date(now.getTime() - 1_000)],
    );
    expectDenied(
      await access.evaluate({ capability: 'customer.account.read', now, user_id: expiredCustomer }),
      'Expired role',
    );
    const revokeAssignment = await access.grantCustomer({
      context: context(),
      now,
      user_id: revokedCustomer,
    });
    await access.revokeRole({
      context: context(),
      now: new Date(now.getTime() + 1_000),
      reason_code: 'ACCESS_REMOVED',
      role_assignment_id: revokeAssignment,
      user_id: revokedCustomer,
    });
    expectDenied(
      await access.evaluate({
        capability: 'customer.account.read',
        now: new Date(now.getTime() + 2_000),
        user_id: revokedCustomer,
      }),
      'Revoked role',
    );

    let subtypeRejected = false;
    try {
      await pool.query(
        `INSERT INTO marketplace.staff_memberships
           (staff_membership_id, role_assignment_id, user_id, vendor_location_id)
         VALUES ($1, $2, $3, $4)`,
        [createUuidV7(), customerRole, customer, locationA],
      );
    } catch (error: unknown) {
      subtypeRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '23514';
    }
    if (!subtypeRejected) throw new Error('Role assignment accepted the wrong membership subtype');

    const event = await pool.query<{ event_id: string }>(
      `SELECT event_id FROM marketplace.access_membership_events ORDER BY occurred_at LIMIT 1`,
    );
    let appendOnlyRejected = false;
    try {
      await pool.query(
        `UPDATE marketplace.access_membership_events SET reason_code = 'TAMPERED'
          WHERE event_id = $1`,
        [event.rows[0]?.event_id],
      );
    } catch (error: unknown) {
      appendOnlyRejected =
        typeof error === 'object' && error !== null && 'code' in error && error.code === '55000';
    }
    if (!appendOnlyRejected) throw new Error('Access membership history accepted mutation');

    const evidence = await pool.query<{ events: string; grants: string }>(
      `SELECT
         (SELECT count(*)::text FROM marketplace.access_membership_events) AS events,
         (SELECT count(*)::text FROM marketplace.role_assignments) AS grants`,
    );
    if (evidence.rows[0]?.events !== '17' || evidence.rows[0].grants !== '11') {
      throw new Error('Access membership evidence includes missing or rolled-back changes');
    }
  } finally {
    await access.close();
    await pool.end();
  }
}
