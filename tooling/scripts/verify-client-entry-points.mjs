import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));

const clients = [
  {
    appDirectory: 'apps/customer-app/dist',
    expected: 'Customer PWA · Internal build',
    filter: '@neighbourhood-store/customer-pwa',
    role: 'customer',
    url: 'http://127.0.0.1:3100',
  },
  {
    appDirectory: 'apps/vendor-app/dist',
    expected: 'Vendor desk · Jaipur company test',
    filter: '@neighbourhood-store/vendor-pwa',
    role: 'vendor',
    url: 'http://127.0.0.1:3101',
  },
  {
    appDirectory: 'apps/partner-app/dist',
    expected: 'Delivery Partner · Internal build',
    filter: '@neighbourhood-store/partner-pwa',
    role: 'partner',
    url: 'http://127.0.0.1:3102',
  },
  {
    appDirectory: 'apps/admin-app/dist',
    expected: 'Admin PWA · Internal build',
    filter: '@neighbourhood-store/admin-pwa',
    role: 'admin',
    url: 'http://127.0.0.1:3103',
  },
];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForPage(client, output) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(client.url, { signal: AbortSignal.timeout(1_000) });
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!body.includes(client.expected)) {
        throw new Error(`response did not contain ${JSON.stringify(client.expected)}`);
      }
      return;
    } catch (error) {
      if (attempt === 39) {
        const reason = error instanceof Error ? error.message : 'unknown request failure';
        throw new Error(`${client.role} PWA did not become ready: ${reason}\n${output()}`, {
          cause: error,
        });
      }
      await delay(250);
    }
  }
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  process.kill(-child.pid, 'SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(3_000).then(() => {
      if (child.exitCode === null && child.pid !== undefined) {
        process.kill(-child.pid, 'SIGKILL');
      }
    }),
  ]);
}

async function verifyPwa(client) {
  let output = '';
  const server = spawn('pnpm', ['--filter', client.filter, 'start'], {
    cwd: workspaceRoot,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-4_000);
  };
  server.stdout.on('data', collect);
  server.stderr.on('data', collect);

  try {
    await waitForPage(client, () => output);
  } finally {
    await stopProcess(server);
  }
}

async function verifyAndroidExport(client) {
  let files;
  try {
    files = await readdir(new URL(client.appDirectory, new URL('../../', import.meta.url)), {
      recursive: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown filesystem failure';
    throw new Error(`${client.role} Android export is missing; run pnpm build first: ${reason}`, {
      cause: error,
    });
  }

  if (!files.includes('metadata.json') || !files.some((file) => file.endsWith('.hbc'))) {
    throw new Error(`${client.role} Android export lacks metadata.json or a Hermes bundle`);
  }
}

for (const client of clients) {
  await verifyPwa(client);
  await verifyAndroidExport(client);
}

process.stdout.write(
  `${JSON.stringify({ android_exports: clients.length, event: 'client_entry_points.verified', pwa_shells: clients.length })}\n`,
);
