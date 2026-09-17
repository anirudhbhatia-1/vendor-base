import {
  createAuthenticatedActor,
  createRequestContext,
  createUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';

/**
 * What every verifier in the ladder needs and each used to declare itself:
 * twenty `check`s, ten `rejects`, fifteen actor-context builders.
 *
 * `check` also counts. The ladder's summary used to carry a hand-typed number
 * per module -- `vendor_fulfilment_scenarios: 70` -- bumped by whoever last
 * edited the module, by judgement. It measured nothing. The number reported
 * now is how many assertions actually ran and passed, so a module that
 * silently stopped asserting shows up as a smaller number, not the same one.
 */

let passed = 0;

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  passed += 1;
}

/** Assertions that have passed since the last call -- one module's worth. */
export function takeAssertionCount(): number {
  const count = passed;
  passed = 0;
  return count;
}

export async function rejects(
  work: () => Promise<unknown>,
  kind: abstract new (...args: never[]) => Error,
  message: string,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    check(error instanceof kind, `${message} (raised ${String(error)})`);
    return;
  }
  throw new Error(message);
}

type ActorKind = Parameters<typeof createAuthenticatedActor>[0]['actor_kind'];

export function actorContext(kind: ActorKind, userId: UuidV7): RequestContext {
  return createRequestContext({
    actor: createAuthenticatedActor({
      actor_id: userId,
      actor_kind: kind,
      session_id: createUuidV7(),
    }),
  });
}

export const customerContext = (userId: UuidV7): RequestContext => actorContext('customer', userId);
export const vendorContext = (userId: UuidV7): RequestContext =>
  actorContext('vendor_staff', userId);
export const adminContext = (userId: UuidV7): RequestContext => actorContext('admin', userId);
export const partnerContext = (userId: UuidV7): RequestContext =>
  actorContext('delivery_partner', userId);
export const systemContext = (userId: UuidV7): RequestContext => actorContext('system', userId);
