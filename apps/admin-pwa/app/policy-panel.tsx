'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Configuration approval and publication (11.6; ADM-17, ADM-19, ADM-20,
 * ADM-21).
 *
 * Every setting an operator may change comes from the server's catalogue --
 * fees, commissions and earnings, timers, limits and operational rules --
 * with the rule its value must meet and whether it is protected. A draft
 * shows the value in force, the one proposed, worked examples and the scope
 * it touches; validating records that report; someone other than the
 * proposer approves; it is scheduled for now or later (a protected change an
 * hour ahead) and can be cancelled before it takes force; and it is undone by
 * rolling back to an earlier version, which is itself a new version.
 *
 * Until audit run 78 this screen offered free-text keys the server did not
 * read (`pricing.delivery_fee`, `finance.payout_policy`), sent the scope as
 * 'GLOBAL' where the server stores 'global', and showed `record.version`,
 * which the register has never returned.
 */
export type CatalogueSetting = {
  readonly key: string;
  readonly category: 'FEES_COMMISSIONS_EARNINGS' | 'TIMERS' | 'LIMITS' | 'OPERATIONAL_RULES';
  readonly title: string;
  readonly protected: boolean;
  readonly value_type: 'INTEGER' | 'JSON';
  readonly scopes: readonly ('GLOBAL' | 'ZONE')[];
  readonly rule: string;
  readonly default_value: unknown;
  readonly global_value: unknown;
};

type RegisterRow = {
  readonly configuration_version_id: string;
  readonly configuration_key: string;
  readonly status: string;
  readonly version_number: number;
  readonly scope: { readonly kind: string; readonly reference: string };
};

type Detail = {
  readonly configuration_version_id: string;
  readonly configuration_key: string;
  readonly version_number: number;
  readonly status: string;
  readonly scope: { readonly kind: string; readonly reference: string };
  readonly effective_from: string | null;
  readonly effective_until: string | null;
  readonly closing_reason_code: string | null;
  readonly rollback_of_version_id: string | null;
  readonly validation_report: unknown;
  readonly preview: {
    readonly title: string;
    readonly protected: boolean;
    readonly rule: string | null;
    readonly in_force: { readonly value: unknown; readonly version_number: number | null };
    readonly proposed: unknown;
    readonly changed_fields: readonly string[];
    readonly examples: readonly { case: string; before: string; after: string }[];
    readonly affected_scope: {
      readonly vendor_locations: number;
      readonly open_orders: number;
      readonly partners_online: number;
      readonly note: string;
    };
    readonly issues: readonly string[];
  };
  readonly history: readonly {
    readonly to_status: string;
    readonly reason_code: string;
    readonly occurred_at: string;
  }[];
};

export type PolicyAction = 'validate' | 'approve' | 'reject' | 'schedule' | 'cancel' | 'rollback';

const CATEGORY_LABELS: Record<CatalogueSetting['category'], string> = {
  FEES_COMMISSIONS_EARNINGS: 'Fees, commissions and earnings',
  TIMERS: 'Timers',
  LIMITS: 'Limits',
  OPERATIONAL_RULES: 'Operational rules',
};

/** A protected change is announced this far ahead of taking force. */
export const PROTECTED_NOTICE_MS = 60 * 60_000;

/** What can be done to a version in each state; the server refuses the rest. */
export function actionsFor(status: string): readonly PolicyAction[] {
  switch (status) {
    case 'DRAFT':
      return ['validate', 'reject'];
    case 'VALIDATED':
      return ['approve', 'reject'];
    case 'APPROVED':
      return ['schedule', 'reject'];
    case 'SCHEDULED':
      return ['cancel'];
    case 'ACTIVE':
    case 'SUPERSEDED':
      return ['rollback'];
    default:
      return [];
  }
}

/** Reads the value an operator typed, in the shape the setting takes. */
export function parseDraftValue(
  setting: Pick<CatalogueSetting, 'value_type'>,
  text: string,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly message: string } {
  if (setting.value_type === 'INTEGER') {
    const trimmed = text.trim();
    return /^-?\d+$/.test(trimmed)
      ? { ok: true, value: Number(trimmed) }
      : { ok: false, message: 'Enter a whole number.' };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, message: 'The value must be valid JSON.' };
  }
}

/** The draft request: the server stores the global scope as 'global'. */
export function draftBody(
  setting: Pick<CatalogueSetting, 'key'>,
  scopeKind: 'GLOBAL' | 'ZONE',
  zoneId: string,
  value: unknown,
  reason: string,
) {
  return {
    configuration_key: setting.key,
    configuration_value: value,
    scope_kind: scopeKind,
    scope_reference: scopeKind === 'GLOBAL' ? 'global' : zoneId.trim(),
    reason_code: reasonCode(reason),
  };
}

/** A reason as the server records it: upper case, words joined by underscores. */
export function reasonCode(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The earliest start the server accepts, so the default schedule is never refused. */
export function earliestStart(isProtected: boolean, nowMs: number): Date {
  return new Date(nowMs + (isProtected ? PROTECTED_NOTICE_MS + 60_000 : 60_000));
}

export function valueText(value: unknown): string {
  if (value === null || value === undefined) return 'unset';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function editableText(setting: CatalogueSetting): string {
  const current = setting.global_value ?? setting.default_value;
  return setting.value_type === 'JSON' ? JSON.stringify(current, null, 2) : valueText(current);
}

export function PolicyPanel() {
  const [settings, setSettings] = useState<CatalogueSetting[]>([]);
  const [records, setRecords] = useState<RegisterRow[]>([]);
  const [settingKey, setSettingKey] = useState('');
  const [scopeKind, setScopeKind] = useState<'GLOBAL' | 'ZONE'>('GLOBAL');
  const [zoneId, setZoneId] = useState('');
  const [valueBody, setValueBody] = useState('');
  const [reason, setReason] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState('Loading the configuration catalogue.');

  const setting = settings.find((candidate) => candidate.key === settingKey);

  const load = useCallback(async () => {
    try {
      const [catalogue, register] = await Promise.all([
        adminRequest<{ settings: CatalogueSetting[] }>('admin/configuration/catalogue'),
        adminRequest<RegisterRow[]>('admin/configuration'),
      ]);
      setSettings(catalogue.settings);
      setRecords(Array.isArray(register) ? register : []);
      setSettingKey((current) => {
        if (current) return current;
        const first = catalogue.settings[0];
        if (first) setValueBody(editableText(first));
        return first?.key ?? '';
      });
      setMessage(`${catalogue.settings.length} settings; ${register.length} versions on record.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The catalogue failed to load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = useCallback(async (id: string) => {
    try {
      setDetail(await adminRequest<Detail>(`admin/configuration/${id}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The version failed to load.');
    }
  }, []);

  function chooseSetting(key: string) {
    const next = settings.find((candidate) => candidate.key === key);
    if (!next) return;
    setSettingKey(key);
    setScopeKind('GLOBAL');
    setValueBody(editableText(next));
  }

  async function draft() {
    if (!setting) return;
    const parsed = parseDraftValue(setting, valueBody);
    if (!parsed.ok) {
      setMessage(parsed.message);
      return;
    }
    if (!reasonCode(reason)) {
      setMessage('Say why this change is proposed.');
      return;
    }
    try {
      const created = await adminRequest<{ configuration_version_id: string }>(
        'admin/configuration/drafts',
        {
          method: 'POST',
          body: JSON.stringify(draftBody(setting, scopeKind, zoneId, parsed.value, reason)),
        },
      );
      setMessage('Draft created. Check the preview, then validate it.');
      await Promise.all([open(created.configuration_version_id), load()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The draft was refused.');
    }
  }

  async function act(action: PolicyAction) {
    if (!detail) return;
    const why = reasonCode(reason) || `ADMIN_POLICY_${action.toUpperCase()}`;
    const from = effectiveFrom
      ? new Date(effectiveFrom)
      : earliestStart(detail.preview.protected, Date.now());
    try {
      const result = await adminRequest<{ configuration_version_id?: string }>(
        `admin/configuration/${detail.configuration_version_id}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason_code: why,
            ...(action === 'schedule'
              ? {
                  effective_from: from.toISOString(),
                  ...(effectiveUntil
                    ? { effective_until: new Date(effectiveUntil).toISOString() }
                    : {}),
                }
              : {}),
          }),
        },
      );
      setMessage(
        action === 'rollback'
          ? 'The earlier value is a new draft; it goes through approval like any change.'
          : `${action} recorded.`,
      );
      await Promise.all([
        open(
          action === 'rollback' && result.configuration_version_id
            ? result.configuration_version_id
            : detail.configuration_version_id,
        ),
        load(),
      ]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The ${action} step was refused.`);
    }
  }

  const categories = Object.keys(CATEGORY_LABELS) as CatalogueSetting['category'][];

  return (
    <section className="catalogue-oversight" id="policy">
      <div>
        <p className="eyebrow">OPERATING POLICY</p>
        <h2>Fees, commissions, earnings, timers, limits and rules</h2>
        <p>
          Each change is a new version: previewed, validated, approved by someone else, and
          scheduled. Orders keep the values they were given, so a change never rewrites one in
          flight.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Setting
          <select value={settingKey} onChange={(event) => chooseSetting(event.target.value)}>
            {categories.map((category) => (
              <optgroup key={category} label={CATEGORY_LABELS[category]}>
                {settings
                  .filter((candidate) => candidate.category === category)
                  .map((candidate) => (
                    <option key={candidate.key} value={candidate.key}>
                      {candidate.title}
                      {candidate.protected ? ' (protected)' : ''}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        {setting && (
          <small>
            {setting.rule} In force: {valueText(setting.global_value ?? setting.default_value)}
            {setting.global_value === null ? ' (default)' : ''}.
            {setting.protected
              ? ' Protected: approved by someone independent, and announced an hour ahead.'
              : ''}
          </small>
        )}
        <label>
          Scope
          <select
            value={scopeKind}
            onChange={(event) => setScopeKind(event.target.value as 'GLOBAL' | 'ZONE')}
          >
            {(setting?.scopes ?? ['GLOBAL']).map((kind) => (
              <option key={kind} value={kind}>
                {kind === 'GLOBAL' ? 'Everywhere' : 'One service zone'}
              </option>
            ))}
          </select>
        </label>
        {scopeKind === 'ZONE' && (
          <label>
            Service zone id
            <input value={zoneId} onChange={(event) => setZoneId(event.target.value)} />
          </label>
        )}
        <label>
          Value
          {setting?.value_type === 'JSON' ? (
            <textarea
              rows={8}
              value={valueBody}
              onChange={(event) => setValueBody(event.target.value)}
              spellCheck={false}
            />
          ) : (
            <input
              inputMode="numeric"
              value={valueBody}
              onChange={(event) => setValueBody(event.target.value)}
            />
          )}
        </label>
        <label>
          Reason
          <input
            placeholder="e.g. slower shops need time"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="actions">
          <button type="button" disabled={!setting} onClick={() => void draft()}>
            Create draft
          </button>
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {detail && (
        <article className="catalogue-flag" aria-label="Configuration version">
          <p className="eyebrow">
            {detail.status} · v{detail.version_number} · {detail.scope.kind.toLowerCase()}{' '}
            {detail.scope.kind === 'GLOBAL' ? '' : detail.scope.reference}
          </p>
          <h3>{detail.preview.title}</h3>
          <p>
            In force: {valueText(detail.preview.in_force.value)}
            {detail.preview.in_force.version_number === null
              ? ' (default)'
              : ` (v${detail.preview.in_force.version_number})`}{' '}
            → proposed: {valueText(detail.preview.proposed)}
            {detail.preview.changed_fields.length > 0 &&
              ` · changes ${detail.preview.changed_fields.join(', ')}`}
          </p>
          {detail.preview.examples.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Now</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {detail.preview.examples.map((example) => (
                  <tr key={example.case}>
                    <td>{example.case}</td>
                    <td>{example.before}</td>
                    <td>{example.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p>
            Touches {detail.preview.affected_scope.vendor_locations} shops,{' '}
            {detail.preview.affected_scope.partners_online} partners online;{' '}
            {detail.preview.affected_scope.open_orders} open orders.{' '}
            {detail.preview.affected_scope.note}
          </p>
          {detail.preview.issues.length > 0 && detail.status === 'DRAFT' && (
            <ul role="alert">
              {detail.preview.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
          {detail.validation_report !== null && <small>Validation report recorded.</small>}
          {detail.effective_from && (
            <small>
              Takes force {new Date(detail.effective_from).toLocaleString()}
              {detail.effective_until
                ? ` until ${new Date(detail.effective_until).toLocaleString()}`
                : ''}
              .
            </small>
          )}
          {detail.closing_reason_code && <small>Closed: {detail.closing_reason_code}</small>}
          {detail.status === 'APPROVED' && (
            <>
              <label>
                Takes force from
                <input
                  type="datetime-local"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                />
              </label>
              <label>
                Until (optional)
                <input
                  type="datetime-local"
                  value={effectiveUntil}
                  onChange={(event) => setEffectiveUntil(event.target.value)}
                />
              </label>
            </>
          )}
          <div className="actions">
            {actionsFor(detail.status).map((action) => (
              <button key={action} type="button" onClick={() => void act(action)}>
                {action === 'rollback' ? 'Roll back to this version' : action}
              </button>
            ))}
          </div>
          <ol>
            {detail.history.map((event) => (
              <li key={`${event.to_status}-${event.occurred_at}`}>
                {event.to_status} · {event.reason_code} ·{' '}
                {new Date(event.occurred_at).toLocaleString()}
              </li>
            ))}
          </ol>
        </article>
      )}

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {records.length === 0 && <p>No configuration versions recorded yet.</p>}
        {records.map((record) => (
          <article key={record.configuration_version_id}>
            <span>{record.status}</span>
            <strong>{record.configuration_key}</strong>
            <p>
              v{record.version_number} · {record.scope.kind.toLowerCase()}
            </p>
            <button type="button" onClick={() => void open(record.configuration_version_id)}>
              Open
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
