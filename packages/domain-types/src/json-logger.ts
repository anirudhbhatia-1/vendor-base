import { redactProtectedFields, type SafeLogValue } from './redaction.js';
import type { RequestContext } from './request-context.js';

/**
 * One structured logger for the API and the worker.
 *
 * Each process had its own copy of this class, differing only in where it
 * read the request context from. Redaction is the point of the class -- the
 * fields that must never reach a log line are decided here, once -- and two
 * copies meant a rule fixed in one process stayed leaky in the other. The
 * context source is injected; everything else is shared.
 *
 * The method set is NestJS's `LoggerService`, kept structural so this package
 * does not depend on the framework.
 */
export type LogLevel = 'debug' | 'error' | 'fatal' | 'info' | 'verbose' | 'warn';

export type LogContextSource = () => RequestContext | undefined;

export type LogOutput = {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
};

function safeMessage(message: unknown): string {
  if (message instanceof Error) {
    // The message text alongside the name, so the line describes the failure
    // instead of just saying "Error".
    return message.message ? `${message.name}: ${message.message}` : message.name;
  }
  if (typeof message === 'string') return message;
  return 'framework event';
}

function errorDetail(message: unknown): Record<string, unknown> {
  if (!(message instanceof Error)) return {};
  const detail: Record<string, unknown> = { error_name: message.name };
  if (message.message) detail['error_message'] = message.message;
  const code = (message as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') detail['error_code'] = code;
  return detail;
}

export class JsonLogger {
  /**
   * Output is injected rather than defaulting to `process`: this package is
   * framework-free and type-checks under browser and React Native globals too.
   */
  constructor(
    private readonly service: string,
    private readonly contextSource: LogContextSource,
    private readonly output: LogOutput,
  ) {}

  event(event: string, metadata: Readonly<Record<string, unknown>> = {}): void {
    this.write('info', event, metadata);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', safeMessage(message), { context: this.context(optionalParams) });
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', safeMessage(message), {
      context: this.context(optionalParams),
      ...errorDetail(message),
    });
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', safeMessage(message), { context: this.context(optionalParams) });
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', safeMessage(message), { context: this.context(optionalParams) });
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', safeMessage(message), { context: this.context(optionalParams) });
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', safeMessage(message), {
      context: this.context(optionalParams),
      ...errorDetail(message),
    });
  }

  private context(optionalParams: readonly unknown[]): string {
    let context: string | undefined;
    for (let index = optionalParams.length - 1; index >= 0; index -= 1) {
      const value = optionalParams[index];
      if (typeof value === 'string') {
        context = value;
        break;
      }
    }
    return typeof context === 'string' ? context : 'application';
  }

  private write(level: LogLevel, event: string, metadata: Readonly<Record<string, unknown>>): void {
    const requestContext = this.contextSource();
    const safeMetadata = redactProtectedFields(metadata) as Readonly<Record<string, SafeLogValue>>;
    const line = `${JSON.stringify({
      ...safeMetadata,
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      event,
      ...(requestContext
        ? {
            request_id: requestContext.request_id,
            correlation_id: requestContext.correlation_id,
            causation_id: requestContext.causation_id,
            trace_id: requestContext.trace.trace_id,
            span_id: requestContext.trace.span_id,
            actor_id: requestContext.actor?.actor_id ?? null,
            actor_kind: requestContext.actor?.actor_kind ?? null,
          }
        : {}),
    })}\n`;
    if (level === 'error' || level === 'fatal') this.output.stderr(line);
    else this.output.stdout(line);
  }
}
