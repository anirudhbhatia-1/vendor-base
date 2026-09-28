'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  actionErrorText,
  Button,
  Card,
  ErrorState,
  LoadingState,
  Notice,
  PageHeader,
} from '@neighbourhood-store/ui';
import { customerApiClient } from './customer-session';
import { StatePill } from './state-pill';

type PrivacyRequest = {
  customer_privacy_request_id: string;
  request_kind: 'ACCOUNT_DELETION' | 'DATA_EXPORT';
  lifecycle_state: string;
  requested_at: string;
};

export function PrivacyPanel() {
  const [requests, setRequests] = useState<readonly PrivacyRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const result = await (await customerApiClient()).auth.privacyRequests();
      setRequests(result.requests as PrivacyRequest[]);
      setError(null);
    } catch (cause) {
      setError(actionErrorText(cause, 'Privacy requests could not be loaded.'));
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => void load(), [load]);
  async function request(kind: PrivacyRequest['request_kind']) {
    setError(null);
    try {
      await (await customerApiClient()).auth.requestPrivacy(kind);
      setNotice(
        kind === 'DATA_EXPORT'
          ? 'Your export request is queued.'
          : 'Your deletion request is queued for identity verification.',
      );
      await load();
    } catch (cause) {
      setError(actionErrorText(cause, 'The request could not be created.'));
    }
  }
  if (!loaded) return <LoadingState label="Loading privacy controls…" lines={3} />;
  if (error && requests.length === 0)
    return <ErrorState onRetry={() => void load()} title={error} />;
  return (
    <div className="ns-stack">
      <PageHeader
        description="Exports and deletion run asynchronously so payments, refunds and legally required records remain consistent."
        eyebrow="Account"
        title="Privacy controls"
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <Card tone="raised">
        <h2>Download your data</h2>
        <p>
          Request an archive of your profile, addresses, orders, support cases and consent history.
        </p>
        <Button onClick={() => void request('DATA_EXPORT')}>Request data export</Button>
      </Card>
      <Card tone="sunken">
        <h2>Delete your account</h2>
        <p>
          This starts a verified deletion workflow. Active orders and refunds must finish first.
        </p>
        <Button onClick={() => void request('ACCOUNT_DELETION')} variant="danger">
          Request account deletion
        </Button>
      </Card>
      {requests.map((item) => (
        <Card as="article" key={item.customer_privacy_request_id} tone="sunken">
          <div className="ns-row">
            <strong>{item.request_kind.replaceAll('_', ' ').toLowerCase()}</strong>
            <StatePill state={item.lifecycle_state} />
          </div>
          <small>Requested {new Date(item.requested_at).toLocaleString()}</small>
        </Card>
      ))}
    </div>
  );
}
