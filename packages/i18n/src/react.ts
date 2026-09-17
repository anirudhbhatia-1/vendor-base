import { useEffect, useState } from 'react';
import { fetchLocaleBundle } from './runtime.js';
import type { LocaleAudience, LocaleLanguage } from './runtime.js';

export type UseLocaleBundleResult = {
  bundle: Record<string, string>;
  loading: boolean;
  error: string | null;
};

export function useLocaleBundle(
  apiUrl: string,
  language: LocaleLanguage,
  audience?: LocaleAudience,
): UseLocaleBundleResult {
  const [bundle, setBundle] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchLocaleBundle(apiUrl, language, audience)
      .then((payload) => {
        if (active) {
          setBundle(payload.bundle);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Bundle unavailable');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [apiUrl, language, audience]);

  return { bundle, loading, error };
}
