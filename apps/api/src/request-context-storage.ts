import { AsyncLocalStorage } from 'node:async_hooks';
import {
  attachAuthenticatedActor,
  type AuthenticatedActor,
  type RequestContext,
} from '@neighbourhood-store/domain-types';

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function currentRequestContext(): RequestContext {
  const context = requestContextStorage.getStore();
  if (!context) throw new Error('Request context is unavailable outside an HTTP request');
  return context;
}

export function optionalRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function runWithAuthenticatedActor<Result>(
  actor: AuthenticatedActor,
  callback: () => Result,
): Result {
  return requestContextStorage.run(
    attachAuthenticatedActor(currentRequestContext(), actor),
    callback,
  );
}
