/**
 * Joins class names, dropping anything falsy.
 *
 * Every component accepts a `className` so an application can position it
 * without reaching into the component's own styling, which is what the old
 * per-app `design-system.css` override layer existed to do.
 */
export function cx(...values: readonly (string | false | null | undefined)[]): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}
