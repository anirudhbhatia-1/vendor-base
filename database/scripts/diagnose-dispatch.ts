import { withDatabaseClient } from '../src/client.js';
import {
  loadDatabaseConfig,
  loadProductionRuntimeDatabaseConfig,
  parseTarget,
} from '../src/config.js';
import { PRESENCE_WINDOW_SECONDS } from '../src/partner-availability.js';

/**
 * Why is nobody being offered this job?
 *
 * Dispatch decides in silence. A tick that finds an attempt with no eligible
 * partner counts it as `waiting` and logs nothing; an offer the assignment
 * module refuses is swallowed the same way. From the outside a vendor sees
 * "Finding a delivery partner" and a partner sees "no offers right now", and
 * neither screen can say which of six conditions is the one failing.
 *
 * This reads the same tables dispatch reads and prints, for every live attempt,
 * where every known partner stands against each condition -- `present` is the
 * one a partner cannot see for themselves: whether their device has confirmed
 * itself within dispatch's presence window. Read-only. Prints
 * truncated ids (the last eight characters, since UUIDv7 prefixes are the
 * clock), states, distances and timestamps -- never a name, a phone number, a
 * coordinate, or a credential.
 *
 * Usage: node --env-file=<env> --import tsx scripts/diagnose-dispatch.ts --target <target>
 */

const target = parseTarget(process.argv.slice(2));
const config =
  target === 'supabase-production'
    ? loadProductionRuntimeDatabaseConfig()
    : loadDatabaseConfig(target);

/** Dispatch's radius, from `PartnerAvailabilityService.eligible`. */
const RADIUS_METERS = 5000;

function print(label: string, rows: readonly Record<string, unknown>[]): void {
  process.stdout.write(`\n== ${label} (${rows.length})\n`);
  for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
}

await withDatabaseClient(config, async (client) => {
  const clock = await client.query<{ now: Date }>('SELECT now() AS now');
  process.stdout.write(`database time ${clock.rows[0]?.now.toISOString()}\n`);

  const attempts = await client.query<{
    delivery_assignment_id: string;
    attempt: string;
    assignment_state: string;
    held_by: string | null;
    offer_expires_at: Date | null;
    updated_at: Date;
    order_state: string;
    vendor_location_id: string;
    store: string;
  }>(
    `SELECT a.delivery_assignment_id, right(a.delivery_assignment_id::text, 8) AS attempt,
            a.assignment_state, right(a.partner_user_id::text, 8) AS held_by,
            a.offer_expires_at, a.updated_at, o.lifecycle_state AS order_state,
            l.vendor_location_id, l.location_name AS store
       FROM marketplace.delivery_assignments a
       JOIN marketplace.vendor_orders o USING (vendor_order_id)
       JOIN marketplace.vendor_locations l ON l.vendor_location_id = a.vendor_location_id
      WHERE o.lifecycle_state IN ('ACCEPTED','PICKING','READY')
      ORDER BY a.created_at DESC
      LIMIT 10`,
  );
  print(
    'attempts on orders a partner could still collect',
    attempts.rows.map((row) => ({
      attempt: row.attempt,
      assignment_state: row.assignment_state,
      held_by: row.held_by,
      offer_expires_at: row.offer_expires_at,
      updated_at: row.updated_at,
      order_state: row.order_state,
      store: row.store,
    })),
  );

  for (const attempt of attempts.rows) {
    const history = await client.query<Record<string, unknown>>(
      `SELECT event_type, right(partner_user_id::text, 8) AS partner, actor_kind, occurred_at
         FROM marketplace.assignment_events
        WHERE delivery_assignment_id = $1
        ORDER BY occurred_at DESC
        LIMIT 12`,
      [attempt.delivery_assignment_id],
    );
    print(`attempt ${attempt.attempt}: recent history`, history.rows);

    // Every partner the system knows, against every condition dispatch applies.
    // A row where each column is true and `declined` is false is a candidate;
    // the first false column is why a partner is not.
    const standing = await client.query<Record<string, unknown>>(
      `SELECT right(av.partner_user_id::text, 8) AS partner,
              av.availability_state = 'ONLINE' AS online,
              av.last_seen_at > clock_timestamp() - make_interval(secs => $4) AS present,
              av.last_seen_at,
              EXISTS (SELECT 1 FROM marketplace.partner_eligibilities e
                       WHERE e.user_id = av.partner_user_id AND e.state = 'ELIGIBLE'
                         AND (e.eligible_until IS NULL OR e.eligible_until > clock_timestamp()))
                AS eligible,
              EXISTS (SELECT 1 FROM marketplace.partner_eligibilities e
                        JOIN marketplace.role_assignments r USING (role_assignment_id)
                       WHERE e.user_id = av.partner_user_id AND e.state = 'ELIGIBLE'
                         AND r.state = 'ACTIVE' AND r.valid_from <= clock_timestamp()
                         AND (r.valid_until IS NULL OR r.valid_until > clock_timestamp()))
                AS role_active,
              av.current_coordinates IS NOT NULL AS has_location,
              ST_Distance(av.current_coordinates, l.coordinates)::integer AS metres_from_store,
              ST_DWithin(av.current_coordinates, l.coordinates, $2) AS within_radius,
              NOT EXISTS (SELECT 1 FROM marketplace.partner_assignment_memberships m
                           WHERE m.user_id = av.partner_user_id AND m.state = 'ACTIVE')
                AS free,
              EXISTS (SELECT 1 FROM marketplace.assignment_events ev
                       WHERE ev.delivery_assignment_id = $1 AND ev.event_type = 'DECLINED'
                         AND ev.actor_id = av.partner_user_id) AS declined,
              (SELECT count(*)::int FROM marketplace.assignment_events ev
                WHERE ev.delivery_assignment_id = $1 AND ev.event_type = 'OFFER_EXPIRED'
                  AND ev.partner_user_id = av.partner_user_id) AS passes,
              av.updated_at AS availability_updated_at
         FROM marketplace.partner_availability av
         CROSS JOIN marketplace.vendor_locations l
        WHERE l.vendor_location_id = $3
        ORDER BY av.updated_at DESC
        LIMIT 20`,
      [
        attempt.delivery_assignment_id,
        RADIUS_METERS,
        attempt.vendor_location_id,
        PRESENCE_WINDOW_SECONDS,
      ],
    );
    print(
      `attempt ${attempt.attempt}: every partner against dispatch's conditions (store ${attempt.store})`,
      standing.rows,
    );
  }

  // Everything the authorization guard reads for a partner, so a run of
  // concealed 404s on every partner route can be traced to the row that
  // denies it: the account, the role, the eligibility window, or the job
  // membership the ACTIVE_ASSIGNMENT rule needs.
  const recentPartners = await client.query<Record<string, unknown>>(
    `SELECT right(r.user_id::text, 8) AS partner, u.state AS user_state,
            r.state AS role_state, r.valid_from, r.valid_until, r.created_at,
            pe.state AS eligibility, pe.eligible_from, pe.eligible_until, pe.reason_code,
            (SELECT array_agg(right(m.delivery_assignment_id::text, 8) || ':' || m.state)
               FROM marketplace.partner_assignment_memberships m
              WHERE m.user_id = r.user_id AND m.state = 'ACTIVE') AS active_memberships,
            (SELECT count(*)::int FROM marketplace.partner_eligibilities e
              WHERE e.user_id = r.user_id) AS eligibility_rows,
            EXISTS (SELECT 1 FROM marketplace.partner_availability av
                     WHERE av.partner_user_id = r.user_id) AS has_availability_row
       FROM marketplace.role_assignments r
       JOIN marketplace.users u ON u.user_id = r.user_id
       LEFT JOIN marketplace.partner_eligibilities pe USING (role_assignment_id)
      WHERE r.role_key = 'DELIVERY_PARTNER'
      ORDER BY r.created_at DESC
      LIMIT 5`,
  );
  print('most recent delivery-partner role grants, as the guard sees them', recentPartners.rows);
});
