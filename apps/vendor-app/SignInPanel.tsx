import { SignInPanel, type NativeSession } from '@neighbourhood-store/app-auth';
import { getSupabase } from './supabase-client';

/** The shared sign-in screen, bound to this shell's role. */
export function VendorSignInPanel({ onSignIn }: { onSignIn: (token: string) => void }) {
  return (
    <SignInPanel
      role="vendor"
      defaultPhone="SYNTH-PHONE-VENDOR-001"
      supabase={getSupabase()}
      onSession={(session: NativeSession | null) => onSignIn(session?.access_token ?? '')}
    />
  );
}
