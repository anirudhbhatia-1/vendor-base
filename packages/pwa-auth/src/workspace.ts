'use client';

import { createApiClient } from '@neighbourhood-store/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticatedJson } from './index.js';
import { createPwaBrowserClient, hasSupabaseConfig } from './index.js';

/**
 * Everything a role workspace needs to talk to the API as its signed-in user.
 *
 * The vendor, partner and admin PWAs each carried a `supabase-client.ts` and
 * an `authenticated-api.ts` -- six files, identical but for the function
 * names. The session is the one thing those three apps must agree on exactly,
 * so it is built here, once, from the two public values a workspace owns.
 */
export function createWorkspaceAuth(input: {
  readonly apiUrl: string;
  readonly supabaseUrl: string | undefined;
  readonly supabaseAnonKey: string | undefined;
}) {
  const config = { url: input.supabaseUrl, anonKey: input.supabaseAnonKey };
  let cached: SupabaseClient | null = null;

  /** Null when the app is not configured for Supabase Auth; callers handle that. */
  const getSupabase = (): SupabaseClient | null => {
    if (cached) return cached;
    cached = createPwaBrowserClient(config);
    return cached;
  };

  const requireSupabase = (): SupabaseClient => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase Auth is not configured.');
    return supabase;
  };

  return {
    apiUrl: input.apiUrl,
    getSupabase,
    supabaseConfigured: () => hasSupabaseConfig(config),
    /** The typed client, bound to the live session's access token. */
    async apiClient() {
      const { data, error } = await requireSupabase().auth.getSession();
      if (error || !data.session?.access_token) {
        throw new Error('Your session has expired. Sign in again.');
      }
      const token = data.session.access_token;
      return createApiClient({ baseUrl: input.apiUrl, getToken: () => token });
    },
    /** A raw JSON request with the session attached and the error contract applied. */
    request<Result>(path: string, init?: RequestInit): Promise<Result> {
      return authenticatedJson<Result>(requireSupabase(), `${input.apiUrl}/${path}`, init);
    },
  };
}

export type WorkspaceAuth = ReturnType<typeof createWorkspaceAuth>;
