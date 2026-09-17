/** Strips the synthetic-data marker required by the schema in synthetic mode. */
export function displayArea(value: string): string {
  return value.replace(/^SYNTH(?:ETIC)?[ _-]*/i, '').trim() || value;
}

/** A reference short enough to read aloud, without losing meaning. */
export function shortReference(value: string): string {
  const tail = value.split('-').at(-1) ?? value;
  return tail.slice(-8).toUpperCase();
}
