import { withDatabaseClient } from '../src/client.js';
import {
  loadDatabaseConfig,
  loadProductionRuntimeDatabaseConfig,
  parseTarget,
} from '../src/config.js';

/**
 * The sign-in code the synthetic OTP adapter would have sent.
 *
 * With `OTP_ADAPTER` on the fake adapter no message leaves the system; the
 * code is written to `otp_protected_test_outbox` instead, which is where every
 * seed and acceptance script already reads it. This prints the newest
 * unexpired codes so a tester can sign in without opening a SQL client. It
 * prints codes and timestamps only -- no phone number, no hash key -- and it
 * is meaningless on an environment with a real SMS provider, where the outbox
 * is never written.
 *
 * Usage: node --env-file=<env> --import tsx scripts/read-synthetic-otp.ts --target <target>
 */

const target = parseTarget(process.argv.slice(2));
const config =
  target === 'supabase-production'
    ? loadProductionRuntimeDatabaseConfig()
    : loadDatabaseConfig(target);

await withDatabaseClient(config, async (client) => {
  const codes = await client.query<{ otp_code: string; created_at: Date; expires_at: Date }>(
    `SELECT otp_code, created_at, expires_at
       FROM marketplace.otp_protected_test_outbox
      WHERE expires_at > clock_timestamp()
      ORDER BY created_at DESC
      LIMIT 3`,
  );
  if (codes.rowCount === 0) {
    process.stdout.write('No unexpired synthetic sign-in code. Request one from the app first.\n');
    return;
  }
  for (const row of codes.rows) {
    process.stdout.write(
      `${row.otp_code}  requested ${row.created_at.toISOString()}  valid until ${row.expires_at.toISOString()}\n`,
    );
  }
});
