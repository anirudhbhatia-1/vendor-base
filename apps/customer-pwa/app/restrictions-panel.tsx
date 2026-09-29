'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OwnRestriction } from '@neighbourhood-store/contracts';
import { actionErrorText, Button, Card, Notice } from '@neighbourhood-store/ui';
import { customerApiClient } from './customer-session';
import { shortReference } from './display';
import { useLocale } from './locale';

/**
 * A restriction on this account (11.4, SEC-14): the reason, the policy, when
 * it is reviewed and ends, and an appeal decided by someone who took no part
 * in it. Shown on the help page, where a blocked checkout sends the customer.
 * Nothing renders when there is nothing in force.
 */
export function RestrictionsPanel() {
  const { t } = useLocale();
  const [restrictions, setRestrictions] = useState<readonly OwnRestriction[]>([]);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await (await customerApiClient()).orders.restrictions();
      setRestrictions(result.restrictions.filter((entry) => entry.in_force));
    } catch {
      // The help page works without this; a failure here is not the customer's to fix.
      setRestrictions([]);
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function appeal(id: string) {
    const statement = (drafts[id] ?? '').trim();
    if (!statement) return;
    try {
      await (await customerApiClient()).orders.appealRestriction(id, statement);
      setDrafts({ ...drafts, [id]: '' });
      setMessage('Your appeal was sent. Someone who was not part of the decision will look at it.');
      await load();
    } catch (cause) {
      setMessage(actionErrorText(cause, 'The appeal could not be sent.'));
    }
  }

  if (restrictions.length === 0) return null;
  return (
    <section
      aria-label={t('customer.restriction.heading', 'Restrictions on your account')}
      className="ns-stack"
    >
      <h2>{t('customer.restriction.heading', 'Restrictions on your account')}</h2>
      {message ? <Notice>{message}</Notice> : null}
      {restrictions.map((entry) => (
        <Card as="article" key={entry.trust_restriction_case_id} tone="raised">
          <p>
            {entry.scope_kind === 'GLOBAL'
              ? 'You cannot place new orders for now.'
              : 'You cannot place new orders with one shop or area for now.'}{' '}
            Orders you have already placed are not affected.
          </p>
          <small>
            Reason {entry.reason_code.replaceAll('_', ' ').toLowerCase()} · policy{' '}
            {shortReference(entry.policy_reference)} · reviewed by{' '}
            {new Date(entry.review_at).toLocaleDateString()} · ends{' '}
            {new Date(entry.effective_until).toLocaleDateString()}
          </small>
          {entry.appeal_state === 'OPEN' ? (
            <Notice>Your appeal is being looked at.</Notice>
          ) : entry.appeal_state === 'UPHELD' ? (
            <Notice tone="warning">Your appeal was looked at and the restriction stands.</Notice>
          ) : null}
          {entry.appealable ? (
            <form
              className="ns-stack"
              onSubmit={(event) => {
                event.preventDefault();
                void appeal(entry.trust_restriction_case_id);
              }}
            >
              <label className="ns-field">
                <span className="ns-field__label">
                  {t('customer.restriction.appeal', 'Appeal this restriction')}
                </span>
                <textarea
                  className="ns-field__control"
                  maxLength={2000}
                  onChange={(event) =>
                    setDrafts({ ...drafts, [entry.trust_restriction_case_id]: event.target.value })
                  }
                  rows={3}
                  value={drafts[entry.trust_restriction_case_id] ?? ''}
                />
              </label>
              <Button type="submit" variant="secondary">
                {t('customer.restriction.appeal', 'Appeal this restriction')}
              </Button>
            </form>
          ) : null}
        </Card>
      ))}
    </section>
  );
}
