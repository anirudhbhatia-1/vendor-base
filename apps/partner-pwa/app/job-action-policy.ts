export function deliveryProofAllowed(state: string, emergency: boolean): boolean {
  return state === 'ARRIVED' && !emergency;
}
export function offerIsCurrent(expiresAt: string | null, now: number): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}

/**
 * A command reference the schema will accept.
 *
 * `assignment_event_command_shape` allows `SYNTH-CMD-` followed by upper-case
 * letters, digits and hyphens only. The route names carry hyphens
 * (`arrive-vendor`, `begin-route`), and the earlier builder swapped them for
 * underscores, which the schema refuses: every multi-word step failed with
 * "Something went wrong at our end", while `accept` and `pickup` worked. A
 * partner could take a job and never mark arrival.
 */
export function transitionCommandReference(action: string, at: number): string {
  const step = action
    .toUpperCase()
    .replaceAll(/[^A-Z0-9-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `SYNTH-CMD-${step}-${at.toString(36).toUpperCase()}`;
}
