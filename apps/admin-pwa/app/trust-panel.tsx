'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Trust and safety review (ADM-42, ADM-43, ADM-44).
 *
 * EXC-14 forbids irreversible punishment from a single automated signal, so a
 * restriction is a *proposal* until a second named person approves it, carries
 * an expiry and a review date, and can be rejected or revoked. All of that
 * existed in the API with no console behind it, which left the rule unenforced
 * in practice: nobody could approve, so nobody could act at all.
 */
type WorkItem = {
  readonly kind: string;
  readonly object_id: string;
  readonly title: string;
  readonly next_action: string;
  readonly created_at: string;
};

/** Subjects and scopes the schema recognises; anything else is rejected. */
const subjectKinds = ['CUSTOMER', 'VENDOR_LOCATION', 'PARTNER', 'CATEGORY'] as const;
const scopeKinds = ['GLOBAL', 'ZONE', 'VENDOR_LOCATION', 'CATEGORY'] as const;

export function TrustPanel() {
  const [proposals, setProposals] = useState<WorkItem[]>([]);
  const [subjectKind, setSubjectKind] = useState<string>('CUSTOMER');
  const [subjectReference, setSubjectReference] = useState('');
  const [scopeKind, setScopeKind] = useState<string>('GLOBAL');
  const [scopeReference, setScopeReference] = useState('GLOBAL');
  const [reasonCode, setReasonCode] = useState('REPEATED_ABUSE_SIGNAL');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [expectedVersion, setExpectedVersion] = useState(1);
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('Loading proposed restrictions…');

  const load = useCallback(async () => {
    try {
      const result = await adminRequest<{ items?: WorkItem[] }>('admin/control/dashboard');
      const items = (result.items ?? []).filter((item) => item.kind === 'TRUST');
      setProposals(items);
      setMessage(
        `${items.length} restriction${items.length === 1 ? '' : 's'} awaiting a decision.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Trust proposals failed to load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function propose() {
    if (!subjectReference || !evidenceReference) {
      setMessage('A restriction needs the subject it applies to and the evidence behind it.');
      return;
    }
    try {
      const now = Date.now();
      const result = await adminRequest<{ trust_restriction_case_id: string }>(
        'admin/control/trust',
        {
          method: 'POST',
          body: JSON.stringify({
            subject_kind: subjectKind,
            subject_reference: subjectReference,
            scope_kind: scopeKind,
            scope_reference: scopeReference,
            reason_code: reasonCode,
            // Both references carry a fixed synthetic shape the schema
            // enforces, so the operator supplies the identifier, not the
            // whole string.
            evidence_reference: `SYNTH-EVIDENCE-${evidenceReference
              .toUpperCase()
              .replaceAll(/[^A-Z0-9-]/g, '-')}`,
            policy_reference: 'SYNTH-POLICY-TRUST-V1',
            effective_until: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
            review_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
          }),
        },
      );
      setSelected(result.trust_restriction_case_id);
      setMessage(
        `Restriction ${result.trust_restriction_case_id} proposed. A second reviewer must approve it before it applies.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The restriction could not be proposed.');
    }
  }

  async function decide(action: 'approve' | 'reject' | 'revoke') {
    if (!selected) {
      setMessage('Select a proposed restriction first.');
      return;
    }
    try {
      await adminRequest(`admin/control/trust/${selected}/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          expected_version: expectedVersion,
          reason_code: `ADMIN_TRUST_${action.toUpperCase()}`,
        }),
      });
      setExpectedVersion((current) => current + 1);
      setMessage(
        action === 'approve'
          ? 'Restriction approved by a second reviewer and now in force.'
          : action === 'reject'
            ? 'Proposal rejected. No restriction applies.'
            : 'Restriction revoked. The subject is unrestricted.',
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The ${action} step failed.`);
    }
  }

  return (
    <section className="catalogue-oversight" id="trust">
      <div>
        <p className="eyebrow">TRUST AND SAFETY</p>
        <h2>{proposals.length} awaiting decision</h2>
        <p>
          A signal opens a review; only an attributable human decision restricts anyone, and every
          restriction expires and can be appealed.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Subject
          <select value={subjectKind} onChange={(e) => setSubjectKind(e.target.value)}>
            {subjectKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Subject reference
          <input value={subjectReference} onChange={(e) => setSubjectReference(e.target.value)} />
        </label>
        <label>
          Scope
          <select value={scopeKind} onChange={(e) => setScopeKind(e.target.value)}>
            {scopeKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scope reference
          <input value={scopeReference} onChange={(e) => setScopeReference(e.target.value)} />
        </label>
        <label>
          Reason code
          <input value={reasonCode} onChange={(e) => setReasonCode(e.target.value.toUpperCase())} />
        </label>
        <label>
          Linked evidence
          <input
            value={evidenceReference}
            onChange={(e) => setEvidenceReference(e.target.value)}
            placeholder="Case, order or report reference"
          />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void propose()}>
            Propose restriction
          </button>
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>
      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {proposals.length === 0 && <p>No restriction is awaiting a decision.</p>}
        {proposals.map((item) => (
          <article key={item.object_id}>
            <span>{item.next_action}</span>
            <strong>{item.title.replaceAll('_', ' ')}</strong>
            <p>Proposed {new Date(item.created_at).toLocaleString()}</p>
            <button type="button" onClick={() => setSelected(item.object_id)}>
              {selected === item.object_id ? 'Selected' : 'Review this case'}
            </button>
          </article>
        ))}
      </div>
      {selected && (
        <div className="catalogue-flag" style={{ marginTop: '1rem' }}>
          <p className="eyebrow">CASE {selected}</p>
          <label>
            Expected version
            <input
              type="number"
              min={1}
              value={expectedVersion}
              onChange={(e) => setExpectedVersion(Number(e.target.value) || 1)}
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void decide('approve')}>
              Approve restriction
            </button>
            <button type="button" onClick={() => void decide('reject')}>
              Reject proposal
            </button>
            <button type="button" onClick={() => void decide('revoke')}>
              Revoke on appeal
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
