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
      <p className="boundary">Local company test · Commands persist through the API</p>
    </main>
  );
}
