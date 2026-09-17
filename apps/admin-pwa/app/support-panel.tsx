'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Structured support cases (ADM-36 to ADM-39).
 *
 * The console could already resolve and escalate a case, but could not open
 * one, attach evidence, merge duplicates, or write a message — so an operator
 * taking a call had nowhere to put what they learned. The queue is ranked by
 * amount at risk and then age, which is what the server already returns.
 */
type WorkItem = {
  readonly kind: string;
  readonly object_id: string;
  readonly title: string;
  readonly risk_minor: number;
  readonly next_action: string;
  readonly created_at: string;
};

const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const categories = [
  'MISSING_ITEM',
  'DAMAGED_ITEM',
  'LATE_DELIVERY',
  'WRONG_ORDER',
  'PAYMENT_ISSUE',
] as const;

export function SupportPanel() {
  const [queue, setQueue] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [vendorOrderId, setVendorOrderId] = useState('');
  const [category, setCategory] = useState<string>(categories[0]);
  const [severity, setSeverity] = useState<string>('MEDIUM');
  const [description, setDescription] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [message, setMessage] = useState('Loading the support queue…');

  const load = useCallback(async () => {
    try {
      const result = await adminRequest<{ items?: WorkItem[] }>('admin/control/dashboard');
      // The server ranks by amount at risk, then age. Support cases carry no
      // monetary risk of their own, so within the kind this is oldest-first.
      const items = (result.items ?? []).filter((item) => item.kind === 'SUPPORT');
      setQueue(items);
      setMessage(`${items.length} open support case${items.length === 1 ? '' : 's'}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The support queue failed to load.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openCase() {
    if (!vendorOrderId || !description.trim()) {
      setMessage('A case needs the order it concerns and a description.');
      return;
    }
    try {
      const result = await adminRequest<{ support_case_id: string }>('admin/control/support', {
        method: 'POST',
        body: JSON.stringify({
          vendor_order_id: vendorOrderId,
          category,
          description,
          severity,
          // Response commitments are part of the case, not a side note.
          response_due_at: new Date(
            Date.now() + (severity === 'CRITICAL' ? 30 : 240) * 60 * 1000,
          ).toISOString(),
        }),
      });
      setSelected(result.support_case_id);
      setDescription('');
      setMessage(`Case ${result.support_case_id} opened.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The case could not be opened.');
    }
  }

  async function act(
    action: 'ASSIGN' | 'NOTE' | 'MESSAGE' | 'RESOLVE' | 'REOPEN' | 'ESCALATE' | 'QUALITY_REVIEW',
  ) {
    if (!selected) {
      setMessage('Select a case first.');
      return;
    }
    if ((action === 'MESSAGE' || action === 'NOTE') && !messageBody.trim()) {
      setMessage('Write the message or note first.');
      return;
    }
    try {
      await adminRequest(`admin/control/support/${selected}/${action}`, {
        method: 'POST',
        body: JSON.stringify({
          reason_code: `ADMIN_SUPPORT_${action}`,
          ...(action === 'MESSAGE' || action === 'NOTE' ? { body: messageBody } : {}),
          ...(action === 'ASSIGN' ? { owner_team: 'operations' } : {}),
        }),
      });
      if (action === 'MESSAGE' || action === 'NOTE') setMessageBody('');
      setMessage(
        action === 'MESSAGE'
          ? 'Message sent to the participants on this case.'
          : action === 'NOTE'
            ? 'Internal note recorded. Participants cannot see it.'
            : `${action} recorded.`,
      );
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `The ${action} step failed.`);
    }
  }

  /**
   * Evidence is classified on the way in. RESTRICTED material stays out of the
   * participant-visible thread; the viewer only ever sees the reference.
   */
  async function attachEvidence(classification: 'INTERNAL' | 'RESTRICTED') {
    if (!selected || !evidenceReference.trim()) {
      setMessage('Select a case and give the evidence reference.');
      return;
    }
    try {
      await adminRequest(`admin/control/support/${selected}/evidence`, {
        method: 'POST',
        body: JSON.stringify({
          evidence_reference: evidenceReference,
          classification,
          reason_code: 'ADMIN_SUPPORT_EVIDENCE',
        }),
      });
      setEvidenceReference('');
      setMessage(`${classification} evidence attached.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The evidence could not be attached.');
    }
  }

  async function merge() {
    if (!selected || !mergeTarget) {
      setMessage('Select the duplicate case and name the case it merges into.');
      return;
    }
    try {
      await adminRequest(`admin/control/support/${selected}/merge`, {
        method: 'POST',
        body: JSON.stringify({ target_case_id: mergeTarget, reason_code: 'ADMIN_SUPPORT_MERGE' }),
      });
      setMessage(`Case ${selected} merged into ${mergeTarget}.`);
      setMergeTarget('');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The cases could not be merged.');
    }
  }

  return (
    <section className="catalogue-oversight" id="support-cases">
      <div>
        <p className="eyebrow">SUPPORT</p>
        <h2>{queue.length} open cases</h2>
        <p>Ranked by amount at risk, then by age. Every action is attributable and audited.</p>
      </div>
      <p aria-live="polite">{message}</p>

      <div className="catalogue-flag">
        <p className="eyebrow">OPEN A CASE</p>
        <label>
          Vendor order ID
          <input value={vendorOrderId} onChange={(e) => setVendorOrderId(e.target.value)} />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {severities.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          What happened
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void openCase()}>
            Open case
          </button>
          <button type="button" onClick={() => void load()}>
            Refresh queue
          </button>
        </div>
      </div>

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {queue.length === 0 && <p>No open support cases.</p>}
        {queue.map((item) => (
          <article key={item.object_id}>
            <span>{item.next_action}</span>
            <strong>{item.title.replaceAll('_', ' ')}</strong>
            <p>Opened {new Date(item.created_at).toLocaleString()}</p>
            <button type="button" onClick={() => setSelected(item.object_id)}>
              {selected === item.object_id ? 'Selected' : 'Work on this case'}
            </button>
          </article>
        ))}
      </div>

      {selected && (
        <div className="catalogue-flag" style={{ marginTop: '1rem' }}>
          <p className="eyebrow">CASE {selected}</p>
          <label>
            Message or internal note
            <textarea
              rows={3}
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void act('MESSAGE')}>
              Send to participants
            </button>
            <button type="button" onClick={() => void act('NOTE')}>
              Internal note
            </button>
            <button type="button" onClick={() => void act('ASSIGN')}>
              Assign to operations
            </button>
            <button type="button" onClick={() => void act('ESCALATE')}>
              Escalate
            </button>
            <button type="button" onClick={() => void act('RESOLVE')}>
              Resolve
            </button>
            <button type="button" onClick={() => void act('REOPEN')}>
              Reopen
            </button>
            <button type="button" onClick={() => void act('QUALITY_REVIEW')}>
              Quality review
            </button>
          </div>
          <label>
            Evidence reference
            <input
              value={evidenceReference}
              onChange={(e) => setEvidenceReference(e.target.value)}
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void attachEvidence('INTERNAL')}>
              Attach internal evidence
            </button>
            <button type="button" onClick={() => void attachEvidence('RESTRICTED')}>
              Attach restricted evidence
            </button>
          </div>
          <label>
            Merge into case
            <input value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void merge()}>
              Merge duplicate
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
