import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';
const apiUrl = 'http://10.0.2.2:3001';
type Item = {
  kind: string;
  object_id: string;
  title: string;
  risk_minor: number;
  next_action: string;
};
export function ControlPlane() {
  const [token, setToken] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState('Connect an authorized admin session.');
  const [report, setReport] = useState('');
  async function request(path: string) {
    const response = await fetch(`${apiUrl}/admin/control/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Control request denied (${response.status}).`);
    return response.json();
  }
  async function load() {
    try {
      const body = (await request('dashboard')) as { items: Item[] };
      setItems(body.items);
      setMessage(
        body.items.length ? 'Operations queues loaded by risk and age.' : 'All queues clear.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Dashboard failed.');
    }
  }
  async function finance() {
    try {
      const body = await request('reports/FINANCE');
      setReport(JSON.stringify(body));
      setMessage('Finance report refreshed.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Report failed.');
    }
  }
  return (
    <View style={s.panel}>
      <Text style={s.kicker}>PHASE 11 CONTROL PLANE</Text>
      <Text style={s.heading}>Accountable operations queue</Text>
      <TextInput
        value={token}
        onChangeText={setToken}
        placeholder="Admin access token"
        style={s.input}
      />
      <View style={s.actions}>
        <Button label="Load queues" onPress={load} />
        <Button label="Finance report" onPress={finance} />
      </View>
      <Text style={s.message}>{message}</Text>
      {items.map((item) => (
        <View key={`${item.kind}-${item.object_id}`} style={s.item}>
          <Text style={s.kind}>{item.kind}</Text>
          <Text style={s.title}>{item.title.replaceAll('_', ' ')}</Text>
          <Text style={s.meta}>
            {item.next_action.replaceAll('_', ' ')}
            {item.risk_minor ? ` · ₹${(item.risk_minor / 100).toFixed(2)} at risk` : ''}
          </Text>
        </View>
      ))}
      {report ? <Text style={s.report}>{report}</Text> : null}
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
    marginTop: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.panel,
    backgroundColor: colors.surface,
  },
  kicker: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  heading: { marginTop: 4, color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  input: { marginTop: spacing.md, padding: 10, borderWidth: 1, borderColor: colors.border },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.textPrimary,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  message: {
    marginTop: spacing.md,
    padding: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#B58A20',
    backgroundColor: '#FFF9DF',
  },
  item: { marginTop: spacing.sm, padding: 12, backgroundColor: '#F3F6F3' },
  kind: { color: colors.textSecondary, fontSize: 10, fontWeight: '800' },
  title: { marginTop: 3, color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  meta: { marginTop: 3, color: colors.textSecondary, fontSize: 12 },
  report: {
    marginTop: spacing.md,
    padding: 10,
    backgroundColor: '#152019',
    color: '#E9F4EB',
    fontSize: 10,
  },
});
