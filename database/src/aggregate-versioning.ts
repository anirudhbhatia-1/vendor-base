import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type ActorKind,
  type RequestId,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool, PoolClient } from 'pg';
import { canonicalRequestJson, type JsonObject } from './idempotency.js';

export type ReasonRequirement = 'forbidden' | 'optional' | 'required';

export interface TransitionRule {
  readonly allowed_actor_kinds: readonly ActorKind[];
  readonly from_state: string;
  readonly reason: ReasonRequirement;
  readonly required_evidence: readonly string[];
  readonly to_state: string;
}

export interface AggregatePolicy {
  readonly aggregate_type: string;
  readonly creation: {
    readonly allowed_actor_kinds: readonly ActorKind[];
    readonly allowed_initial_states: readonly string[];
    readonly reason: ReasonRequirement;
    readonly required_evidence: readonly string[];
  };
  readonly states: readonly string[];
  readonly transitions: readonly TransitionRule[];
}

export interface AggregateSnapshot {
  readonly aggregate_id: UuidV7;
  readonly aggregate_type: string;
  readonly state: string;
  readonly version: number;
}

export interface AggregateTransitionResult extends AggregateSnapshot {
  readonly transition_id: UuidV7;
}

export class AggregateVersionConflictError extends Error {
  readonly code = 'VERSION_CONFLICT';

  constructor(
    readonly expected_version: number,
    readonly current_version: number,
    readonly current_state: string,
  ) {
    super('Aggregate version changed before the command could be applied');
    this.name = 'AggregateVersionConflictError';
  }
}

export class AggregateTransitionRejectedError extends Error {
  readonly code = 'BUSINESS_RULE_VIOLATION';

  constructor(readonly violation: 'ACTOR' | 'EVIDENCE' | 'REASON' | 'STATE') {
    super(`Aggregate transition rejected by ${violation.toLowerCase()} policy`);
    this.name = 'AggregateTransitionRejectedError';
  }
}

export class AggregateNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';

  constructor() {
    super('Aggregate was not found');
    this.name = 'AggregateNotFoundError';
  }
}

const AGGREGATE_TYPE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const STATE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const REASON_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const EVIDENCE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const ACTOR_KINDS = new Set<ActorKind>([
  'admin',
  'customer',
  'delivery_partner',
  'system',
  'vendor_staff',
]);
const REASON_REQUIREMENTS = new Set<ReasonRequirement>(['forbidden', 'optional', 'required']);

function requireAggregateType(value: string): string {
  if (!AGGREGATE_TYPE_PATTERN.test(value)) throw new TypeError('Aggregate type is invalid');
  return value;
}

function requireState(value: string): string {
  if (!STATE_PATTERN.test(value)) throw new TypeError('Aggregate state is invalid');
  return value;
}

function requireActorKind(value: ActorKind): ActorKind {
  if (!ACTOR_KINDS.has(value)) throw new TypeError('Aggregate actor kind is invalid');
  return value;
}

function requireReasonRequirement(value: ReasonRequirement): ReasonRequirement {
  if (!REASON_REQUIREMENTS.has(value)) throw new TypeError('Reason requirement is invalid');
  return value;
}

function requireExpectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('Expected aggregate version must be a positive safe integer');
  }
  return value;
}

function requireEvidenceKeys(keys: readonly string[], label: string): readonly string[] {
  const unique = new Set<string>();
  for (const key of keys) {
    if (!EVIDENCE_KEY_PATTERN.test(key)) throw new TypeError(`${label} evidence key is invalid`);
    if (unique.has(key)) throw new TypeError(`${label} evidence keys must be unique`);
    unique.add(key);
  }
  return Object.freeze([...unique]);
}

function requireActorKinds(kinds: readonly ActorKind[], label: string): readonly ActorKind[] {
  if (kinds.length === 0) throw new TypeError(`${label} must allow at least one actor kind`);
  const unique = new Set(kinds.map(requireActorKind));
  if (unique.size !== kinds.length) throw new TypeError(`${label} actor kinds must be unique`);
  return Object.freeze([...unique]);
}

export function defineAggregatePolicy(input: AggregatePolicy): AggregatePolicy {
  const aggregateType = requireAggregateType(input.aggregate_type);
  const states = input.states.map(requireState);
  if (states.length === 0 || new Set(states).size !== states.length) {
    throw new TypeError('Aggregate policy states must be non-empty and unique');
  }
  const stateSet = new Set(states);
  const initialStates = input.creation.allowed_initial_states.map(requireState);
  if (
    initialStates.length === 0 ||
    new Set(initialStates).size !== initialStates.length ||
    initialStates.some((state) => !stateSet.has(state))
  ) {
    throw new TypeError('Creation states must be unique members of the aggregate policy');
  }
  const transitionKeys = new Set<string>();
  const transitions = input.transitions.map((rule) => {
    const fromState = requireState(rule.from_state);
    const toState = requireState(rule.to_state);
    if (!stateSet.has(fromState) || !stateSet.has(toState)) {
      throw new TypeError('Transition states must belong to the aggregate policy');
    }
    const key = `${fromState}:${toState}`;
    if (transitionKeys.has(key)) throw new TypeError('Aggregate transition rules must be unique');
    transitionKeys.add(key);
    return Object.freeze({
      allowed_actor_kinds: requireActorKinds(rule.allowed_actor_kinds, key),
      from_state: fromState,
      reason: requireReasonRequirement(rule.reason),
      required_evidence: requireEvidenceKeys(rule.required_evidence, key),
      to_state: toState,
    });
  });
  return Object.freeze({
    aggregate_type: aggregateType,
    creation: Object.freeze({
      allowed_actor_kinds: requireActorKinds(
        input.creation.allowed_actor_kinds,
        `${aggregateType} creation`,
      ),
      allowed_initial_states: Object.freeze(initialStates),
      reason: requireReasonRequirement(input.creation.reason),
      required_evidence: requireEvidenceKeys(
        input.creation.required_evidence,
        `${aggregateType} creation`,
      ),
    }),
    states: Object.freeze(states),
    transitions: Object.freeze(transitions),
  });
}

function validateReason(
  requirement: ReasonRequirement,
  reasonCode: string | null | undefined,
): string | null {
  const reason = reasonCode ?? null;
  if (requirement === 'required' && reason === null) {
    throw new AggregateTransitionRejectedError('REASON');
  }
  if (requirement === 'forbidden' && reason !== null) {
    throw new AggregateTransitionRejectedError('REASON');
  }
  if (reason !== null && !REASON_PATTERN.test(reason)) {
    throw new AggregateTransitionRejectedError('REASON');
  }
  return reason;
}

function validateEvidence(evidence: unknown, requiredKeys: readonly string[]): string {
  if (
    evidence === null ||
    typeof evidence !== 'object' ||
    Array.isArray(evidence) ||
    (Object.getPrototypeOf(evidence) !== Object.prototype &&
      Object.getPrototypeOf(evidence) !== null)
  ) {
    throw new AggregateTransitionRejectedError('EVIDENCE');
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(evidence, key) || (evidence as Record<string, unknown>)[key] === null) {
      throw new AggregateTransitionRejectedError('EVIDENCE');
    }
  }
  try {
    return canonicalRequestJson(evidence);
  } catch {
    throw new AggregateTransitionRejectedError('EVIDENCE');
  }
}

function validateActor(ruleKinds: readonly ActorKind[], actorKind: ActorKind): ActorKind {
  requireActorKind(actorKind);
  if (!ruleKinds.includes(actorKind)) throw new AggregateTransitionRejectedError('ACTOR');
  return actorKind;
}

interface AttributionInput {
  readonly actor_id: string;
  readonly actor_kind: ActorKind;
  readonly causation_id?: string | null;
  readonly command_record_id?: string | null;
  readonly correlation_id: string;
  readonly evidence: JsonObject;
  readonly reason_code?: string | null;
  readonly request_id: string;
}

interface ValidatedAttribution {
  readonly actor_id: UuidV7;
  readonly actor_kind: ActorKind;
  readonly causation_id: UuidV7 | null;
  readonly command_record_id: UuidV7 | null;
  readonly correlation_id: UuidV7;
  readonly evidence_json: string;
  readonly reason_code: string | null;
  readonly request_id: RequestId;
}

function validateAttribution(
  input: AttributionInput,
  rule: {
    readonly allowed_actor_kinds: readonly ActorKind[];
    readonly reason: ReasonRequirement;
    readonly required_evidence: readonly string[];
  },
): ValidatedAttribution {
  return {
    actor_id: parseUuidV7(input.actor_id),
    actor_kind: validateActor(rule.allowed_actor_kinds, input.actor_kind),
    causation_id: input.causation_id ? parseUuidV7(input.causation_id) : null,
    command_record_id: input.command_record_id ? parseUuidV7(input.command_record_id) : null,
    correlation_id: parseUuidV7(input.correlation_id),
    evidence_json: validateEvidence(input.evidence, rule.required_evidence),
    reason_code: validateReason(rule.reason, input.reason_code),
    request_id: parseRequestId(input.request_id),
  };
}

async function insertTransition(
  client: PoolClient,
  input: {
    readonly aggregate_id: UuidV7;
    readonly aggregate_type: string;
    readonly attribution: ValidatedAttribution;
    readonly from_state: string | null;
    readonly previous_version: number;
    readonly resulting_version: number;
    readonly to_state: string;
    readonly transition_id: UuidV7;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO marketplace.aggregate_transitions
       (transition_id, aggregate_type, aggregate_id, previous_version, resulting_version,
        from_state, to_state, actor_id, actor_kind, reason_code, evidence, request_id,
        correlation_id, causation_id, command_record_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15)`,
    [
      input.transition_id,
      input.aggregate_type,
      input.aggregate_id,
      input.previous_version,
      input.resulting_version,
      input.from_state,
      input.to_state,
      input.attribution.actor_id,
      input.attribution.actor_kind,
      input.attribution.reason_code,
      input.attribution.evidence_json,
      input.attribution.request_id,
      input.attribution.correlation_id,
      input.attribution.causation_id,
      input.attribution.command_record_id,
    ],
  );
}

export async function createVersionedAggregate(
  pool: Pool,
  policy: AggregatePolicy,
  input: AttributionInput & {
    readonly aggregate_id: string;
    readonly initial_state: string;
  },
  apply?: (client: PoolClient, resultingVersion: number) => Promise<void>,
): Promise<AggregateTransitionResult> {
  const checkedPolicy = defineAggregatePolicy(policy);
  const aggregateId = parseUuidV7(input.aggregate_id);
  const initialState = requireState(input.initial_state);
  if (!checkedPolicy.creation.allowed_initial_states.includes(initialState)) {
    throw new AggregateTransitionRejectedError('STATE');
  }
  const attribution = validateAttribution(input, checkedPolicy.creation);
  const transitionId = createUuidV7();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO marketplace.aggregate_heads
         (aggregate_type, aggregate_id, version, state)
       VALUES ($1, $2, 1, $3)`,
      [checkedPolicy.aggregate_type, aggregateId, initialState],
    );
    if (apply) await apply(client, 1);
    await insertTransition(client, {
      aggregate_id: aggregateId,
      aggregate_type: checkedPolicy.aggregate_type,
      attribution,
      from_state: null,
      previous_version: 0,
      resulting_version: 1,
      to_state: initialState,
      transition_id: transitionId,
    });
    await client.query('COMMIT');
    return Object.freeze({
      aggregate_id: aggregateId,
      aggregate_type: checkedPolicy.aggregate_type,
      state: initialState,
      transition_id: transitionId,
      version: 1,
    });
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function transitionAggregate(
  pool: Pool,
  policy: AggregatePolicy,
  input: AttributionInput & {
    readonly aggregate_id: string;
    readonly expected_version: number;
    readonly to_state: string;
  },
  apply?: (client: PoolClient, resultingVersion: number) => Promise<void>,
): Promise<AggregateTransitionResult> {
  const checkedPolicy = defineAggregatePolicy(policy);
  const aggregateId = parseUuidV7(input.aggregate_id);
  const expectedVersion = requireExpectedVersion(input.expected_version);
  const toState = requireState(input.to_state);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query<{ state: string; version: number }>(
      `SELECT version, state
         FROM marketplace.aggregate_heads
        WHERE aggregate_type = $1 AND aggregate_id = $2`,
      [checkedPolicy.aggregate_type, aggregateId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new AggregateNotFoundError();
    if (current.version !== expectedVersion) {
      throw new AggregateVersionConflictError(expectedVersion, current.version, current.state);
    }
    const rule = checkedPolicy.transitions.find(
      (candidate) => candidate.from_state === current.state && candidate.to_state === toState,
    );
    if (!rule) throw new AggregateTransitionRejectedError('STATE');
    const attribution = validateAttribution(input, rule);
    const resultingVersion = expectedVersion + 1;
    const updated = await client.query(
      `UPDATE marketplace.aggregate_heads
          SET version = $3, state = $4, updated_at = clock_timestamp()
        WHERE aggregate_type = $1 AND aggregate_id = $2 AND version = $5`,
      [checkedPolicy.aggregate_type, aggregateId, resultingVersion, toState, expectedVersion],
    );
    if (updated.rowCount !== 1) {
      const winner = await client.query<{ state: string; version: number }>(
        `SELECT version, state
           FROM marketplace.aggregate_heads
          WHERE aggregate_type = $1 AND aggregate_id = $2`,
        [checkedPolicy.aggregate_type, aggregateId],
      );
      const winnerState = winner.rows[0];
      if (!winnerState) throw new AggregateNotFoundError();
      throw new AggregateVersionConflictError(
        expectedVersion,
        winnerState.version,
        winnerState.state,
      );
    }
    if (apply) await apply(client, resultingVersion);
    const transitionId = createUuidV7();
    await insertTransition(client, {
      aggregate_id: aggregateId,
      aggregate_type: checkedPolicy.aggregate_type,
      attribution,
      from_state: current.state,
      previous_version: expectedVersion,
      resulting_version: resultingVersion,
      to_state: toState,
      transition_id: transitionId,
    });
    await client.query('COMMIT');
    return Object.freeze({
      aggregate_id: aggregateId,
      aggregate_type: checkedPolicy.aggregate_type,
      state: toState,
      transition_id: transitionId,
      version: resultingVersion,
    });
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
