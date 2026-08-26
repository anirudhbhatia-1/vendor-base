import type { LoggerService } from '@nestjs/common';
import { redactProtectedFields, type SafeLogValue } from '@neighbourhood-store/domain-types';
import { optionalRequestContext } from './request-context-storage.js';

type LogLevel = 'debug' | 'error' | 'fatal' | 'info' | 'verbose' | 'warn';

function safeMessage(message: unknown): string {
  if (message instanceof Error) return message.name;
  if (typeof message === 'string') return message;
  return 'framework event';
}

export class JsonLogger implements LoggerService {
  constructor(private readonly service: string) {}

  event(event: string, metadata: Readonly<Record<string, unknown>> = {}): void {
    this.write('info', event, metadata);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', safeMessage(message), { context: this.context(optionalParams) });
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', safeMessage(message), { context: this.context(optionalParams) });
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
    this.write('fatal', safeMessage(message), { context: this.context(optionalParams) });
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
    const requestContext = optionalRequestContext();
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
    if (level === 'error' || level === 'fatal') process.stderr.write(line);
    else process.stdout.write(line);
  }
}

export const apiLogger = new JsonLogger('marketplace-api');
