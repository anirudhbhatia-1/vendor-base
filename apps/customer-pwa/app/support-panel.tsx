'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { CustomerSupportCase } from '@neighbourhood-store/contracts';
import {
  actionErrorText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  PageHeader,
} from '@neighbourhood-store/ui';
import { customerApiClient } from './customer-session';
import { messageLabel, shortReference } from './display';
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
      setError(actionErrorText(cause, 'Support cases could not be loaded.'));
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
      setError(actionErrorText(cause, 'Message could not be sent.'));
    }
  }

  if (!loaded) return <LoadingState label="Loading support…" lines={3} />;
  if (error && !detail && cases.length === 0)
    return <ErrorState onRetry={() => void load()} title={error} />;

  if (supportCaseId) {
    if (!detail) return <EmptyState glyph="?" title="Case not found" />;
    const messages = detail.messages ?? [];
    return (
      <div className="ns-stack">
        <PageHeader
          description={`Order ${shortReference(detail.order_reference)}`}
          eyebrow="Support case"
          title={detail.category.replaceAll('_', ' ').toLowerCase()}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {detail.merged_into_case_id ? (
          // Merged into the case already open about the same trouble; a reply
          // here is carried there (11.3).
          <Notice>
            This case was joined with another one about the same problem.{' '}
            <Link href={`/support/${detail.merged_into_case_id}`}>Open that case</Link>.
          </Notice>
        ) : null}
        {detail.awaiting_you ? (
          <Notice tone="warning">
            Support asked you a question. Reply below so they can continue.
          </Notice>
        ) : null}
        <Card tone="raised">
          <div className="ns-row">
            <strong>Issue</strong>
            <StatePill state={detail.lifecycle_state} />
          </div>
          <p>{detail.description}</p>
          {detail.line_title ? <small>About: {detail.line_title}</small> : null}
          {detail.response_due_at ? (
            <small>We will reply by {new Date(detail.response_due_at).toLocaleString()}</small>
          ) : null}
        </Card>
        <section className="ns-stack" aria-label="Conversation">
          {messages.length === 0 ? (
            <p>No replies yet.</p>
          ) : (
            messages.map((message) => (
              <Card
                as="article"
                key={message.support_case_message_id}
                tone={message.from === 'YOU' ? 'sunken' : 'raised'}
              >
                <small>{messageLabel(message)}</small>
                <p>{message.body}</p>
                <small>{new Date(message.created_at).toLocaleString()}</small>
              </Card>
            ))
          )}
        </section>
        <form className="ns-stack" onSubmit={send}>
          <label className="ns-field">
            <span className="ns-field__label">
              {detail.lifecycle_state === 'RESOLVED'
                ? 'Still wrong? Reply to reopen this case'
                : 'Reply'}
            </span>
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
            {item.awaiting_you ? (
              <Notice tone="warning">Support is waiting for your reply.</Notice>
            ) : null}
            <small>Order {shortReference(item.order_reference)}</small>
          </Card>
        ))
      )}
    </div>
  );
}
