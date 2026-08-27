import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';
const apiUrl = 'http://10.0.2.2:3001';
type Job = {
  delivery_assignment_id: string;
  assignment_state: string;
  version: number;
  package_count: number;
  approximate_pickup_area: string;
  approximate_drop_area: string;
};
type Earning = { partner_earnings_record_id: string; total_minor: number; lifecycle_state: string };
const actions: Record<string, [string, string]> = {
  OFFERED: ['Accept job', 'offers/{id}/accept'],
  ASSIGNED: ['Arrive at vendor', 'assignments/{id}/arrive-vendor'],
  AT_VENDOR: ['Verify pickup', 'assignments/{id}/pickup'],
  PICKED_UP: ['Begin route', 'assignments/{id}/begin-route'],
  EN_ROUTE_TO_CUSTOMER: ['Arrive near customer', 'assignments/{id}/arrive-customer'],
  ARRIVED: ['Record delivery', 'assignments/{id}/deliver'],
};
export function PartnerJob() {
  const [token, setToken] = useState('');
  const [id, setId] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [message, setMessage] = useState('Connect an authorized assignment.');
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${apiUrl}/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (!response.ok) throw new Error(`Server rejected the step (${response.status}).`);
    return response.json();
  }
  async function load() {
    try {
      setJob((await request(`partner/assignments/${id}`)) as Job);
      setMessage('Custody state loaded from the server.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Job failed.');
    }
  }
  async function advance() {
    if (!job) return;
    const action = actions[job.assignment_state];
    if (!action) return;
    try {
      const body = {
        command_reference: `SYNTH-ANDROID-${Date.now().toString(36).toUpperCase()}`,
        expected_version: job.version,
        reason_code: 'PARTNER_CONFIRMED',
        ...(job.assignment_state === 'AT_VENDOR'
          ? {
              package_count: job.package_count,
              proof_reference: `SYNTH-PROOF-PICKUP-${Date.now().toString(36).toUpperCase()}`,
              vendor_confirmed: true,
            }
          : {}),
        ...(job.assignment_state === 'ARRIVED'
          ? { proof_reference: `SYNTH-PROOF-DELIVERY-${Date.now().toString(36).toUpperCase()}` }
          : {}),
      };
      setJob(
        (await request(`partner/${action[1].replace('{id}', job.delivery_assignment_id)}`, {
          method: 'POST',
          body: JSON.stringify(body),
        })) as Job,
      );
      setMessage(`${action[0]} persisted.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Step failed.');
    }
  }
  async function exception() {
    if (!job) return;
    try {
      await request(`partner/field/${job.delivery_assignment_id}/exception`, {
        method: 'POST',
        body: JSON.stringify({
          exception_kind: 'CUSTOMER_UNREACHABLE',
          reason_code: 'CUSTOMER_UNREACHABLE',
        }),
      });
      setMessage('Operations exception opened. Custody remains active.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Exception failed.');
    }
  }
  async function loadEarnings() {
    try {
      const body = (await request('partner/earnings')) as { earnings: Earning[] };
      setEarnings(body.earnings);
      setMessage('Ledger earnings refreshed.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Earnings failed.');
    }
  }
  const action = job ? actions[job.assignment_state] : undefined;
  return (
    <View style={s.panel}>
      <Text style={s.kicker}>LIVE LOCAL JOB</Text>
      <TextInput
        value={token}
        onChangeText={setToken}
        placeholder="Partner access token"
        style={s.input}
      />
      <TextInput value={id} onChangeText={setId} placeholder="Assignment UUID" style={s.input} />
      <Button label="Load assignment" onPress={load} />
      <Text style={s.message}>{message}</Text>
      {job && (
        <View style={s.job}>
          <Text style={s.state}>{job.assignment_state}</Text>
          <Text style={s.meta}>
            {job.package_count} packages · {job.approximate_pickup_area} →{' '}
            {job.approximate_drop_area}
          </Text>
          <Button disabled={!action} label={action?.[0] ?? 'Await operations'} onPress={advance} />
          <Button label="Customer unreachable" onPress={exception} />
        </View>
      )}
      <Button label="Refresh earnings" onPress={loadEarnings} />
      {earnings.map((e) => (
        <Text key={e.partner_earnings_record_id} style={s.earning}>
          {e.lifecycle_state} · ₹{(e.total_minor / 100).toFixed(2)}
        </Text>
      ))}
    </View>
  );
}
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[s.button, disabled && s.disabled]}>
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
  input: { marginTop: spacing.sm, padding: 10, borderWidth: 1, borderColor: colors.border },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: radii.control,
    backgroundColor: colors.evergreen,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.4 },
  message: {
    marginTop: spacing.md,
    padding: 10,
    backgroundColor: '#e8f2ff',
    color: colors.textPrimary,
  },
  job: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  state: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  meta: { marginTop: 4, color: colors.textSecondary, lineHeight: 19 },
  earning: { marginTop: spacing.sm, color: colors.textPrimary, fontWeight: '700' },
});
