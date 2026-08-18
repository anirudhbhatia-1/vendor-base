import { defineConfig } from 'drizzle-kit';
import { loadDatabaseConfig } from './src/config.js';

const database = loadDatabaseConfig('local');

export default defineConfig({
  dialect: 'postgresql',
  schema: './schema.ts',
  out: './generated',
  dbCredentials: {
    url: database.connectionString,
  },
  strict: true,
  verbose: true,
});
