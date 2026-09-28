import { releaseServicePool, resolveServicePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import {
  LocalDeterministicMessageProvider,
  type ProviderScenario,
  type PushProvider,
  type SmsProvider,
} from './provider-ports.js';
import { resolveConfiguration } from './versioned-configuration.js';

export class NotificationAuthorizationError extends Error {}
export class NotificationNotFoundError extends Error {}
export class NotificationInputError extends Error {}

type Channel = 'IN_APP' | 'PUSH' | 'SMS';
type Scenario = ProviderScenario;

/** An unheard new-order alert is raised to the owners after this long. */
export const DEFAULT_ALERT_ESCALATION_SECONDS = 60;
/** Where the escalation goes when no policy is active: a text message, too. */
export const DEFAULT_ALERT_ESCALATION_CHANNELS: readonly Channel[] = Object.freeze([
  'IN_APP',
  'PUSH',
  'SMS',
]);

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
  readonly #pushProvider: PushProvider;
  readonly #smsProvider: SmsProvider;
  constructor(input: {
    readonly connection_string: string;
    readonly pool?: Pool;
    readonly push_provider?: PushProvider;
    readonly sms_provider?: SmsProvider;
  }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'local-notifications',
      max: 6,
    });
    this.#pushProvider = input.push_provider ?? new LocalDeterministicMessageProvider();
    this.#smsProvider = input.sms_provider ?? new LocalDeterministicMessageProvider();
  }
  async close() {
    await releaseServicePool(this.#pool);
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

  /**
   * The shop's alert for a new order (8.1): one intent per staff member of
   * the location, in-app and push, carrying the order's reference and the
   * server's deadline and asking the device to sound. Idempotent per order
   * and person. Until audit run 49 nothing told a shop about a new order:
   * the customer was notified of every state change and the console polled
   * a list in silence.
   */
  async alertStaffOfPlacedOrder(input: {
    context: RequestContext;
    vendor_order_id: UuidV7;
    now?: Date;
  }) {
    system(input.context);
    const now = input.now ?? new Date();
    const order = await this.#pool.query<{
      order_reference: string;
      vendor_location_id: string;
      accept_by: Date | null;
      lifecycle_state: string;
    }>(
      `SELECT order_reference, vendor_location_id, accept_by, lifecycle_state
         FROM marketplace.vendor_orders WHERE vendor_order_id=$1`,
      [input.vendor_order_id],
    );
    const found = order.rows[0];
    if (!found || found.lifecycle_state !== 'PLACED') return 0;
    const staff = await this.#staffOf(found.vendor_location_id, now);
    for (const member of staff) {
      await this.enqueue({
        context: input.context,
        recipient_user_id: member.user_id,
        notification_kind: 'ORDER_STATUS',
        template_key: 'vendor_order_event.placed',
        template_payload: {
          accept_by: found.accept_by?.toISOString() ?? null,
          audible: true,
          order_reference: found.order_reference,
          vendor_location_id: found.vendor_location_id,
          vendor_order_id: input.vendor_order_id,
        },
        channels: ['IN_APP', 'PUSH'],
        source_kind: 'vendor_order',
        source_id: input.vendor_order_id,
        source_event_type: 'PLACED',
        deduplication_key: `vendor_alert:${input.vendor_order_id}:${member.user_id}`,
        now,
      });
    }
    return staff.length;
  }

  /**
   * The escalation (8.1): an order still PLACED after the configured wait,
   * still inside its deadline, whose alert nobody at the shop has opened,
   * is raised to the owners on the configured channels -- SMS among them by
   * default, because a push that went unheard is what this is for. Once per
   * order and owner; an alert that was read is an alert that was heard.
   */
  async escalateUnacknowledgedOrders(input: { context: RequestContext; now?: Date }) {
    system(input.context);
    const now = input.now ?? new Date();
    const policy = await this.escalationPolicy(now);
    const overdue = await this.#pool.query<{
      vendor_order_id: string;
      order_reference: string;
      vendor_location_id: string;
      accept_by: Date;
    }>(
      `SELECT o.vendor_order_id, o.order_reference, o.vendor_location_id, o.accept_by
         FROM marketplace.vendor_orders o
        WHERE o.lifecycle_state='PLACED'
          AND o.accept_by IS NOT NULL AND o.accept_by > $1
          AND o.created_at <= $1::timestamptz - make_interval(secs => $2)
          AND NOT EXISTS (
            SELECT 1 FROM marketplace.in_app_notifications n
             WHERE n.template_key='vendor_order_event.placed'
               AND n.template_payload->>'vendor_order_id' = o.vendor_order_id::text
               AND n.read_at IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM marketplace.notification_intents i
             WHERE i.source_kind='vendor_order' AND i.source_id=o.vendor_order_id
               AND i.source_event_type='PLACED_ESCALATION')
        ORDER BY o.created_at LIMIT 100`,
      [now, policy.after_seconds],
    );
    let escalated = 0;
    for (const order of overdue.rows) {
      const owners = (await this.#staffOf(order.vendor_location_id, now)).filter(
        (member) => member.role_key === 'VENDOR_OWNER',
      );
      for (const owner of owners) {
        await this.enqueue({
          context: input.context,
          recipient_user_id: owner.user_id,
          notification_kind: 'OPERATIONS',
          template_key: 'vendor_order_event.placed_escalation',
          template_payload: {
            accept_by: order.accept_by.toISOString(),
            audible: true,
            order_reference: order.order_reference,
            vendor_location_id: order.vendor_location_id,
            vendor_order_id: order.vendor_order_id,
          },
          channels: policy.channels,
          source_kind: 'vendor_order',
          source_id: parseUuidV7(order.vendor_order_id),
          source_event_type: 'PLACED_ESCALATION',
          deduplication_key: `vendor_alert_escalation:${order.vendor_order_id}:${owner.user_id}`,
          now,
        });
        escalated += 1;
      }
    }
    return escalated;
  }

  /**
   * How long an unheard alert waits and where the escalation goes:
   * `vendor.order_alert_escalation` (a SETTING: `after_seconds` 15-600 and
   * `channels`), or the defaults below when none is active.
   */
  async escalationPolicy(at?: Date): Promise<{
    readonly after_seconds: number;
    readonly channels: readonly Channel[];
  }> {
    const resolved = await resolveConfiguration(this.#pool, {
      configuration_key: 'vendor.order_alert_escalation',
      configuration_kind: 'SETTING',
      ...(at ? { at } : {}),
    });
    const value = resolved?.configuration_value as
      { after_seconds?: unknown; channels?: unknown } | null | undefined;
    const after =
      typeof value?.after_seconds === 'number' &&
      Number.isSafeInteger(value.after_seconds) &&
      value.after_seconds >= 15 &&
      value.after_seconds <= 600
        ? value.after_seconds
        : DEFAULT_ALERT_ESCALATION_SECONDS;
    const channels =
      Array.isArray(value?.channels) &&
      value.channels.length > 0 &&
      value.channels.every((channel) => ['IN_APP', 'PUSH', 'SMS'].includes(String(channel)))
        ? (value.channels as Channel[])
        : DEFAULT_ALERT_ESCALATION_CHANNELS;
    return Object.freeze({ after_seconds: after, channels: Object.freeze([...channels]) });
  }

  /** The people a location's alerts go to: its live staff, with their role. */
  async #staffOf(vendorLocationId: string, now: Date) {
    const result = await this.#pool.query<{ user_id: string; role_key: string }>(
      `SELECT DISTINCT ra.user_id, ra.role_key
         FROM marketplace.staff_memberships sm
         JOIN marketplace.role_assignments ra USING (role_assignment_id)
         JOIN marketplace.users u ON u.user_id = ra.user_id
        WHERE sm.vendor_location_id=$1 AND ra.state='ACTIVE' AND u.state='ACTIVE'
          AND ra.valid_from <= $2 AND (ra.valid_until IS NULL OR ra.valid_until > $2)`,
      [vendorLocationId, now],
    );
    return result.rows.map((row) => ({
      user_id: parseUuidV7(row.user_id),
      role_key: row.role_key,
    }));
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
    // A decision's notice carries what the customer needs to answer it (8.4):
    // the item as ordered, what the shop offers instead, the difference, the
    // reason and the deadline -- and a change the shop applied under the
    // customer's own rule (a lighter weight, a replacement at no extra cost)
    // is told to them too. Until audit run 52 the notice said only
    // "substitution proposed".
    const orderSignals = await this.#pool.query<{
      source_id: string;
      recipient_user_id: string;
      event_type: string;
      request_id: string;
      correlation_id: string;
      detail: Record<string, unknown> | null;
    }>(
      `SELECT event.event_id source_id,grouping.customer_user_id recipient_user_id,event.event_type,
              event.request_id,event.correlation_id,
              CASE WHEN event.decision_id IS NULL THEN NULL ELSE (
                SELECT jsonb_build_object(
                  'decision_id', d.decision_id,
                  'order_reference', orders.order_reference,
                  'location_name', loc.location_name,
                  'proposal_kind', d.proposal_kind,
                  'ordered_title', l.product_title_snapshot,
                  'ordered_quantity', l.quantity,
                  'ordered_unit_price_minor', l.unit_price_minor,
                  'offered_title', COALESCE(op.title, l.product_title_snapshot),
                  'offered_quantity', d.proposed_quantity,
                  'offered_unit_price_minor', d.proposed_unit_price_minor,
                  'difference_minor', d.authorization_delta_minor,
                  'reason_note', d.reason_note,
                  'decision_deadline_at', d.decision_deadline_at)
                  FROM marketplace.vendor_order_customer_decisions d
                  JOIN marketplace.vendor_order_line_picks p ON p.pick_id = d.pick_id
                  JOIN marketplace.vendor_order_lines l
                    ON l.vendor_order_line_id = p.vendor_order_line_id
                  JOIN marketplace.vendor_locations loc
                    ON loc.vendor_location_id = orders.vendor_location_id
                  LEFT JOIN marketplace.catalogue_product_variants ov
                    ON ov.catalogue_variant_id = d.proposed_variant_id
                  LEFT JOIN marketplace.catalogue_products op
                    ON op.catalogue_product_id = ov.catalogue_product_id
                 WHERE d.decision_id = event.decision_id) END AS detail
         FROM marketplace.vendor_order_events event
         JOIN marketplace.vendor_orders orders USING(vendor_order_id)
         JOIN marketplace.checkout_groups grouping USING(checkout_group_id)
        WHERE (event.event_type IN ('ACCEPTED','DECLINED','TIMED_OUT','SUBSTITUTION_PROPOSED',
          'WEIGHT_PROPOSED','READY','PICKED_UP','DELIVERED','RETURNED','SUPPORT_CASE_OPENED')
          OR (event.event_type IN ('SUBSTITUTION_APPROVED','WEIGHT_APPROVED')
              AND event.actor_kind='vendor_staff'))
          AND NOT EXISTS(SELECT 1 FROM marketplace.notification_intents intent
            WHERE intent.source_kind='vendor_order_event' AND intent.source_id=event.event_id)
        ORDER BY event.occurred_at LIMIT $1`,
      [limit],
    );
    // The partner at the customer's door (9.6): the customer is told, so the
    // handover is expected rather than a knock out of nowhere. Nothing of the
    // partner crosses -- the notice is the event, not the person.
    const arrivalSignals = await this.#pool.query<{
      source_id: string;
      recipient_user_id: string;
      event_type: string;
      request_id: string;
      correlation_id: string;
      detail: Record<string, unknown> | null;
    }>(
      `SELECT event.assignment_event_id source_id, grouping.customer_user_id recipient_user_id,
              event.event_type, event.request_id, event.correlation_id,
              jsonb_build_object('order_reference', orders.order_reference) AS detail
         FROM marketplace.assignment_events event
         JOIN marketplace.delivery_assignments assignment USING (delivery_assignment_id)
         JOIN marketplace.vendor_orders orders ON orders.vendor_order_id = assignment.vendor_order_id
         JOIN marketplace.checkout_groups grouping ON grouping.checkout_group_id = orders.checkout_group_id
        WHERE event.event_type = 'ARRIVED'
          AND NOT EXISTS(SELECT 1 FROM marketplace.notification_intents intent
            WHERE intent.source_kind='assignment_event' AND intent.source_id=event.assignment_event_id)
        ORDER BY event.occurred_at LIMIT $1`,
      [limit],
    );
    let created = 0;
    const signals: readonly { sourceKind: string; signal: (typeof orderSignals.rows)[number] }[] = [
      ...waitSignals.rows.map((signal) => ({
        sourceKind: 'partner_wait_event',
        signal: { ...signal, detail: null },
      })),
      ...orderSignals.rows.map((signal) => ({ sourceKind: 'vendor_order_event', signal })),
      ...arrivalSignals.rows.map((signal) => ({ sourceKind: 'assignment_event', signal })),
    ];
    for (const { sourceKind, signal } of signals) {
      const signalContext: RequestContext = {
        ...input.context,
        request_id: parseRequestId(signal.request_id),
        correlation_id: parseUuidV7(signal.correlation_id),
      };
      await this.enqueue({
        context: signalContext,
        recipient_user_id: parseUuidV7(signal.recipient_user_id),
        notification_kind: sourceKind === 'partner_wait_event' ? 'OPERATIONS' : 'ORDER_STATUS',
        template_key: `${sourceKind}.${signal.event_type.toLowerCase()}`,
        template_payload: {
          event: signal.event_type,
          ...(('detail' in signal && signal.detail) || {}),
        },
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
      // IN_APP needs no provider, but it is still a channel a person can be
      // given a choice about (0056). It used to short-circuit this check, which
      // made it the one channel nobody could switch off.
      const enabled = await this.#channelEnabled(
        client,
        intent.recipient_user_id,
        intent.notification_kind,
        channel,
      );
      const delivery =
        enabled && channel !== 'IN_APP'
          ? await (channel === 'SMS' ? this.#smsProvider : this.#pushProvider).send({
              attempt,
              operation_reference: `${intent.notification_intent_id}-${channel}`,
              payload: intent.template_payload,
              scenario: intent.provider_scenario,
            })
          : null;
      const state = !enabled
        ? 'SKIPPED'
        : channel === 'IN_APP'
          ? 'DELIVERED'
          : (delivery?.state ?? 'FAILED');
      retry ||= delivery?.retryable ?? false;
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
          channel === 'IN_APP' && state === 'DELIVERED'
            ? `SYNTH-NOTIFY-${intent.notification_intent_id}-${channel}`
            : (delivery?.provider_reference ?? null),
          delivery?.error_code ?? null,
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
