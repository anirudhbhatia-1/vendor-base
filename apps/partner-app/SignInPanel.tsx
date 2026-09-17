import { SignInPanel, type NativeSession } from '@neighbourhood-store/app-auth';
import { colors } from '@neighbourhood-store/ui-tokens/native';
import { getSupabase } from './supabase-client';

/** The shared sign-in screen, bound to this shell's role. */
export function PartnerSignInPanel({ onSignIn }: { onSignIn: (token: string) => void }) {
  return (
    <SignInPanel
      role="partner"
      accent={colors.evergreen}
      supabase={getSupabase()}
      onSession={(session: NativeSession | null) => onSignIn(session?.access_token ?? '')}
    />
  );
}
