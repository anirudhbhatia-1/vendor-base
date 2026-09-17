import type { JsonLogger } from '@neighbourhood-store/domain-types';

/**
 * Makes an unreachable queue backend say so once, usefully.
 *
 * BullMQ opens a separate ioredis client per Queue, QueueEvents and Worker, and
 * each retries for ever, emitting an `error` event on every attempt. With the
 * backend down that is three unbounded streams of identical, unlabelled
 * `ECONNREFUSED` stack traces — which in a shared `pnpm dev` terminal buries
 * the output of every other app in the workspace, and never once says which
 * dependency is missing or how to start it.
 *
 * OPS-05 asks a failure to carry its own first response. So: one line, naming
 * the queue, the address and the remedy, repeated at most once a minute for as
 * long as the condition lasts.
 */
const REPEAT_AFTER_MS = 60_000;

type ErrorEmitter = { on: (event: 'error', listener: (error: Error) => void) => unknown };

/**
 * Named `endpoint`, not `address`.
 *
 * The log redactor treats any `*_address` field as protected — correctly, since
 * it cannot tell a queue host from a customer's doorstep — so calling this
 * `queue_address` printed `[REDACTED]` and took the useful half of the message
 * with it. The fix belongs here, not in the redactor.
 */
function endpointOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || '6379'}`;
  } catch {
    // A malformed URL is itself worth reporting, but not worth crashing on.
    return url;
  }
}

/**
 * Attaches a deduplicating error handler to each BullMQ connection.
 *
 * Also stops the process treating the `error` event as unhandled, which is what
 * printed the raw traces in the first place.
 */
export function reportQueueErrors(input: {
  readonly logger: JsonLogger;
  readonly queueUrl: string;
  readonly emitters: readonly (ErrorEmitter | undefined)[];
  readonly component: string;
}): void {
  const endpoint = endpointOf(input.queueUrl);
  let lastReportedAt = 0;
  let suppressed = 0;

  for (const emitter of input.emitters) {
    emitter?.on('error', (error: Error) => {
      const now = Date.now();
      if (now - lastReportedAt < REPEAT_AFTER_MS) {
        suppressed += 1;
        return;
      }
      const code = (error as { code?: unknown }).code;
      input.logger.event('worker.queue.unavailable', {
        component: input.component,
        queue_endpoint: endpoint,
        error_code: typeof code === 'string' ? code : 'UNKNOWN',
        error_message: error.message,
        ...(suppressed > 0 ? { suppressed_since_last_report: suppressed } : {}),
        first_response:
          code === 'ECONNREFUSED'
            ? 'The queue backend is not running. Start it with `pnpm db:up`, then restart the worker.'
            : 'Check the queue backend and QUEUE_URL / VALKEY_URL.',
      });
      lastReportedAt = now;
      suppressed = 0;
    });
  }
}

/**
 * Fails startup with one actionable message rather than retrying in silence.
 *
 * `waitUntilReady()` never settles while the backend is refusing connections,
 * so without a bound the worker sits "starting" for ever while the log fills.
 */
export async function requireQueueReady(input: {
  readonly ready: readonly Promise<unknown>[];
  readonly queueUrl: string;
  readonly timeoutMs?: number;
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 15_000;
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `The queue backend at ${endpointOf(input.queueUrl)} did not accept a connection within ` +
            `${Math.round(timeoutMs / 1000)}s. Start it with \`pnpm db:up\`, then restart the worker.`,
        ),
      );
    }, timeoutMs);
    // A pending timer must not be the reason the process stays alive.
    timer.unref?.();
  });
  try {
    await Promise.race([Promise.all(input.ready), expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Waits for a graceful queue close, but never for ever.
 *
 * BullMQ's `close()` waits for the active job to finish, and it is idempotent —
 * a later `close(true)` cannot escalate a close that is already under way, so
 * the decision to stop waiting has to be made here rather than after the fact.
 * A worker holding an in-flight job therefore ignored the supervisor's stop
 * signal until the job finished, was force-killed part way through, and left
 * the surrounding `pnpm dev` reporting exit 137 for a deliberate Ctrl+C.
 *
 * The job handlers cooperate first (they check the stopping flag between
 * passes); this is the backstop for the case where one of them is already
 * blocked in a call that cannot be interrupted.
 */
export async function closeQueuesWithin(input: {
  readonly logger: JsonLogger;
  readonly component: string;
  readonly close: () => Promise<void>;
  readonly graceMs?: number;
}): Promise<void> {
  const graceMs = input.graceMs ?? 4_000;
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), graceMs);
    timer.unref?.();
  });
  try {
    const outcome = await Promise.race([input.close().then(() => 'closed' as const), expiry]);
    if (outcome === 'timeout') {
      input.logger.event('worker.shutdown.incomplete', {
        component: input.component,
        grace_ms: graceMs,
        first_response:
          'A queue job was still running at shutdown. It stays claimed until it stalls and is ' +
          'retried, which is safe because every handler is idempotent.',
      });
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
