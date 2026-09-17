import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Keeps the acceptance suite able to fail.
 *
 * `cross-role-journey.spec.ts` wrapped every mandatory stage in
 * `if (await button.isVisible().catch(() => false))`, so a vendor with no orders
 * clicked nothing and a test named "accepts, picks and hands over an order"
 * passed having done none of those things. Its status assertions did the same
 * job from the other side: `Orders are current|No store orders yet` let the empty
 * state satisfy the golden path.
 *
 * Neither is visible in a green run, and the suite is opt-in, so nothing would
 * have surfaced it. This control is the part of that repair that holds without a
 * live stack: the shapes cannot come back unnoticed.
 *
 * It is deliberately narrow. It does not try to judge whether a journey is
 * complete -- only that it cannot silently do nothing.
 */

const specDirectory = fileURLToPath(new URL('../../e2e/', import.meta.url));

/** Swallowing a locator failure turns "the button is missing" into "skip this step". */
const SWALLOWED_VISIBILITY = /isVisible\(\)\s*\.catch\(/;

/** A conditional around a locator is how a mandatory action becomes optional. */
const CONDITIONAL_ACTION = /if\s*\(\s*await\s+[A-Za-z0-9_.]*\s*\.?\s*isVisible\(/;

/**
 * Empty-state copy inside an assertion.
 *
 * These strings are correct to assert *about* — a dedicated empty-state test
 * should — but not as one branch of an alternation standing in for the populated
 * path, which is how they were used. Matching them inside an alternation is the
 * signal: a bare `getByText(/No store orders yet/)` is a legitimate empty-state
 * assertion and is left alone.
 */
const EMPTY_STATE_ALTERNATION =
  /getByText\(\s*\/[^/\n]*\|[^/\n]*(?:no\s+(?:\w+\s+){0,3}(?:yet|loaded)|not\s+eligible|nothing\s+(?:\w+\s+){0,3}yet)[^/\n]*\//i;

/**
 * Comments quote these shapes when explaining why they were removed, and a
 * control that flags its own rationale trains people to delete the rationale.
 */
function isComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

export function findAcceptanceDefects(filename, text) {
  const defects = [];
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (isComment(line)) continue;
    const at = `${filename}:${index + 1}`;
    if (SWALLOWED_VISIBILITY.test(line)) {
      defects.push(
        `${at} swallows a locator failure with isVisible().catch(...), which turns a missing control into a skipped step`,
      );
    }
    if (CONDITIONAL_ACTION.test(line)) {
      defects.push(
        `${at} makes an action conditional on isVisible(), so an empty fixture passes the journey without walking it`,
      );
    }
    if (EMPTY_STATE_ALTERNATION.test(line)) {
      defects.push(
        `${at} accepts an empty state as one branch of an assertion, so "no data" satisfies the populated path`,
      );
    }
  }
  return defects;
}

function main() {
  if (process.argv.includes('--self-test')) {
    const cases = [
      ['const x = await b.isVisible().catch(() => false);', 'swallows a locator failure'],
      ['if (await accept.isVisible()) { await accept.click(); }', 'makes an action conditional'],
      [
        'await expect(page.getByText(/Orders are current|No store orders yet/i)).toBeVisible();',
        'accepts an empty state',
      ],
    ];
    for (const [source, expected] of cases) {
      const found = findAcceptanceDefects('sample.spec.ts', source);
      if (!found.some((defect) => defect.includes(expected))) {
        throw new Error(`acceptance control missed: ${source}`);
      }
    }
    // A dedicated empty-state assertion is legitimate and must not be flagged,
    // otherwise the control pushes people to delete real coverage.
    const allowed = [
      '// if (await accept.isVisible()) -- removed, see the comment above',
      '   * accepts /Orders are current|No store orders yet/ as a pass',
      'await expect(page.getByText(/No store orders yet/i)).toBeVisible();',
      'await expect(page.getByRole("button", { name: /Accept/ })).toBeVisible();',
    ];
    for (const source of allowed) {
      if (findAcceptanceDefects('sample.spec.ts', source).length > 0) {
        throw new Error(`acceptance control was too broad for: ${source}`);
      }
    }
    process.stdout.write('Acceptance spec control self-test passed.\n');
    return;
  }

  const specs = readdirSync(specDirectory).filter((name) => name.endsWith('.spec.ts'));
  if (specs.length === 0) {
    process.stderr.write('No acceptance specs were found to check.\n');
    process.exitCode = 1;
    return;
  }
  const defects = specs.flatMap((name) =>
    findAcceptanceDefects(`e2e/${name}`, readFileSync(`${specDirectory}${name}`, 'utf8')),
  );
  if (defects.length > 0) {
    for (const defect of defects) process.stderr.write(`${defect}\n`);
    process.stderr.write(
      'An acceptance test that cannot fail is worse than no acceptance test: it reports success ' +
        'for a journey nobody walked. Assert the mandatory stage, and let a missing fixture fail.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Acceptance spec controls passed for ${specs.length} suites.\n`);
}

main();
