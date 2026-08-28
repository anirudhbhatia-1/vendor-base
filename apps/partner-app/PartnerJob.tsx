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
type Availability = {
  availability_state: string;
  trips_today: string;
  earnings_today_minor: string;
  warning_codes: string[];
};
type WaitTimer = {
  wait_state: 'RUNNING' | 'THRESHOLD_ONE' | 'THRESHOLD_TWO' | 'LEFT_POLICY' | 'RESOLVED';
  elapsed_seconds: number;
  wait_adjustment_minor: number | null;
};
type Notice = { in_app_notification_id: string; template_key: string };
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
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [waitTimer, setWaitTimer] = useState<WaitTimer | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
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
  async function dispatch(state: 'ONLINE' | 'OFFLINE') {
    try {
      await request('partner/availability', {
        method: 'POST',
        body: JSON.stringify({
          state,
          reason_code: state === 'ONLINE' ? 'PARTNER_AVAILABLE' : 'PARTNER_OFFLINE',
          ...(state === 'ONLINE'
            ? { latitude: 26.8505, longitude: 75.7628, accuracy_meters: 25, battery_percent: 80 }
            : {}),
        }),
      });
      setAvailability((await request('partner/availability')) as Availability);
      setMessage(`Dispatch state changed to ${state}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Availability failed.');
    }
  }
  async function wait(action: 'start' | 'refresh' | 'leave') {
    if (!job) return;
    try {
      const next = (await request(
        `partner/assignments/${job.delivery_assignment_id}/wait/${action}`,
        {
          method: 'POST',
          ...(action === 'refresh'
            ? {}
            : {
                body: JSON.stringify({
                  command_reference: `SYNTH-CMD-WAIT-${Date.now().toString(36).toUpperCase()}`,
                  reason_code: action === 'start' ? 'CUSTOMER_WAIT_STARTED' : 'WAIT_POLICY_LEAVE',
                }),
              }),
        },
      )) as WaitTimer;
      setWaitTimer(next);
      if (action === 'leave') await load();
      setMessage(`Wait state changed to ${next.wait_state}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Wait action failed.');
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
      <View style={s.job}>
        <Text style={s.state}>{availability?.availability_state ?? 'DISPATCH OFFLINE'}</Text>
        <Text style={s.meta}>
          {availability
            ? `${availability.trips_today} trips today · ₹${(Number(availability.earnings_today_minor) / 100).toFixed(2)}`
            : 'Load a partner session to update availability.'}
        </Text>
        <View style={s.inline}>
          <Button label="Go online" onPress={() => void dispatch('ONLINE')} />
          <Button label="Go offline" onPress={() => void dispatch('OFFLINE')} />
        </View>
      </View>
      {job && (
        <View style={s.job}>
          <Text style={s.state}>{job.assignment_state}</Text>
          <Text style={s.meta}>
            {job.package_count} packages · {job.approximate_pickup_area} →{' '}
            {job.approximate_drop_area}
          </Text>
          <Button disabled={!action} label={action?.[0] ?? 'Await operations'} onPress={advance} />
          <Button label="Customer unreachable" onPress={exception} />
          {job.assignment_state === 'ARRIVED' && (
            <View style={s.job}>
              <Text style={s.meta}>
                {waitTimer
                  ? `${waitTimer.wait_state} · ${waitTimer.elapsed_seconds}s · credit ${waitTimer.wait_adjustment_minor ?? 'pending'} paise`
                  : 'Server-owned customer wait timer is not started.'}
              </Text>
              {!waitTimer && <Button label="Start wait" onPress={() => void wait('start')} />}
              {waitTimer && <Button label="Refresh timer" onPress={() => void wait('refresh')} />}
              {waitTimer?.wait_state === 'THRESHOLD_TWO' && (
                <Button label="Leave under policy" onPress={() => void wait('leave')} />
              )}
            </View>
          )}
        </View>
      )}
      <Button label="Refresh earnings" onPress={loadEarnings} />
      <Button label="Unread notifications" onPress={notifications} />
      {earnings.map((e) => (
        <Text key={e.partner_earnings_record_id} style={s.earning}>
          {e.lifecycle_state} · ₹{(e.total_minor / 100).toFixed(2)}
        </Text>
      ))}
      {notices.map((notice) => (
        <Text key={notice.in_app_notification_id} style={s.earning}>
          {notice.template_key.replaceAll('.', ' ')}
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
  inline: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
