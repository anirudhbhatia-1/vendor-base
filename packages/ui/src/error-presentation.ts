/**
 * Turns a failed request into copy a person can act on.
 *
 * The apps were rendering `error.message` raw — server phrasing, English only,
 * and without the request id support asks for. This reads the standard error
 * shape ({ code, message_key, request_id }) structurally, so it needs no
 * dependency on the contracts package, and falls back to a safe sentence for
 * anything unrecognised.
 */

export type PresentableError = {
  readonly title: string;
  readonly description: string;
  /** The request id to quote to support, when the failure carried one. */
  readonly reference?: string | undefined;
  /** True when trying again might work without anything else changing. */
  readonly retryable: boolean;
};

const COPY: Readonly<Record<string, { title: string; description: string; retryable: boolean }>> = {
  CONFLICT: {
    title: 'Someone got there first',
    description: 'This changed while you were looking at it. Refresh and try again.',
    retryable: true,
  },
  INVALID_ARGUMENT: {
    title: 'That could not be accepted',
    description: 'Check the highlighted details and try again.',
    retryable: false,
  },
  PERMISSION_DENIED: {
    title: 'You do not have access to this',
    description: 'Your role does not allow this action. Ask an administrator if that seems wrong.',
    retryable: false,
  },
  RATE_LIMITED: {
    title: 'Too many attempts',
    description: 'Wait a moment before trying again.',
    retryable: true,
  },
  RESOURCE_NOT_FOUND: {
    title: 'Not found',
    description: 'This may have been removed, or the link may be out of date.',
    retryable: false,
  },
  UNAUTHENTICATED: {
    title: 'Signed out',
    description: 'Your session ended. Sign in again to continue.',
    retryable: false,
  },
};

const OFFLINE: PresentableError = {
  title: 'You are offline',
  description: 'Reconnect to refresh. What you see may be out of date.',
  retryable: true,
};

const FALLBACK: PresentableError = {
  title: 'Something went wrong',
  description: 'Try again. If it keeps failing, contact support and quote the reference below.',
  retryable: true,
};

function field(source: unknown, ...names: readonly string[]): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  for (const name of names) {
    const value = (source as Record<string, unknown>)[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/**
 * The one-line form for an action failure notice: the shared copy when the
 * failure kind is recognised, the action's own fallback sentence otherwise,
 * and the request id support asks people to quote, when one was carried.
 */
export function actionErrorText(error: unknown, fallback: string): string {
  const described = describeError(error);
  const sentence =
    described.title === FALLBACK.title ? fallback : `${described.title}. ${described.description}`;
  return described.reference ? `${sentence} Reference ${described.reference}.` : sentence;
}

export function describeError(error: unknown): PresentableError {
  const reference = field(error, 'request_id', 'requestId');
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (error instanceof TypeError || offline) {
    return { ...OFFLINE, reference };
  }
  const code = field(error, 'code');
  const known = code ? COPY[code] : undefined;
  if (known) return { ...known, reference };
  return { ...FALLBACK, reference };
}
