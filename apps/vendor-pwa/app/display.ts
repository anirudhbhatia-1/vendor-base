/**
 * Strips the synthetic-data marker from a stored name.
 *
 * `SYNTH ` is required by the schema's CHECK constraints while
 * `DATA_MODE=synthetic`, so it is written deliberately and must be removed just
 * as deliberately before anything is shown to a person.
 */
export function displayName(value: string): string {
  return value.replace(/^SYNTH(?:ETIC)?[ _-]*/i, '').trim() || value;
}

/** A reference short enough to read aloud, without losing meaning. */
export function shortReference(value: string): string {
  const tail = value.split('-').at(-1) ?? value;
  return tail.slice(-8).toUpperCase();
}
