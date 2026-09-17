'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@neighbourhood-store/contracts';
import { Button, Card, ErrorState, LoadingState, PageHeader } from '@neighbourhood-store/ui';
import { clearCustomerSession, customerApiClient } from './customer-session';
import { StatePill } from './state-pill';

export function SessionManager() {
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setSessions((await (await customerApiClient()).auth.sessions()).sessions);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sessions could not be loaded.');
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => void load(), [load]);
  if (!loaded) return <LoadingState label="Loading signed-in devices…" lines={3} />;
  if (error) return <ErrorState onRetry={() => void load()} title={error} />;
  return (
    <div className="ns-stack">
      <PageHeader
        description="Revoke a device you no longer use. A revoked refresh token cannot be rotated again."
        eyebrow="Security"
        title="Signed-in devices"
      />
      {sessions.map((session) => (
        <Card as="article" key={session.session_id} tone={session.current ? 'raised' : 'sunken'}>
          <div className="ns-row">
            <div>
              <strong>{session.device_label || session.platform}</strong>
              <p>Signed in {new Date(session.created_at).toLocaleString()}</p>
            </div>
            <StatePill state={session.current ? 'CURRENT' : session.state} />
          </div>
          <Button
            onClick={() =>
              void (async () => {
                const client = await customerApiClient();
                await client.auth.revokeSession(session.session_id);
                if (session.current) {
                  await clearCustomerSession();
                  window.location.assign('/login');
                } else await load();
              })()
            }
            variant={session.current ? 'danger' : 'secondary'}
          >
            {session.current ? 'Sign out this device' : 'Revoke session'}
          </Button>
        </Card>
      ))}
    </div>
  );
}
