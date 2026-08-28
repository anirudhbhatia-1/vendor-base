import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type ActorKind,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { PartnerWaitConflictError, PartnerWaitPolicyService } from '../src/partner-wait-policy.js';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function context(kind: ActorKind, id: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({ actor_id: id, actor_kind: kind, session_id: createUuidV7() }),
  });
}
async function rejects(work: () => Promise<unknown>, message: string) {
  try {
    await work();
  } catch (error) {
    check(error instanceof PartnerWaitConflictError, `${message}: ${String(error)}`);
    return;
  }
  throw new Error(message);
}

export async function verifyPartnerWaitPolicy(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const service = new PartnerWaitPolicyService({ connection_string: connectionString });
  const partnerId = createUuidV7();
  const systemId = createUuidV7();
  const vendorId = createUuidV7();
  const locationId = createUuidV7();
  const assignmentId = createUuidV7();
  const startedAt = new Date('2026-08-27T10:00:00.000Z');
  try {
    await pool.query('INSERT INTO marketplace.users(user_id) VALUES($1)', [partnerId]);
    await pool.query(
      `INSERT INTO marketplace.vendors
        (vendor_id,business_name,profile_description,lifecycle_state,request_id,correlation_id)
       VALUES($1,'SYNTH Wait Store','Wait policy verifier','ACTIVE',$2,$2)`,
      [vendorId, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.vendor_locations
        (vendor_location_id,vendor_id,location_name,profile_description,operating_timezone,
         coordinates,category,lifecycle_state,request_id,correlation_id)
       VALUES($1,$2,'SYNTH Wait Location','Wait policy verifier','Asia/Kolkata',
         ST_SetSRID(ST_MakePoint(75.81,26.91),4326)::geography,
         'FRUIT_VEGETABLE','ACTIVE',$3,$3)`,
      [locationId, vendorId, createUuidV7()],
    );
    await pool.query(
      `INSERT INTO marketplace.delivery_assignments
        (delivery_assignment_id,source_order_reference,vendor_location_id,partner_user_id,
         assignment_state,custody_state,package_count,approximate_pickup_area,
         approximate_drop_area,request_id,correlation_id,created_at,updated_at)
       VALUES($1,'SYNTH-ORDER-WAIT-0001',$2,$3,'ARRIVED','IN_CUSTODY',1,
         'SYNTH Wait Store Jaipur','SYNTH Customer Jaipur',$4,$4,$5,$5)`,
      [assignmentId, locationId, partnerId, createUuidV7(), startedAt],
    );
    const partner = context('delivery_partner', partnerId);
    const timer = await service.start({
      context: partner,
      delivery_assignment_id: assignmentId,
      command_reference: 'SYNTH-CMD-WAIT-START-0001',
      reason_code: 'CUSTOMER_WAIT_STARTED',
      now: startedAt,
    });
    check(timer.wait_state === 'RUNNING', 'Wait timer did not start');
    await rejects(
      () =>
        service.leave({
          context: partner,
          delivery_assignment_id: assignmentId,
          command_reference: 'SYNTH-CMD-WAIT-EARLY-0001',
          reason_code: 'WAIT_POLICY_LEAVE',
          now: new Date(startedAt.getTime() + 599_000),
        }),
      'Policy allowed early leave',
    );
    const first = await service.refresh({
      context: partner,
      delivery_assignment_id: assignmentId,
      now: new Date(startedAt.getTime() + 300_000),
    });
    check(first.wait_state === 'THRESHOLD_ONE', 'First wait threshold was not recorded');
    const secondAt = new Date(startedAt.getTime() + 660_000);
    const advanced = await service.advanceDue({
      context: context('system', systemId),
      now: secondAt,
    });
    check(advanced === 1, 'Worker did not advance the wait timer');
    const second = await service.get({
      context: partner,
      delivery_assignment_id: assignmentId,
      now: secondAt,
    });
    check(second.wait_state === 'THRESHOLD_TWO', 'Leave threshold was not recorded');
    const left = await service.leave({
      context: partner,
      delivery_assignment_id: assignmentId,
      command_reference: 'SYNTH-CMD-WAIT-LEAVE-0001',
      reason_code: 'WAIT_POLICY_LEAVE',
      now: secondAt,
    });
    check(left.wait_state === 'LEFT_POLICY', 'Policy leave did not close timer');
    check(left.wait_adjustment_minor === 600, 'Wait earning adjustment was calculated incorrectly');
    await service.leave({
      context: partner,
      delivery_assignment_id: assignmentId,
      command_reference: 'SYNTH-CMD-WAIT-LEAVE-RETRY',
      reason_code: 'WAIT_POLICY_LEAVE',
      now: secondAt,
    });
    const evidence = await pool.query<{
      adjustments: string;
      events: string;
      assignment_state: string;
    }>(
      `SELECT
        (SELECT count(*)::text FROM marketplace.partner_wait_earning_adjustments
          WHERE delivery_assignment_id=$1) adjustments,
        (SELECT count(*)::text FROM marketplace.partner_wait_timer_events event
          JOIN marketplace.partner_wait_timers timer USING(partner_wait_timer_id)
          WHERE timer.delivery_assignment_id=$1) events,
        (SELECT assignment_state FROM marketplace.delivery_assignments
          WHERE delivery_assignment_id=$1) assignment_state`,
      [assignmentId],
    );
    check(evidence.rows[0]?.adjustments === '1', 'Wait adjustment was posted more than once');
    check(evidence.rows[0]?.events === '4', 'Wait event history is incomplete');
    check(
      evidence.rows[0]?.assignment_state === 'DELIVERY_FAILED',
      'Policy leave did not route custody to recovery',
    );
  } finally {
    await service.close();
    await pool.end();
  }
}
