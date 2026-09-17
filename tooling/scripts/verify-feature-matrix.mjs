import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Validates `docs/feature-matrix.json` against `FEATURES.md`.
 *
 * The matrix is the record of what is actually built per catalogued capability,
 * and nothing checked it: its own summary block disagreed with its own feature
 * array on eight of nine counts, and records stayed at `missing` for months
 * after the feature shipped. An inventory nobody verifies is worse than none,
 * because plans get made from it.
 *
 * Usage: node tooling/scripts/verify-feature-matrix.mjs [--self-test]
 */

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

export const STATUSES = new Set([
  'complete_local_synthetic',
  'partial_workflow',
  'backend_only',
  'ui_only',
  'not_started',
  'blocked_production_provider',
  'later',
  'gated',
  'excluded',
]);

/** Catalogue statuses that pin the matrix status exactly. */
const PINNED = { Excluded: 'excluded', Gated: 'gated', Later: 'later' };

/** Parses the capability tables in FEATURES.md into id -> catalogue status. */
export function parseCatalogue(markdown) {
  const catalogue = new Map();
  for (const line of markdown.split('\n')) {
    if (!/^\|\s*[A-Z]{2,4}-\d{2}\s*\|/.test(line)) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    const id = cells[0];
    // The excluded-behaviour table has no status column; every row in it is
    // excluded by definition.
    const status =
      cells.find((cell) => ['Launch', 'Later', 'Gated', 'Excluded'].includes(cell)) ?? 'Excluded';
    catalogue.set(id, status);
  }
  return catalogue;
}

export function summaryOf(features) {
  const count = (list, key) => {
    const totals = {};
    for (const record of list) totals[record[key]] = (totals[record[key]] ?? 0) + 1;
    return Object.fromEntries(
      Object.entries(totals).sort(([left], [right]) => left.localeCompare(right)),
    );
  };
  const launch = features.filter((record) => record.catalogue_status === 'Launch');
  return {
    total_features: features.length,
    launch_features: launch.length,
    by_status: count(features, 'status'),
    by_catalogue_status: count(features, 'catalogue_status'),
    launch_by_status: count(launch, 'status'),
  };
}

/** Parses the canonical numbered steps out of phases.md (`#### 7.5 Title`). */
export function parseSteps(markdown) {
  return new Set([...markdown.matchAll(/^#### (\d+\.\d+) /gm)].map((match) => match[1]));
}

/**
 * Steps that govern process rather than a catalogued capability, so no feature maps to
 * them: decision ownership, the concierge pilot, repository scaffolding, the shared
 * primitive kernel, resilience drills and controlled launch. Listing them explicitly is
 * what lets the control demand a feature for every other step.
 */
export const PROCESS_ONLY_STEPS = new Set([
  '0.1',
  '0.2',
  '0.5',
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '2.1',
  '3.1',
  '12.5',
  '13.1',
  '13.2',
  '13.3',
  '13.4',
  '13.5',
]);

/**
 * A verifier is something a person can execute: a test file, a connected `verify-*`
 * module, or a control script. A design document proves nothing and must not qualify.
 */
const VERIFIER_PATH = /(?:\.spec\.[cm]?[jt]sx?|\/verify-[a-z-]+\.ts|\/[a-z-]+\.mjs)$/;

/** Client layers whose evidence claim must be backed by a verifier in that layer. */
const CLIENT_LAYERS = {
  android: /^apps\/[a-z-]+-app\//,
  // The PWAs share their rendering, formatting, accessibility, locale and session
  // helpers, so a spec in those packages is client-layer evidence too.
  pwa: /^(?:apps\/[a-z-]+-pwa\/|e2e\/|packages\/(?:ui|i18n|pwa-auth)\/)/,
};

/**
 * Evidence values. `unverified` says the layer is believed to be implemented but
 * nothing in this repository demonstrates it — the one value that does not require
 * a verifier, and the one that cannot support a completion status.
 */
export const EVIDENCE_VALUES = new Set([true, false, 'partial', 'ui_only', 'unverified']);

function evidenceOf(record) {
  return record.evidence ?? {};
}

/** True when the layer is claimed at all, whatever the strength of the claim. */
function claimsLayer(value) {
  return value !== false && value !== undefined && value !== 'unverified';
}

/** Every rule, applied to an already-parsed catalogue and matrix. */
export function validate(catalogue, matrix, fileExists, steps = null) {
  const errors = [];
  const seen = new Set();
  const claimedSteps = new Set();

  for (const record of matrix.features) {
    if (seen.has(record.id)) errors.push(`${record.id}: duplicate matrix record`);
    seen.add(record.id);

    const catalogued = catalogue.get(record.id);
    if (!catalogued) {
      errors.push(`${record.id}: recorded in the matrix but absent from FEATURES.md`);
      continue;
    }
    if (record.catalogue_status !== catalogued) {
      errors.push(
        `${record.id}: catalogue_status is ${record.catalogue_status}, FEATURES.md says ${catalogued}`,
      );
    }
    if (!STATUSES.has(record.status)) errors.push(`${record.id}: unknown status ${record.status}`);

    const pinned = PINNED[catalogued];
    if (pinned && record.status !== pinned) {
      errors.push(`${record.id}: FEATURES.md marks it ${catalogued}, so status must be ${pinned}`);
    }
    if (catalogued === 'Launch' && !record.owner) {
      errors.push(`${record.id}: a Launch feature needs an owner`);
    }
    // A gated capability may sit in the register indefinitely; what it may not
    // do is become available without a named approval recorded beside it.
    if (
      catalogued === 'Gated' &&
      record.approval?.state === 'AVAILABLE' &&
      !record.approval.recorded_by
    ) {
      errors.push(`${record.id}: enabled without a recorded approval`);
    }
    for (const [layer, value] of Object.entries(evidenceOf(record))) {
      if (!EVIDENCE_VALUES.has(value)) {
        errors.push(`${record.id}: evidence.${layer} is ${JSON.stringify(value)}`);
      }
    }
    if (record.status === 'complete_local_synthetic') {
      const evidence = record.evidence ?? {};
      if (!evidence.tests) errors.push(`${record.id}: completion requires a test`);
      // An `unverified` client does not support completion: nothing demonstrates it.
      const hasClient = claimsLayer(evidence.pwa) || claimsLayer(evidence.android);
      const clientless = record.client_applicability === 'no_client';
      if (!hasClient && !clientless) {
        errors.push(
          `${record.id}: completion requires a client, or client_applicability: "no_client"`,
        );
      }
    }
    // A capability nobody can locate in the plan cannot be audited for completion,
    // which is how whole steps went unreviewed while the matrix read as finished.
    if (!Array.isArray(record.phase_steps)) {
      errors.push(`${record.id}: phase_steps must be an array of canonical step ids`);
    } else {
      for (const step of record.phase_steps) {
        if (steps && !steps.has(step)) {
          errors.push(`${record.id}: phase_steps names ${step}, which is not a step in phases.md`);
        }
        claimedSteps.add(step);
      }
      const deferred = ['later', 'gated', 'excluded'].includes(record.status);
      if (record.phase_steps.length === 0 && !deferred) {
        errors.push(`${record.id}: a non-deferred capability must name the step that delivers it`);
      }
    }

    // `evidence` is a set of booleans the matrix asserts about itself. Naming the
    // verifier turns each claim into something a reader can run, and makes an
    // unbacked claim visible instead of indistinguishable from a real one.
    const verifiers = record.verified_by;
    if (!Array.isArray(verifiers)) {
      errors.push(`${record.id}: verified_by must be an array of verifier paths`);
    } else {
      for (const verifier of verifiers) {
        if (!fileExists(verifier)) {
          errors.push(`${record.id}: verified_by names a missing verifier ${verifier}`);
        }
        if (!VERIFIER_PATH.test(verifier)) {
          errors.push(`${record.id}: ${verifier} is not an executable verifier`);
        }
      }
      if (evidenceOf(record).tests === true && verifiers.length === 0) {
        errors.push(`${record.id}: claims a test but names no verifier`);
      }
      for (const [layer, pattern] of Object.entries(CLIENT_LAYERS)) {
        if (!claimsLayer(evidenceOf(record)[layer])) continue;
        if (!verifiers.some((verifier) => pattern.test(verifier))) {
          errors.push(`${record.id}: claims ${layer} evidence with no ${layer} verifier`);
        }
      }
    }

    for (const cited of record.files ?? []) {
      if (!fileExists(cited)) errors.push(`${record.id}: cites a missing file ${cited}`);
    }
  }

  for (const id of catalogue.keys()) {
    if (!seen.has(id)) errors.push(`${id}: catalogued in FEATURES.md with no matrix record`);
  }

  if (steps) {
    for (const step of steps) {
      if (!claimedSteps.has(step) && !PROCESS_ONLY_STEPS.has(step)) {
        errors.push(`step ${step}: no catalogued capability is mapped to it`);
      }
    }
  }

  const expected = JSON.stringify(summaryOf(matrix.features));
  if (JSON.stringify(matrix.summary) !== expected) {
    errors.push('summary is not derived from features');
  }
  return errors;
}

function runSelfTest() {
  const catalogue = parseCatalogue(
    [
      '| CUS-01 | Phone OTP sign-in | Launch | Behaviour. |',
      '| EXC-01 | Dark stores | Reason. |',
    ].join('\n'),
  );
  if (catalogue.get('CUS-01') !== 'Launch') throw new Error('Launch row was not parsed');
  if (catalogue.get('EXC-01') !== 'Excluded') throw new Error('excluded row was not parsed');

  const complete = {
    id: 'CUS-01',
    owner: 'customer-surface',
    catalogue_status: 'Launch',
    status: 'complete_local_synthetic',
    evidence: { tests: true, pwa: true },
    phase_steps: ['4.1'],
    verified_by: ['apps/customer-pwa/app/customer-panels.spec.ts'],
  };
  const excluded = {
    id: 'EXC-01',
    owner: 'excluded-scope',
    catalogue_status: 'Excluded',
    status: 'excluded',
    evidence: {},
    phase_steps: [],
    verified_by: [],
  };
  const good = { features: [complete, excluded] };
  good.summary = summaryOf(good.features);
  if (validate(catalogue, good, () => true).length !== 0) {
    throw new Error('a valid matrix was rejected');
  }

  const stale = structuredClone(good);
  stale.summary.total_features = 99;
  if (!validate(catalogue, stale, () => true).some((e) => e.includes('summary'))) {
    throw new Error('a stale summary was accepted');
  }

  const missingRecord = { features: [complete] };
  missingRecord.summary = summaryOf(missingRecord.features);
  if (!validate(catalogue, missingRecord, () => true).some((e) => e.startsWith('EXC-01'))) {
    throw new Error('a catalogued feature with no record was accepted');
  }

  const untested = structuredClone(good);
  untested.features[0].evidence.tests = false;
  if (!validate(catalogue, untested, () => true).some((e) => e.includes('requires a test'))) {
    throw new Error('completion without a test was accepted');
  }

  const clientless = structuredClone(good);
  clientless.features[0].evidence.pwa = false;
  if (!validate(catalogue, clientless, () => true).some((e) => e.includes('requires a client'))) {
    throw new Error('completion without a client was accepted');
  }

  const wrongPin = structuredClone(good);
  wrongPin.features[1].status = 'complete_local_synthetic';
  wrongPin.summary = summaryOf(wrongPin.features);
  if (!validate(catalogue, wrongPin, () => true).some((e) => e.includes('must be excluded'))) {
    throw new Error('an excluded feature recorded as built was accepted');
  }

  const openGate = {
    id: 'GAT-01',
    owner: 'gated-scope',
    catalogue_status: 'Gated',
    status: 'gated',
    evidence: {},
    phase_steps: [],
    verified_by: [],
    approval: { state: 'AVAILABLE', recorded_by: null },
  };
  const gateCatalogue = new Map([['GAT-01', 'Gated']]);
  const gated = { features: [openGate] };
  gated.summary = summaryOf(gated.features);
  if (!validate(gateCatalogue, gated, () => true).some((e) => e.includes('recorded approval'))) {
    throw new Error('an enabled gated capability without an approval was accepted');
  }
  const closedGate = structuredClone(gated);
  closedGate.features[0].approval.state = 'UNAVAILABLE';
  if (validate(gateCatalogue, closedGate, () => true).length !== 0) {
    throw new Error('an unavailable gated capability was rejected');
  }

  const ghostFile = structuredClone(good);
  ghostFile.features[0].files = ['apps/does-not-exist.tsx'];
  if (!validate(catalogue, ghostFile, () => false).some((e) => e.includes('missing file'))) {
    throw new Error('a citation of a missing file was accepted');
  }

  if (parseSteps('#### 4.1 Build OTP\n### 4.2 Not a step\n#### 10.7 Prove\n').size !== 2) {
    throw new Error('canonical steps were not parsed from phases.md headings');
  }

  const declaredSteps = new Set(['4.1']);
  if (validate(catalogue, good, () => true, declaredSteps).length !== 0) {
    throw new Error('a fully mapped matrix was rejected');
  }

  const ghostStep = structuredClone(good);
  ghostStep.features[0].phase_steps = ['99.9'];
  if (
    !validate(catalogue, ghostStep, () => true, declaredSteps).some((e) =>
      e.includes('not a step in phases.md'),
    )
  ) {
    throw new Error('a phase_steps value outside phases.md was accepted');
  }

  const unmapped = structuredClone(good);
  unmapped.features[0].phase_steps = [];
  if (
    !validate(catalogue, unmapped, () => true, declaredSteps).some((e) =>
      e.includes('must name the step that delivers it'),
    )
  ) {
    throw new Error('a Launch capability with no step was accepted');
  }

  // A step nobody delivers must surface, unless it is declared process-only.
  const orphanSteps = new Set(['4.1', '6.2']);
  if (
    !validate(catalogue, good, () => true, orphanSteps).some((e) =>
      e.includes('step 6.2: no catalogued capability'),
    )
  ) {
    throw new Error('a step with no capability mapped to it was accepted');
  }
  const processOnly = new Set(['4.1', '13.1']);
  if (validate(catalogue, good, () => true, processOnly).length !== 0) {
    throw new Error('a declared process-only step was reported as uncovered');
  }

  const unbackedTest = structuredClone(good);
  unbackedTest.features[0].verified_by = [];
  if (!validate(catalogue, unbackedTest, () => true).some((e) => e.includes('names no verifier'))) {
    throw new Error('a test claim with no verifier was accepted');
  }

  const documentAsProof = structuredClone(good);
  documentAsProof.features[0].verified_by = ['docs/engineering/sessions-and-devices.md'];
  if (
    !validate(catalogue, documentAsProof, () => true).some((e) =>
      e.includes('is not an executable verifier'),
    )
  ) {
    throw new Error('a design document was accepted as proof');
  }

  const serverOnlyVerifier = structuredClone(good);
  serverOnlyVerifier.features[0].verified_by = ['database/scripts/verify-otp-identity.ts'];
  if (
    !validate(catalogue, serverOnlyVerifier, () => true).some((e) =>
      e.includes('claims pwa evidence with no pwa verifier'),
    )
  ) {
    throw new Error('a client claim backed only by a server verifier was accepted');
  }

  // `unverified` is the one value that may stand without a verifier, and the one
  // that must not support a completion status.
  const unverifiedClient = structuredClone(good);
  unverifiedClient.features[0].evidence.pwa = 'unverified';
  unverifiedClient.features[0].verified_by = ['database/scripts/verify-otp-identity.ts'];
  const unverifiedErrors = validate(catalogue, unverifiedClient, () => true);
  if (unverifiedErrors.some((e) => e.includes('no pwa verifier'))) {
    throw new Error('an explicitly unverified layer was asked for a verifier');
  }
  if (!unverifiedErrors.some((e) => e.includes('requires a client'))) {
    throw new Error('completion resting on an unverified client was accepted');
  }

  const badEvidence = structuredClone(good);
  badEvidence.features[0].evidence.pwa = 'probably';
  if (!validate(catalogue, badEvidence, () => true).some((e) => e.includes('evidence.pwa'))) {
    throw new Error('an undocumented evidence value was accepted');
  }

  console.log('Feature matrix control self-test passed.');
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }
  const catalogue = parseCatalogue(
    fs.readFileSync(path.join(repositoryRoot, 'FEATURES.md'), 'utf8'),
  );
  const matrix = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'docs/feature-matrix.json'), 'utf8'),
  );
  const steps = parseSteps(fs.readFileSync(path.join(repositoryRoot, 'phases.md'), 'utf8'));
  const errors = validate(
    catalogue,
    matrix,
    (cited) => fs.existsSync(path.join(repositoryRoot, cited)),
    steps,
  );
  if (errors.length > 0) {
    console.error('Feature matrix does not reconcile with FEATURES.md:');
    for (const error of errors) console.error(`  ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Feature matrix check passed for ${matrix.features.length} catalogued capabilities across ${steps.size} canonical steps.`,
  );
}

main();
