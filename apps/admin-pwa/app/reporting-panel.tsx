'use client';

import { useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Reporting, exports and scoped search (ADM-58, ADM-06).
 *
 * The report reader existed but the export path did not: the console showed
 * figures with no way to take them away, and the audit trail had a `?q=` filter
 * nothing used, so finding one actor's actions meant reading the whole log.
 *
 * An export is a two-step, classified operation — request a token, then redeem
 * it — so that taking data out of the platform is itself an audited act.
 */
/**
 * The kinds both the report reader and the export register accept. The two
 * disagreed historically — the reader knows `MARKETPLACE`, the export table's
 * CHECK constraint allows the same — so this list is their intersection rather
 * than a guess.
 */
const reportKinds = [
  'CUSTOMER_FUNNEL',
  'MARKETPLACE',
  'VENDOR_HEALTH',
  'DELIVERY_OPERATIONS',
  'FINANCE',
  'SUPPORT',
  'RISK',
] as const;

type AuditEntry = {
  readonly audit_event_id?: string;
  readonly actor_id?: string;
  readonly action?: string;
  readonly occurred_at?: string;
  readonly object_reference?: string;
};

export function ReportingPanel({ view }: { view: 'reporting' | 'audit' }) {
  const [reportKind, setReportKind] = useState<string>('MARKETPLACE');
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [downloadToken, setDownloadToken] = useState('');
  const [payload, setPayload] = useState<string>('');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [message, setMessage] = useState('Choose a report or search the audit trail.');

  async function loadReport() {
    try {
      const result = await adminRequest<Record<string, unknown>>(
        `admin/control/reports/${reportKind}`,
      );
      setReport(result);
      setMessage(`${reportKind.replaceAll('_', ' ')} report loaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The report failed to load.');
    }
  }

  async function requestExport(classification: 'INTERNAL' | 'RESTRICTED') {
    try {
      const result = await adminRequest<{ download_token: string }>('admin/control/exports', {
        method: 'POST',
        body: JSON.stringify({ report_kind: reportKind, filters: {}, classification }),
      });
      setDownloadToken(result.download_token);
      setMessage(`${classification} export authorised. Redeem the token to receive the contents.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The export could not be authorised.');
    }
  }

  async function redeem() {
    if (!downloadToken) {
      setMessage('Request an export first.');
      return;
    }
    try {
      const result = await adminRequest<Record<string, unknown>>('admin/control/exports/redeem', {
        method: 'POST',
        body: JSON.stringify({ download_token: downloadToken }),
      });
      setPayload(JSON.stringify(result, null, 2));
      setMessage('Export redeemed. The token is now spent.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The export could not be redeemed.');
    }
  }

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

      {view === 'reporting' && (
        <div className="catalogue-flag">
          <label>
            Report
            <select value={reportKind} onChange={(e) => setReportKind(e.target.value)}>
              {reportKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <div className="actions">
            <button type="button" onClick={() => void loadReport()}>
              Load report
            </button>
            <button type="button" onClick={() => void requestExport('INTERNAL')}>
              Export (internal)
            </button>
            <button type="button" onClick={() => void requestExport('RESTRICTED')}>
              Export (restricted)
            </button>
            <button type="button" disabled={!downloadToken} onClick={() => void redeem()}>
              Redeem export
            </button>
          </div>
          {report && (
            <pre style={{ overflowX: 'auto', maxHeight: '18rem' }}>
              {JSON.stringify(report, null, 2)}
            </pre>
          )}
          {payload && <pre style={{ overflowX: 'auto', maxHeight: '18rem' }}>{payload}</pre>}
        </div>
      )}

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
