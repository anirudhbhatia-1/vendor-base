import { SignInPanel, type NativeSession } from '@neighbourhood-store/app-auth';
import type { SessionTokens } from '@neighbourhood-store/contracts';
import { colors } from '@neighbourhood-store/ui-tokens/native';

/** The shared sign-in screen, bound to this shell's role. */
export function CustomerSignInPanel({
  onSignIn,
}: {
  onSignIn: (tokens: SessionTokens | null) => void;
}) {
  return (
    <SignInPanel
      role="customer"
      accent={colors.customerMango}
      defaultPhone="SYNTH-PHONE-CUSTOMER-001"
      onSession={(session: NativeSession | null) => onSignIn(session?.tokens ?? null)}
    />
  );
}
