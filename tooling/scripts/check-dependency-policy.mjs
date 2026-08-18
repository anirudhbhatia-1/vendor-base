import fs from 'node:fs';
import path from 'node:path';

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function workspaceManifestFiles(root) {
  const files = [path.join(root, 'package.json')];
  for (const group of ['apps', 'packages']) {
    const groupRoot = path.join(root, group);
    for (const entry of fs.readdirSync(groupRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) files.push(path.join(groupRoot, entry.name, 'package.json'));
    }
  }
  return files.sort();
}

function isExactExternalVersion(version) {
  return /^(?:\d+!)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

export function validateDependencyPolicy(manifests) {
  const errors = [];
  const localNames = new Set(manifests.map(({ manifest }) => manifest.name));

  for (const { file, manifest } of manifests) {
    if (!manifest.private) errors.push(`${file}: workspace packages must be private`);

    for (const field of dependencyFields) {
      for (const [name, version] of Object.entries(manifest[field] ?? {})) {
        if (localNames.has(name)) {
          if (!version.startsWith('workspace:')) {
            errors.push(`${file}: local dependency ${name} must use the workspace: protocol`);
          }
        } else if (name.startsWith('@neighbourhood-store/')) {
          errors.push(`${file}: unknown internal dependency ${name}`);
        } else if (!isExactExternalVersion(version)) {
          errors.push(
            `${file}: external dependency ${name} must use an exact version, got ${version}`,
          );
        }
      }
    }
  }

  return errors;
}

function runSelfTest() {
  const valid = [
    { file: 'package.json', manifest: { name: 'root', private: true } },
    {
      file: 'apps/a/package.json',
      manifest: {
        name: '@example/a',
        private: true,
        dependencies: { '@example/shared': 'workspace:*', external: '1.2.3' },
      },
    },
    { file: 'packages/shared/package.json', manifest: { name: '@example/shared', private: true } },
  ];
  if (validateDependencyPolicy(valid).length !== 0) throw new Error('valid policy fixture failed');

  const invalid = JSON.parse(JSON.stringify(valid));
  invalid[1].manifest.dependencies.external = '^1.2.3';
  invalid[1].manifest.dependencies['@example/shared'] = '1.0.0';
  if (validateDependencyPolicy(invalid).length !== 2) {
    throw new Error('invalid dependency versions were not rejected');
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    console.warn('Dependency-policy self-test passed.');
    return;
  }

  const root = process.cwd();
  const manifests = workspaceManifestFiles(root).map((file) => ({
    file: path.relative(root, file),
    manifest: readJson(file),
  }));
  const errors = validateDependencyPolicy(manifests);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.warn(`Dependency policy passed for ${manifests.length} workspace manifests.`);
}

main();
