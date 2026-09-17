import * as SecureStore from 'expo-secure-store';
import { createNativeSupabase } from '@neighbourhood-store/app-auth/supabase';

const globalEnv =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

/** Null when the shell was built without Supabase configuration. */
export const { getSupabase, supabaseConfigured } = createNativeSupabase({
  url: globalEnv['EXPO_PUBLIC_SUPABASE_URL'],
  anonKey: globalEnv['EXPO_PUBLIC_SUPABASE_ANON_KEY'],
  storage: SecureStore,
});
