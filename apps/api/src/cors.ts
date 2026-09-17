const loopbackClients = /^http:\/\/(?:127\.0\.0\.1|localhost):31(?:00|01|02|03)$/;

/**
 * Methods the browser clients actually use. DELETE was missing, so every
 * address, favourite, preferred-store and recent-search removal failed its
 * preflight even though the routes existed and the typed client exposed them.
 */
export const allowedMethods = ['DELETE', 'GET', 'POST', 'PUT'] as const;

/**
 * Additional exact origins, supplied as a comma-separated `CORS_ALLOWED_ORIGINS`.
 *
 * The loopback development clients are always allowed. A deployed PWA is served
 * from its own origin, which no regex here can know, so it is configured rather
 * than guessed. Entries must be a bare scheme+host+port with no path, and a
 * wildcard is rejected: this list is what separates the API from any website a
 * signed-in user happens to visit.
 */
export function parseConfiguredOrigins(value: string | undefined): readonly string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry === '*') throw new Error('CORS_ALLOWED_ORIGINS must not contain a wildcard');
      let parsed: URL;
      try {
        parsed = new URL(entry);
      } catch {
        throw new Error(`CORS_ALLOWED_ORIGINS entry is not a URL: ${entry}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`CORS_ALLOWED_ORIGINS entry must be http or https: ${entry}`);
      }
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error(`CORS_ALLOWED_ORIGINS entry must be an origin only: ${entry}`);
      }
      return parsed.origin;
    });
}

export function isAllowedOrigin(origin: string, configured: readonly string[]): boolean {
  return loopbackClients.test(origin) || configured.includes(origin);
}
