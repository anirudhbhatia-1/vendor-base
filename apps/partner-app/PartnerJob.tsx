import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing } from '@neighbourhood-store/ui-tokens/native';
import { createApiClient, createRawRequester } from '@neighbourhood-store/contracts';
const globalEnv =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const apiUrl = globalEnv['EXPO_PUBLIC_API_URL'] ?? 'http://10.0.2.2:3001';
type Job = {
  delivery_assignment_id: string;
  assignment_state: string;
  version: number;
  package_count: number;
  approximate_pickup_area: string;
  /** True while a safety report on this job is open. Decided by the server. */
  open_emergency?: boolean;
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
type Offer = {
  delivery_assignment_id: string;
  package_count: number;
  approximate_pickup_area: string;
  approximate_drop_area: string;
  offer_expires_at: string | null;
  version: number;
};

export function PartnerJob({ accessToken = '' }: { accessToken?: string } = {}) {
  const token = accessToken;
  const [job, setJob] = useState<Job | null>(null);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [message, setMessage] = useState(
    token ? 'Signed in. Go online to receive offers.' : 'Sign in above.',
  );
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [waitTimer, setWaitTimer] = useState<WaitTimer | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  // The customer's delivery code (CUS-56). Completion is refused without it.
  const [otp, setOtp] = useState('');
  const [pickupCode, setPickupCode] = useState<string | null>(null);
  async function request(path: string, init?: RequestInit) {
    const raw = createRawRequester({ baseUrl: apiUrl, getToken: () => token });
    return raw<unknown>(`/${path}`, init);
  }
  async function loadOffers() {
    if (!token) return;
    try {
      const client = createApiClient({ baseUrl: apiUrl, getToken: () => token });
      const body = await client.partner.offers();
      setOffers(body.offers);
    } catch {
      // silent
    }
  }
  async function acceptOffer(offer: Offer) {
    try {
      await request(`partner/offers/${offer.delivery_assignment_id}/accept`, {
        method: 'POST',
        body: JSON.stringify({
          command_reference: `SYNTH-CMD-ANDROID-ACCEPT-${Date.now().toString(36).toUpperCase()}`,
          expected_version: offer.version,
          reason_code: 'PARTNER_ACCEPTED',
        }),
      });
      const next = (await request(`partner/assignments/${offer.delivery_assignment_id}`)) as Job;
      setJob(next);
      setMessage('Offer accepted. Custody is yours.');
      await loadOffers();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Accept failed.');
    }
  }
  /**
   * The code the store hands the order over against (DLP-24). Minted only once
   * the partner has marked arrival; the server refuses it from the road.
   */
  async function showPickupCode() {
    if (!job) return;
    try {
      const issued = (await request(
        `partner/assignments/${job.delivery_assignment_id}/pickup-otp`,
        {
          method: 'POST',
          body: '{}',
        },
      )) as { plaintext_otp: string };
      setPickupCode(issued.plaintext_otp);
      setMessage('Read this code to the store.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The pickup code could not be issued.');
    }
  }
  async function advance() {
    if (!job) return;
    if (job.open_emergency === true) {
      setMessage('This job is on hold while your safety report is open.');
      return;
    }
    const action = actions[job.assignment_state];
    if (!action) return;
    if (job.assignment_state === 'ARRIVED' && !/^\d{6}$/.test(otp)) {
      setMessage('Ask the customer to read the six-digit code from their order screen.');
      return;
    }
    try {
      const body = {
        command_reference: `SYNTH-CMD-ANDROID-${Date.now().toString(36).toUpperCase()}`,
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
          ? {
              // The code proves the partner is at the right door with the right
              // order. A self-generated reference proves nothing, and the route
              // has required `otp` since the control landed — so this app could
              // not complete a single delivery.
              otp,
              proof_reference: `SYNTH-PROOF-DELIVERY-${Date.now().toString(36).toUpperCase()}`,
            }
          : {}),
      };
      const next = (await request(
        `partner/${action[1].replace('{id}', job.delivery_assignment_id)}`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      )) as Job & { arrival_claim?: unknown };
      setJob(next);
      setOtp('');
      // This shell has no device fix yet (see `dispatch`), so an arrival is a
      // claim for the store to confirm (9.4), never presence on its own word.
      setMessage(
        job.assignment_state === 'ASSIGNED' && next.arrival_claim
          ? 'Arrival noted. The store has to confirm you are at the counter.'
          : `${action[0]} persisted.`,
      );
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
          // Android geolocation is a separate permission; use a synthetic
          // Mansarovar centre until the platform integration is added.
          ...(state === 'ONLINE'
            ? { latitude: 26.8505, longitude: 75.7628, accuracy_meters: 250, battery_percent: 80 }
            : {}),
        }),
      });
      setAvailability((await request('partner/availability')) as Availability);
      setMessage(`Dispatch state changed to ${state}.`);
      if (state === 'ONLINE') await loadOffers();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Availability failed.');
    }
  }

  useEffect(() => {
    if (!token || availability?.availability_state !== 'ONLINE') return;
    const id = setInterval(() => void loadOffers(), 10_000);
    return () => clearInterval(id);
  }, [token, availability?.availability_state]);
  // Presence: dispatch offers work only to partners whose device has confirmed
  // itself within the last few minutes. Going online once is not enough. The
  // same synthetic position as `dispatch` until platform geolocation lands; a
  // refusal means the server no longer has this partner online.
  useEffect(() => {
    if (!token || availability?.availability_state !== 'ONLINE') return;
    const beat = async () => {
      try {
        await request('partner/availability/heartbeat', {
          method: 'POST',
          body: JSON.stringify({ latitude: 26.8505, longitude: 75.7628, accuracy_meters: 250 }),
        });
      } catch {
        setAvailability(
          (await request('partner/availability').catch(() => null)) as Availability | null,
        );
      }
    };
    void beat();
    const id = setInterval(() => void beat(), 60_000);
    return () => clearInterval(id);
  }, [token, availability?.availability_state]);
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
      if (action === 'leave' && job) {
        const refreshed = (await request(
          `partner/assignments/${job.delivery_assignment_id}`,
        )) as Job;
        setJob(refreshed);
      }
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
  // A job with an open safety report does not move, on this surface either. The
  // web workspace already holds it; leaving the shell unguarded would mean the
  // same job answered differently depending on which app the partner opened.
  const blocked = job?.open_emergency === true;
  const action = job && !blocked ? actions[job.assignment_state] : undefined;
  return (
    <View style={s.panel}>
      <Text style={s.kicker}>LIVE LOCAL JOB</Text>
      <Text style={s.message}>{message}</Text>
      {offers.length > 0 && (
        <View style={s.job}>
          <Text style={s.state}>Incoming offers</Text>
          {offers.map((offer) => (
            <View key={offer.delivery_assignment_id} style={s.job}>
              <Text style={s.meta}>
                {offer.package_count} package(s) · {offer.approximate_pickup_area} →{' '}
                {offer.approximate_drop_area}
              </Text>
              <Button label="Accept" onPress={() => void acceptOffer(offer)} />
            </View>
          ))}
        </View>
      )}
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
          {job.assignment_state === 'AT_VENDOR' && (
            <>
              <Text accessibilityLabel="Your pickup code" style={s.state}>
                {pickupCode ?? '— — — — — —'}
              </Text>
              <Text style={s.meta}>The store needs this code to hand the order to you.</Text>
              <Button
                label={pickupCode ? 'Get a fresh code' : 'Show my pickup code'}
                onPress={() => void showPickupCode()}
              />
            </>
          )}
          {job.assignment_state === 'ARRIVED' && (
            <>
              <Text style={s.meta}>Ask the customer to read the code from their order screen.</Text>
              <TextInput
                accessibilityLabel="Customer's delivery code"
                inputMode="numeric"
                maxLength={6}
                onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit delivery code"
                style={s.input}
                value={otp}
              />
            </>
          )}
          <Button
            disabled={!action || (job.assignment_state === 'ARRIVED' && !/^\d{6}$/.test(otp))}
            label={action?.[0] ?? 'Await operations'}
            onPress={advance}
          />
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
