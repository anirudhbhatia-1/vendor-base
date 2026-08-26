import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { attachAuthenticatedActor } from '@neighbourhood-store/domain-types';
import { Observable } from 'rxjs';
import { AUTHORIZED_ACTOR, type AuthorizedRequest } from './authorization.js';
import { currentRequestContext, requestContextStorage } from './request-context-storage.js';

@Injectable()
export class AuthenticatedActorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const actor = request[AUTHORIZED_ACTOR];
    if (!actor) return next.handle();
    const authenticatedContext = attachAuthenticatedActor(currentRequestContext(), actor);
    return new Observable((subscriber) =>
      requestContextStorage.run(authenticatedContext, () => next.handle().subscribe(subscriber)),
    );
  }
}
