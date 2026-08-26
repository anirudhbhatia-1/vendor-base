import type { Brand } from './brand.js';
import {
  createRequestId,
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  secureRandomBytes,
  type RandomBytes,
  type RequestId,
  type UuidV7,
} from './identifiers.js';

export type TraceId = Brand<string, 'TraceId'>;
export type SpanId = Brand<string, 'SpanId'>;
export type ActorKind = 'admin' | 'customer' | 'delivery_partner' | 'system' | 'vendor_staff';

export interface AuthenticatedActor {
  readonly actor_id: UuidV7;
  readonly actor_kind: ActorKind;
  readonly session_id: UuidV7;
}

export interface TraceContext {
  readonly trace_id: TraceId;
  readonly span_id: SpanId;
  readonly parent_span_id: SpanId | null;
  readonly trace_flags: string;
}

export interface RequestContext {
  readonly request_id: RequestId;
  readonly correlation_id: UuidV7;
  readonly causation_id: UuidV7 | null;
  readonly actor: AuthenticatedActor | null;
  readonly trace: TraceContext;
}

export type PropagatedMessageKind = 'command' | 'event' | 'job';

export interface PropagatedMessage<TPayload = unknown> {
  readonly message_id: UuidV7;
  readonly kind: PropagatedMessageKind;
  readonly context: RequestContext;
  readonly payload: TPayload;
}

export interface ProviderCallContext {
  readonly operation_id: UuidV7;
  readonly context: RequestContext;
}

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const ACTOR_KINDS = new Set<ActorKind>([
  'admin',
  'customer',
  'delivery_partner',
  'system',
  'vendor_staff',
]);

function randomHex(length: number, randomBytes: RandomBytes): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = randomBytes(length / 2);
    if (bytes.length !== length / 2)
      throw new RangeError('Random source returned an invalid length');
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (!/^0+$/.test(value)) return value;
  }
  throw new Error('Random source produced an invalid all-zero trace identifier');
}

export function createAuthenticatedActor(input: {
  readonly actor_id: string;
  readonly actor_kind: ActorKind;
  readonly session_id: string;
}): AuthenticatedActor {
  if (!ACTOR_KINDS.has(input.actor_kind))
    throw new TypeError('Unsupported authenticated actor kind');
  return Object.freeze({
    actor_id: parseUuidV7(input.actor_id),
    actor_kind: input.actor_kind,
    session_id: parseUuidV7(input.session_id),
  });
}

export function createTraceContext(
  options: {
    readonly traceparent?: string;
    readonly random_bytes?: RandomBytes;
  } = {},
): TraceContext {
  const randomBytes = options.random_bytes ?? secureRandomBytes;
  if (options.traceparent) {
    const match = TRACEPARENT_PATTERN.exec(options.traceparent.toLowerCase());
    if (!match || /^0+$/.test(match[1] ?? '') || /^0+$/.test(match[2] ?? '')) {
      throw new TypeError('traceparent must be a valid W3C version 00 trace context');
    }
    return Object.freeze({
      trace_id: match[1] as TraceId,
      span_id: randomHex(16, randomBytes) as SpanId,
      parent_span_id: match[2] as SpanId,
      trace_flags: match[3] ?? '00',
    });
  }

  return Object.freeze({
    trace_id: randomHex(32, randomBytes) as TraceId,
    span_id: randomHex(16, randomBytes) as SpanId,
    parent_span_id: null,
    trace_flags: '00',
  });
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.trace_id}-${context.span_id}-${context.trace_flags}`;
}

export function createRequestContext(
  options: {
    readonly actor?: AuthenticatedActor | null;
    readonly causation_id?: string | null;
    readonly correlation_id?: string;
    readonly random_bytes?: RandomBytes;
    readonly request_id?: string;
    readonly traceparent?: string;
  } = {},
): RequestContext {
  const requestId = options.request_id
    ? parseRequestId(options.request_id)
    : createRequestId(options.random_bytes ? { random_bytes: options.random_bytes } : {});
  return Object.freeze({
    request_id: requestId,
    correlation_id: options.correlation_id
      ? parseUuidV7(options.correlation_id)
      : parseUuidV7(requestId),
    causation_id: options.causation_id ? parseUuidV7(options.causation_id) : null,
    actor: options.actor ?? null,
    trace: createTraceContext({
      ...(options.traceparent ? { traceparent: options.traceparent } : {}),
      ...(options.random_bytes ? { random_bytes: options.random_bytes } : {}),
    }),
  });
}

export function attachAuthenticatedActor(
  context: RequestContext,
  actor: AuthenticatedActor,
): RequestContext {
  return Object.freeze({ ...context, actor });
}

export function createChildRequestContext(
  parent: RequestContext,
  causationId: string,
  randomBytes: RandomBytes = secureRandomBytes,
): RequestContext {
  return Object.freeze({
    request_id: parent.request_id,
    correlation_id: parent.correlation_id,
    causation_id: parseUuidV7(causationId),
    actor: parent.actor,
    trace: createTraceContext({
      traceparent: formatTraceparent(parent.trace),
      random_bytes: randomBytes,
    }),
  });
}

function createMessage<TPayload>(input: {
  readonly caused_by: string;
  readonly context: RequestContext;
  readonly kind: PropagatedMessageKind;
  readonly message_id?: string;
  readonly payload: TPayload;
  readonly random_bytes?: RandomBytes;
}): PropagatedMessage<TPayload> {
  const randomBytes = input.random_bytes ?? secureRandomBytes;
  return Object.freeze({
    message_id: input.message_id
      ? parseUuidV7(input.message_id)
      : createUuidV7({ random_bytes: randomBytes }),
    kind: input.kind,
    context: createChildRequestContext(input.context, input.caused_by, randomBytes),
    payload: input.payload,
  });
}

export function createCommandEnvelope<TPayload>(
  input: Omit<Parameters<typeof createMessage<TPayload>>[0], 'kind'>,
): PropagatedMessage<TPayload> {
  return createMessage({ ...input, kind: 'command' });
}

export function createEventEnvelope<TPayload>(
  input: Omit<Parameters<typeof createMessage<TPayload>>[0], 'kind'>,
): PropagatedMessage<TPayload> {
  return createMessage({ ...input, kind: 'event' });
}

export function createJobEnvelope<TPayload>(
  input: Omit<Parameters<typeof createMessage<TPayload>>[0], 'kind'>,
): PropagatedMessage<TPayload> {
  return createMessage({ ...input, kind: 'job' });
}

export function createProviderCallContext(input: {
  readonly caused_by: string;
  readonly context: RequestContext;
  readonly operation_id?: string;
  readonly random_bytes?: RandomBytes;
}): ProviderCallContext {
  const randomBytes = input.random_bytes ?? secureRandomBytes;
  return Object.freeze({
    operation_id: input.operation_id
      ? parseUuidV7(input.operation_id)
      : createUuidV7({ random_bytes: randomBytes }),
    context: createChildRequestContext(input.context, input.caused_by, randomBytes),
  });
}
