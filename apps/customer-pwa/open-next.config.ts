import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * The customer surface needs a real runtime for its BFF session boundary and
 * entity-addressed pages. It deliberately uses no incremental cache adapter:
 * customer responses are request scoped and public catalogue caching remains
 * controlled by the API's HTTP headers.
 */
export default defineCloudflareConfig({});
