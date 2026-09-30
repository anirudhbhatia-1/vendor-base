import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { AdminControlPlaneService } from '../src/admin-control-plane.js';
import { check } from './verify-support.js';
export async function verifyAdminControlPlane(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, application_name: 'admin-control-verifier' });
  const service = new AdminControlPlaneService({ connection_string: connectionString });
  const adminA = createUuidV7();
  const adminB = createUuidV7();
  const context = (id = adminA) =>
    createRequestContext({
      actor: createAuthenticatedActor({
        actor_id: id,
        actor_kind: 'admin',
        session_id: createUuidV7(),
      }),
    });
  try {
    await pool.query(
      'INSERT INTO marketplace.users(user_id) VALUES($1),($2) ON CONFLICT DO NOTHING',
      [adminA, adminB],
    );
    // Support cases moved to their own service and walk (11.3,
    // verify-support-cases.ts).
    // Trust restrictions moved to their own service and walk (11.4,
    // verify-trust-review.ts).
    // Incident controls moved to their own service and walk (11.7,
    // verify-incident-controls.ts).
    // Reports and exports moved to their own service and walk (11.8,
    // verify-reporting.ts). The audit search stays here until 11.9.
    const action = `SYNTH_CONTROL_${adminA.replaceAll('-', '').slice(-8).toUpperCase()}`;
    await pool.query(
      `INSERT INTO marketplace.operational_audit_events
         (operational_audit_event_id, action, target_kind, target_reference, actor_id, reason_code,
          request_id, correlation_id)
       VALUES ($1,$2,'CONTROL_PLANE',$3,$4,'VERIFIER_CHECK',$5,$5)`,
      [createUuidV7(), action, adminA, adminA, createUuidV7()],
    );
    const audit = await service.audit({ context: context(), query: action });
    check(audit.events.length === 1, 'The audit search did not find the event it was asked for');
  } finally {
    await Promise.all([service.close(), pool.end()]);
  }
}
