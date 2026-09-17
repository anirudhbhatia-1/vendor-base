/**
 * Presentation helpers shared by every customer screen.
 */

/**
 * Strips the synthetic-data marker from a stored name.
 *
 * `SYNTH ` is not decoration: the schema's CHECK constraints require it on
 * store names, product titles and address labels while `DATA_MODE=synthetic`,
 * so it is written deliberately and must be removed just as deliberately before
 * anything is shown to a person. Four surfaces each had their own private copy
 * of this function under a different name.
 */
export function displayLabel(value: string): string {
  return value.replace(/^SYNTH(?:ETIC)?[ _-]*/i, '').trim() || value;
}

/** The inverse: prefixes a customer-entered value so it satisfies the constraint. */
/** A reference short enough to read aloud to support, without losing meaning. */
export function shortReference(value: string): string {
  const tail = value.split('-').at(-1) ?? value;
  return tail.slice(-8).toUpperCase();
}
