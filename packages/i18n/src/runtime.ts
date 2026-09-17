export type LocaleLanguage = 'en' | 'hi';
export type LocaleAudience = 'CUSTOMER' | 'VENDOR' | 'PARTNER' | 'ADMIN' | 'SHARED';

export type LocaleBundle = {
  language: LocaleLanguage;
  audience?: LocaleAudience;
  bundle: Record<string, string>;
};

export async function fetchLocaleBundle(
  apiUrl: string,
  language: LocaleLanguage,
  audience?: LocaleAudience,
): Promise<LocaleBundle> {
  const params = new URLSearchParams({ language });
  if (audience) params.set('audience', audience);
  const response = await fetch(`${apiUrl}/locale/bundle?${params.toString()}`);
  if (!response.ok) throw new Error(`Locale bundle request failed (${response.status})`);
  return response.json() as Promise<LocaleBundle>;
}

export function t(bundle: Record<string, string>, key: string, fallback?: string): string {
  return bundle[key] ?? fallback ?? key;
}
