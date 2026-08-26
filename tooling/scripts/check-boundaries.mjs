import fs from 'node:fs';
import path from 'node:path';

const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const skippedDirectories = new Set([
  '.git',
  '.gstack',
  '.next',
  '.expo',
  '.pnpm-store',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'outputs',
]);
const packageImportAllowlist = {
  contracts: new Set(['domain-types']),
  'test-data': new Set(['contracts', 'domain-types']),
};

function ownerOf(relativeFile) {
  const [group, name] = relativeFile.split(path.sep);
  if ((group === 'apps' || group === 'packages') && name) return { group, name };
  if (group === 'database') return { group: 'database', name: 'database' };
  return null;
}

function isTestFile(relativeFile) {
  return /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/.test(
    relativeFile.replaceAll(path.sep, '/'),
  );
}

function localPackageName(specifier) {
  const match = /^@neighbourhood-store\/([^/]+)(?:\/.*)?$/.exec(specifier);
  return match?.[1] ?? null;
}

export function validatePackageEdge(source, target, testFile = false) {
  if (!source) return null;
  if (target.group === 'apps') return 'applications may not be imported by another workspace';
  if (
    target.group === 'database' &&
    (source.group !== 'apps' || (source.name !== 'api' && source.name !== 'worker'))
  ) {
    return 'the database runtime may be imported only by server applications';
  }
  if (target.name === 'test-data' && !testFile) {
    return 'test-data may be imported only from test files';
  }
  if (source.group === 'packages') {
    const allowed = packageImportAllowlist[source.name] ?? new Set();
    if (!allowed.has(target.name)) {
      return `package ${source.name} may not import package ${target.name}`;
    }
  }
  return null;
}

function walk(root, directory = root, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (skippedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(root, absolute, output);
    else if (sourceExtensions.has(path.extname(entry.name))) output.push(absolute);
  }
  return output;
}

function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

export function validateBoundaries(root) {
  const errors = [];
  for (const file of walk(root)) {
    const relativeFile = path.relative(root, file);
    const sourceOwner = ownerOf(relativeFile);
    if (!sourceOwner) continue;

    for (const specifier of importSpecifiers(fs.readFileSync(file, 'utf8'))) {
      const localName = localPackageName(specifier);
      if (localName) {
        const appExists = fs.existsSync(path.join(root, 'apps', localName));
        const packageExists = fs.existsSync(path.join(root, 'packages', localName));
        const databaseExists =
          localName === 'database' && fs.existsSync(path.join(root, 'database', 'package.json'));
        if (!appExists && !packageExists && !databaseExists) {
          errors.push(`${relativeFile}: ${specifier}: unknown internal workspace package`);
          continue;
        }
        const targetGroup = appExists ? 'apps' : databaseExists ? 'database' : 'packages';
        const reason = validatePackageEdge(
          sourceOwner,
          { group: targetGroup, name: localName },
          isTestFile(relativeFile),
        );
        if (reason) errors.push(`${relativeFile}: ${specifier}: ${reason}`);
        continue;
      }

      if (specifier.startsWith('.')) {
        const target = path.resolve(path.dirname(file), specifier);
        const targetOwner = ownerOf(path.relative(root, target));
        if (!targetOwner) continue;
        if (targetOwner.group !== sourceOwner.group || targetOwner.name !== sourceOwner.name) {
          errors.push(
            `${relativeFile}: ${specifier}: cross-workspace relative imports are prohibited`,
          );
        }
      }
    }
  }
  return errors;
}

function runSelfTest() {
  const app = { group: 'apps', name: 'customer-pwa' };
  const otherApp = { group: 'apps', name: 'vendor-pwa' };
  const contracts = { group: 'packages', name: 'contracts' };
  const domain = { group: 'packages', name: 'domain-types' };
  const testData = { group: 'packages', name: 'test-data' };
  const database = { group: 'database', name: 'database' };
  const api = { group: 'apps', name: 'api' };

  if (!validatePackageEdge(app, otherApp)) throw new Error('app-to-app import was accepted');
  if (validatePackageEdge(app, contracts)) throw new Error('app-to-package import was rejected');
  if (validatePackageEdge(contracts, domain)) throw new Error('approved package edge was rejected');
  if (!validatePackageEdge(domain, contracts))
    throw new Error('unapproved package edge was accepted');
  if (!validatePackageEdge(app, testData, false))
    throw new Error('runtime test-data import passed');
  if (validatePackageEdge(app, testData, true))
    throw new Error('test-only test-data import failed');
  if (validatePackageEdge(api, database)) throw new Error('server-to-database import was rejected');
  if (!validatePackageEdge(app, database))
    throw new Error('client-to-database import was accepted');

  const root = process.cwd();
  const gitIgnore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const prettierIgnore = fs.readFileSync(path.join(root, '.prettierignore'), 'utf8');
  const eslintConfig = fs.readFileSync(path.join(root, 'eslint.config.mjs'), 'utf8');
  if (!gitIgnore.split(/\r?\n/).includes('outputs/')) {
    throw new Error('generated outputs are not excluded from Git');
  }
  if (!prettierIgnore.split(/\r?\n/).includes('outputs/')) {
    throw new Error('generated outputs are not excluded from formatting');
  }
  if (!eslintConfig.includes("'**/outputs/**'")) {
    throw new Error('generated outputs are not excluded from linting');
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    console.warn('Boundary self-test passed.');
    return;
  }
  const errors = validateBoundaries(process.cwd());
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.warn('Import boundaries passed.');
}

main();
