'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, LoadingState, Notice, Panel } from '@neighbourhood-store/ui';
import { adminRequest } from './authenticated-api';

/**
 * Renewed partner documents awaiting review (9.1).
 *
 * A partner whose identity, vehicle or insurance document lapses is kept off
 * new offers until a renewal is approved here. The reviewer sees the document,
 * its new reference and expiry, and decides with a reason; approval restores
 * the partner's eligibility when nothing else of theirs has lapsed.
 */
type Renewal = {
  readonly partner_document_renewal_id: string;
  readonly partner_user_id: string;
  readonly document_kind: string;
  readonly document_reference: string;
  readonly expires_at: string;
  readonly created_at: string;
};

function shortReference(value: string): string {
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function PartnerDocumentsPanel() {
  const [renewals, setRenewals] = useState<readonly Renewal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await adminRequest<{ renewals?: readonly Renewal[] }>('admin/partner-documents');
      setRenewals(body.renewals ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Document renewals could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(entry: Renewal, decision: 'APPROVED' | 'REJECTED') {
    setBusy(entry.partner_document_renewal_id);
    setError(null);
    try {
      await adminRequest(`admin/partner-documents/${entry.partner_document_renewal_id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          reason_code: decision === 'APPROVED' ? 'DOCUMENT_VERIFIED' : 'DOCUMENT_NOT_VERIFIED',
        }),
      });
      setMessage(
        `${entry.document_kind.toLowerCase()} renewal for ${shortReference(entry.partner_user_id)} ${decision.toLowerCase()}.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That decision could not be recorded.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel
      actions={
        <Button onClick={() => void load()} variant="secondary">
          Refresh
        </Button>
      }
      description="A partner with a lapsed document is off new offers until a renewal is approved."
      eyebrow="Document renewals"
      id="partner-documents"
      level={2}
      title={`${renewals.length} awaiting review`}
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {loading ? (
        <LoadingState label="Loading renewals…" lines={2} />
      ) : renewals.length === 0 ? (
        <EmptyState
          description="Renewed documents appear here when a partner sends one."
          glyph="✓"
          title="Nothing to review"
        />
      ) : (
        renewals.map((entry) => (
          <Card key={entry.partner_document_renewal_id} tone="sunken">
            <strong>
              {entry.document_kind.toLowerCase()} · partner {shortReference(entry.partner_user_id)}
            </strong>
            <p>
              New reference {entry.document_reference}, expires{' '}
              {new Date(entry.expires_at).toLocaleDateString()} · sent{' '}
              {new Date(entry.created_at).toLocaleString()}
            </p>
            <div className="ns-row">
              <Button
                busy={busy === entry.partner_document_renewal_id}
                onClick={() => void decide(entry, 'APPROVED')}
                size="small"
              >
                Approve
              </Button>
              <Button
                busy={busy === entry.partner_document_renewal_id}
                onClick={() => void decide(entry, 'REJECTED')}
                size="small"
                variant="danger"
              >
                Reject
              </Button>
            </div>
          </Card>
        ))
      )}
    </Panel>
  );
}
