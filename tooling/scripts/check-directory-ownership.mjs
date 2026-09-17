import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Phase 2.1 requires every top-level directory to document what it owns and what it
 * may import. Nothing checked that, and it had drifted: `packages/README.md` listed
 * five of seven shared packages, `e2e/` and `tooling/` had no README at all, and
 * `tests/README.md` claimed ownership of the Playwright journeys that actually live
 * in `e2e/`. An ownership map nobody verifies stops describing the repository.
 *
 * Usage: node tooling/scripts/check-directory-ownership.mjs [--self-test]
 */

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

/** Top-level directories that must state their ownership in a README. */
export const DOCUMENTED_DIRECTORIES = [
  'apps',
  'database',
  'e2e',
  'infrastructure',
  'packages',
  'runbooks',
  'tests',
  'tooling',
];

/** Claims that must not survive in an ownership document once they stop being true. */
export const STALE_CLAIMS = [
  {
    directory: 'infrastructure',
    pattern: /D-12 prohibits/i,
    reason: 'D-15 supersedes the D-12 local-only restriction',
  },
  {
    directory: 'infrastructure',
    pattern: /Valkey[^.]*remain later/i,
    reason: 'compose.yaml provisions valkey and valkey-test today',
  },
];

export function validateOwnership(directories, readmeFor, sharedPackages) {
  const errors = [];

  for (const directory of directories) {
    const readme = readmeFor(directory);
    if (readme === null || readme === undefined) {
      errors.push(`${directory}/: no README.md stating what the directory owns`);
      continue;
    }
    if (!/\bimports?\b/i.test(readme)) {
      errors.push(`${directory}/: README.md does not state what it may import`);
    }
    for (const stale of STALE_CLAIMS) {
      if (stale.directory === directory && stale.pattern.test(readme)) {
        errors.push(`${directory}/: README.md repeats a stale claim (${stale.reason})`);
      }
    }
  }

  // Every shared package needs a row in the ownership table, or a package can exist
  // that nobody has written down the boundaries for.
  const packagesReadme = readmeFor('packages') ?? '';
  for (const shared of sharedPackages) {
    if (!packagesReadme.includes(`\`${shared}/\``)) {
      errors.push(`packages/${shared}: absent from the ownership table in packages/README.md`);
    }
  }
  return errors;
}

function readmeFrom(directory) {
  const file = path.join(repositoryRoot, directory, 'README.md');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function sharedPackageNames() {
  return fs
    .readdirSync(path.join(repositoryRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function runSelfTest() {
  const readmes = {
    apps: 'Owns applications. An application may import an approved shared package.',
    packages: 'Table: `domain-types/` and `ui/`. Import direction is one way.',
  };
  const readmeFor = (directory) => readmes[directory] ?? null;

  if (validateOwnership(['apps'], readmeFor, []).length !== 0) {
    throw new Error('a documented directory was rejected');
  }
  if (
    !validateOwnership(['runbooks'], readmeFor, []).some((error) => error.includes('no README.md'))
  ) {
    throw new Error('a directory with no README was accepted');
  }

  const silentOnImports = { ...readmes, tests: 'This directory owns cross-application journeys.' };
  if (
    !validateOwnership(['tests'], (d) => silentOnImports[d] ?? null, []).some((error) =>
      error.includes('does not state what it may import'),
    )
  ) {
    throw new Error('a README silent on imports was accepted');
  }

  if (validateOwnership([], readmeFor, ['domain-types', 'ui']).length !== 0) {
    throw new Error('a fully tabulated package set was rejected');
  }
  if (
    !validateOwnership([], readmeFor, ['pwa-auth']).some((error) =>
      error.includes('absent from the ownership table'),
    )
  ) {
    throw new Error('an undocumented shared package was accepted');
  }

  const stale = { infrastructure: 'Owns infrastructure imports. D-12 prohibits executing it.' };
  if (
    !validateOwnership(['infrastructure'], (d) => stale[d] ?? null, []).some((error) =>
      error.includes('stale claim'),
    )
  ) {
    throw new Error('a stale decision reference was accepted');
  }

  console.warn('Directory ownership control self-test passed.');
}

if (process.argv.includes('--self-test')) {
  runSelfTest();
} else {
  const errors = validateOwnership(DOCUMENTED_DIRECTORIES, readmeFrom, sharedPackageNames());
  if (errors.length > 0) {
    console.error('Top-level directory ownership is not documented:');
    for (const error of errors) console.error(`  ${error}`);
    process.exitCode = 1;
  } else {
    console.warn(
      `Directory ownership documented for ${DOCUMENTED_DIRECTORIES.length} directories and ${sharedPackageNames().length} shared packages.`,
    );
  }
}
