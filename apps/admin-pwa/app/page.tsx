'use client';

import { useMemo, useState, type FormEvent } from 'react';

type PipelineState = 'Approved' | 'Changes required' | 'Pending approval';
interface StoreCase {
  readonly checks: readonly boolean[];
  readonly id: string;
  readonly name: string;
  readonly pin: string;
  readonly state: PipelineState;
  readonly updated: string;
}
type ModerationCase = {
  readonly moderation_case_id: string;
  readonly decision_state: string;
  readonly product_reference: string;
};
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

const checkLabels = [
  'Onboarding',
  'Profile',
  'Hours',
  'Service zone',
  'Fulfilment',
  'Documents',
] as const;
const initialCases = [
  {
    checks: [true, true, true, true, true, true],
    id: 'PUB-SYN-302020-A1',
    name: 'SYNTH Jain Stores Test',
    pin: '302020',
    state: 'Pending approval',
    updated: '9 min ago',
  },
  {
    checks: [true, true, true, false, true, false],
    id: 'PUB-SYN-302021-B4',
    name: 'SYNTH Shree Ram Produce',
    pin: '302021',
    state: 'Changes required',
    updated: '24 min ago',
  },
  {
    checks: [true, true, true, true, true, true],
    id: 'PUB-SYN-302019-C7',
    name: 'SYNTH Kisan Fal Sabzi House',
    pin: '302019',
    state: 'Approved',
    updated: '1 hr ago',
  },
] as const satisfies readonly [StoreCase, ...StoreCase[]];

export default function AdminHome() {
  const [cases, setCases] = useState<readonly StoreCase[]>(initialCases);
  const [filter, setFilter] = useState<'All' | PipelineState>('All');
  const [selectedId, setSelectedId] = useState<string>(initialCases[0].id);
  const [note, setNote] = useState('Synthetic evidence and launch checks reviewed.');
  const [moderatorToken, setModeratorToken] = useState('');
  const [moderationCases, setModerationCases] = useState<readonly ModerationCase[]>([]);
  const [moderationMessage, setModerationMessage] = useState(
    'Connect a local catalogue moderator session to load the queue.',
  );
  async function loadModeration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await fetch(`${apiUrl}/admin/catalogue/moderation`, {
        headers: { authorization: `Bearer ${moderatorToken}` },
      });
      if (!response.ok) throw new Error('This local session cannot read the moderation queue.');
      const body = (await response.json()) as
        { readonly data?: readonly ModerationCase[] } | readonly ModerationCase[];
      const entries: readonly ModerationCase[] = Array.isArray(body)
        ? (body as readonly ModerationCase[])
        : ((body as { readonly data?: readonly ModerationCase[] }).data ?? []);
      setModerationCases(entries);
      setModerationMessage(
        entries.length
          ? 'Connected to the server moderation queue.'
          : 'No catalogue cases need review.',
      );
    } catch (error) {
      setModerationMessage(error instanceof Error ? error.message : 'Queue could not be loaded.');
    }
  }
  const visible = useMemo(
    () => cases.filter((item) => filter === 'All' || item.state === filter),
    [cases, filter],
  );
  const selected = cases.find((item) => item.id === selectedId) ?? initialCases[0];

  function decide(state: PipelineState) {
    setCases((current) =>
      current.map((item) =>
        item.id === selected.id ? { ...item, state, updated: 'Just now' } : item,
      ),
    );
  }

  return (
    <main className="ops-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          AO
        </div>
        <div>
          <p className="eyebrow">Admin PWA · Internal build</p>
          <strong>Marketplace control room</strong>
        </div>
        <div className="environment">
          <span />
          Local · synthetic
        </div>
      </header>

      <section className="command-header">
        <div>
          <p className="eyebrow">Vendor publication</p>
          <h1>Clear the launch line.</h1>
          <p>One queue for readiness, independent approval and storefront control.</p>
        </div>
        <dl>
          <div>
            <dt>Needs review</dt>
            <dd>{cases.filter((item) => item.state === 'Pending approval').length}</dd>
          </div>
          <div>
            <dt>Blocked checks</dt>
            <dd>{cases.flatMap((item) => item.checks).filter((ready) => !ready).length}</dd>
          </div>
        </dl>
      </section>
      <section className="catalogue-oversight" aria-labelledby="catalogue-oversight-title">
        <div>
          <p className="eyebrow">Catalogue oversight</p>
          <h2 id="catalogue-oversight-title">Review the local catalogue queue.</h2>
        </div>
        <div className="catalogue-flag">
          <form className="moderation-connect" onSubmit={loadModeration}>
            <label>
              Local moderator token
              <input
                onChange={(event) => setModeratorToken(event.target.value)}
                placeholder="nsa_…"
                value={moderatorToken}
              />
            </label>
            <button type="submit">Load queue</button>
            <small aria-live="polite">{moderationMessage}</small>
          </form>
        </div>
        <div className="catalogue-flag">
          <strong>{moderationCases.length} server cases</strong>
          <span>
            {moderationCases
              .map((item) => `${item.product_reference} · ${item.decision_state}`)
              .join(' · ') || 'No case requires an administrator decision.'}
          </span>
        </div>
      </section>

      <div className="filters" role="group" aria-label="Filter publication queue">
        {(['All', 'Pending approval', 'Changes required', 'Approved'] as const).map((value) => (
          <button
            aria-pressed={filter === value}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {value}
          </button>
        ))}
      </div>

      <section className="workspace">
        <aside className="queue" aria-label="Publication cases">
          <div className="queue-heading">
            <strong>Publication queue</strong>
            <span>{visible.length} cases</span>
          </div>
          {visible.map((item) => (
            <button
              className={item.id === selected.id ? 'queue-row is-selected' : 'queue-row'}
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              type="button"
            >
              <span className={`status-dot state-${item.state.toLowerCase().replace(' ', '-')}`} />
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.id} · Jaipur {item.pin}
                </small>
              </span>
              <em>{item.updated}</em>
            </button>
          ))}
          {visible.length === 0 && <p className="empty">No synthetic cases in this state.</p>}
        </aside>

        <article className="case-workbench">
          <header className="case-header">
            <div>
              <p className="eyebrow">{selected.id}</p>
              <h2>{selected.name}</h2>
              <p>Fruit and sabzi · Jaipur {selected.pin}</p>
            </div>
            <span className="state-badge">{selected.state}</span>
          </header>

          <section className="launch-strip" aria-label="Publication readiness">
            {checkLabels.map((label, index) => (
              <div
                className={selected.checks[index] ? 'launch-check is-ready' : 'launch-check'}
                key={label}
              >
                <span>{selected.checks[index] ? '✓' : '!'}</span>
                <small>{label}</small>
              </div>
            ))}
          </section>

          <div className="workbench-grid">
            <section className="evidence-panel">
              <p className="eyebrow">Review evidence</p>
              <h3>Launch record</h3>
              <dl>
                <div>
                  <dt>Business profile</dt>
                  <dd>SYNTH-BIZ-JPR-0001</dd>
                </div>
                <div>
                  <dt>Payout profile</dt>
                  <dd>SYNTH-PAYOUT-JPR-0001</dd>
                </div>
                <div>
                  <dt>Fulfilment</dt>
                  <dd>Customer pickup</dd>
                </div>
                <div>
                  <dt>Operating hours</dt>
                  <dd>Mon–Sat · 08:00–20:00</dd>
                </div>
              </dl>
              <p className="privacy-note">
                Protected documents open only through a short-lived server grant. File paths and
                payout details never appear here.
              </p>
            </section>
            <section className="decision-panel">
              <p className="eyebrow">Independent decision</p>
              <h3>Record the outcome</h3>
              <label>
                Reason code
                <select defaultValue="PUBLICATION_APPROVED">
                  <option>PUBLICATION_APPROVED</option>
                  <option>PUBLICATION_CHANGES_REQUIRED</option>
                </select>
              </label>
              <label>
                Reviewer note
                <textarea onChange={(event) => setNote(event.target.value)} rows={4} value={note} />
              </label>
              <div className="decision-actions">
                <button
                  className="changes-button"
                  onClick={() => decide('Changes required')}
                  type="button"
                >
                  Request changes
                </button>
                <button
                  className="approve-button"
                  disabled={!selected.checks.every(Boolean)}
                  onClick={() => decide('Approved')}
                  type="button"
                >
                  Approve launch
                </button>
              </div>
              <small className="maker-checker">
                The proposal creator cannot approve this case.
              </small>
            </section>
          </div>

          <section className="audit-row">
            <span>Created</span>
            <i />
            <span>Readiness checked</span>
            <i />
            <span>{selected.state}</span>
            <strong>Append-only evidence</strong>
          </section>
        </article>
      </section>
      <section className="money-strip" aria-label="Synthetic finance queue">
        <div>
          <p className="eyebrow">Finance integrity</p>
          <h2>₹49 at risk · 1 statement pending</h2>
        </div>
        <span>Refund approval · maker/checker</span>
        <span>Payout unknown · reconcile same operation</span>
        <strong>Ledger difference ₹0</strong>
      </section>
      <p className="boundary">
        Company test mode: decisions on this screen use synthetic cases only. No production
        publication authority is enabled.
      </p>
    </main>
  );
}
