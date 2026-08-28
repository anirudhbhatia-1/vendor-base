'use client';

import { useEffect, useState } from 'react';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

type Language = 'en' | 'hi';

// The order-status keys this panel renders from the server bundle. Server codes
// are stable; only the rendered label changes with language.
const STATUS_KEYS = [
  'customer.order.status.placed',
  'customer.order.status.accepted',
  'customer.order.status.picking',
  'customer.order.status.ready',
  'customer.order.status.picked_up',
] as const;

export function LocaleBar() {
  const [language, setLanguage] = useState<Language>('en');
  const [bundle, setBundle] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    fetch(`${apiUrl}/locale/bundle?language=${language}&audience=CUSTOMER`)
      .then((response) => {
        if (!response.ok) throw new Error(`Bundle request failed (${response.status})`);
        return response.json() as Promise<{ bundle: Record<string, string> }>;
      })
      .then((payload) => {
        if (active) setBundle(payload.bundle);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Bundle unavailable');
      });
    return () => {
      active = false;
    };
  }, [language]);

  return (
    <section className="locale-bar" aria-labelledby="locale-heading">
      <div className="locale-header">
        <h2 id="locale-heading">Order status labels</h2>
        <div className="locale-toggle" role="group" aria-label="Language">
          {(['en', 'hi'] as const).map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={language === code}
              onClick={() => setLanguage(code)}
            >
              {code === 'en' ? 'English' : 'हिन्दी'}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p role="status" className="locale-error">
          {error}
        </p>
      ) : (
        <dl className="locale-list">
          {STATUS_KEYS.map((key) => (
            <div key={key} className="locale-row">
              <dt>{key.split('.').pop()}</dt>
              <dd lang={language}>{bundle[key] ?? '—'}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
