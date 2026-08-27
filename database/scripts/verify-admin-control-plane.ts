import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  parseUuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { AdminControlNotFoundError, AdminControlPlaneService } from '../src/admin-control-plane.js';
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
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
    const order = await pool.query<{ vendor_order_id: string }>(
      'SELECT vendor_order_id FROM marketplace.vendor_orders ORDER BY created_at LIMIT 1',
    );
    const orderId = order.rows[0]?.vendor_order_id;
    check(orderId, 'Admin verifier needs the fulfilment order fixture');
    const first = await service.createSupportCase({
      context: context(),
      vendor_order_id: parseUuidV7(orderId),
      category: 'DELIVERY_DELAY',
      description: 'SYNTH Delivery support verification',
      severity: 'HIGH',
      response_due_at: new Date(Date.now() + 3_600_000),
    });
    const duplicate = await service.createSupportCase({
      context: context(),
      vendor_order_id: parseUuidV7(orderId),
      category: 'DELIVERY_DELAY',
      description: 'SYNTH Duplicate support verification',
      severity: 'HIGH',
      response_due_at: new Date(Date.now() + 3_600_000),
    });
    check(duplicate.deduplicated === true, 'Support deduplication failed');
    await service.supportAction({
      context: context(),
      support_case_id: parseUuidV7(String(first.support_case_id)),
      action: 'ASSIGN',
      reason_code: 'CASE_ASSIGNED',
      owner_user_id: adminA,
      owner_team: 'SYNTH_SUPPORT',
    });
    await service.attachSupportEvidence({
      context: context(),
      support_case_id: parseUuidV7(String(first.support_case_id)),
      evidence_reference: 'SYNTH-EVIDENCE-SUPPORT-0001',
      classification: 'RESTRICTED',
      reason_code: 'EVIDENCE_ATTACHED',
    });
    const second = await service.createSupportCase({
      context: context(),
      vendor_order_id: parseUuidV7(orderId),
      category: 'ORDER_QUALITY',
      description: 'SYNTH Quality support verification',
      severity: 'MEDIUM',
      response_due_at: new Date(Date.now() + 7_200_000),
    });
    await service.mergeSupportCases({
      context: context(),
      source_case_id: parseUuidV7(String(second.support_case_id)),
      target_case_id: parseUuidV7(String(first.support_case_id)),
      reason_code: 'DUPLICATE_CASE',
    });
    const proposed = await service.proposeTrust({
      context: context(),
      subject_kind: 'CUSTOMER',
      subject_reference: 'SYNTH-CUSTOMER-RISK-0001',
      scope_kind: 'GLOBAL',
      scope_reference: 'SYNTH-GLOBAL-SCOPE-0001',
      reason_code: 'RISK_REVIEW',
      evidence_reference: 'SYNTH-EVIDENCE-RISK-0001',
      policy_reference: 'SYNTH-POLICY-TRUST-0001',
      effective_until: new Date(Date.now() + 86_400_000),
      review_at: new Date(Date.now() + 3_600_000),
    });
    const active = await service.approveTrust({
      context: context(adminB),
      trust_restriction_case_id: parseUuidV7(String(proposed.trust_restriction_case_id)),
      expected_version: 1,
      reason_code: 'RISK_APPROVED',
    });
    await service.transitionTrust({
      context: context(adminB),
      trust_restriction_case_id: parseUuidV7(String(active.trust_restriction_case_id)),
      expected_version: 2,
      action: 'REVOKE',
      reason_code: 'RISK_CLEARED',
    });
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
