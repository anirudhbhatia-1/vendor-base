'use client';
import { useCallback, useEffect, useState } from 'react';
import { formatMoneyMinor } from '@neighbourhood-store/ui';
import { adminRequest } from './authenticated-api';

/**
 * Reports and exports (11.8; ADM-58).
 *
 * The reports offered are the ones this person's work is measured by, for
 * the platform or one zone, over a period they choose; every figure says
 * what it counts and whether it is over the period or as things stand, and
 * the report says when it was read. An export is a snapshot, classified at
 * least as the report is, taken once by the person who asked, before it
 * lapses; the register shows every attempt. Until audit run 80 this screen
 * printed raw JSON of group-by counts, and an export re-ran the report when
 * it was taken.
 */
export type ReportEntry = {
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly classification: 'INTERNAL' | 'RESTRICTED';
  readonly global_only: boolean;
  readonly exportable: boolean;
};

export type ReportMetric = {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly unit: 'COUNT' | 'INR_MINOR' | 'BASIS_POINTS' | 'SECONDS' | 'BOOLEAN';
  readonly definition: string;
  readonly window: 'PERIOD' | 'NOW';
};

type Report = {
  readonly title: string;
  readonly classification: string;
  readonly scope: {
    readonly kind: string;
    readonly zone_name: string | null;
    readonly shops: number | null;
  };
  readonly period: { readonly from: string; readonly to: string };
  readonly generated_at: string;
  readonly freshness: { readonly note: string };
  readonly metrics: readonly ReportMetric[];
};

type ExportRecord = {
  readonly report_export_id: string;
  readonly report_kind: string;
  readonly classification: string;
  readonly scope_kind: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly state: 'AVAILABLE' | 'TAKEN' | 'LAPSED';
  readonly accesses: readonly { readonly outcome: string; readonly occurred_at: string }[];
};

/** A figure in words: money in rupees, rates as percentages, times in minutes. */
export function formatMetric(metric: Pick<ReportMetric, 'value' | 'unit'>): string {
  if (metric.value === null) return '—';
  switch (metric.unit) {
    case 'INR_MINOR':
      return formatMoneyMinor(metric.value);
    case 'BASIS_POINTS':
      return `${(metric.value / 100).toFixed(1)}%`;
    case 'SECONDS': {
      const minutes = Math.floor(metric.value / 60);
      const seconds = metric.value % 60;
      return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
    }
    case 'BOOLEAN':
      return metric.value === 1 ? 'Yes' : 'No';
    default:
      return metric.value.toLocaleString('en-IN');
  }
}

/** Where a report is read: the platform, or one zone. */
export function reportPath(kind: string, zone: string): string {
  const trimmed = zone.trim();
  return trimmed ? `admin/reports/zones/${trimmed}/${kind}` : `admin/reports/${kind}`;
}

/** A period as the API takes it: whole days, the end day included. */
export function periodQuery(from: string, to: string): string {
  const query = new URLSearchParams();
  if (from) query.set('from', new Date(`${from}T00:00:00`).toISOString());
  if (to) query.set('to', new Date(`${to}T23:59:59`).toISOString());
  const text = query.toString();
  return text ? `?${text}` : '';
}

export function ReportsPanel() {
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [kind, setKind] = useState('');
  const [zone, setZone] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [minutes, setMinutes] = useState(15);
  const [token, setToken] = useState('');
  const [exports, setExports] = useState<ExportRecord[]>([]);
  const [message, setMessage] = useState('Loading the reports you can read.');

  const entry = reports.find((candidate) => candidate.kind === kind);

  const load = useCallback(async () => {
    try {
      const [listed, register] = await Promise.all([
        adminRequest<{ reports: ReportEntry[] }>('admin/reports'),
        adminRequest<{ exports: ExportRecord[] }>('admin/reports/exports'),
      ]);
      setReports(listed.reports);
      setExports(register.exports);
      setKind((current) => current || listed.reports[0]?.kind || '');
      setMessage(
        listed.reports.length === 0
          ? 'No report measures your work.'
          : `${listed.reports.length} report${listed.reports.length === 1 ? '' : 's'} available.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Reports failed to load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function read() {
    if (!entry) return;
    try {
      setReport(await adminRequest<Report>(`${reportPath(kind, zone)}${periodQuery(from, to)}`));
      setMessage(`${entry.title} read.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The report failed to load.');
    }
  }

  async function requestExport() {
    if (!entry) return;
    try {
      const body: Record<string, unknown> = {
        expires_in_minutes: minutes,
        ...(restricted || entry.classification === 'RESTRICTED'
          ? { classification: 'RESTRICTED' }
          : {}),
        ...(from ? { from: new Date(`${from}T00:00:00`).toISOString() } : {}),
        ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
      };
      const created = await adminRequest<{
        download_token: string;
        classification: string;
        expires_at: string;
      }>(
        zone.trim()
          ? `admin/reports/zones/${zone.trim()}/${kind}/exports`
          : `admin/reports/${kind}/exports`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setToken(created.download_token);
      setMessage(
        `${created.classification} export ready until ${new Date(created.expires_at).toLocaleTimeString()}. Only you can take it, once.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The export was refused.');
    }
  }

  async function take() {
    try {
      const taken = await adminRequest<{
        filename: string;
        content: string;
        classification: string;
      }>('admin/reports/exports/redeem', {
        method: 'POST',
        body: JSON.stringify({ download_token: token }),
      });
      const url = URL.createObjectURL(new Blob([taken.content], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = taken.filename;
      link.click();
      URL.revokeObjectURL(url);
      setToken('');
      setMessage(`${taken.filename} (${taken.classification}) taken. The export is spent.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The export could not be taken.');
    }
  }

  return (
    <section className="catalogue-oversight" id="reporting">
      <div>
        <p className="eyebrow">REPORTING</p>
        <h2>The figures your work is measured by</h2>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Report
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            {reports.map((candidate) => (
              <option key={candidate.kind} value={candidate.kind}>
                {candidate.title} ({candidate.classification.toLowerCase()})
              </option>
            ))}
          </select>
        </label>
        {entry && <small>{entry.description}</small>}
        {entry && !entry.global_only && (
          <label>
            Zone id (blank for the whole platform)
            <input value={zone} onChange={(event) => setZone(event.target.value)} />
          </label>
        )}
        <label>
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <div className="actions">
          <button type="button" disabled={!entry} onClick={() => void read()}>
            Read report
          </button>
        </div>
      </div>

      {report && (
        <article className="catalogue-flag" aria-label="Report">
          <p className="eyebrow">
            {report.classification} ·{' '}
            {report.scope.kind === 'GLOBAL'
              ? 'whole platform'
              : `${report.scope.zone_name ?? 'zone'} (${report.scope.shops ?? 0} shops)`}
          </p>
          <h3>{report.title}</h3>
          <small>
            {new Date(report.period.from).toLocaleString()} to{' '}
            {new Date(report.period.to).toLocaleString()} · read{' '}
            {new Date(report.generated_at).toLocaleString()}
          </small>
          <table>
            <thead>
              <tr>
                <th>Figure</th>
                <th>Value</th>
                <th>What it counts</th>
              </tr>
            </thead>
            <tbody>
              {report.metrics.map((metric) => (
                <tr key={metric.key}>
                  <td>
                    {metric.label}
                    {metric.window === 'NOW' ? ' (now)' : ''}
                  </td>
                  <td>{formatMetric(metric)}</td>
                  <td>{metric.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <small>{report.freshness.note}</small>
        </article>
      )}

      {entry?.exportable && (
        <div className="catalogue-flag">
          {entry.classification === 'INTERNAL' ? (
            <label>
              <input
                type="checkbox"
                checked={restricted}
                onChange={(event) => setRestricted(event.target.checked)}
              />{' '}
              Classify this export RESTRICTED
            </label>
          ) : (
            <small>This report is always exported RESTRICTED.</small>
          )}
          <label>
            Lapses after (minutes)
            <input
              type="number"
              min={5}
              max={60}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void requestExport()}>
              Export this report
            </button>
            <button type="button" disabled={!token} onClick={() => void take()}>
              Take the export
            </button>
          </div>
        </div>
      )}

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {exports.length === 0 && <p>No exports recorded.</p>}
        {exports.map((record) => (
          <article key={record.report_export_id}>
            <span>
              {record.state} · {record.classification}
            </span>
            <strong>
              {record.report_kind} {record.scope_kind === 'ZONE' ? '(zone)' : ''}
            </strong>
            <small>
              Made {new Date(record.created_at).toLocaleString()}; lapses{' '}
              {new Date(record.expires_at).toLocaleString()}
            </small>
            {record.accesses.length > 0 && (
              <ol aria-label="Attempts to take it">
                {record.accesses.map((access) => (
                  <li key={`${access.outcome}-${access.occurred_at}`}>
                    {access.outcome} · {new Date(access.occurred_at).toLocaleString()}
                  </li>
                ))}
              </ol>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
