import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SecureStorageBackend } from './secure-storage';

/**
 * Supabase Auth for a native shell.
 *
 * The admin console provisions vendors and partners as Supabase email
 * identities, with no phone identity and no local password, so the phone
 * screens alone could not sign them in. Two shells carried this file; this is
 * it once. The session lives in the keychain rather than plain storage: it is
 * a credential, and on a shared or lost shop phone the difference matters
 * (SEC-08).
 */
export function createNativeSupabase(input: {
  readonly url: string | undefined;
  readonly anonKey: string | undefined;
  readonly storage: SecureStorageBackend;
}): { getSupabase: () => SupabaseClient | null; supabaseConfigured: () => boolean } {
  let cached: SupabaseClient | null = null;
  const configured = Boolean(input.url && input.anonKey);
  return {
    supabaseConfigured: () => configured,
    getSupabase() {
      if (cached) return cached;
      if (!input.url || !input.anonKey) return null;
      cached = createClient(input.url, input.anonKey, {
        auth: {
          autoRefreshToken: true,
          // No URL-based session detection: there is no browser address bar
          // here, and leaving it on makes the client parse a window that does
          // not exist.
          detectSessionInUrl: false,
          persistSession: true,
          storage: {
            getItem: (key) => input.storage.getItemAsync(key),
            setItem: (key, value) => input.storage.setItemAsync(key, value),
            removeItem: (key) => input.storage.deleteItemAsync(key),
          },
        },
      });
      return cached;
    },
  };
}
