import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';

export class NotificationAuthorizationError extends Error {}
export class NotificationNotFoundError extends Error {}
export class NotificationInputError extends Error {}

type Channel = 'IN_APP' | 'PUSH' | 'SMS';
type Scenario = 'SUCCESS' | 'TRANSIENT_FAILURE' | 'PERMANENT_FAILURE';

function actor(context: RequestContext) {
  if (!context.actor) throw new NotificationAuthorizationError();
  return context.actor;
}
function system(context: RequestContext) {
  const found = actor(context);
  if (!['system', 'admin'].includes(found.actor_kind)) throw new NotificationAuthorizationError();
  return found;
}
function contextIds(context: RequestContext) {
  return {
    request: parseRequestId(context.request_id),
    correlation: parseUuidV7(context.correlation_id),
  };
}

export class LocalNotificationService {
  readonly #pool: Pool;
  constructor(input: { connection_string: string }) {
    this.#pool = new Pool({
      application_name: 'local-notifications',
      connectionString: input.connection_string,
      max: 6,
    });
  }
  async close() {
    await this.#pool.end();
  }

  async enqueue(input: {
    context: RequestContext;
    recipient_user_id: UuidV7;
    notification_kind: 'ORDER_STATUS' | 'SECURITY' | 'SUPPORT' | 'OPERATIONS';
    template_key: string;
    template_payload?: Record<string, string | number | boolean | null>;
    channels?: readonly Channel[];
    provider_scenario?: Scenario;
    source_kind: string;
    source_id: UuidV7;
    source_event_type: string;
    deduplication_key: string;
    now?: Date;
  }) {
    system(input.context);
    if (!/^[a-z][a-z0-9_.]{2,119}$/.test(input.template_key)) throw new NotificationInputError();
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(input.source_kind)) throw new NotificationInputError();
    if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(input.source_event_type)) throw new NotificationInputError();
    const channels = [...new Set(input.channels ?? ['IN_APP', 'PUSH'])];
    if (
      !channels.length ||
      channels.some((channel) => !['IN_APP', 'PUSH', 'SMS'].includes(channel))
    ) {
      throw new NotificationInputError();
    }
    const now = input.now ?? new Date();
    const ids = contextIds(input.context);
    const result = await this.#pool.query(
      `INSERT INTO marketplace.notification_intents
        (notification_intent_id,recipient_user_id,notification_kind,template_key,
         template_payload,channels,provider_scenario,source_kind,source_id,source_event_type,
         deduplication_key,request_id,correlation_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
       ON CONFLICT(deduplication_key) DO UPDATE SET deduplication_key=EXCLUDED.deduplication_key
       RETURNING *`,
      [
        createUuidV7({ now_ms: now.getTime() }),
        input.recipient_user_id,
        input.notification_kind,
        input.template_key,
        JSON.stringify(input.template_payload ?? {}),
        channels,
        input.provider_scenario ?? 'SUCCESS',
        input.source_kind,
        input.source_id,
        input.source_event_type,
        input.deduplication_key,
        ids.request,
        ids.correlation,
        now,
      ],
    );
    return result.rows[0];
  }

  async syncDomainSignals(input: { context: RequestContext; now?: Date; limit?: number }) {
    system(input.context);
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const waitSignals = await this.#pool.query<{
      source_id: string;
      recipient_user_id: string;
      event_type: string;
      request_id: string;
      correlation_id: string;
    }>(
      `SELECT event.partner_wait_timer_event_id source_id,timer.partner_user_id recipient_user_id,
              event.event_type,event.request_id,event.correlation_id
         FROM marketplace.partner_wait_timer_events event
         JOIN marketplace.partner_wait_timers timer USING(partner_wait_timer_id)
        WHERE event.event_type IN ('THRESHOLD_ONE','THRESHOLD_TWO','LEFT_POLICY')
          AND NOT EXISTS(SELECT 1 FROM marketplace.notification_intents intent
            WHERE intent.source_kind='partner_wait_event' AND intent.source_id=event.partner_wait_timer_event_id)
        ORDER BY event.occurred_at LIMIT $1`,
      [limit],
    );
    const orderSignals = await this.#pool.query<{
      source_id: string;
      recipient_user_id: string;
      event_type: string;
      request_id: string;
      correlation_id: string;
    }>(
      `SELECT event.event_id source_id,grouping.customer_user_id recipient_user_id,event.event_type,
              event.request_id,event.correlation_id
         FROM marketplace.vendor_order_events event
         JOIN marketplace.vendor_orders orders USING(vendor_order_id)
         JOIN marketplace.checkout_groups grouping USING(checkout_group_id)
        WHERE event.event_type IN ('ACCEPTED','DECLINED','TIMED_OUT','SUBSTITUTION_PROPOSED',
          'WEIGHT_PROPOSED','READY','PICKED_UP','SUPPORT_CASE_OPENED')
          AND NOT EXISTS(SELECT 1 FROM marketplace.notification_intents intent
            WHERE intent.source_kind='vendor_order_event' AND intent.source_id=event.event_id)
        ORDER BY event.occurred_at LIMIT $1`,
      [limit],
    );
    let created = 0;
    for (const signal of [...waitSignals.rows, ...orderSignals.rows]) {
      const sourceKind = waitSignals.rows.includes(signal)
        ? 'partner_wait_event'
        : 'vendor_order_event';
      const signalContext: RequestContext = {
        ...input.context,
        request_id: parseRequestId(signal.request_id),
        correlation_id: parseUuidV7(signal.correlation_id),
      };
      await this.enqueue({
        context: signalContext,
        recipient_user_id: parseUuidV7(signal.recipient_user_id),
        notification_kind: sourceKind === 'vendor_order_event' ? 'ORDER_STATUS' : 'OPERATIONS',
        template_key: `${sourceKind}.${signal.event_type.toLowerCase()}`,
        template_payload: { event: signal.event_type },
        channels: ['IN_APP', 'PUSH'],
        source_kind: sourceKind,
        source_id: parseUuidV7(signal.source_id),
        source_event_type: signal.event_type,
        deduplication_key: `${sourceKind}:${signal.source_id}`,
        now,
      });
      created += 1;
    }
    return created;
  }

  async deliverPending(input: { context: RequestContext; now?: Date; limit?: number }) {
    system(input.context);
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const intents = await client.query<{
        notification_intent_id: string;
        recipient_user_id: string;
        notification_kind: string;
        template_key: string;
        template_payload: Record<string, unknown>;
        channels: Channel[];
        provider_scenario: Scenario;
      }>(
        `SELECT * FROM marketplace.notification_intents WHERE delivery_state='PENDING'
          ORDER BY created_at,notification_intent_id FOR UPDATE SKIP LOCKED LIMIT $1`,
        [limit],
      );
      for (const intent of intents.rows) await this.#deliver(client, intent, now);
      await client.query('COMMIT');
      return intents.rows.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(input: { context: RequestContext; unread_only?: boolean; limit?: number }) {
    const who = actor(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const result = await this.#pool.query(
      `SELECT in_app_notification_id,template_key,template_payload,read_at,created_at
         FROM marketplace.in_app_notifications WHERE recipient_user_id=$1
           AND ($2::boolean=false OR read_at IS NULL)
         ORDER BY created_at DESC LIMIT $3`,
      [who.actor_id, input.unread_only ?? false, limit],
    );
    return result.rows;
  }

  async markRead(input: { context: RequestContext; in_app_notification_id: UuidV7; now?: Date }) {
    const who = actor(input.context);
    const result = await this.#pool.query(
      `UPDATE marketplace.in_app_notifications SET read_at=COALESCE(read_at,$3)
        WHERE in_app_notification_id=$1 AND recipient_user_id=$2 RETURNING *`,
      [input.in_app_notification_id, who.actor_id, input.now ?? new Date()],
    );
    if (!result.rows[0]) throw new NotificationNotFoundError();
    return result.rows[0];
  }

  async #deliver(
    client: PoolClient,
    intent: {
      notification_intent_id: string;
      recipient_user_id: string;
      notification_kind: string;
      template_key: string;
      template_payload: Record<string, unknown>;
      channels: Channel[];
      provider_scenario: Scenario;
    },
    now: Date,
  ) {
    let retry = false;
    let delivered = 0;
    for (const channel of intent.channels) {
      const attempts = await client.query<{ count: string; delivered: boolean }>(
        `SELECT count(*)::text count,bool_or(delivery_state='DELIVERED') delivered
           FROM marketplace.notification_attempts WHERE notification_intent_id=$1 AND channel=$2`,
        [intent.notification_intent_id, channel],
      );
      const attempt = Number(attempts.rows[0]?.count ?? 0) + 1;
      if (attempts.rows[0]?.delivered) {
        delivered += 1;
        continue;
      }
      const enabled =
        channel === 'IN_APP' ||
        (await this.#channelEnabled(
          client,
          intent.recipient_user_id,
          intent.notification_kind,
          channel,
        ));
      const state = !enabled
        ? 'SKIPPED'
        : intent.provider_scenario === 'SUCCESS' ||
            (intent.provider_scenario === 'TRANSIENT_FAILURE' && attempt >= 3)
          ? 'DELIVERED'
          : 'FAILED';
      const transient = enabled && intent.provider_scenario === 'TRANSIENT_FAILURE' && attempt < 3;
      retry ||= transient;
      if (state === 'DELIVERED') delivered += 1;
      await client.query(
        `INSERT INTO marketplace.notification_attempts
          (notification_attempt_id,notification_intent_id,channel,attempt_number,adapter_key,
           delivery_state,provider_reference,error_code,attempted_at)
         VALUES($1,$2,$3,$4,'LOCAL_FAKE',$5,$6,$7,$8)`,
        [
          createUuidV7({ now_ms: now.getTime() + attempt }),
          intent.notification_intent_id,
          channel,
          attempt,
          state,
          state === 'DELIVERED' ? `SYNTH-NOTIFY-${intent.notification_intent_id}-${channel}` : null,
          state === 'FAILED'
            ? transient
              ? 'FAKE_TRANSIENT_FAILURE'
              : 'FAKE_PERMANENT_FAILURE'
            : null,
          now,
        ],
      );
      if (channel === 'IN_APP' && state === 'DELIVERED') {
        await client.query(
          `INSERT INTO marketplace.in_app_notifications
            (in_app_notification_id,notification_intent_id,recipient_user_id,template_key,
             template_payload,created_at) VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT(notification_intent_id) DO NOTHING`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            intent.notification_intent_id,
            intent.recipient_user_id,
            intent.template_key,
            JSON.stringify(intent.template_payload),
            now,
          ],
        );
      }
    }
    const next = retry
      ? 'PENDING'
      : delivered === intent.channels.length
        ? 'DELIVERED'
        : delivered
          ? 'PARTIAL'
          : 'FAILED';
    await client.query(
      'UPDATE marketplace.notification_intents SET delivery_state=$2,updated_at=$3 WHERE notification_intent_id=$1',
      [intent.notification_intent_id, next, now],
    );
  }

  async #channelEnabled(client: PoolClient, userId: string, kind: string, channel: Channel) {
    if (kind === 'OPERATIONS') return true;
    const result = await client.query<{ enabled: boolean }>(
      `SELECT COALESCE(preference.enabled,policy.default_enabled) enabled
         FROM marketplace.notification_channel_policies policy
         LEFT JOIN marketplace.notification_preferences preference
           ON preference.user_id=$1 AND preference.notification_kind=policy.notification_kind
          AND preference.channel=policy.channel
        WHERE policy.notification_kind=$2 AND policy.channel=$3`,
      [userId, kind, channel],
    );
    return result.rows[0]?.enabled ?? true;
  }
}
