import assert from 'node:assert/strict';
import net from 'node:net';
import process from 'node:process';

const host = '127.0.0.1';

export function parsePort(argument) {
  const [rawPort, label = 'service'] = argument.split(':', 2);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid development port: ${rawPort}`);
  }
  return { label, port };
}

export function portIsAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(error);
      }
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve(true)));
    });
  });
}

async function runSelfTest() {
  assert.deepEqual(parsePort('3100:customer'), { label: 'customer', port: 3100 });
  assert.throws(() => parsePort('0:invalid'));
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host, port: 0 }, resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  assert.equal(await portIsAvailable(address.port), false);
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  process.stdout.write('Development port preflight self-test passed.\n');
}

if (process.argv.includes('--self-test')) {
  await runSelfTest();
} else {
  let services;
  try {
    services = process.argv.slice(2).map(parsePort);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Invalid port preflight'}\n`);
    process.exit(1);
  }
  if (services.length === 0) {
    process.stderr.write('usage: assert-dev-ports-available.mjs <port:service> [...]\n');
    process.exit(1);
  }

  const results = await Promise.all(
    services.map(async (service) => ({
      ...service,
      available: await portIsAvailable(service.port),
    })),
  );
  const occupied = results.filter((result) => !result.available);
  if (occupied.length > 0) {
    const details = occupied.map(({ label, port }) => `${label} (${host}:${port})`).join(', ');
    process.stderr.write(
      `Cannot start another development stack; these addresses are already in use: ${details}.\n` +
        'Stop the existing stack with Ctrl+C, then run the command again.\n',
    );
    process.exit(1);
  }
}
