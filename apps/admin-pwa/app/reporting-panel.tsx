'use client';

import { useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Scoped search over the audit trail (ADM-06). Reports and exports moved to
 * their own screen (11.8, reports-panel.tsx); this search is 11.9's.
 */

type AuditEntry = {
  readonly audit_event_id?: string;
  readonly actor_id?: string;
  readonly action?: string;
  readonly occurred_at?: string;
  readonly object_reference?: string;
};

export function ReportingPanel({ view }: { view: 'audit' }) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [message, setMessage] = useState('Search the audit trail.');

  /**
   * Scoped search over the immutable audit log. The filter runs on the server,
   * so an operator never has to pull the whole trail to answer "what did this
   * actor do?".
   */
  async function searchAudit() {
    try {
      const result = await adminRequest<{ entries?: AuditEntry[]; events?: AuditEntry[] }>(
        `admin/control/audit${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
      );
      const list = result.entries ?? result.events ?? [];
      setEntries(list);
      setMessage(
        query.trim()
          ? `${list.length} audit entries match “${query.trim()}”.`
          : `${list.length} most recent audit entries.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The audit search failed.');
    }
  }

  return (
    <section className="catalogue-oversight" id={view}>
      <div>
        <p className="eyebrow">{view === 'audit' ? 'IMMUTABLE AUDIT LOG' : 'REPORTING'}</p>
        <h2>{view === 'audit' ? 'Who changed what, and why' : 'Protected operational evidence'}</h2>
      </div>
      <p aria-live="polite">{message}</p>

      {view === 'audit' && (
        <div className="catalogue-flag">
          <label>
            Search the trail
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Actor, action or object reference"
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void searchAudit()}>
              Search audit trail
            </button>
          </div>
          <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
            {entries.length === 0 && <p>No audit entries loaded yet.</p>}
            {entries.map((entry, index) => (
              <article key={entry.audit_event_id ?? index}>
                <span>{entry.action ?? 'EVENT'}</span>
                <strong>{entry.object_reference ?? entry.audit_event_id ?? '—'}</strong>
                <p>
                  {entry.actor_id ? `${entry.actor_id.slice(0, 8)}… · ` : ''}
                  {entry.occurred_at ? new Date(entry.occurred_at).toLocaleString() : ''}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
