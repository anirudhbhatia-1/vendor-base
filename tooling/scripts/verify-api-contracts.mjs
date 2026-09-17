import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Fails when the typed client in `packages/contracts` declares a request path
 * the API does not serve.
 *
 * The client was hand-written against an imagined surface and drifted: whole
 * namespaces addressed routes that never existed, so calls 404ed at runtime
 * while every layer type-checked. Nothing compares the two sides, because the
 * client sends plain strings and the controllers declare their paths in
 * decorators. This control closes that gap.
 *
 * Usage: node tooling/scripts/verify-api-contracts.mjs [--self-test]
 */

const repositoryRoot = path.resolve(import.meta.dirname, '../..');
const clientFile = path.join(repositoryRoot, 'packages/contracts/src/client.ts');
const controllerDirectory = path.join(repositoryRoot, 'apps/api/src');
/**
 * The PWAs also call the API directly through their own authenticated-request
 * helpers, bypassing the typed client. Those raw strings are where the admin
 * refund path drifted to a route that did not exist, so they are checked too.
 */
const rawCallDirectories = [
  'apps/admin-pwa/app',
  'apps/vendor-pwa/app',
  'apps/partner-pwa/app',
  'apps/customer-pwa/app',
];

/**
 * Reduces a path to its shape: every parameter segment becomes `:`.
 *
 * A segment that is entirely an interpolation is a path parameter. A segment
 * that only *ends* with one — `favourites${qs}` — is a literal segment with an
 * appended query string, so the literal prefix is what the API serves.
 */
export function normalisePath(value) {
  const withoutQuery = value.split('?')[0];
  return `/${withoutQuery
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(':')) return ':';
      const interpolation = segment.indexOf('${');
      if (interpolation < 0) return segment;
      return interpolation === 0 ? ':' : segment.slice(0, interpolation);
    })
    .filter(Boolean)
    .join('/')}`;
}

/** Every path literal the typed client passes to its request helper. */
export function clientPaths(source) {
  const paths = new Set();
  for (const match of source.matchAll(/r<[^>]*>\(\s*([`'])([^`']+)\1/g)) {
    paths.add(normalisePath(match[2]));
  }
  for (const match of source.matchAll(/request\(\s*([`'])([^`']+)\1/g)) {
    paths.add(normalisePath(match[2]));
  }
  return paths;
}

/**
 * Paths passed to a PWA's own `adminRequest` / `vendorRequest` / `partnerRequest`
 * helper. These are written without a leading slash.
 */
export function rawCallPaths(source) {
  const paths = new Set();
  const pattern =
    /(?:adminRequest|vendorRequest|partnerRequest|customerRequest)(?:<[^>]*>)?\(\s*([`'])([^`']+)\1/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[2];
    // A template whose first segment is an interpolation cannot be resolved
    // statically; the typed client covers those call sites.
    if (value.startsWith('${')) continue;
    paths.add(normalisePath(`/${value}`));
  }
  return paths;
}

/** Every route a Nest controller file serves, as `prefix + method path`. */
export function controllerPaths(source) {
  const paths = new Set();
  let prefix = '';
  for (const line of source.split('\n')) {
    const controller = /@Controller\('([^']*)'\)/.exec(line);
    if (controller) {
      prefix = controller[1];
      continue;
    }
    const route = /@(?:Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/.exec(line);
    if (route) paths.add(normalisePath(`/${prefix}/${route[1] ?? ''}`));
  }
  return paths;
}

/**
 * Compares a declared path against the served set, treating `:` on either side
 * as a single-segment wildcard.
 *
 * A call site may build its final segment from a variable — one of a known set
 * of actions, say — which cannot be resolved statically. Literal segments still
 * have to match exactly, so a wrong prefix such as `/vendor/fulfilment/:/orders`
 * is still caught.
 */
export function matchesServed(declared, served) {
  if (served.has(declared)) return true;
  const wanted = declared.split('/');
  for (const candidate of served) {
    const parts = candidate.split('/');
    if (parts.length !== wanted.length) continue;
    const compatible = parts.every(
      (part, index) => part === ':' || wanted[index] === ':' || part === wanted[index],
    );
    if (compatible) return true;
  }
  return false;
}

function runSelfTest() {
  if (normalisePath('/vendor/locations/${id}/orders') !== '/vendor/locations/:/orders') {
    throw new Error('template parameters were not normalised');
  }
  if (normalisePath('/customer/discovery/stores?limit=5') !== '/customer/discovery/stores') {
    throw new Error('query strings were not removed');
  }
  if (normalisePath('/customer/discovery/favourites${qs}') !== '/customer/discovery/favourites') {
    throw new Error('an appended query string was treated as a path parameter');
  }
  const served = controllerPaths(
    "@Controller('vendor/locations/:vendor_location_id/orders')\n  @Get()\n  @Post(':vendor_order_id/accept')",
  );
  if (!served.has('/vendor/locations/:/orders')) throw new Error('bare route was not collected');
  if (!served.has('/vendor/locations/:/orders/:/accept')) {
    throw new Error('parameterised route was not collected');
  }
  const declared = clientPaths('r<Thing>(`/vendor/fulfilment/${id}/orders`)');
  if (!declared.has('/vendor/fulfilment/:/orders'))
    throw new Error('client path was not collected');
  if ([...declared].some((route) => matchesServed(route, served))) {
    throw new Error('a fabricated client path was treated as served');
  }
  const raw = rawCallPaths("adminRequest('admin/finance/v2/refunds', { method: 'POST' })");
  if (!raw.has('/admin/finance/v2/refunds')) throw new Error('raw call path was not collected');
  const interpolated = rawCallPaths('adminRequest(`admin/control/support/${id}/evidence`)');
  if (!interpolated.has('/admin/control/support/:/evidence')) {
    throw new Error('an interpolated raw call path was not normalised');
  }
  const wildcard = new Set(['/admin/configuration/:/approve']);
  if (!matchesServed('/admin/configuration/:/:', wildcard)) {
    throw new Error('a dynamic action segment was not matched');
  }
  if (matchesServed('/admin/finance/v2/refunds', wildcard)) {
    throw new Error('a wrong prefix was matched through the wildcard');
  }
  console.log('API contract control self-test passed.');
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else if (entry.isFile()) yield file;
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }
  const served = new Set();
  for (const entry of fs.readdirSync(controllerDirectory)) {
    if (!entry.endsWith('.controller.ts')) continue;
    for (const route of controllerPaths(
      fs.readFileSync(path.join(controllerDirectory, entry), 'utf8'),
    )) {
      served.add(route);
    }
  }
  const declared = clientPaths(fs.readFileSync(clientFile, 'utf8'));
  for (const directory of rawCallDirectories) {
    const absolute = path.join(repositoryRoot, directory);
    if (!fs.existsSync(absolute)) continue;
    for (const file of walk(absolute)) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
      for (const route of rawCallPaths(fs.readFileSync(file, 'utf8'))) declared.add(route);
    }
  }
  const missing = [...declared].filter((route) => !matchesServed(route, served)).sort();
  if (missing.length > 0) {
    console.error('Client code calls paths the API does not serve:');
    for (const route of missing) console.error(`  ${route}`);
    process.exitCode = 1;
    return;
  }
  console.log(`API contract check passed for ${served.size} served routes.`);
}

main();
