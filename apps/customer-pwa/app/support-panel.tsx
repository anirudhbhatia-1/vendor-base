'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { CustomerSupportCase } from '@neighbourhood-store/contracts';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  PageHeader,
} from '@neighbourhood-store/ui';
import { customerApiClient } from './customer-session';
import { shortReference } from './display';
import { StatePill } from './state-pill';

export function SupportPanel({ supportCaseId }: { readonly supportCaseId?: string }) {
  const [cases, setCases] = useState<readonly CustomerSupportCase[]>([]);
  const [detail, setDetail] = useState<CustomerSupportCase | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const client = await customerApiClient();
      if (supportCaseId) setDetail(await client.orders.supportCase(supportCaseId));
      else setCases((await client.orders.supportCases()).cases);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Support cases could not be loaded.');
    } finally {
      setLoaded(true);
    }
  }, [supportCaseId]);
  useEffect(() => void load(), [load]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supportCaseId) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = String(data.get('body') ?? '').trim();
    if (!body) return;
    try {
      await (await customerApiClient()).orders.sendSupportMessage(supportCaseId, body);
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Message could not be sent.');
    }
  }

  if (!loaded) return <LoadingState label="Loading support…" lines={3} />;
  if (error && !detail && cases.length === 0)
    return <ErrorState onRetry={() => void load()} title={error} />;

  if (supportCaseId) {
    if (!detail) return <EmptyState glyph="?" title="Case not found" />;
    return (
      <div className="ns-stack">
        <PageHeader
          description={`Order ${shortReference(detail.order_reference)}`}
          eyebrow="Support case"
          title={detail.category.replaceAll('_', ' ').toLowerCase()}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Card tone="raised">
          <div className="ns-row">
            <strong>Issue</strong>
            <StatePill state={detail.lifecycle_state} />
          </div>
          <p>{detail.description}</p>
          {detail.response_due_at ? (
            <small>Response due {new Date(detail.response_due_at).toLocaleString()}</small>
          ) : null}
        </Card>
        <section className="ns-stack" aria-label="Conversation">
          {(detail.messages ?? []).length === 0 ? (
            <p>No replies yet.</p>
          ) : (
            (detail.messages ?? []).map((message) => (
              <Card as="article" key={message.support_case_message_id} tone="sunken">
                <p>{message.body}</p>
                <small>{new Date(message.created_at).toLocaleString()}</small>
              </Card>
            ))
          )}
        </section>
        <form className="ns-stack" onSubmit={send}>
          <label className="ns-field">
            <span className="ns-field__label">Reply</span>
            <textarea
              className="ns-field__control"
              maxLength={2000}
              name="body"
              required
              rows={4}
            />
          </label>
          <Button type="submit">Send message</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="ns-stack">
      <PageHeader
        description="Issues and conversations tied to your orders."
        eyebrow="Help"
        title="Support cases"
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {cases.length === 0 ? (
        <EmptyState
          description="Open an order and choose Get help when something is wrong."
          glyph="?"
          title="No support cases"
        />
      ) : (
        cases.map((item) => (
          <Card as="article" key={item.support_case_id} tone="sunken">
            <div className="ns-row">
              <strong>
                <Link href={`/support/${item.support_case_id}`}>
                  {item.category.replaceAll('_', ' ').toLowerCase()}
                </Link>
              </strong>
              <StatePill state={item.lifecycle_state} />
            </div>
            <p>{item.description}</p>
            <small>Order {shortReference(item.order_reference)}</small>
          </Card>
        ))
      )}
    </div>
  );
}
