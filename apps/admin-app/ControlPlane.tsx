import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, TextInput } from 'react-native';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';
import { createRawRequester } from '@neighbourhood-store/contracts';
const globalEnv =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const apiUrl = globalEnv['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3001';
type Item = {
  kind: string;
  object_id: string;
  title: string;
  risk_minor: number;
  next_action: string;
};
type Notice = { in_app_notification_id: string; template_key: string };
export function ControlPlane({ accessToken = '' }: { accessToken?: string } = {}) {
  const token = accessToken;
  const [items, setItems] = useState<Item[]>([]);
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [message, setMessage] = useState(
    token ? 'Signed in. Press Load queues.' : 'Sign in with admin credentials above.',
  );
  const [report, setReport] = useState('');
  const [accessUserId, setAccessUserId] = useState('');
  const [roleAssignmentId, setRoleAssignmentId] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [configurationVersionId, setConfigurationVersionId] = useState('');
  async function request(path: string, init?: RequestInit) {
    const raw = createRawRequester({ baseUrl: apiUrl, getToken: () => token });
    return raw<unknown>(`/${path}`, init);
  }
  async function load() {
    try {
      const body = (await request('admin/control/dashboard')) as { items: Item[] };
      setItems(body.items);
      setMessage(
        body.items.length ? 'Operations queues loaded by risk and age.' : 'All queues clear.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Dashboard failed.');
    }
  }
  async function loadOrders() {
    try {
      const body = (await request('admin/control/orders')) as {
        checkout_groups?: Record<string, unknown>[];
      };
      setOrders(body.checkout_groups ?? []);
      setMessage(`Order monitor: ${(body.checkout_groups ?? []).length} checkout group(s).`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Order monitor failed.');
    }
  }
  async function finance() {
    try {
      const body = await request('admin/control/reports/FINANCE');
      setReport(JSON.stringify(body));
      setMessage('Finance report refreshed.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Report failed.');
    }
  }
  async function grantSupport() {
    try {
      const body = (await request(`admin/access/users/${accessUserId}/memberships`, {
        method: 'POST',
        body: JSON.stringify({ role: 'SUPPORT_AGENT', scope_kind: 'GLOBAL' }),
      })) as { role_assignment_id: string };
      setRoleAssignmentId(body.role_assignment_id);
      setMessage(`Support membership granted: ${body.role_assignment_id}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Membership grant failed.');
    }
  }
  async function revokeSupport() {
    try {
      await request(`admin/access/users/${accessUserId}/memberships/${roleAssignmentId}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason_code: 'ADMIN_ACCESS_REVOKED' }),
      });
      setMessage(`Membership revoked: ${roleAssignmentId}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Membership revoke failed.');
    }
  }
  async function notifications() {
    try {
      setNotices((await request('notifications?unread_only=true')) as Notice[]);
      setMessage('Unread notifications refreshed.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Notifications failed.');
    }
  }
  async function createConfiguration() {
    try {
      const body = (await request('admin/configuration/drafts', {
        method: 'POST',
        body: JSON.stringify({
          configuration_key: 'delivery.wait.enabled',
          configuration_kind: 'FEATURE_FLAG',
          configuration_value: true,
          scope_kind: 'GLOBAL',
          scope_reference: 'global',
          reason_code: 'COMPANY_TEST_CONFIGURATION',
        }),
      })) as { configuration_version_id: string };
      setConfigurationVersionId(body.configuration_version_id);
      setMessage(`Configuration draft created: ${body.configuration_version_id}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Configuration draft failed.');
    }
  }
  return (
    <View style={s.panel}>
      <Text style={s.kicker}>CONTROL PLANE</Text>
      <Text style={s.heading}>Accountable operations queue</Text>
      <View style={s.actions}>
        <Button label="Load queues" onPress={() => token && void load()} />
        <Button label="Load orders" onPress={() => token && void loadOrders()} />
        <Button label="Finance report" onPress={() => token && void finance()} />
        <Button label="Unread notifications" onPress={() => token && void notifications()} />
      </View>
      <Text style={s.message}>{message}</Text>
      <View style={s.item}>
        <Text style={s.kind}>VERSIONED CONFIGURATION</Text>
        <Text style={s.meta}>{configurationVersionId || 'No draft created in this session.'}</Text>
        <Button label="Create wait-policy draft" onPress={createConfiguration} />
      </View>
      <View style={s.item}>
        <Text style={s.kind}>CONTROLLED ACCESS · CONFIG APPROVER ONLY</Text>
        <TextInput
          value={accessUserId}
          onChangeText={setAccessUserId}
          placeholder="Target user UUID"
          style={s.input}
        />
        <TextInput
          value={roleAssignmentId}
          onChangeText={setRoleAssignmentId}
          placeholder="Role assignment UUID for revoke"
          style={s.input}
        />
        <View style={s.actions}>
          <Button label="Grant support role" onPress={grantSupport} />
          <Button label="Revoke role" onPress={revokeSupport} />
        </View>
      </View>
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
      {orders.map((row, idx) => {
        const ref =
          typeof row['checkout_reference'] === 'string'
            ? row['checkout_reference']
            : `Group ${idx + 1}`;
        const state = typeof row['lifecycle_state'] === 'string' ? row['lifecycle_state'] : '';
        const nested = Array.isArray(row['orders']) ? (row['orders'] as unknown[]).length : 0;
        return (
          <View key={`order-${idx}`} style={s.item}>
            <Text style={s.kind}>CHECKOUT GROUP</Text>
            <Text style={s.title}>{ref}</Text>
            <Text style={s.meta}>
              {state.replaceAll('_', ' ')} · {nested} vendor order{nested === 1 ? '' : 's'}
            </Text>
          </View>
        );
      })}
      {notices.map((notice) => (
        <Text style={s.meta} key={notice.in_app_notification_id}>
          {notice.template_key.replaceAll('.', ' ')}
        </Text>
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
