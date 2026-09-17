import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { trace } from '@opentelemetry/api';
import { apiLogger } from './json-logger.js';
import { currentRequestContext } from './request-context-storage.js';

function responseWithRequestId(value: unknown, requestId: string): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value, request_id: requestId };
  }
  return { data: value, request_id: requestId };
}

@Injectable()
export class RequestReferenceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const requestContext = currentRequestContext();
    const request = context
      .switchToHttp()
      .getRequest<{ method: string; routeOptions?: { url?: string } }>();
    trace.getActiveSpan()?.setAttributes({
      'app.request_id': requestContext.request_id,
      'app.correlation_id': requestContext.correlation_id,
      ...(requestContext.causation_id ? { 'app.causation_id': requestContext.causation_id } : {}),
    });
    return next.handle().pipe(
      map((value: unknown) => {
        apiLogger.event('http.request.completed', {
          method: request.method,
          route: request.routeOptions?.url ?? 'unmatched',
        });
        return responseWithRequestId(value, requestContext.request_id);
      }),
    );
  }
}
