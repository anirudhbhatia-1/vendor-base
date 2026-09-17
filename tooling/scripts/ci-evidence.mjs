import fs from 'node:fs';
import path from 'node:path';

const checks = [
  ['format', 'Formatting', 'CI_FORMAT_OUTCOME'],
  ['lint', 'Lint and repository policies', 'CI_LINT_OUTCOME'],
  ['typecheck', 'Type checking', 'CI_TYPECHECK_OUTCOME'],
  ['control_tests', 'Repository control tests', 'CI_CONTROL_TESTS_OUTCOME'],
  ['unit_tests', 'Unit tests', 'CI_UNIT_TESTS_OUTCOME'],
  ['integration_tests', 'Integration tests', 'CI_INTEGRATION_TESTS_OUTCOME'],
  ['e2e_tests', 'Browser end-to-end tests', 'CI_E2E_TESTS_OUTCOME'],
  ['build', 'Build and entry-point verification', 'CI_BUILD_OUTCOME'],
  ['online_test_build', 'Online-test PWA export build', 'CI_ONLINE_TEST_BUILD_OUTCOME'],
  ['database', 'Database migration lifecycle', 'CI_DATABASE_OUTCOME'],
  ['dependency_audit', 'Dependency audit', 'CI_DEPENDENCY_AUDIT_OUTCOME'],
  ['secret_scan', 'Secret scan', 'CI_SECRET_SCAN_OUTCOME'],
  ['database_cleanup', 'Disposable database cleanup', 'CI_DATABASE_CLEANUP_OUTCOME'],
];

const allowedOutcomes = new Set(['success', 'failure', 'cancelled', 'skipped']);

export function collectOutcomes(environment) {
  return checks.map(([id, name, key]) => {
    const raw = environment[key];
    return {
      id,
      name,
      outcome: allowedOutcomes.has(raw) ? raw : 'unreported',
    };
  });
}

export function failedOutcomes(outcomes) {
  return outcomes.filter(({ outcome }) => outcome !== 'success');
}

function markdown(report) {
  const rows = report.checks.map(({ name, outcome }) => `| ${name} | \`${outcome}\` |`);
  return [
    '# CI evidence',
    '',
    `Result: **${report.result}**`,
    '',
    '| Mandatory check | Outcome |',
    '|---|---|',
    ...rows,
    '',
    'This report contains workflow outcomes only. It intentionally excludes logs, credentials,',
    'environment values, test payloads, personal data, and generated application artifacts.',
    '',
  ].join('\n');
}

function writeEvidence(environment) {
  const outcomes = collectOutcomes(environment);
  const failures = failedOutcomes(outcomes);
  const report = {
    schema_version: 1,
    kind: 'ci_quality_evidence',
    result: failures.length === 0 ? 'success' : 'failure',
    repository: environment.GITHUB_REPOSITORY ?? 'local',
    commit: environment.GITHUB_SHA ?? 'local',
    run_id: environment.GITHUB_RUN_ID ?? 'local',
    run_attempt: environment.GITHUB_RUN_ATTEMPT ?? 'local',
    generated_at: new Date().toISOString(),
    checks: outcomes,
  };

  const outputDirectory = path.resolve('.ci-artifacts');
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(outputDirectory, 'summary.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const summary = markdown(report);
  fs.writeFileSync(path.join(outputDirectory, 'summary.md'), summary);

  if (environment.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, summary);
  }
}

function enforceGate(environment) {
  const failures = failedOutcomes(collectOutcomes(environment));
  if (failures.length === 0) {
    process.stdout.write('All mandatory CI results passed.\n');
    return;
  }

  for (const { name, outcome } of failures) {
    process.stderr.write(`${name}: ${outcome}\n`);
  }
  process.exitCode = 1;
}

function selfTest() {
  const successEnvironment = Object.fromEntries(checks.map(([, , key]) => [key, 'success']));
  const success = collectOutcomes(successEnvironment);
  if (failedOutcomes(success).length !== 0) throw new Error('successful outcomes were rejected');

  const failedEnvironment = { ...successEnvironment, CI_DATABASE_OUTCOME: 'failure' };
  const failures = failedOutcomes(collectOutcomes(failedEnvironment));
  if (failures.length !== 1 || failures[0].id !== 'database') {
    throw new Error('database failure was not detected');
  }

  delete failedEnvironment.CI_DATABASE_OUTCOME;
  if (failedOutcomes(collectOutcomes(failedEnvironment))[0]?.outcome !== 'unreported') {
    throw new Error('missing outcome did not fail closed');
  }
  process.stdout.write('CI evidence self-test passed.\n');
}

const command = process.argv[2];
if (command === 'write') writeEvidence(process.env);
else if (command === 'gate') enforceGate(process.env);
else if (command === '--self-test') selfTest();
else {
  process.stderr.write('Usage: node tooling/scripts/ci-evidence.mjs write|gate|--self-test\n');
  process.exitCode = 1;
}
