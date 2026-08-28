import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';
const apiUrl = 'http://10.0.2.2:3001';
type Order = {
  vendor_order_id: string;
  order_reference: string;
  lifecycle_state: string;
  total_minor: number;
};
type Notice = { in_app_notification_id: string; template_key: string };
export function Orders() {
  const [token, setToken] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState('Connect a customer session.');
  const [notices, setNotices] = useState<Notice[]>([]);
  async function call(path: string, init?: RequestInit) {
    const r = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!r.ok) throw new Error(`Request failed (${r.status}).`);
    return r.json();
  }
  async function load() {
    try {
      const b = (await call('/customer/orders')) as { groups: { vendor_orders: Order[] }[] };
      setOrders(b.groups.flatMap((g) => g.vendor_orders));
      setMessage('Order history refreshed.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'History failed.');
    }
  }
  async function action(id: string, kind: 'rating' | 'support') {
    try {
      await call(`/customer/orders/${id}/${kind}`, {
        method: 'POST',
        body: JSON.stringify(
          kind === 'rating'
            ? { stars: 5, review_note: 'SYNTH Android company-test rating' }
            : { category: 'ORDER_HELP', description: 'SYNTH Android customer requested support.' },
        ),
      });
      setMessage(kind === 'rating' ? 'Rating recorded.' : 'Support case opened.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Action failed.');
    }
  }
  async function notifications() {
    try {
      setNotices((await call('/notifications?unread_only=true')) as Notice[]);
      setMessage('Unread notifications refreshed.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Notifications failed.');
    }
  }
  return (
    <View style={s.panel}>
      <Text style={s.kicker}>ORDER HISTORY</Text>
      <Text style={s.heading}>Receipts and support</Text>
      <TextInput
        style={s.input}
        value={token}
        onChangeText={setToken}
        placeholder="Customer access token"
      />
      <Pressable style={s.button} onPress={() => void load()}>
        <Text style={s.buttonText}>Load orders</Text>
      </Pressable>
      <Pressable style={s.button} onPress={() => void notifications()}>
        <Text style={s.buttonText}>Unread notifications</Text>
      </Pressable>
      <Text style={s.message}>{message}</Text>
      {orders.map((o) => (
        <View style={s.row} key={o.vendor_order_id}>
          <Text style={s.title}>{o.order_reference}</Text>
          <Text style={s.meta}>
            {o.lifecycle_state.replaceAll('_', ' ')} · ₹{(o.total_minor / 100).toFixed(2)}
          </Text>
          <View style={s.actions}>
            <Pressable style={s.small} onPress={() => void action(o.vendor_order_id, 'rating')}>
              <Text style={s.buttonText}>Rate 5★</Text>
            </Pressable>
            <Pressable style={s.small} onPress={() => void action(o.vendor_order_id, 'support')}>
              <Text style={s.buttonText}>Get help</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {notices.map((notice) => (
        <Text style={s.message} key={notice.in_app_notification_id}>
          {notice.template_key.replaceAll('.', ' ')}
        </Text>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  panel: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: colors.surface,
  },
  kicker: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  heading: { marginTop: 4, color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  input: { marginTop: spacing.sm, padding: 10, borderWidth: 1, borderColor: colors.border },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.textPrimary,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  message: { marginTop: spacing.sm, color: colors.textSecondary },
  row: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  title: { color: colors.textPrimary, fontWeight: '700' },
  meta: { marginTop: 3, color: colors.textSecondary, fontSize: 11 },
  actions: { flexDirection: 'row', gap: 8 },
  small: { marginTop: 8, padding: 8, backgroundColor: colors.textPrimary },
});
