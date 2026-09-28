import { formatMoneyMinor } from '@neighbourhood-store/ui';

/** Strips the synthetic-data marker required by the schema in synthetic mode. */
export function displayArea(value: string): string {
  return value.replace(/^SYNTH(?:ETIC)?[ _-]*/i, '').trim() || value;
}

/**
 * The zones the partner's position falls in (9.2), named up to three: where
 * zones overlap, a position can sit in many, and listing every one pushed the
 * work itself off the screen.
 */
export function zoneSentence(zones: readonly string[]): string {
  const named = zones.map(displayArea);
  if (named.length <= 3) return `In ${named.join(', ')}`;
  const more = named.length - 3;
  return `In ${named.slice(0, 3).join(', ')} and ${more} more zone${more === 1 ? '' : 's'}`;
}

/** A reference short enough to read aloud, without losing meaning. */
export function shortReference(value: string): string {
  const tail = value.split('-').at(-1) ?? value;
  return tail.slice(-8).toUpperCase();
}

/** When to be at the store, from the shop's ready time or its estimate (9.3). */
export function offerDeadlineSentence(
  expectedReadyAt: string | null | undefined,
  now: number,
): string {
  if (!expectedReadyAt) return 'Ready time not yet known';
  const at = new Date(expectedReadyAt);
  if (Number.isNaN(at.getTime())) return 'Ready time not yet known';
  const minutes = Math.round((at.getTime() - now) / 60_000);
  if (minutes <= 0) return 'Ready to collect now';
  return `Ready to collect in about ${minutes} min`;
}

/** The waiting terms, in the partner's words (9.3). */
export function waitPolicySentence(policy: {
  readonly included_seconds: number;
  readonly per_completed_minute_minor: number;
  readonly cap_minor: number;
}): string {
  const included = Math.round(policy.included_seconds / 60);
  return `first ${included} min waiting included, then ${formatMoneyMinor(policy.per_completed_minute_minor)}/min up to ${formatMoneyMinor(policy.cap_minor)}`;
}
