/**
 * Compatibility declarations for Next.js 16.3's public type surface while the
 * workspace remains on TypeScript 5.9. Remove these when TypeScript's standard
 * libraries provide URLPatternInput and URLPatternOptions globally.
 */
type URLPatternInput = string | URLPatternInit;

interface URLPatternOptions {
  ignoreCase?: boolean;
}
