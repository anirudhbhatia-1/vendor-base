import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Step 2.4 intentionally defines no domain tables. Later slices add reviewed
 * Drizzle tables to this schema and commit the generated SQL for review.
 */
export const marketplaceSchema = pgSchema('marketplace');
