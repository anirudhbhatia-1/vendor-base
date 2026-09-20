import assert from 'node:assert/strict';
import test from 'node:test';
import { PLACED_ORDER_ALERT, alertsToAcknowledge } from './order-alerts.js';

const notice = (id: string, key: string, orderId: unknown) => ({
  in_app_notification_id: id,
  template_key: key,
  template_payload: { vendor_order_id: orderId },
});

test('only the placed-order alerts for orders the console shows are acknowledged', () => {
  const alerts = alertsToAcknowledge(
    [
      notice('n1', PLACED_ORDER_ALERT, 'o1'),
      notice('n2', PLACED_ORDER_ALERT, 'other-location'),
      notice('n3', 'vendor_order_event.placed_escalation', 'o1'),
      notice('n4', PLACED_ORDER_ALERT, 42),
      notice('n1', PLACED_ORDER_ALERT, 'o1'),
    ],
    ['o1', 'o2'],
  );
  assert.deepEqual(alerts, [{ in_app_notification_id: 'n1', vendor_order_id: 'o1' }]);
});

test('an order that is no longer waiting is not acknowledged on its behalf', () => {
  assert.deepEqual(alertsToAcknowledge([notice('n1', PLACED_ORDER_ALERT, 'o1')], []), []);
});
