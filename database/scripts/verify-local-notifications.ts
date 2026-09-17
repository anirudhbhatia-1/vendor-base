import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type ActorKind,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import { LocalNotificationService } from '../src/local-notifications.js';
import { check } from './verify-support.js';

function context(kind: ActorKind, id: UuidV7) {
  return createRequestContext({
    actor: createAuthenticatedActor({ actor_id: id, actor_kind: kind, session_id: createUuidV7() }),
  });
}

export async function verifyLocalNotifications(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4 });
  const service = new LocalNotificationService({ connection_string: connectionString });
  const userId = createUuidV7();
  const systemId = createUuidV7();
  const sourceId = createUuidV7();
  const now = new Date('2026-08-27T12:00:00.000Z');
  const system = context('system', systemId);
  const customer = context('customer', userId);
  try {
    await pool.query('INSERT INTO marketplace.users(user_id) VALUES($1)', [userId]);
    const first = await service.enqueue({
      context: system,
      recipient_user_id: userId,
      notification_kind: 'ORDER_STATUS',
      template_key: 'vendor_order_event.ready',
      template_payload: { event: 'READY' },
      channels: ['IN_APP', 'PUSH'],
      source_kind: 'verification_event',
      source_id: sourceId,
      source_event_type: 'READY',
      deduplication_key: `verification:${sourceId}`,
      now,
    });
    const replay = await service.enqueue({
      context: system,
      recipient_user_id: userId,
      notification_kind: 'ORDER_STATUS',
      template_key: 'vendor_order_event.ready',
      channels: ['IN_APP', 'PUSH'],
      source_kind: 'verification_event',
      source_id: sourceId,
      source_event_type: 'READY',
      deduplication_key: `verification:${sourceId}`,
      now,
    });
    check(
      first.notification_intent_id === replay.notification_intent_id,
      'Notification deduplication created two intents',
    );
    check(
      (await service.deliverPending({ context: system, now })) === 1,
      'Intent was not delivered',
    );
    const inbox = await service.list({ context: customer });
    check(inbox.length === 1, 'In-app notification was not delivered exactly once');
    const notificationId = inbox[0]?.in_app_notification_id as string | undefined;
    check(notificationId, 'Notification ID missing');
    await service.markRead({
      context: customer,
      in_app_notification_id: notificationId as UuidV7,
      now,
    });
    check(
      (await service.list({ context: customer, unread_only: true })).length === 0,
      'Read state was not persisted',
    );

    await service.enqueue({
      context: system,
      recipient_user_id: userId,
      notification_kind: 'SECURITY',
      template_key: 'security.session_changed',
      // A transient failure is a provider outcome, so this has to run on a
      // channel that has a provider. IN_APP is delivered in-process and can
      // never fail, so it could not exercise the retry this asserts.
      channels: ['PUSH'],
      provider_scenario: 'TRANSIENT_FAILURE',
      source_kind: 'verification_event',
      source_id: createUuidV7(),
      source_event_type: 'SESSION_CHANGED',
      deduplication_key: `verification:retry:${sourceId}`,
      now,
    });
    await service.deliverPending({ context: system, now: new Date(now.getTime() + 1_000) });
    await service.deliverPending({ context: system, now: new Date(now.getTime() + 2_000) });
    await service.deliverPending({ context: system, now: new Date(now.getTime() + 3_000) });
    const attempts = await pool.query<{ attempts: string; state: string }>(
      `SELECT (SELECT count(*)::text FROM marketplace.notification_attempts attempt
          WHERE attempt.notification_intent_id=intent.notification_intent_id) attempts,
          intent.delivery_state state FROM marketplace.notification_intents intent
        WHERE deduplication_key=$1`,
      [`verification:retry:${sourceId}`],
    );
    check(attempts.rows[0]?.attempts === '3', 'Transient delivery did not retry twice');
    check(attempts.rows[0]?.state === 'DELIVERED', 'Transient delivery did not recover');
  } finally {
    await service.close();
    await pool.end();
  }
}
