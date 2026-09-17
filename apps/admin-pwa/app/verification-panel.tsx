'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Document review for vendors and partners (ADM-08, ADM-12, ADM-13, ADM-10).
 *
 * Verification decides who may trade and who may carry other people's orders,
 * and the whole review API existed with no console: the partner side showed a
 * hard-coded "0 applications" and the vendor side had no reviewer surface at
 * all. A document is approved or rejected against a named evidence reference
 * and a reviewer note, so a decision is never anonymous.
 */
type CaseSummary = Record<string, unknown>;

type DocumentRow = {
  readonly verification_document_id?: string;
  readonly document_id?: string;
  readonly document_kind?: string;
  readonly review_state?: string;
};

type VendorQueueRow = {
  readonly onboarding_case_id: string;
  readonly lifecycle_state: string;
  readonly entry_kind: string;
  readonly business_profile_reference: string | null;
  readonly document_count: number;
  readonly awaiting_review: boolean;
  readonly updated_at: string;
};

type PartnerQueueRow = {
  readonly partner_application_id: string;
  readonly lifecycle_state: string;
  readonly awaiting_review: boolean;
  readonly submitted_at: string | null;
  readonly updated_at: string;
  readonly reason_code: string | null;
};

export function VerificationPanel() {
  const [subject, setSubject] = useState<'vendor' | 'partner'>('vendor');
  const [caseId, setCaseId] = useState('');
  const [queue, setQueue] = useState<readonly (VendorQueueRow | PartnerQueueRow)[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [caseDetail, setCaseDetail] = useState<CaseSummary | null>(null);
  const [expectedVersion, setExpectedVersion] = useState(1);
  const [documentId, setDocumentId] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [reviewerNote, setReviewerNote] = useState('');
  const [appealId, setAppealId] = useState('');
  const [message, setMessage] = useState('Load a case to review its documents.');

  const documents: DocumentRow[] = Array.isArray(caseDetail?.['documents'])
    ? (caseDetail['documents'] as DocumentRow[])
    : [];

  /**
   * The inbox this screen never had.
   *
   * Review was reachable only by typing a case UUID, and nothing in the product
   * shows one to a reviewer — so an application submitted through the vendor or
   * partner app waited on a decision nobody could discover.
   */
  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      if (subject === 'vendor') {
        const body = await adminRequest<{ cases: readonly VendorQueueRow[] }>(
          'admin/vendor-onboarding/queue',
        );
        setQueue(body.cases);
      } else {
        const body = await adminRequest<{ applications: readonly PartnerQueueRow[] }>(
          'admin/partner-applications',
        );
        setQueue(body.applications);
      }
    } catch (error) {
      setQueueError(error instanceof Error ? error.message : 'The review queue failed to load.');
    } finally {
      setQueueLoading(false);
    }
  }, [subject]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  async function loadCase() {
    if (!caseId) {
      setMessage('Enter the case identifier first.');
      return;
    }
    const path =
      subject === 'vendor' ? `admin/vendor-onboarding/${caseId}` : `partner/applications/${caseId}`;
    try {
      const result = await adminRequest<CaseSummary>(path);
      setCaseDetail(result);
      const version = Number(result['version'] ?? 1);
      setExpectedVersion(Number.isFinite(version) ? version : 1);
      setMessage(`Case loaded at version ${version}.`);
    } catch (error) {
      setCaseDetail(null);
      setMessage(error instanceof Error ? error.message : 'The case could not be loaded.');
    }
  }

  async function startReview() {
    const path =
      subject === 'vendor'
        ? `admin/vendor-onboarding/${caseId}/review/start`
        : `admin/partner-applications/${caseId}/start-review`;
    try {
      await adminRequest(path, {
        method: 'POST',
        body: JSON.stringify({ expected_version: expectedVersion }),
      });
      setExpectedVersion((current) => current + 1);
      setMessage('Review started. The case is now assigned for a decision.');
      await loadCase();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The review could not be started.');
    }
  }

  /**
   * Reviewing a document is deliberately heavier than a yes/no click: the
   * decision, the evidence it rests on and the reviewer's own words are all
   * recorded together, because this is the record an appeal is judged against.
   */
  async function reviewDocument(decision: 'APPROVED' | 'REJECTED') {
    if (subject !== 'vendor') {
      setMessage('Partner documents are decided with the application decision below.');
      return;
    }
    if (!documentId || !evidenceReference || !reviewerNote.trim()) {
      setMessage('A document decision needs the document, its evidence reference and a note.');
      return;
    }
    try {
      await adminRequest(`admin/vendor-onboarding/${caseId}/documents/${documentId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          evidence_reference: evidenceReference,
          expected_version: expectedVersion,
          reason_code: `DOCUMENT_${decision}`,
          reviewer_note: reviewerNote,
        }),
      });
      setExpectedVersion((current) => current + 1);
      setReviewerNote('');
      setMessage(`Document ${decision.toLowerCase()}.`);
      await loadCase();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The document decision failed.');
    }
  }

  async function decideCase(decision: 'approve' | 'reject' | 'request-changes') {
    const path =
      subject === 'vendor'
        ? `admin/vendor-onboarding/${caseId}/${decision === 'request-changes' ? 'reject' : decision}`
        : `admin/partner-applications/${caseId}/${decision}`;
    try {
      await adminRequest(path, {
        method: 'POST',
        body: JSON.stringify({
          expected_version: expectedVersion,
          reason_code: `ADMIN_${decision.replaceAll('-', '_').toUpperCase()}`,
          reviewer_note: reviewerNote || 'Reviewed against the submitted evidence.',
        }),
      });
      setExpectedVersion((current) => current + 1);
      setMessage(`Case ${decision.replaceAll('-', ' ')} recorded.`);
      await loadCase();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The decision failed.');
    }
  }

  /**
   * Appeals and manual exceptions (ADM-15).
   *
   * A rejected applicant must be able to challenge the decision, and someone
   * must be able to answer. Upholding or overturning is recorded against the
   * same case version as the original decision, so the trail reads as one
   * story rather than two unrelated acts.
   */
  async function reviewAppeal(decision: 'UPHELD' | 'OVERTURNED') {
    if (subject !== 'vendor' || !caseId || !appealId) {
      setMessage('Appeals are reviewed on a vendor case; give the case and appeal identifiers.');
      return;
    }
    try {
      await adminRequest(`admin/vendor-onboarding/${caseId}/appeals/${appealId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          expected_version: expectedVersion,
          reason_code: `APPEAL_${decision}`,
          reviewer_note: reviewerNote || 'Appeal reviewed against the original evidence.',
        }),
      });
      setExpectedVersion((current) => current + 1);
      setMessage(
        decision === 'OVERTURNED'
          ? 'Appeal upheld in the applicant’s favour; the original decision is overturned.'
          : 'Original decision stands.',
      );
      await loadCase();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The appeal review failed.');
    }
  }

  return (
    <section className="catalogue-oversight" id="verification">
      <div>
        <p className="eyebrow">VERIFICATION</p>
        <h2>Vendor and partner document review</h2>
        <p>
          Eligibility, zones and vehicle class all follow from this decision, so each one names its
          evidence and its reviewer.
        </p>
      </div>
      <p aria-live="polite">{message}</p>

      <div className="review-queue">
        <h3>Waiting for a decision</h3>
        {queueLoading ? (
          <p>Loading the review queue…</p>
        ) : queueError ? (
          <p role="alert">{queueError}</p>
        ) : queue.length === 0 ? (
          <p>Nothing is waiting for review.</p>
        ) : (
          <ul>
            {queue.map((row) => {
              const id =
                'onboarding_case_id' in row ? row.onboarding_case_id : row.partner_application_id;
              const detail =
                'business_profile_reference' in row
                  ? `${row.entry_kind} · ${row.document_count} document${row.document_count === 1 ? '' : 's'}`
                  : (row.reason_code ?? 'No reason recorded');
              return (
                <li key={id}>
                  <button
                    onClick={() => {
                      setCaseId(id);
                      setMessage('Case selected. Load it to review its documents.');
                    }}
                    type="button"
                  >
                    <strong>{row.lifecycle_state.replaceAll('_', ' ')}</strong>
                    <span>{detail}</span>
                    <span>{new Date(row.updated_at).toLocaleString()}</span>
                  </button>
                  {row.awaiting_review ? <em>Needs review</em> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="catalogue-flag">
        <label>
          Subject
          <select
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value as 'vendor' | 'partner');
              setCaseDetail(null);
            }}
          >
            <option value="vendor">Vendor onboarding case</option>
            <option value="partner">Partner application</option>
          </select>
        </label>
        <label>
          Case identifier
          <input value={caseId} onChange={(e) => setCaseId(e.target.value)} />
        </label>
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
          <button type="button" onClick={() => void loadCase()}>
            Load case
          </button>
          <button type="button" onClick={() => void startReview()}>
            Start review
          </button>
        </div>
      </div>

      {documents.length > 0 && (
        <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
          {documents.map((document, index) => {
            const id = document.verification_document_id ?? document.document_id ?? String(index);
            return (
              <article key={id}>
                <span>{document.review_state ?? 'PENDING'}</span>
                <strong>{document.document_kind ?? 'Document'}</strong>
                <button type="button" onClick={() => setDocumentId(id)}>
                  {documentId === id ? 'Selected' : 'Review this document'}
                </button>
              </article>
            );
          })}
        </div>
      )}

      <div className="catalogue-flag" style={{ marginTop: '1rem' }}>
        <label>
          Evidence reference
          <input value={evidenceReference} onChange={(e) => setEvidenceReference(e.target.value)} />
        </label>
        <label>
          Reviewer note
          <textarea
            rows={3}
            value={reviewerNote}
            onChange={(e) => setReviewerNote(e.target.value)}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void reviewDocument('APPROVED')}>
            Approve document
          </button>
          <button type="button" onClick={() => void reviewDocument('REJECTED')}>
            Reject document
          </button>
          <button type="button" onClick={() => void decideCase('approve')}>
            Approve case
          </button>
          <button type="button" onClick={() => void decideCase('request-changes')}>
            Request changes
          </button>
          <button type="button" onClick={() => void decideCase('reject')}>
            Reject case
          </button>
        </div>
        <label>
          Appeal identifier
          <input value={appealId} onChange={(e) => setAppealId(e.target.value)} />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void reviewAppeal('OVERTURNED')}>
            Overturn on appeal
          </button>
          <button type="button" onClick={() => void reviewAppeal('UPHELD')}>
            Uphold decision
          </button>
        </div>
      </div>

      {caseDetail && (
        <pre style={{ overflowX: 'auto', maxHeight: '18rem', marginTop: '1rem' }}>
          {JSON.stringify(caseDetail, null, 2)}
        </pre>
      )}
    </section>
  );
}
