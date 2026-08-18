import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const databaseDirectory = fileURLToPath(new URL('..', import.meta.url));
const composeScript = fileURLToPath(new URL('./compose.mjs', import.meta.url));

function run(command, arguments_, cwd = databaseDirectory) {
  const result = spawnSync(command, arguments_, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 1}`);
}

function main() {
  let testDatabaseStarted = false;
  try {
    run(process.execPath, [composeScript, 'test-up']);
    testDatabaseStarted = true;
    run('pnpm', ['verify:lifecycle']);
  } finally {
    if (testDatabaseStarted) run(process.execPath, [composeScript, 'test-down']);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown database verification failure';
  process.stderr.write(
    `${JSON.stringify({ event: 'database.stack_verification.failed', message })}\n`,
  );
  process.exitCode = 1;
}
