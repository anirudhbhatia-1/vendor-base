import {
  createFieldError,
  createRequestContext,
  createStandardError,
  createTraceContext,
  formatTraceparent,
  parseRequestId,
  FIELD_ERROR_MESSAGE_KEYS,
} from '@neighbourhood-store/domain-types';
import type { FastifyInstance } from 'fastify';
import { requestContextStorage } from './request-context-storage.js';

const REQUEST_ID_HEADER = 'x-request-id';
const TRACEPARENT_HEADER = 'traceparent';

function singleHeader(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === 'string' || value === undefined) return value;
  return value[0];
}

export function installRequestContextHook(instance: FastifyInstance): void {
  instance.addHook('onRequest', (request, reply, done) => {
    const suppliedRequestId = singleHeader(request.headers[REQUEST_ID_HEADER]);
    const suppliedTraceparent = singleHeader(request.headers[TRACEPARENT_HEADER]);
    let invalidField: 'headers.traceparent' | 'headers.x_request_id' | undefined;

    try {
      if (suppliedRequestId) parseRequestId(suppliedRequestId);
    } catch {
      invalidField = 'headers.x_request_id';
    }
    try {
      if (!invalidField && suppliedTraceparent)
        createTraceContext({ traceparent: suppliedTraceparent });
    } catch {
      invalidField = 'headers.traceparent';
    }

    if (!invalidField) {
      const context = createRequestContext({
        ...(suppliedRequestId ? { request_id: suppliedRequestId } : {}),
        ...(suppliedTraceparent ? { traceparent: suppliedTraceparent } : {}),
      });
      reply.header(REQUEST_ID_HEADER, context.request_id);
      reply.header(TRACEPARENT_HEADER, formatTraceparent(context.trace));
      requestContextStorage.run(context, done);
    } else {
      const fallback = createRequestContext();
      reply.header(REQUEST_ID_HEADER, fallback.request_id);
      reply.header(TRACEPARENT_HEADER, formatTraceparent(fallback.trace));
      void reply.code(400).send(
        createStandardError('INVALID_ARGUMENT', fallback.request_id, {
          field_errors: [
            createFieldError({
              field: invalidField,
              code:
                invalidField === 'headers.x_request_id'
                  ? 'INVALID_REQUEST_ID'
                  : 'INVALID_TRACEPARENT',
              message_key:
                invalidField === 'headers.x_request_id'
                  ? FIELD_ERROR_MESSAGE_KEYS.INVALID_REQUEST_ID
                  : FIELD_ERROR_MESSAGE_KEYS.INVALID_TRACEPARENT,
            }),
          ],
        }),
      );
    }
  });
}
