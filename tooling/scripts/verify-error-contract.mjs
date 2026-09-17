import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Keeps refusals able to explain themselves.
 *
 * `request-exception.filter.ts` builds every error response from a stable code and
 * discards the exception body. A controller that throws `ConflictException()` or
 * `ConflictException(error.message)` therefore says nothing: the response falls
 * back to the status-derived code, which for 409 is `VERSION_CONFLICT`, which
 * clients render as "Something changed while you were working. Refresh and try
 * again."
 *
 * Three separate field reports came from that one sentence. A delivery partner
 * pressed pickup four times and leave five times; a vendor retyped a service-zone
 * name that was already taken; a vendor pressed Mark ready five times with an
 * unfinished pick list. In none of those cases had anything changed, and in none
 * of them could refreshing help -- while the domain layer knew the real reason
 * every time.
 *
 * The fix was to declare a code at each site. This control is what keeps them
 * declared: it is cheap to add a twenty-ninth bare `ConflictException` by
 * accident, and impossible to notice from a green test run.
 */

const controllerDirectory = fileURLToPath(new URL('../../apps/api/src/', import.meta.url));
const registryFile = fileURLToPath(
  new URL('../../packages/domain-types/src/errors.ts', import.meta.url),
);

/** A throw that hands the filter nothing to work with. */
const UNDECLARED = /throw new ConflictException\((?!\{)/;

/** `error_code` is the key the filter reads; `code` was tried and ignored. */
const WRONG_KEY = /throw new ConflictException\(\{\s*code:/;

/**
 * A literal code at a throw site. The filter checks the code against
 * `ERROR_DEFINITIONS` and discards one it does not know, so a declaration that
 * looks right can still be dead: four were, for the delivery and collection
 * codes, and reached partners as "something in that request was not valid" and
 * vendors as "refresh and try again". A code read from `error.code` cannot be
 * checked here and is left to the domain type.
 */
const LITERAL_CODE = /error_code:\s*'([A-Z][A-Z0-9_]*)'/g;

/**
 * A code named in the shared translation table (`domain-errors.ts`), where the
 * key is `code:` rather than `error_code:`.
 */
const TABLE_CODE = /\bcode:\s*'([A-Z][A-Z0-9_]*)'/g;

/**
 * A controller declaring its own translator again. Twenty-four of these were
 * folded into one table; a new one is the drift starting over.
 */
const LOCAL_TRANSLATOR = /^function (?:translate|map|mapLifecycle|mapFieldOps|mapDiscovery)\(/;

/** The keys of `ERROR_DEFINITIONS`, read from the source rather than imported. */
export function registeredCodes(registrySource) {
  const body = registrySource.slice(
    registrySource.indexOf('export const ERROR_DEFINITIONS = {'),
    registrySource.indexOf('} as const;'),
  );
  return new Set([...body.matchAll(/^ {2}([A-Z][A-Z0-9_]*): \{/gm)].map((match) => match[1]));
}

export function findUndeclaredConflicts(filename, text, registered) {
  const defects = [];
  const isTable = filename.endsWith('domain-errors.ts');
  for (const [index, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    const at = `${filename}:${index + 1}`;
    if (!isTable && LOCAL_TRANSLATOR.test(line)) {
      defects.push(
        `${at} declares its own domain-error translator; add the class to ` +
          `DOMAIN_ERROR_TRANSLATIONS in domain-errors.ts instead`,
      );
    }
    if (isTable) {
      for (const match of line.matchAll(TABLE_CODE)) {
        if (!registered.has(match[1])) {
          defects.push(
            `${at} translates to ${match[1]}, which is not in ERROR_DEFINITIONS, so the filter ` +
              `discards it and the response falls back to the status-derived code`,
          );
        }
      }
    }
    if (WRONG_KEY.test(line)) {
      defects.push(
        `${at} uses \`code:\`, which the exception filter does not read; the key is \`error_code\``,
      );
    } else if (UNDECLARED.test(line)) {
      defects.push(
        `${at} throws a conflict without a stable code, so it reaches the client as ` +
          `VERSION_CONFLICT and tells the user to refresh and try again`,
      );
    }
    for (const match of line.matchAll(LITERAL_CODE)) {
      if (!registered.has(match[1])) {
        defects.push(
          `${at} declares ${match[1]}, which is not in ERROR_DEFINITIONS, so the filter ` +
            `discards it and the response falls back to the status-derived code`,
        );
      }
    }
  }
  return defects;
}

function main() {
  if (process.argv.includes('--self-test')) {
    const registered = registeredCodes(
      [
        'export const ERROR_DEFINITIONS = {',
        "  ORDER_STATE_CONFLICT: { http_status: 409, message_key: 'x', retryable: false },",
        '  /** documented */',
        '  DELIVERY_OTP_EXPIRED: {',
        '    http_status: 409,',
        '  },',
        '} as const;',
      ].join('\n'),
    );
    if (registered.size !== 2) throw new Error('registry parsing missed a definition');
    const rejected = [
      ['  throw new ConflictException();', 'without a stable code'],
      ['  throw new ConflictException(error.message);', 'without a stable code'],
      ["  throw new ConflictException('OTP_EXPIRED');", 'without a stable code'],
      ["  throw new ConflictException({ code: 'ACTIVE_OBLIGATIONS' });", 'does not read'],
      [
        "  throw new ConflictException({ error_code: 'CUSTOMER_OTP_ACTIVE' });",
        'not in ERROR_DEFINITIONS',
      ],
      [
        "  throw new BadRequestException({ error_code: 'DELIVERY_OTP_MISMATCH' });",
        'not in ERROR_DEFINITIONS',
      ],
      ['function translate(error: unknown): never {', 'declares its own'],
      ['function map(e: unknown): never {', 'declares its own'],
    ];
    for (const [source, expected] of rejected) {
      if (!findUndeclaredConflicts('x.ts', source, registered).some((d) => d.includes(expected))) {
        throw new Error(`error-contract control missed: ${source}`);
      }
    }
    const tableRejected = findUndeclaredConflicts(
      'apps/api/src/domain-errors.ts',
      "  [MoneyStateError, { status: 'conflict', code: 'MONEY_STATE' }],",
      registered,
    );
    if (!tableRejected.some((d) => d.includes('not in ERROR_DEFINITIONS'))) {
      throw new Error('error-contract control missed an unregistered code in the table');
    }
    const tableAllowed = findUndeclaredConflicts(
      'apps/api/src/domain-errors.ts',
      "  [SomeError, { status: 'conflict', code: 'ORDER_STATE_CONFLICT' }],\nfunction translateDomainError(error: unknown): never {",
      registered,
    );
    if (tableAllowed.length > 0) {
      throw new Error(`error-contract control was too broad for the table: ${tableAllowed[0]}`);
    }
    const allowed = [
      "  throw new ConflictException({ error_code: 'ORDER_STATE_CONFLICT' });",
      "  throw new ConflictException({ error_code: 'DELIVERY_OTP_EXPIRED' });",
      '  throw new ConflictException({ error_code: error.code });',
      '  // throw new ConflictException(error.message) -- replaced, see the comment',
    ];
    for (const source of allowed) {
      if (findUndeclaredConflicts('x.ts', source, registered).length > 0) {
        throw new Error(`error-contract control was too broad for: ${source}`);
      }
    }
    process.stdout.write('Error contract control self-test passed.\n');
    return;
  }

  const registered = registeredCodes(readFileSync(registryFile, 'utf8'));
  if (registered.size === 0) {
    process.stderr.write('ERROR_DEFINITIONS could not be read from the domain types.\n');
    process.exitCode = 1;
    return;
  }

  const controllers = readdirSync(controllerDirectory).filter(
    (name) =>
      (name.endsWith('.controller.ts') || name === 'domain-errors.ts') &&
      !name.endsWith('.spec.ts'),
  );
  if (controllers.length === 0) {
    process.stderr.write('No controllers were found to check.\n');
    process.exitCode = 1;
    return;
  }
  const defects = controllers.flatMap((name) =>
    findUndeclaredConflicts(
      `apps/api/src/${name}`,
      readFileSync(`${controllerDirectory}${name}`, 'utf8'),
      registered,
    ),
  );
  if (defects.length > 0) {
    for (const defect of defects) process.stderr.write(`${defect}\n`);
    process.stderr.write(
      'The exception filter builds the response from a stable code and discards the body, so a ' +
        'refusal that declares no code cannot explain itself. Declare one from ERROR_DEFINITIONS ' +
        'whose http_status matches the response.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Error contract controls passed for ${controllers.length - 1} controllers and the translation table.\n`,
  );
}

main();
