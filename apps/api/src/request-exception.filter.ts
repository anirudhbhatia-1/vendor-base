import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  createRequestId,
  createStandardError,
  ERROR_DEFINITIONS,
  errorHttpStatus,
  type ErrorDetailValue,
  type StableErrorCode,
} from '@neighbourhood-store/domain-types';
import type { FastifyReply } from 'fastify';
import { apiLogger } from './json-logger.js';
import { optionalRequestContext } from './request-context-storage.js';

function codeForStatus(status: number): StableErrorCode {
  if (status === 400) return 'INVALID_ARGUMENT';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'RESOURCE_NOT_FOUND';
  if (status === 409) return 'VERSION_CONFLICT';
  if (status === 422) return 'BUSINESS_RULE_VIOLATION';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  return 'INTERNAL_ERROR';
}

/**
 * A stable code the controller chose, when it chose one.
 *
 * Every 409 was reported as `VERSION_CONFLICT`, because the code was derived from
 * the HTTP status alone and this filter discarded whatever the controller had
 * attached. Clients render `VERSION_CONFLICT` as "Something changed while you were
 * working. Refresh and try again." -- so a delivery partner told that the vendor
 * had not handed the order over yet was instead told to refresh and retry, and
 * did, repeatedly. `ORDER_STATE_CONFLICT` existed for exactly this case and was
 * unreachable: defined, unit-tested and impossible to emit.
 *
 * Only a declared code is honoured, and only when it belongs to the status being
 * sent. Nothing from the exception body reaches the response otherwise -- no raw
 * messages, so a controller cannot leak internal detail through this path, and a
 * concealed 404 stays concealed.
 */
function declaredCode(exception: unknown, status: number): StableErrorCode | null {
  if (!(exception instanceof HttpException)) return null;
  const body = exception.getResponse();
  if (typeof body !== 'object' || body === null) return null;
  const candidate = (body as { readonly error_code?: unknown }).error_code;
  if (typeof candidate !== 'string' || !(candidate in ERROR_DEFINITIONS)) return null;
  const code = candidate as StableErrorCode;
  return errorHttpStatus(code) === status ? code : null;
}

/**
 * Structured detail a refusal is allowed to carry.
 *
 * An allowlist, for the same reason `declaredCode` validates its code: this filter
 * discards exception bodies on purpose, and a concealed 404 has to stay concealed.
 * Only these keys cross, and only with the shapes named here, so a controller
 * cannot widen the channel by attaching something new.
 *
 * `available_quantity` is how many units are actually left; `missing_checks` is
 * which publication checks are outstanding. Both were attached to their
 * exceptions and thrown away, leaving "That is not allowed in the current state".
 * `offered_modes` is how a store can get an order to the customer, for a group
 * that asked for a way it cannot.
 */
const ALLOWED_DETAIL_KEYS = new Set(['available_quantity', 'missing_checks', 'offered_modes']);

function declaredDetails(exception: unknown): Readonly<Record<string, ErrorDetailValue>> {
  if (!(exception instanceof HttpException)) return {};
  const body = exception.getResponse();
  if (typeof body !== 'object' || body === null) return {};
  const details: Record<string, ErrorDetailValue> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!ALLOWED_DETAIL_KEYS.has(key)) continue;
    if (typeof value === 'number' || typeof value === 'string') details[key] = value;
    else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      details[key] = Object.freeze([...(value as readonly string[])]);
    }
  }
  return details;
}

@Catch()
export class RequestExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<{ method?: string; routeOptions?: { url?: string } }>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const requestId = optionalRequestContext()?.request_id ?? createRequestId();
    const code = declaredCode(exception, status) ?? codeForStatus(status);

    if (status >= 500) {
      apiLogger.error(
        exception instanceof Error ? exception : new Error('Unhandled request failure'),
        RequestExceptionFilter.name,
      );
    }
    // Method and route matter most on this path, not the success one. Every
    // authorization denial is a thrown exception, so it never reaches the interceptor
    // that logs them — a concealed 404 for someone probing another customer's addresses
    // was indistinguishable in the logs from a dead link, across every route in the API.
    // Concealment is right for the response; the logs are where the attempt is supposed
    // to be visible.
    //
    // This is `routeOptions.url`, the registered route pattern, so it carries no
    // identifier from the request — the same value the success path already logs.
    apiLogger.event('http.request.failed', {
      status,
      error_code: code,
      method: request?.method ?? 'unknown',
      route: request?.routeOptions?.url ?? 'unmatched',
    });
    void reply
      .code(status)
      .send(createStandardError(code, requestId, { details: declaredDetails(exception) }));
  }
}
