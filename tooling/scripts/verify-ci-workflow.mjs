import fs from 'node:fs';
import path from 'node:path';

const requiredCommands = [
  'pnpm install --frozen-lockfile',
  'pnpm format:check',
  'pnpm lint',
  'pnpm typecheck',
  'pnpm test:controls',
  'pnpm test:unit',
  'pnpm test:integration',
  'pnpm build:verify',
  'pnpm db:verify',
  'pnpm security:dependencies',
  'pnpm security:secrets',
  'node tooling/scripts/ci-evidence.mjs write',
  'node tooling/scripts/ci-evidence.mjs gate',
];

const expectedActions = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['pnpm/setup', 'bf5bfae7d43e2b2b1191383f5005cd3fb69b848d'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
]);

export function validateWorkflow(text) {
  const errors = [];

  if (/\bpull_request_target\s*:/.test(text)) {
    errors.push('pull_request_target is prohibited for the untrusted repository quality workflow');
  }
  if (/\bsecrets\s*\./.test(text)) {
    errors.push('the quality workflow must not access repository or environment secrets');
  }
  if (
    /^permissions:\s+(?:write|write-all)\s*$/m.test(text) ||
    /^ {2}[a-z-]+:\s+(?:write|write-all)\s*$/m.test(text)
  ) {
    errors.push('the quality workflow must not request write permissions');
  }
  if (!/permissions:\s*\n\s+contents:\s+read/.test(text)) {
    errors.push('the workflow must declare contents: read permissions');
  }
  if (!/persist-credentials:\s+false/.test(text)) {
    errors.push('checkout credentials must not persist');
  }
  if (!/timeout-minutes:\s+30/.test(text)) {
    errors.push('the job must retain its bounded timeout');
  }
  if (!/cache:\s+true/.test(text) || !/cache-dependency-path:\s+pnpm-lock\.yaml/.test(text)) {
    errors.push('only the lockfile-keyed pnpm store cache is approved');
  }
  if (!/retention-days:\s+7/.test(text)) {
    errors.push('safe CI evidence must expire after seven days');
  }

  for (const command of requiredCommands) {
    if (!text.includes(command)) errors.push(`missing mandatory command: ${command}`);
  }

  const foundActions = new Set();
  for (const match of text.matchAll(/^\s*uses:\s+([^@\s]+)@([^\s#]+)(?:\s+#\s+(.+))?$/gm)) {
    const [, action, reference, versionComment] = match;
    foundActions.add(action);
    if (!/^[a-f0-9]{40}$/.test(reference)) {
      errors.push(`${action} must use an immutable 40-character commit SHA`);
    }
    if (!versionComment) errors.push(`${action} must retain a readable release comment`);
    const expected = expectedActions.get(action);
    if (!expected) errors.push(`unreviewed external action: ${action}`);
    else if (reference !== expected) errors.push(`${action} is not pinned to the reviewed commit`);
  }

  for (const action of expectedActions.keys()) {
    if (!foundActions.has(action)) errors.push(`missing reviewed action: ${action}`);
  }

  return errors;
}

function main() {
  const workflowPath = path.resolve('.github/workflows/ci.yml');
  const text = fs.readFileSync(workflowPath, 'utf8');
  const errors = validateWorkflow(text);

  if (process.argv.includes('--self-test')) {
    if (errors.length !== 0) throw new Error(`valid workflow failed: ${errors.join('; ')}`);
    const unsafe = text.replace(expectedActions.get('actions/checkout'), 'v7');
    const unsafeErrors = validateWorkflow(unsafe);
    if (!unsafeErrors.some((error) => error.includes('immutable 40-character'))) {
      throw new Error('mutable action reference was not rejected');
    }
    process.stdout.write('CI workflow control self-test passed.\n');
    return;
  }

  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('CI workflow controls passed.\n');
}

main();
