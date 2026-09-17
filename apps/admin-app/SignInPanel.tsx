import { SignInPanel, type NativeSession } from '@neighbourhood-store/app-auth';

/** The shared sign-in screen, bound to this shell's role. */
export function AdminSignInPanel({ onSignIn }: { onSignIn: (token: string) => void }) {
  return (
    <SignInPanel
      role="admin"
      onSession={(session: NativeSession | null) => onSignIn(session?.access_token ?? '')}
    />
  );
}
