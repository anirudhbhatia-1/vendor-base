import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import {
  createRequestId,
  createStandardError,
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

@Catch()
export class RequestExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const requestId = optionalRequestContext()?.request_id ?? createRequestId();
    const code = codeForStatus(status);

    apiLogger.event('http.request.failed', { status, error_code: code });
    void reply.code(status).send(createStandardError(code, requestId));
  }
}
