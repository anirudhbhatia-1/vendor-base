'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  EmptyState,
  LoadingState,
  Notice,
  formatMoneyMinor,
} from '@neighbourhood-store/ui';
import { customerApiClient, readCustomerSession } from './customer-session';
import { displayLabel } from './display';
import { useLocale } from './locale';

type Notice = {
  in_app_notification_id: string;
  template_key: string;
  template_payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

/**
 * Turns a notification template and its payload into a sentence.
 *
 * The inbox previously rendered `JSON.stringify(template_payload)` — a
 * customer was shown `{"order_reference":"SYNTH-ORDER-01K…"}` and expected to
 * make sense of it. COM-06 requires template-first messaging; unknown templates
 * degrade to the template's own words rather than to its serialised data.
 */
function describe(notice: Notice, t: (key: string, fallback: string) => string): string {
  const payload = notice.template_payload;
  const store =
    typeof payload['location_name'] === 'string' ? displayLabel(payload['location_name']) : null;
  const amount =
    typeof payload['amount_minor'] === 'number' ? formatMoneyMinor(payload['amount_minor']) : null;

  const theStore = store ?? t('customer.notification.the_store', 'The store');
  // A decision's notice says what it is about (8.4): the item as ordered,
  // what is offered instead, and the difference. Without the payload it falls
  // back to the sentence alone.
  const offer =
    typeof payload['ordered_title'] === 'string' && typeof payload['offered_title'] === 'string'
      ? `${displayLabel(payload['ordered_title'])} (${String(payload['ordered_quantity'] ?? '')}) → ${displayLabel(payload['offered_title'])} (${String(payload['offered_quantity'] ?? '')})${
          typeof payload['difference_minor'] === 'number' && payload['difference_minor'] !== 0
            ? `, ${payload['difference_minor'] > 0 ? '+' : '−'}${formatMoneyMinor(Math.abs(payload['difference_minor']))}`
            : ''
        }. `
      : '';

  // The domain sweep names a template after the table it read and the event it
  // found — `vendor_order_event.accepted`. Every case below used to be written
  // against a different, shorter vocabulary that nothing emitted, so every
  // notification a customer received fell through to the default and was shown
  // its own key with the dots taken out.
  switch (notice.template_key) {
    case 'notification.pickup_ready.body':
    case 'order.ready':
    case 'vendor_order_event.ready':
      return `${theStore} ${t('customer.notification.ready', 'has your order ready to collect.')}`;
    case 'order.accepted':
    case 'vendor_order_event.accepted':
      return `${theStore} ${t('customer.notification.accepted', 'accepted your order and started packing.')}`;
    case 'vendor_order_event.declined':
      return `${theStore} ${t('customer.notification.declined', 'could not take this order. Nothing has been charged for it.')}`;
    case 'vendor_order_event.timed_out':
      return `${theStore} ${t('customer.notification.timed_out', 'did not answer in time, so the order was cancelled. Nothing has been charged for it.')}`;
    case 'order.customer_decision_required':
    case 'vendor_order_event.substitution_proposed':
      return `${offer}${t(
        'customer.notification.decision',
        'A store needs your answer before it can pack your order.',
      )}`;
    case 'vendor_order_event.weight_proposed':
      return `${offer}${t(
        'customer.notification.weight_decision',
        'A store weighed an item and needs you to accept the final price.',
      )}`;
    case 'vendor_order_event.substitution_approved':
      return `${offer}${t(
        'customer.notification.substitution_applied',
        'The shop replaced an item with a close match, as you allowed. You are not charged more.',
      )}`;
    case 'vendor_order_event.weight_approved':
      return `${offer}${t(
        'customer.notification.weight_applied',
        'An item weighed lighter than ordered. You pay only for what you get.',
      )}`;
    case 'vendor_order_event.picked_up':
      return t('customer.notification.picked_up', 'Your order has left the shop.');
    case 'delivery.completed':
    case 'vendor_order_event.delivered':
      return t('customer.notification.delivered', 'Your order was delivered.');
    case 'vendor_order_event.returned':
      return t(
        'customer.notification.returned',
        'Your order could not be delivered and went back to the shop. We have opened a case and will come back to you.',
      );
    case 'vendor_order_event.support_case_opened':
      return t('customer.notification.support_opened', 'Your support case is open.');
    case 'refund.completed':
      return amount
        ? `${t('customer.notification.refunded', 'A refund of')} ${amount} ${t('customer.notification.refunded_tail', 'is on its way back to you.')}`
        : t('customer.notification.refunded_plain', 'A refund is on its way back to you.');
    default:
      return notice.template_key.replaceAll('.', ' ').replaceAll('_', ' ');
  }
}

export function NotificationInbox() {
  const { t } = useLocale();
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const client = await customerApiClient();
    if (path === '?unread_only=false') return client.notifications.list();
    const match = /^\/([^/]+)\/read$/.exec(path);
    if (init?.method === 'POST' && match?.[1]) return client.notifications.markRead(match[1]);
    throw new Error('Unsupported notification request');
  }, []);

  const refresh = useCallback(async () => {
    if (!readCustomerSession()) {
      setLoaded(true);
      return;
    }
    try {
      const result = await call('?unread_only=false');
      setNotices('notifications' in result ? result.notifications : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your updates could not be loaded.');
    } finally {
      setLoaded(true);
    }
  }, [call]);

  // Loads on mount. The inbox previously waited for a "Refresh inbox" press,
  // so an actionable alert sat unseen behind an empty panel.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!loaded) {
    return (
      <LoadingState
        label={t('customer.notifications.loading', 'Loading your updates…')}
        lines={2}
      />
    );
  }

  return (
    <div className="ns-stack">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notices.length === 0 ? (
        <EmptyState
          description={t(
            'customer.notifications.empty.description',
            'Order, refund and support updates will collect here.',
          )}
          glyph="◔"
          title={t('customer.notifications.empty.title', 'Nothing new')}
        />
      ) : (
        <ul className="notification-list">
          {notices.map((notice) => (
            <li key={notice.in_app_notification_id}>
              <Card tone={notice.read_at ? 'sunken' : 'raised'}>
                <p className="notification-body">{describe(notice, t)}</p>
                <p className="ns-eyebrow">{new Date(notice.created_at).toLocaleString()}</p>
                {notice.read_at ? null : (
                  <Button
                    onClick={() =>
                      void call(`/${notice.in_app_notification_id}/read`, { method: 'POST' }).then(
                        () => refresh(),
                      )
                    }
                    size="small"
                    variant="secondary"
                  >
                    {t('customer.notifications.mark_read', 'Mark as read')}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={() => void refresh()} variant="secondary">
        {t('customer.refresh', 'Refresh')}
      </Button>
    </div>
  );
}
