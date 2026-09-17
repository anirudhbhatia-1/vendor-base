export type ProofQueueState =
  | { readonly status: 'loading' | 'unknown' | 'denied' | 'unavailable' }
  | { readonly status: 'ready'; readonly pending: number; readonly checkedAt: number };

export async function readProofQueue(
  read: () => Promise<unknown>,
  now: () => number = Date.now,
): Promise<ProofQueueState> {
  try {
    const value = await read();
    if (!value || typeof value !== 'object' || !('proofs' in value) || !Array.isArray(value.proofs))
      return { status: 'unavailable' };
    if (
      !value.proofs.every(
        (proof: unknown) =>
          proof &&
          typeof proof === 'object' &&
          'sync_state' in proof &&
          ['PENDING', 'SYNCED', 'EXPIRED'].includes(String(proof.sync_state)),
      )
    )
      return { status: 'unavailable' };
    return {
      status: 'ready',
      pending: value.proofs.filter(
        (proof: { sync_state: string }) => proof.sync_state === 'PENDING',
      ).length,
      checkedAt: now(),
    };
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
    return {
      status: status === 401 || status === 403 || status === 404 ? 'denied' : 'unavailable',
    };
  }
}

export function proofQueueAllowsNewWork(
  state: ProofQueueState,
  connected: boolean,
  now: number,
): boolean {
  return (
    connected &&
    state.status === 'ready' &&
    state.pending === 0 &&
    now >= state.checkedAt &&
    now - state.checkedAt < 30_000
  );
}

export function proofQueueMessage(state: ProofQueueState): string {
  if (state.status === 'ready' && state.pending > 0)
    return 'Send your held proof from your active job before accepting more work.';
  if (state.status === 'denied')
    return 'Proof access could not be confirmed. Sign in again or ask support to check your access. Existing delivery and safety controls remain available.';
  if (state.status === 'unavailable')
    return 'The proof queue could not be checked. Retry before accepting new work. Existing delivery and safety controls remain available.';
  return 'Checking your held proofs before accepting new work. Existing delivery and safety controls remain available.';
}
