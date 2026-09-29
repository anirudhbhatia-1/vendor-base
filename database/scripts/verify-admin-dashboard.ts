import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  AdminControlAuthorizationError,
  AdminControlPlaneService,
} from '../src/admin-control-plane.js';
import { adminContext, check, partnerContext, rejects } from './verify-support.js';

type Item = {
  readonly rank: number;
  readonly kind: string;
  readonly tier: string;
  readonly severity: string;
  readonly object_kind: string;
  readonly object_id: string;
  readonly owner: string;
  readonly next_action: string;
  readonly sla_due_at: string;
  readonly overdue: boolean;
  readonly escalation_due: boolean;
  readonly custody_risk: string;
  readonly risk_minor: number;
  readonly age_seconds: number;
};

/**
 * 11.1 -- each operator sees the work their role acts on, ranked the same way
 * for everyone, and every look is on the record.
 *
 * A partner reports a threat with goods in hand; the ledger holds money paid
 * twice and a large amount mismatch; an incident pause is in force. A delivery
 * operator, a finance operator, a support agent, an incident commander, an
 * admin whose role holds no queue, and a finance operator scoped to one zone
 * each open the dashboard.
 *
 * July 2027, and assertions only on its own rows: earlier modules leave
 * queues populated, as a real desk would.
 */
export async function verifyAdminDashboard(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'admin-dashboard-verifier' });
  const control = new AdminControlPlaneService({ connection_string: connectionString });
  const now = new Date('2027-07-01T10:00:00.000Z');
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  const request = createUuidV7({ now_ms: now.getTime() });
  const people = {
    delivery: createUuidV7({ now_ms: now.getTime() + 1 }),
    finance: createUuidV7({ now_ms: now.getTime() + 2 }),
    support: createUuidV7({ now_ms: now.getTime() + 3 }),
    commander: createUuidV7({ now_ms: now.getTime() + 4 }),
    configurer: createUuidV7({ now_ms: now.getTime() + 5 }),
    zonal: createUuidV7({ now_ms: now.getTime() + 6 }),
    rider: createUuidV7({ now_ms: now.getTime() + 7 }),
  };
  const vendor = createUuidV7({ now_ms: now.getTime() + 8 });
  const location = createUuidV7({ now_ms: now.getTime() + 9 });
  const tag = String(request).replaceAll('-', '').slice(-10).toUpperCase();

  const grant = async (user: UuidV7, role: string, scope: 'GLOBAL' | 'ZONE' = 'GLOBAL') => {
    const assignment = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, granted_by_user_id,
          request_id, correlation_id, retention_review_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$5,$6,$4,$4)`,
      [
        assignment,
        user,
        role,
        minutesAgo(600),
        request,
        new Date(now.getTime() + 365 * 86_400_000),
      ],
    );
    await pool.query(
      `INSERT INTO marketplace.admin_membership_scopes
         (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        createUuidV7(),
        assignment,
        user,
        scope,
        scope === 'GLOBAL' ? null : createUuidV7(),
        minutesAgo(600),
      ],
    );
  };
  const view = async (user: UuidV7) => {
    const context = adminContext(user);
    const result = await control.dashboard({ context, now });
    return { context, result, items: result.items as readonly Item[] };
  };
  const find = (items: readonly Item[], id: string) => items.find((item) => item.object_id === id);

  try {
    await pool.query('INSERT INTO marketplace.users (user_id) SELECT unnest($1::uuid[])', [
      Object.values(people),
    ]);
    await grant(people.delivery, 'DELIVERY_OPERATOR');
    await grant(people.finance, 'FINANCE_OPERATOR');
    await grant(people.support, 'SUPPORT_AGENT');
    await grant(people.commander, 'INCIDENT_COMMANDER');
    await grant(people.configurer, 'CONFIG_OPERATOR');
    await grant(people.zonal, 'FINANCE_OPERATOR', 'ZONE');
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,'SYNTH Dashboard Vendor','Synthetic dashboard vendor','ACTIVE',$2,$2,$3,$3)`,
      [vendor, request, now],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,'SYNTH Dashboard Location','Synthetic dashboard location','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3,$4,$4)`,
      [location, vendor, request, now],
    );

    // A partner with the goods reports a threat, ten minutes ago.
    const assignment = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id,source_order_reference,vendor_location_id,partner_user_id,
         assignment_state,custody_state,package_count,approximate_pickup_area,
         approximate_drop_area,request_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'PICKED_UP','IN_CUSTODY',1,'SYNTH Dashboard Store','SYNTH Dashboard Drop',$5,$5,$6,$6)`,
      [assignment, `SYNTH-ORDER-DASHBOARD-${tag}`, location, people.rider, request, minutesAgo(30)],
    );
    const threat = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.partner_exception_events
        (partner_exception_event_id,delivery_assignment_id,partner_user_id,exception_kind,
         resolution_state,reason_code,request_id,correlation_id,occurred_at)
       VALUES ($1,$2,$3,'THREAT','OPEN','PARTNER_REPORTED_THREAT',$4,$4,$5)`,
      [threat, assignment, people.rider, request, minutesAgo(10)],
    );
    // The ledger: money paid twice (critical), and a large mismatch (high).
    const paidTwice = createUuidV7();
    const mismatch = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.finance_exceptions
        (finance_exception_id,exception_kind,operation_reference,amount_at_risk_minor,
         owner_reference,next_action_code,created_at,updated_at)
       VALUES ($1,'PAYOUT_DUPLICATE_RISK',$3,1000,'FINANCE_OPERATIONS','RECOVER_DUPLICATE_PARTNER_PAYOUT',$5,$5),
              ($2,'AMOUNT_MISMATCH',$4,999999,'FINANCE_RECONCILIATION','RESOLVE_AMOUNT_DIFFERENCE',$6,$6)`,
      [
        paidTwice,
        mismatch,
        `SYNTH-PAYOUT-DASH-${tag}`,
        `SYNTH-PAY-DASH-${tag}`,
        minutesAgo(2),
        minutesAgo(600),
      ],
    );
    // An incident pause in force, due for review in an hour.
    const pause = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.incident_controls
        (incident_control_id,control_key,scope_kind,scope_reference,reason_code,owner_user_id,
         proposed_by,activated_at,expires_at,review_at,obligations,request_id,correlation_id,
         created_at,updated_at)
       VALUES ($1,'VENDOR_PAUSE','VENDOR_LOCATION',$2,'PROVIDER_OUTAGE',$3,$3,$7,$4,$5,'[]',$6,$6,$7,$7)`,
      [
        pause,
        // A shop that does not exist, so the pause stops nothing in later walks.
        createUuidV7(),
        people.commander,
        new Date(now.getTime() + 86_400_000),
        new Date(now.getTime() + 3_600_000),
        request,
        minutesAgo(5),
      ],
    );

    // Every admin role can open it now.
    const openers = await pool.query<{ role_key: string }>(
      `SELECT role.role_key FROM marketplace.roles role
        WHERE role.actor_kind='ADMIN' AND NOT EXISTS (
          SELECT 1 FROM marketplace.role_capabilities granted
           WHERE granted.role_key=role.role_key AND granted.capability_key='admin.control.dashboard_read')`,
    );
    check(
      openers.rows.length === 0,
      `Admin roles cannot open the dashboard: ${JSON.stringify(openers.rows)}`,
    );

    // The delivery operator: the threat, critical, goods in custody, overdue.
    const delivery = await view(people.delivery);
    const threatForDelivery = find(delivery.items, threat);
    check(
      threatForDelivery?.tier === 'SAFETY_SECURITY' &&
        threatForDelivery.severity === 'CRITICAL' &&
        threatForDelivery.custody_risk === 'GOODS_IN_CUSTODY' &&
        threatForDelivery.overdue &&
        threatForDelivery.sla_due_at ===
          new Date(minutesAgo(10).getTime() + 5 * 60_000).toISOString() &&
        threatForDelivery.age_seconds === 600 &&
        threatForDelivery.owner === 'DELIVERY_OPERATIONS' &&
        threatForDelivery.next_action === 'CONTACT_PARTNER_AND_DIRECT',
      `A partner reporting a threat with goods in hand was not critical, owned and overdue (${JSON.stringify(threatForDelivery)})`,
    );
    check(
      !find(delivery.items, paidTwice) &&
        delivery.items.every((item) => item.kind !== 'FINANCE' && item.kind !== 'SUPPORT'),
      'A delivery operator saw finance or support work',
    );

    // The finance operator: money paid twice is critical and first of theirs.
    const finance = await view(people.finance);
    const doubled = find(finance.items, paidTwice);
    const large = find(finance.items, mismatch);
    check(
      doubled?.severity === 'CRITICAL' &&
        doubled.tier === 'LEDGER' &&
        large?.severity === 'HIGH' &&
        doubled.rank < large.rank &&
        !find(finance.items, threat) &&
        finance.items.every((item) => item.tier !== 'SAFETY_SECURITY'),
      `The ledger was not ranked by severity, or a finance operator saw safety work (${JSON.stringify({ doubled, large })})`,
    );

    // The support agent sees both the threat and live-order work: safety first.
    const support = await view(people.support);
    const threatForSupport = find(support.items, threat);
    check(
      threatForSupport !== undefined &&
        support.items
          .filter((item) => item.tier !== 'SAFETY_SECURITY')
          .every((item) => item.rank > threatForSupport.rank) &&
        support.result.queues.includes('SUPPORT'),
      'Safety work did not rank ahead of everything else in a mixed view',
    );
    // What one operator may see, another sees with the same meaning.
    check(
      threatForSupport?.severity === threatForDelivery.severity &&
        threatForSupport.tier === threatForDelivery.tier &&
        threatForSupport.sla_due_at === threatForDelivery.sla_due_at &&
        threatForSupport.custody_risk === threatForDelivery.custody_risk,
      'Filtering by role changed what a row means',
    );

    // The incident commander sees the pause, due at its own review.
    const commander = await view(people.commander);
    const paused = find(commander.items, pause);
    check(
      paused?.tier === 'SAFETY_SECURITY' &&
        paused.sla_due_at === new Date(now.getTime() + 3_600_000).toISOString() &&
        !paused.overdue,
      `An incident control was not due at its own review (${JSON.stringify(paused)})`,
    );

    // A role with no queue sees an empty, safe dashboard; a zone-scoped finance
    // operator is not given the global ledger.
    const configurer = await view(people.configurer);
    check(
      configurer.items.length === 0 && configurer.result.queues.length === 0,
      `An admin whose role holds no queue was shown work (${JSON.stringify(configurer.result.queues)})`,
    );
    const zonal = await view(people.zonal);
    check(
      !find(zonal.items, paidTwice) && !zonal.result.queues.includes('FINANCE'),
      'A zone-scoped finance operator was shown the global ledger',
    );
    await rejects(
      () => control.dashboard({ context: partnerContext(people.rider), now }),
      AdminControlAuthorizationError,
      'A partner opened the admin dashboard',
    );

    // Every look is on the record, under the request it was made in.
    for (const { context, result } of [delivery, finance, support, commander, configurer, zonal]) {
      const recorded = await pool.query<{
        request_id: string;
        actor_id: string;
        after_value: { queues: string[] };
      }>(
        `SELECT request_id::text, actor_id::text, after_value
           FROM marketplace.operational_audit_events
          WHERE operational_audit_event_id=$1 AND action='DASHBOARD_VIEWED'`,
        [result.trace.audit_event_id],
      );
      check(
        recorded.rows[0]?.request_id === context.request_id &&
          recorded.rows[0].actor_id === context.actor?.actor_id &&
          JSON.stringify(recorded.rows[0].after_value.queues) === JSON.stringify(result.queues) &&
          result.trace.request_id === context.request_id,
        `A dashboard view was not recorded under its request (${JSON.stringify(recorded.rows[0])})`,
      );
    }
  } finally {
    await Promise.all([pool.end(), control.close()]);
  }
}
