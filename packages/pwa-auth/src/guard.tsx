'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type WorkspaceRole = 'admin' | 'customer' | 'partner' | 'vendor';

type GuardState = 'checking' | 'authorized' | 'unauthorized';

/**
 * Client-side authentication and role gate for a role PWA workspace.
 *
 * The `proxy.ts` gate only runs on a Next.js server. Every PWA also ships as a
 * static export (`output: 'export'` for Cloudflare Pages), where no proxy runs
 * at all — so a server-only gate leaves the deployed build with no route
 * protection whatsoever. This component enforces the same rule in the browser,
 * in both builds.
 *
 * It also closes a second gap: `proxy.ts` only asked whether *someone* is
 * signed in, never which role they hold, so any authenticated user could load
 * any workspace shell. The role is confirmed against the API, which is the only
 * party that can answer it.
 *
 * This is defence in depth, not the security boundary. Every route the
 * workspace calls is capability-checked server-side; the gate exists so an
 * unauthorized viewer sees a sign-in screen rather than an empty shell that
 * 401s on every request.
 */
export function RequireWorkspaceRole(input: {
  readonly children: ReactNode;
  readonly apiUrl: string;
  readonly client: SupabaseClient | null;
  readonly configured: boolean;
  readonly loginPath?: string;
  readonly workspaceRole: WorkspaceRole;
}): ReactNode {
  const { apiUrl, client, configured, workspaceRole } = input;
  const loginPath = input.loginPath ?? '/login';
  const [state, setState] = useState<GuardState>('checking');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function check(): Promise<void> {
      if (!configured || !client) {
        if (active) {
          setState('unauthorized');
          setMessage('Supabase Auth is not configured for this build.');
        }
        return;
      }
      try {
        const { data } = await client.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          redirect();
          return;
        }
        const response = await fetch(`${apiUrl}/auth/whoami`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
          redirect();
          return;
        }
        const body = (await response.json()) as { primary_role?: string };
        if (body.primary_role !== workspaceRole) {
          await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
          redirect();
          return;
        }
        if (active) setState('authorized');
      } catch {
        redirect();
      }
    }
    function redirect(): void {
      if (!active) return;
      setState('unauthorized');
      if (typeof window !== 'undefined' && window.location.pathname !== loginPath) {
        window.location.replace(loginPath);
      }
    }
    void check();
    return () => {
      active = false;
    };
  }, [apiUrl, client, configured, loginPath, workspaceRole]);

  if (state === 'authorized') return input.children;
  return (
    <main aria-busy={state === 'checking'} style={{ padding: '2rem' }}>
      <p>
        {state === 'checking' ? 'Checking your session…' : (message ?? 'Redirecting to sign in…')}
      </p>
    </main>
  );
}
