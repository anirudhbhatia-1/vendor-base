'use client';
import { createWorkspaceAuth } from '@neighbourhood-store/pwa-auth/workspace';

/** This workspace's session, built once from its two public values. */
export const workspaceAuth = createWorkspaceAuth({
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

export const { getSupabase, supabaseConfigured } = workspaceAuth;
