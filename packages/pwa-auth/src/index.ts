import { errorMessageFor } from '@neighbourhood-store/domain-types';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PublicSupabaseConfig {
  readonly anonKey: string | undefined;
  readonly url: string | undefined;
}

export function hasSupabaseConfig(
  config: PublicSupabaseConfig,
): config is { readonly anonKey: string; readonly url: string } {
  return Boolean(config.anonKey && config.url);
}

export function createPwaBrowserClient(config: PublicSupabaseConfig): SupabaseClient | null {
  if (!hasSupabaseConfig(config)) return null;
  return createBrowserClient(config.url, config.anonKey);
}

export async function authenticatedFetch(
  client: SupabaseClient,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error('Your session has expired. Sign in again.');
  }
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${data.session.access_token}`);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}

export async function authenticatedJson<Result>(
  client: SupabaseClient,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Result> {
  const response = await authenticatedFetch(client, input, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      readonly message?: string | string[];
      readonly error?: {
        readonly code?: string;
        readonly details?: Readonly<Record<string, unknown>>;
      };
    } | null;
    if (response.status === 401) {
      await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
    const raw = body?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : raw;
    // The stable code is for logs and branching, never for a person: a vendor
    // or partner was being shown `RESOURCE_NOT_FOUND` in the middle of a
    // delivery. The API answers with a code by design (it localises client
    // side), so the wording lives here.
    const code = body?.error?.code;
    const detail =
      message ?? errorMessageFor(code) ?? `Something went wrong (${response.status}). Try again.`;
    const error = new Error(detail);
    Object.assign(error, { status: response.status });
    if (code !== undefined) Object.assign(error, { code });
    // Structured detail the API allowlisted -- how many units are left, which
    // publication checks are outstanding. It travels with the error so a screen
    // can say the specific thing rather than the generic sentence above.
    const details = body?.error?.details;
    if (details && typeof details === 'object') Object.assign(error, { details });
    throw error;
  }
  if (response.status === 204) return undefined as Result;
  return (await response.json()) as Result;
}

/**
 * Signs out of the marketplace session and the Supabase session.
 *
 * The Supabase sign-out is global: a local-only sign-out left the refresh token
 * live on every other device the account was signed in on, so "sign out" did
 * not end the account's other sessions. If the global call cannot reach
 * Supabase, the local session is still cleared so the device in front of the
 * user is not left signed in.
 */
export async function revokeAndSignOut(input: {
  readonly apiUrl: string;
  readonly client: SupabaseClient;
}): Promise<void> {
  const { data } = await input.client.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    const response = await fetch(`${input.apiUrl}/auth/sessions/sign-out`, {
      headers: { authorization: `Bearer ${token}` },
      method: 'POST',
    });
    if (!response.ok && response.status !== 401) {
      throw new Error('The marketplace session could not be revoked. Try signing out again.');
    }
  }
  const { error } = await input.client.auth.signOut({ scope: 'global' });
  if (error) await input.client.auth.signOut({ scope: 'local' });
}
