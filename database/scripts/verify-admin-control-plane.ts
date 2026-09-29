import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  parseUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { AdminControlNotFoundError, AdminControlPlaneService } from '../src/admin-control-plane.js';
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
    const incident = await service.setIncident({
      context: context(),
      control_key: 'DELIVERY_PAUSE',
      scope_kind: 'ZONE',
      scope_reference: 'SYNTH-ZONE-JAIPUR-0001',
      reason_code: 'WEATHER_CHECK',
      expires_at: new Date(Date.now() + 86_400_000),
      review_at: new Date(Date.now() + 3_600_000),
      obligations: { banner: 'SYNTH Delivery paused' },
    });
    await service.revokeIncident({
      context: context(),
      incident_control_id: parseUuidV7(String(incident.incident_control_id)),
      reason_code: 'WEATHER_CLEARED',
    });
    const created = await service.createExport({
      context: context(),
      report_kind: 'SUPPORT',
      filters: { state: 'OPEN' },
      classification: 'RESTRICTED',
    });
    const redeemed = await service.redeemExport({
      context: context(),
      download_token: String(created.download_token),
    });
    check(String(redeemed.content).includes('Synthetic SUPPORT'), 'Export content is missing');
    let replayBlocked = false;
    try {
      await service.redeemExport({
        context: context(),
        download_token: String(created.download_token),
      });
    } catch (error) {
      replayBlocked = error instanceof AdminControlNotFoundError;
    }
    check(replayBlocked, 'Export token replay was not blocked');
    const audit = await service.audit({ context: context(), query: 'REPORT_EXPORT_DOWNLOADED' });
    check(audit.events.length === 1, 'Export audit event missing');
  } finally {
    await Promise.all([service.close(), pool.end()]);
  }
}
