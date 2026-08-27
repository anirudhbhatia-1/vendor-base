'use client';

import { useState } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
type Publication = {
  publication_case_id: string;
  lifecycle_state: string;
  version: number;
  vendor_location_id: string;
};
type WorkItem = {
  kind: string;
  object_id: string;
  title: string;
  risk_minor: number;
  created_at: string;
  next_action: string;
};
type Moderation = { moderation_case_id: string; decision_state: string; product_reference: string };

export default function AdminHome() {
  const [token, setToken] = useState('');
  const [publications, setPublications] = useState<Publication[]>([]);
  const [work, setWork] = useState<WorkItem[]>([]);
  const [moderation, setModeration] = useState<Moderation[]>([]);
  const [output, setOutput] = useState('Connect an authorized admin session.');

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(`${apiUrl}/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Request denied (${response.status}).`);
    return body;
  }
  async function refresh() {
    try {
      const [p, d, m] = await Promise.all([
        request('admin/vendor-publications'),
        request('admin/control/dashboard'),
        request('admin/catalogue/moderation'),
      ]);
      setPublications((p as { cases: Publication[] }).cases ?? []);
      setWork((d as { items: WorkItem[] }).items ?? []);
      setModeration(
        Array.isArray(m) ? (m as Moderation[]) : ((m as { data?: Moderation[] }).data ?? []),
      );
      setOutput('Server queues refreshed. No local decision state is used.');
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Refresh failed.');
    }
  }
  async function publicationAction(
    item: Publication,
    action: 'readiness' | 'submit' | 'publish' | 'decision',
  ) {
    try {
      const body =
        action === 'decision'
          ? {
              expected_version: item.version,
              decision: 'APPROVED',
              evidence_reference: 'SYNTH-PUBLICATION-EVIDENCE-0001',
              note: 'Company-test checks reviewed.',
              reason_code: 'COMPANY_TEST_APPROVAL',
            }
          : {
              expected_version: item.version,
              note: 'Company-test transition.',
              reason_code: 'COMPANY_TEST_TRANSITION',
            };
      await request(`admin/vendor-publications/${item.publication_case_id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await refresh();
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Action failed.');
    }
  }
  async function report(kind: string) {
    try {
      setOutput(JSON.stringify(await request(`admin/control/reports/${kind}`), null, 2));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Report failed.');
    }
  }
  async function audit() {
    try {
      setOutput(JSON.stringify(await request('admin/control/audit'), null, 2));
    } catch (error) {
      setOutput(error instanceof Error ? error.message : 'Audit failed.');
    }
  }

  return (
    <main className="ops-shell">
      <header className="topbar">
        <div className="brand-mark">AO</div>
        <div>
          <p className="eyebrow">Admin PWA · company test</p>
          <strong>Marketplace control room</strong>
        </div>
        <div className="environment">
          <span />
          Local · synthetic
        </div>
      </header>
      <section className="command-header">
        <div>
          <p className="eyebrow">ACCOUNTABLE OPERATIONS</p>
          <h1>Act on server truth.</h1>
          <p>
            Publication, catalogue, support, trust, incident, finance and audit work stay
            capability-scoped.
          </p>
        </div>
      </section>
      <section className="catalogue-oversight">
        <div>
          <p className="eyebrow">SESSION</p>
          <h2>Connect the admin API</h2>
        </div>
        <div className="catalogue-flag">
          <label>
            Admin access token
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="nsa_…"
            />
          </label>
          <button type="button" onClick={() => void refresh()}>
            Refresh all queues
          </button>
        </div>
      </section>
      <section className="workspace">
        <aside className="queue">
          <div className="queue-heading">
            <strong>Risk-ranked work</strong>
            <span>{work.length}</span>
          </div>
          {work.map((item) => (
            <div className="queue-row" key={`${item.kind}-${item.object_id}`}>
              <span>
                <strong>
                  {item.kind} · {item.title}
                </strong>
                <small>
                  {item.next_action} ·{' '}
                  {item.risk_minor
                    ? `₹${(item.risk_minor / 100).toFixed(2)} at risk`
                    : 'operational risk'}
                </small>
              </span>
            </div>
          ))}
        </aside>
        <article className="case-workbench">
          <p className="eyebrow">VENDOR PUBLICATION</p>
          <h2>{publications.length} persisted cases</h2>
          {publications.map((item) => (
            <div className="catalogue-flag" key={item.publication_case_id}>
              <strong>
                {item.lifecycle_state} · v{item.version}
              </strong>
              <span>{item.vendor_location_id}</span>
              <div className="actions">
                <button onClick={() => void publicationAction(item, 'readiness')}>Evaluate</button>
                <button onClick={() => void publicationAction(item, 'submit')}>Submit</button>
                <button onClick={() => void publicationAction(item, 'decision')}>Approve</button>
                <button onClick={() => void publicationAction(item, 'publish')}>Publish</button>
              </div>
            </div>
          ))}
        </article>
      </section>
      <section className="catalogue-oversight">
        <div>
          <p className="eyebrow">CATALOGUE MODERATION</p>
          <h2>{moderation.length} live cases</h2>
        </div>
        {moderation.map((item) => (
          <div className="catalogue-flag" key={item.moderation_case_id}>
            <strong>{item.product_reference}</strong>
            <span>{item.decision_state}</span>
          </div>
        ))}
      </section>
      <section className="catalogue-oversight">
        <div>
          <p className="eyebrow">REPORTING & AUDIT</p>
          <h2>Protected operational evidence</h2>
        </div>
        <div className="actions">
          {[
            'CUSTOMER_FUNNEL',
            'MARKETPLACE_HEALTH',
            'VENDOR_HEALTH',
            'DELIVERY_OPERATIONS',
            'FINANCE',
            'SUPPORT',
            'RISK',
          ].map((kind) => (
            <button key={kind} onClick={() => void report(kind)}>
              {kind.replaceAll('_', ' ')}
            </button>
          ))}
          <button onClick={() => void audit()}>Audit trail</button>
        </div>
        <pre>{output}</pre>
      </section>
      <p className="boundary">
        Company-local synthetic data only · production intervention and providers remain disabled
      </p>
    </main>
  );
}
