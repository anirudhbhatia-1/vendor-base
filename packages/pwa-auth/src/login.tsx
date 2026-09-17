'use client';

import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WorkspaceRole } from './guard.js';

/** The part of the API's whoami answer the login page acts on. */
type WhoAmIAnswer = {
  readonly primary_role: string;
  readonly redirect_hint?: string | null;
};

/**
 * The sign-in page the three role workspaces share.
 *
 * Signs in with Supabase, then asks the API which workspace the account
 * belongs to and refuses -- signing the session out again -- if it is not
 * this one. Each app rendered its own copy of this page, and the only
 * differences were the role word and two sentences of copy; those are props.
 */
export function WorkspaceLoginPage(input: {
  readonly workspaceRole: WorkspaceRole;
  readonly title: string;
  readonly lede: string;
  readonly apiUrl: string;
  readonly getSupabase: () => SupabaseClient | null;
  readonly configured: boolean;
  readonly homePath?: string;
  /** Navigate after a successful sign-in; the app owns the router. */
  readonly onSignedIn: (path: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const supabase = input.getSupabase();
      if (!supabase) {
        setMessage(
          'Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
        );
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const token = data.session?.access_token;
      if (!token) throw new Error('Sign-in succeeded but no session was returned.');
      const who = await fetch(`${input.apiUrl}/auth/whoami`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!who.ok) throw new Error(`whoami failed with ${who.status}`);
      const body = (await who.json()) as WhoAmIAnswer;
      if (body.primary_role !== input.workspaceRole) {
        await supabase.auth.signOut();
        setMessage(
          `This account belongs to the ${body.primary_role} workspace, not the ${input.workspaceRole} workspace.`,
        );
        return;
      }
      input.onSignedIn(body.redirect_hint ?? input.homePath ?? '/');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '10vh auto', padding: '2rem' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>{input.title}</h1>
      <p style={{ marginBottom: '2rem', opacity: 0.7 }}>{input.lede}</p>
      <form onSubmit={submit} style={{ display: 'grid', gap: '1rem' }}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={{ width: '100%', padding: '10px 12px', marginTop: 4 }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="current-password"
            style={{ width: '100%', padding: '10px 12px', marginTop: 4 }}
          />
        </label>
        <button type="submit" disabled={busy} style={{ padding: '10px 14px' }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {message && (
          <p role="alert" style={{ color: '#7a2f2f' }}>
            {message}
          </p>
        )}
        {!input.configured && (
          <p style={{ opacity: 0.6, fontSize: 12 }}>
            Supabase env not detected — set NEXT_PUBLIC_SUPABASE_URL and
            NEXT_PUBLIC_SUPABASE_ANON_KEY in the app&apos;s environment.
          </p>
        )}
      </form>
    </main>
  );
}
