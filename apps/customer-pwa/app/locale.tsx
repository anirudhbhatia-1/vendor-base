'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchLocaleBundle, type LocaleLanguage } from '@neighbourhood-store/i18n';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
const storageKey = 'neighbourhood.customer.language';

type LocaleValue = {
  readonly language: LocaleLanguage;
  readonly setLanguage: (next: LocaleLanguage) => void;
  /** Returns the translation for `key`, falling back to the English literal. */
  readonly t: (key: string, fallback: string) => string;
};

const LocaleContext = createContext<LocaleValue | null>(null);

/**
 * English and Hindi for the whole customer surface (MKT-11).
 *
 * The infrastructure for this has existed all along — server-held locale keys,
 * a `/locale/bundle` endpoint, a fetch helper — and exactly one screen used it,
 * to list five status labels as a demonstration. Every other string was a
 * hardcoded English literal in JSX, and the header's "EN / हिन्दी" control was a
 * link to the account page.
 *
 * Copy lives on the server so a translation can be corrected without shipping a
 * client. The English literal stays in the call as the fallback, which keeps the
 * source readable and means a missing key degrades to English rather than to a
 * bare `customer.cart.empty.title`.
 */
export function LocaleProvider({ children }: { readonly children: ReactNode }) {
  const [language, setLanguageState] = useState<LocaleLanguage>('en');
  const [bundle, setBundle] = useState<Record<string, string>>({});

  // Restored before the first paint of client content so a Hindi reader does
  // not watch the interface translate itself a moment after it appears.
  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === 'en' || stored === 'hi') setLanguageState(stored);
  }, []);

  useEffect(() => {
    let active = true;
    fetchLocaleBundle(apiUrl, language, 'CUSTOMER')
      .then((payload) => {
        if (active) setBundle(payload.bundle);
      })
      .catch(() => {
        // A failed bundle leaves every `t()` on its English fallback, which is
        // a usable app. Blocking the shop on a translation fetch would not be.
        if (active) setBundle({});
      });
    return () => {
      active = false;
    };
  }, [language]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: LocaleLanguage) => {
    setLanguageState(next);
    window.localStorage.setItem(storageKey, next);
  }, []);

  const value = useMemo<LocaleValue>(
    () => ({
      language,
      setLanguage,
      t: (key: string, fallback: string) => bundle[key] ?? fallback,
    }),
    [bundle, language, setLanguage],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  const value = useContext(LocaleContext);
  // A default rather than a throw: a component rendered outside the provider
  // (a test, a future route) should still show English, not crash the tree.
  return value ?? { language: 'en', setLanguage: () => {}, t: (_key, fallback) => fallback };
}
