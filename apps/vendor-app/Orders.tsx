import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
const apiUrl = 'http://10.0.2.2:3001';
type Order = {
  vendor_order_id: string;
  order_reference: string;
  lifecycle_state: string;
  total_minor: number;
  version: number;
};
export function Orders() {
  const [token, setToken] = useState('');
  const [location, setLocation] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState('Connect the live store order desk.');
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${apiUrl}/vendor/locations/${location}/orders${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!response.ok) throw new Error(`Order request failed (${response.status}).`);
    return response.json();
  }
  async function load() {
    try {
      const body = (await request('')) as { orders: Order[] };
      setOrders(body.orders);
      setMessage(body.orders.length ? 'Server orders loaded.' : 'No store orders.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Orders failed.');
    }
  }
  async function action(order: Order, path: string, body: object) {
    try {
      await request(`/${order.vendor_order_id}/${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Action failed.');
    }
  }
  return (
    <View style={s.panel}>
      <Text style={s.kicker}>LIVE FULFILMENT</Text>
      <Text style={s.heading}>Accept and prepare orders</Text>
      <TextInput value={token} onChangeText={setToken} placeholder="Vendor token" style={s.input} />
      <TextInput
        value={location}
        onChangeText={setLocation}
        placeholder="Location UUID"
        style={s.input}
      />
      <Button label="Load orders" onPress={load} />
      <Text style={s.message}>{message}</Text>
      {orders.map((order) => (
        <View key={order.vendor_order_id} style={s.order}>
          <Text style={s.ref}>{order.order_reference}</Text>
          <Text style={s.title}>
            {order.lifecycle_state.replaceAll('_', ' ')} · ₹{(order.total_minor / 100).toFixed(2)}
          </Text>
          {order.lifecycle_state === 'PLACED' && (
            <Button
              label="Accept · 15 min"
              onPress={() =>
                action(order, 'accept', {
                  expected_version: order.version,
                  preparation_estimate_seconds: 900,
                })
              }
            />
          )}{' '}
          {order.lifecycle_state === 'ACCEPTED' && (
            <Button
              label="Start picking"
              onPress={() => action(order, 'start-picking', { expected_version: order.version })}
            />
          )}{' '}
          {order.lifecycle_state === 'PICKING' && (
            <Button
              label="Mark one package ready"
              onPress={() =>
                action(order, 'ready', {
                  expected_version: order.version,
                  package_count: 1,
                  package_condition_note: 'SYNTH Sealed',
                })
              }
            />
          )}{' '}
          {order.lifecycle_state === 'READY' && (
            <Button label="Issue pickup OTP" onPress={() => action(order, 'pickup-otp', {})} />
          )}
        </View>
      ))}
    </View>
  );
}
function Button({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.button}>
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  panel: {
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ccd5ce',
    backgroundColor: '#fff',
  },
  kicker: { color: '#667068', fontSize: 10, fontWeight: '800' },
  heading: { marginTop: 4, color: '#17211b', fontSize: 22, fontWeight: '800' },
  input: { marginTop: 8, padding: 10, borderWidth: 1, borderColor: '#ccd5ce' },
  button: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#1f6846',
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  message: { marginTop: 12, padding: 10, backgroundColor: '#e6f1e9' },
  order: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#ccd5ce' },
  ref: { color: '#667068', fontSize: 10 },
  title: { marginTop: 4, color: '#17211b', fontWeight: '700' },
});
