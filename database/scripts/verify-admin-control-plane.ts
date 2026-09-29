import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
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
    // Incident controls moved to their own service and walk (11.7,
    // verify-incident-controls.ts).
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
