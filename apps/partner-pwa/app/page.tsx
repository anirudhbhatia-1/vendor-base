'use client';
import { useEffect, useState, type FormEvent } from 'react';
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
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
  accumulated_online_seconds: string;
  warning_codes: string[];
};
type WaitTimer = {
  wait_state: 'RUNNING' | 'THRESHOLD_ONE' | 'THRESHOLD_TWO' | 'LEFT_POLICY' | 'RESOLVED';
  elapsed_seconds: number;
  first_threshold_seconds: number;
  leave_threshold_seconds: number;
  wait_adjustment_minor: number | null;
};
type Notice = { in_app_notification_id: string; template_key: string; read_at: string | null };
const actions: Record<string, [string, string]> = {
  OFFERED: ['Accept this job', 'offers/{id}/accept'],
  ASSIGNED: ['Confirm vendor arrival', 'assignments/{id}/arrive-vendor'],
  AT_VENDOR: ['Verify packages and pick up', 'assignments/{id}/pickup'],
  PICKED_UP: ['Begin route', 'assignments/{id}/begin-route'],
  EN_ROUTE_TO_CUSTOMER: ['Confirm customer-area arrival', 'assignments/{id}/arrive-customer'],
  ARRIVED: ['Record accountable delivery', 'assignments/{id}/deliver'],
};
export default function PartnerHome() {
  const [token, setToken] = useState('');
  const [jobId, setJobId] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Connect a partner session and assigned job.');
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
    if (!response.ok)
      throw new Error(
        `Server rejected this step (${response.status}). Refresh the job before retrying.`,
      );
    return response.json();
  }
  async function load(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    try {
      const next = (await request(`partner/assignments/${jobId}`)) as Job;
      setJob(next);
      sessionStorage.setItem('neighbourhood.partner.token', token);
      setMessage('Server custody record loaded. Every next step is version checked.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Job could not be loaded.');
    } finally {
      setBusy(false);
    }
  }
  async function advance() {
    if (!job) return;
    const action = actions[job.assignment_state];
    if (!action) return;
    setBusy(true);
    try {
      const body = {
        command_reference: `SYNTH-PARTNER-${Date.now().toString(36).toUpperCase()}`,
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
      setMessage(`${action[0]} recorded on the server.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Step failed.');
    } finally {
      setBusy(false);
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
      setMessage('Operations exception opened. Keep custody until instructions arrive.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Exception failed.');
    }
  }
  async function offlineProof() {
    if (!job) return;
    try {
      await request(`partner/field/${job.delivery_assignment_id}/offline-proof`, {
        method: 'POST',
        body: JSON.stringify({
          proof_kind: 'DELIVERY',
          encrypted_payload_digest: 'a'.repeat(64),
          encryption_key_reference: 'SYNTH-KEY-DEVICE-0001',
          captured_at: new Date().toISOString(),
          reason_code: 'NETWORK_UNAVAILABLE',
        }),
      });
      setMessage('Encrypted proof digest saved for reconciliation.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Offline proof failed.');
    }
  }
  async function loadEarnings() {
    try {
      const body = (await request('partner/earnings')) as { earnings: Earning[] };
      setEarnings(body.earnings);
      setMessage('Earnings loaded from the ledger projection.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Earnings failed.');
    }
  }
  async function setDispatch(state: 'ONLINE' | 'OFFLINE') {
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
      const next = (await request('partner/availability')) as Availability;
      setAvailability(next);
      setMessage(`Dispatch state is ${next.availability_state}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Availability failed.');
    }
  }
  async function wait(action: 'start' | 'refresh' | 'leave') {
    if (!job) return;
    try {
      const commandReference = `SYNTH-CMD-WAIT-${Date.now().toString(36).toUpperCase()}`;
      const next = (await request(
        `partner/assignments/${job.delivery_assignment_id}/wait/${action}`,
        {
          method: 'POST',
          ...(action === 'refresh'
            ? {}
            : {
                body: JSON.stringify({
                  command_reference: commandReference,
                  reason_code: action === 'start' ? 'CUSTOMER_WAIT_STARTED' : 'WAIT_POLICY_LEAVE',
                }),
              }),
        },
      )) as WaitTimer;
      setWaitTimer(next);
      if (action === 'leave') await load();
      setMessage(
        next.wait_state === 'THRESHOLD_TWO'
          ? 'The server has reached the leave threshold. Policy leave is now available.'
          : `Wait state: ${next.wait_state}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Wait action failed.');
    }
  }
  async function loadNotifications() {
    try {
      setNotices((await request('notifications?unread_only=true')) as Notice[]);
      setMessage('Unread notification inbox refreshed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Notification inbox failed.');
    }
  }
  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true),
      down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  const action = job ? actions[job.assignment_state] : undefined;
  return (
    <main className="shell">
      <header className="masthead">
        <span className="role-mark">DP</span>
        <div>
          <p className="eyebrow">Delivery Partner · Internal build</p>
          <p className="product-name">Custody desk</p>
        </div>
        <span className="local-badge">{online ? 'ONLINE' : 'OFFLINE'} · SYNTH</span>
      </header>
      <section className="job-head">
        <div>
          <p className="assignment-ref">{job?.delivery_assignment_id ?? 'NO JOB LOADED'}</p>
          <h1>
            One job.
            <br />
            Every handoff accountable.
          </h1>
          <p className="summary">
            The server owns offer expiry, custody, proof, return, exception and earning states.
          </p>
        </div>
        <div className={`custody-seal ${job?.assignment_state === 'DELIVERED' ? 'is-closed' : ''}`}>
          <span className="seal-count">{String(job?.package_count ?? 0).padStart(2, '0')}</span>
          <span className="seal-label">{job?.assignment_state ?? 'Disconnected'}</span>
          <span className="seal-rule" />
          <span className="seal-meta">Server state</span>
        </div>
      </section>
      <form className="partner-connect" onSubmit={load}>
        <label>
          Partner access token
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="nsa_…" />
        </label>
        <label>
          Assignment ID
          <input value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder="UUID" />
        </label>
        <button disabled={busy}>Load assigned job</button>
      </form>
      <p className="partner-message" aria-live="polite">
        {message}
      </p>
      <section className="money-strip">
        <div>
          <strong>Dispatch availability</strong>
          <small>
            {availability
              ? `${availability.trips_today} trips today · ₹${(Number(availability.earnings_today_minor) / 100).toFixed(2)} · ${availability.warning_codes.join(', ') || 'device healthy'}`
              : 'Server status not loaded'}
          </small>
        </div>
        <button onClick={() => void setDispatch('ONLINE')}>Go online</button>
        <button onClick={() => void setDispatch('OFFLINE')}>Go offline</button>
      </section>
      {job && (
        <section className="workbench">
          <div className="route-strip">
            <div>
              <p className="route-label">Pick up near</p>
              <strong>{job.approximate_pickup_area}</strong>
            </div>
            <span>→</span>
            <div>
              <p className="route-label">Drop near</p>
              <strong>{job.approximate_drop_area}</strong>
            </div>
          </div>
          <div className="action-dock">
            <div>
              <p className="dock-label">Current custody state</p>
              <strong>{job.assignment_state}</strong>
            </div>
            <button disabled={busy || !action} onClick={advance}>
              {action?.[0] ?? 'Await operations'}
            </button>
          </div>
        </section>
      )}
      {job?.assignment_state === 'ARRIVED' && (
        <section className="money-strip">
          <div>
            <strong>Customer wait policy</strong>
            <small>
              {waitTimer
                ? `${waitTimer.wait_state} · ${waitTimer.elapsed_seconds}s · credit ${waitTimer.wait_adjustment_minor ?? 'pending'} paise`
                : 'Start only after reaching the customer area. Server time controls both thresholds.'}
            </small>
          </div>
          {!waitTimer && <button onClick={() => void wait('start')}>Start wait</button>}
          {waitTimer && <button onClick={() => void wait('refresh')}>Refresh timer</button>}
          {waitTimer?.wait_state === 'THRESHOLD_TWO' && (
            <button onClick={() => void wait('leave')}>Leave under policy</button>
          )}
        </section>
      )}
      <aside className="failure-note">
        <strong>Delivery cannot continue?</strong>
        <span>Record the exception first. Return only after authorization.</span>
        <div>
          <button onClick={exception} disabled={!job}>
            Customer unreachable
          </button>
          <button onClick={offlineProof} disabled={!job}>
            Save offline proof
          </button>
        </div>
      </aside>
      <section className="money-strip">
        <button onClick={loadEarnings}>Refresh earnings</button>
        <button onClick={() => void loadNotifications()}>Unread notifications</button>
        {earnings.length === 0 ? (
          <small>No posted earning yet.</small>
        ) : (
          earnings.map((e) => (
            <div key={e.partner_earnings_record_id}>
              <span>{e.lifecycle_state}</span>
              <strong>₹{(e.total_minor / 100).toFixed(2)}</strong>
            </div>
          ))
        )}
      </section>
      {notices.map((notice) => (
        <p className="partner-message" key={notice.in_app_notification_id}>
          {notice.template_key.replaceAll('.', ' ')}
        </p>
      ))}
      <p className="boundary">Local company test · Commands persist through the API</p>
    </main>
  );
}
