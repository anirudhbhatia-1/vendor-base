'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Versioned operating policies (ADM-17, ADM-19, ADM-20, ADM-21).
 *
 * Every fee, commission, payout rule and taxonomy is a versioned configuration
 * document under maker-checker control, and every order keeps the exact version
 * it was priced against (MKT-10). The API for this existed from the start; the
 * console offered only a hard-coded feature-flag toggle, so none of these
 * policies could actually be set by an operator.
 */
type ConfigurationRecord = {
  readonly configuration_version_id: string;
  readonly configuration_key: string;
  readonly configuration_kind: string;
  readonly status: string;
  readonly version: number;
  readonly scope_kind?: string;
  readonly scope_reference?: string;
};

type PolicyTemplate = {
  readonly id: string;
  readonly label: string;
  readonly catalogue: string;
  readonly key: string;
  readonly kind: 'SETTING' | 'FEATURE_FLAG';
  readonly value: string;
};

/**
 * Starting points, not a closed list: the key and the document body are both
 * editable. They exist so an operator does not have to invent the shape of a
 * fee table from an empty box.
 */
const templates: readonly PolicyTemplate[] = [
  {
    id: 'taxonomy',
    label: 'Category taxonomy',
    catalogue: 'ADM-17',
    key: 'catalogue.taxonomy',
    kind: 'SETTING',
    value: JSON.stringify(
      {
        categories: [
          { key: 'grocery', label_en: 'Grocery', label_hi: 'किराना' },
          { key: 'vegetables', label_en: 'Vegetables', label_hi: 'सब्ज़ी' },
        ],
      },
      null,
      2,
    ),
  },
  {
    id: 'delivery_fee',
    label: 'Delivery fee',
    catalogue: 'ADM-19',
    key: 'pricing.delivery_fee',
    kind: 'SETTING',
    value: JSON.stringify(
      { base_minor: 2500, per_km_minor: 800, free_above_minor: 40000, currency: 'INR' },
      null,
      2,
    ),
  },
  {
    id: 'commission',
    label: 'Vendor fee and commission',
    catalogue: 'ADM-20',
    key: 'pricing.vendor_commission',
    kind: 'SETTING',
    value: JSON.stringify({ commission_basis_points: 1200, platform_fee_minor: 500 }, null, 2),
  },
  {
    id: 'payout',
    label: 'Payout and earning policy',
    catalogue: 'ADM-21',
    key: 'finance.payout_policy',
    kind: 'SETTING',
    value: JSON.stringify(
      { settlement_cadence: 'DAILY', hold_days: 2, partner_base_minor: 3000 },
      null,
      2,
    ),
  },
];

export function PolicyPanel() {
  const [records, setRecords] = useState<ConfigurationRecord[]>([]);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? 'taxonomy');
  const [configurationKey, setConfigurationKey] = useState(templates[0]?.key ?? '');
  const [documentBody, setDocumentBody] = useState(templates[0]?.value ?? '{}');
  const [scopeReference, setScopeReference] = useState('GLOBAL');
  const [versionId, setVersionId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [message, setMessage] = useState('Load the policy register to begin.');

  const load = useCallback(async () => {
    try {
      const result = await adminRequest<{ configurations?: ConfigurationRecord[] }>(
        'admin/configuration',
      );
      const list = Array.isArray(result) ? result : (result.configurations ?? []);
      setRecords(list as ConfigurationRecord[]);
      setMessage(`Policy register: ${list.length} versions.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The policy register failed to load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function selectTemplate(id: string) {
    const template = templates.find((candidate) => candidate.id === id);
    if (!template) return;
    setTemplateId(id);
    setConfigurationKey(template.key);
    setDocumentBody(template.value);
  }

  const template = templates.find((candidate) => candidate.id === templateId);

  async function draft() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(documentBody);
    } catch {
      setMessage('The policy document must be valid JSON.');
      return;
    }
    try {
      const result = await adminRequest<{ configuration_version_id: string; status: string }>(
        'admin/configuration/drafts',
        {
          method: 'POST',
          body: JSON.stringify({
            configuration_key: configurationKey,
            configuration_kind: template?.kind ?? 'SETTING',
            configuration_value: parsed,
            reason_code: 'ADMIN_POLICY_CHANGE',
            scope_kind: 'GLOBAL',
            scope_reference: scopeReference,
          }),
        },
      );
      setVersionId(result.configuration_version_id);
      setMessage(`Draft ${result.configuration_version_id} is ${result.status}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The draft could not be created.');
    }
  }

  async function transition(action: 'validate' | 'approve' | 'schedule' | 'rollback') {
    if (!versionId) {
      setMessage('Create or select a policy version first.');
      return;
    }
    try {
      const result = await adminRequest<{ status?: string }>(
        `admin/configuration/${versionId}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason_code: `ADMIN_POLICY_${action.toUpperCase()}`,
            ...(action === 'schedule'
              ? {
                  effective_from: effectiveFrom
                    ? new Date(effectiveFrom).toISOString()
                    : new Date(Date.now() + 60_000).toISOString(),
                }
              : {}),
          }),
        },
      );
      setMessage(`${action} recorded${result.status ? `: ${result.status}` : ''}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The ${action} step failed.`);
    }
  }

  return (
    <section className="catalogue-oversight" id="policy">
      <div>
        <p className="eyebrow">OPERATING POLICY</p>
        <h2>Fees, commissions, payouts and taxonomy</h2>
        <p>
          Each change is a new version under maker-checker approval. Orders keep the version they
          were priced against, so a change never rewrites a settled order.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Policy
          <select value={templateId} onChange={(event) => selectTemplate(event.target.value)}>
            {templates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label} ({candidate.catalogue})
              </option>
            ))}
          </select>
        </label>
        <label>
          Configuration key
          <input value={configurationKey} onChange={(e) => setConfigurationKey(e.target.value)} />
        </label>
        <label>
          Scope reference
          <input value={scopeReference} onChange={(e) => setScopeReference(e.target.value)} />
        </label>
        <label>
          Document
          <textarea
            rows={10}
            value={documentBody}
            onChange={(e) => setDocumentBody(e.target.value)}
            spellCheck={false}
          />
        </label>
        <label>
          Effective from
          <input
            type="datetime-local"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void draft()}>
            Create draft
          </button>
          <button type="button" disabled={!versionId} onClick={() => void transition('validate')}>
            Validate
          </button>
          <button type="button" disabled={!versionId} onClick={() => void transition('approve')}>
            Approve
          </button>
          <button type="button" disabled={!versionId} onClick={() => void transition('schedule')}>
            Schedule
          </button>
          <button type="button" disabled={!versionId} onClick={() => void transition('rollback')}>
            Roll back
          </button>
          <button type="button" onClick={() => void load()}>
            Refresh register
          </button>
        </div>
        {versionId && <small>Working version: {versionId}</small>}
      </div>
      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {records.length === 0 && <p>No policy versions recorded yet.</p>}
        {records.map((record) => (
          <article key={record.configuration_version_id}>
            <span>{record.status}</span>
            <strong>{record.configuration_key}</strong>
            <p>
              v{record.version} · {record.configuration_kind}
            </p>
            <button type="button" onClick={() => setVersionId(record.configuration_version_id)}>
              Work on this version
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
