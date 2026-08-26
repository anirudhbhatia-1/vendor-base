import { AsyncLocalStorage } from 'node:async_hooks';
import type { PropagatedMessage, RequestContext } from '@neighbourhood-store/domain-types';

const messageContextStorage = new AsyncLocalStorage<RequestContext>();

export function optionalMessageContext(): RequestContext | undefined {
  return messageContextStorage.getStore();
}

export function runWithMessageContext<Result>(
  message: PropagatedMessage,
  handler: () => Result,
): Result {
  return messageContextStorage.run(message.context, handler);
}
