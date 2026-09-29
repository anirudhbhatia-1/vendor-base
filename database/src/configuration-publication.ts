import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool, PoolClient } from 'pg';
import { globalAdminCapabilities } from './admin-capabilities.js';
import { releaseServicePool, resolveServicePool } from './database-pool.js';
import { checkFinancialPolicy } from './financial-policy.js';
import {
  calculateCommissionAmount,
  calculateDistanceAmount,
  calculatePartnerOfferEarning,
  type FinancialPolicy,
} from './money-policy.js';
import { transaction as tx } from './transaction.js';
import {
  approveConfigurationVersion,
  createConfigurationDraft,
  createConfigurationRollbackDraft,
  scheduleConfigurationVersion,
  type ConfigurationScopeKind,
} from './versioned-configuration.js';

export class ConfigurationPublicationInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class ConfigurationPublicationNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
export class ConfigurationPublicationStateError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}
export class ConfigurationPublicationAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}

export type ConfigurationCategory =
  'FEES_COMMISSIONS_EARNINGS' | 'TIMERS' | 'LIMITS' | 'OPERATIONAL_RULES';

type Example = { readonly case: string; readonly before: string; readonly after: string };

type CatalogueEntry = {
  readonly key: string;
  readonly category: ConfigurationCategory;
  readonly title: string;
  /** A protected change is approved by someone who neither proposed nor validated it. */
  readonly protected: boolean;
  readonly value_type: 'INTEGER' | 'JSON';
  readonly scopes: readonly ConfigurationScopeKind[];
  readonly rule: string;
  readonly default_value: unknown;
  /** The problems with a proposed value; empty when it is one the consumer accepts. */
  readonly check: (value: unknown) => readonly string[];
  /** What the change does to worked cases, before and after. */
  readonly examples: (before: unknown, after: unknown) => readonly Example[];
};

function whole(label: string, min: number, max: number) {
  return (value: unknown): readonly string[] =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
      ? []
      : [`${label} must be a whole number from ${min} to ${max}`];
}

function minutes(seconds: unknown): string {
  if (typeof seconds !== 'number') return 'unset (the default)';
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

function secondsExamples(what: string) {
  return (before: unknown, after: unknown): readonly Example[] => [
    { case: what, before: minutes(before), after: minutes(after) },
  ];
}

function metresExamples(what: string) {
  return (before: unknown, after: unknown): readonly Example[] => [
    {
      case: what,
      before: typeof before === 'number' ? `${before} m` : 'unset (the default)',
      after: typeof after === 'number' ? `${after} m` : 'unset (the default)',
    },
  ];
}

function rupees(minor: number): string {
  return `₹${(minor / 100).toFixed(2)}`;
}

function policyOrNull(value: unknown): FinancialPolicy | null {
  try {
    return checkFinancialPolicy(value);
  } catch {
    return null;
  }
}

/**
 * Every setting an operator may change (11.6), with the rule its consumer
 * enforces, where it may be scoped, whether it is protected, and worked
 * examples of what a change does. A key outside this list cannot be drafted
 * here; a value the consumer would quietly replace with its default is
 * refused at draft and again at validation.
 */
export const CONFIGURATION_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
  {
    key: 'finance.financial_policy',
    category: 'FEES_COMMISSIONS_EARNINGS',
    title: 'Delivery fees, vendor commission and partner earnings',
    protected: true,
    value_type: 'JSON',
    scopes: ['GLOBAL'],
    rule: 'INR; twelve whole-number fields; commission at most 5,000 basis points',
    default_value: null,
    check: (value) => {
      try {
        const policy = checkFinancialPolicy(value);
        const issues: string[] = [];
        if (policy.commission_basis_points > 5_000) issues.push('Commission may not exceed 50%');
        if (policy.included_metres > policy.outer_route_metres)
          issues.push('Included distance may not exceed the delivery boundary');
        return issues;
      } catch (error) {
        return [error instanceof Error ? error.message : 'Not a financial policy'];
      }
    },
    examples: (before, after) => {
      const from = policyOrNull(before);
      const to = policyOrNull(after);
      const cases: Example[] = [];
      for (const basket of [20_000, 50_000, 100_000]) {
        cases.push({
          case: `Commission on a ${rupees(basket)} basket`,
          before: from
            ? rupees(calculateCommissionAmount(basket, from.commission_basis_points))
            : '—',
          after: to ? rupees(calculateCommissionAmount(basket, to.commission_basis_points)) : '—',
        });
      }
      for (const metres of [1_000, 3_000, 6_000]) {
        const fee = (policy: FinancialPolicy | null) =>
          policy && metres <= policy.outer_route_metres
            ? rupees(calculateDistanceAmount(metres, policy))
            : 'out of range';
        const earning = (policy: FinancialPolicy | null) =>
          policy && metres <= policy.outer_route_metres
            ? rupees(
                calculatePartnerOfferEarning({ route_metres: metres, package_count: 1 }, policy)
                  .total_minor,
              )
            : 'out of range';
        cases.push({
          case: `Delivery fee for ${metres / 1000} km`,
          before: fee(from),
          after: fee(to),
        });
        cases.push({
          case: `Partner earning for ${metres / 1000} km`,
          before: earning(from),
          after: earning(to),
        });
      }
      return cases;
    },
  },
  {
    key: 'finance.correction_approval',
    category: 'LIMITS',
    title: 'Correction amount one person may post',
    protected: true,
    value_type: 'JSON',
    scopes: ['GLOBAL'],
    rule: '{ single_approval_limit_minor: 0 to 10,000,000 }',
    default_value: { single_approval_limit_minor: 0 },
    check: (value) => {
      const limit = (value as { single_approval_limit_minor?: unknown } | null)
        ?.single_approval_limit_minor;
      return typeof limit === 'number' &&
        Number.isSafeInteger(limit) &&
        limit >= 0 &&
        limit <= 10_000_000
        ? []
        : ['single_approval_limit_minor must be a whole number of paise from 0 to 10,000,000'];
    },
    examples: (before, after) => {
      const read = (value: unknown) =>
        (value as { single_approval_limit_minor?: number } | null)?.single_approval_limit_minor ??
        0;
      return [500, 50_000].map((amount) => ({
        case: `A ${rupees(amount)} correction`,
        before: amount > read(before) ? 'needs a second person' : 'one person may post',
        after: amount > read(after) ? 'needs a second person' : 'one person may post',
      }));
    },
  },
  {
    key: 'vendor.accept_deadline_seconds',
    category: 'TIMERS',
    title: 'Time a shop has to accept an order',
    protected: false,
    value_type: 'INTEGER',
    scopes: ['GLOBAL'],
    rule: '60 to 1,800 seconds',
    default_value: 180,
    check: whole('The accept deadline', 60, 1_800),
    examples: secondsExamples('A shop has to accept a new order within'),
  },
  {
    key: 'assignment.offer_seconds',
    category: 'TIMERS',
    title: 'Time a partner has to take a delivery offer',
    protected: false,
    value_type: 'INTEGER',
    scopes: ['GLOBAL', 'ZONE'],
    rule: '5 to 300 seconds',
    default_value: 30,
    check: whole('The offer time', 5, 300),
    examples: secondsExamples('A delivery offer stays open for'),
  },
  {
    key: 'customer.decision_seconds',
    category: 'TIMERS',
    title: 'Time a customer has to answer a substitution or weight change',
    protected: false,
    value_type: 'INTEGER',
    scopes: ['GLOBAL'],
    rule: '60 to 3,600 seconds',
    default_value: 300,
    check: whole('The decision time', 60, 3_600),
    examples: secondsExamples('A customer has to answer a proposal within'),
  },
  {
    key: 'assignment.wait_leave_seconds',
    category: 'TIMERS',
    title: 'How long a partner waits at the door before they may leave',
    protected: false,
    value_type: 'INTEGER',
    scopes: ['GLOBAL', 'ZONE'],
    rule: '300 to 3,600 seconds',
    default_value: 600,
    check: whole('The wait', 300, 3_600),
    examples: secondsExamples('A partner may leave the door after'),
  },
  {
    key: 'assignment.offline_proof_grace_seconds',
    category: 'TIMERS',
    title: 'How long a proof captured offline may wait to be synced',
    protected: false,
    value_type: 'INTEGER',
    scopes: ['GLOBAL'],
    rule: '600 to 172,800 seconds',
    default_value: 86_400,
    check: whole('The offline grace', 600, 172_800),
    examples: secondsExamples('An offline proof must be synced within'),
  },
  {
    key: 'support.p2_staffed_ack_seconds',
    category: 'TIMERS',
    title: 'First response to a medium-severity support case',
    protected: false,
    value_type: 'INTEGER',
    scopes: ['GLOBAL'],
    rule: '60 to 604,800 seconds',
    default_value: 14_400,
    check: whole('The response time', 60, 604_800),
    examples: secondsExamples('A medium support case is answered within'),
  },
  {
    key: 'vendor.order_alert_escalation',
    category: 'TIMERS',
    title: 'When an unanswered new-order alert escalates, and how',
    protected: false,
    value_type: 'JSON',
    scopes: ['GLOBAL'],
    rule: '{ after_seconds: 15 to 600, channels: one or more of IN_APP, PUSH, SMS }',
    default_value: { after_seconds: 60, channels: ['PUSH', 'SMS'] },
    check: (value) => {
      const record = value as { after_seconds?: unknown; channels?: unknown } | null;
      const issues: string[] = [...whole('after_seconds', 15, 600)(record?.after_seconds)];
      const channels = record?.channels;
      if (
        !Array.isArray(channels) ||
        channels.length === 0 ||
        !channels.every((channel) => ['IN_APP', 'PUSH', 'SMS'].includes(String(channel)))
      )
        issues.push('channels must be one or more of IN_APP, PUSH, SMS');
      return issues;
    },
    examples: (before, after) => [
      {
        case: 'An unanswered new-order alert escalates after',
        before: minutes((before as { after_seconds?: number } | null)?.after_seconds),
        after: minutes((after as { after_seconds?: number } | null)?.after_seconds),
      },
    ],
  },
  {
    key: 'customer.cart_group_limit',
    category: 'LIMITS',
    title: 'Shops one basket may hold',
    protected: false,
    value_type: 'INTEGER',
    scopes: ['GLOBAL'],
    rule: '1 to 10',
    default_value: 3,
    check: whole('The shop limit', 1, 10),
    examples: (before, after) => [
      { case: 'Shops in one basket', before: String(before ?? 'default 3'), after: String(after) },
    ],
  },
  {
    key: 'customer.saved_address_limit',
    category: 'LIMITS',
    title: 'Addresses a customer may save',
    protected: false,
    value_type: 'INTEGER',
    scopes: ['GLOBAL'],
    rule: '1 to 50',
    default_value: 4,
    check: whole('The address limit', 1, 50),
    examples: (before, after) => [
      { case: 'Saved addresses', before: String(before ?? 'default 4'), after: String(after) },
    ],
  },
  {
    key: 'dispatch.offer_radius_metres',
    category: 'OPERATIONAL_RULES',
    title: 'How far from a shop partners are offered its deliveries',
    protected: false,
    value_type: 'INTEGER',
    scopes: ['GLOBAL', 'ZONE'],
    rule: '100 to 50,000 metres',
    default_value: 5_000,
    check: whole('The offer radius', 100, 50_000),
    examples: metresExamples('Partners are offered deliveries within'),
  },
  {
    key: 'assignment.arrival_radius_metres',
    category: 'OPERATIONAL_RULES',
    title: 'How close a partner must be for an arrival to be trusted',
    protected: true,
    value_type: 'INTEGER',
    scopes: ['GLOBAL', 'ZONE'],
    rule: '25 to 1,000 metres',
    default_value: 150,
    check: whole('The arrival radius', 25, 1_000),
    examples: metresExamples('An arrival is trusted within'),
  },
]);

/** The notice a protected change gives before it takes force. */
export const PROTECTED_NOTICE_MS = 60 * 60_000;
const PROPOSE = 'admin.configuration.propose';
const APPROVE = 'admin.configuration.approve';
const READ = 'admin.configuration.read';
const REASON = /^[A-Z][A-Z0-9_]{1,63}$/;

type VersionRow = {
  configuration_version_id: string;
  configuration_key: string;
  version_number: number;
  configuration_value: unknown;
  scope_kind: ConfigurationScopeKind;
  scope_reference: string;
  status: string;
  proposed_by: string;
  validated_by: string | null;
  approved_by: string | null;
  rollback_of_version_id: string | null;
  effective_from: Date | null;
  effective_until: Date | null;
  validation_report: Record<string, unknown> | null;
  closed_by: string | null;
  closing_reason_code: string | null;
  created_at: Date;
};

function entryFor(key: string): CatalogueEntry {
  const entry = CONFIGURATION_CATALOGUE.find((candidate) => candidate.key === key);
  if (!entry) {
    throw new ConfigurationPublicationInputError(
      `${key} is not a setting operators change here; see the catalogue`,
    );
  }
  return entry;
}

/**
 * Configuration approval and publication (11.6).
 *
 * The operator's path over the versioned configuration: a draft is only a
 * catalogued setting with a value its consumer accepts, in a scope it may
 * take; validating it re-checks the value and records the report the
 * approver reads -- the value in force now, the one proposed, worked
 * examples and the scope it touches; a protected change is approved by
 * someone who neither proposed nor validated it; a schedule starts now or
 * later, never in the past, and can be cancelled; a proposal can be
 * rejected; a rollback is a new version of an earlier value, not of the one
 * in force. Every step is on the version's lifecycle history.
 */
export class ConfigurationPublicationService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-configuration-publication',
      max: 4,
    });
  }

  async close() {
    await releaseServicePool(this.#pool);
  }

  /** The settings operators may change, with each one's value in force globally. */
  async catalogue(input: { readonly context: RequestContext; readonly now?: Date }) {
    const now = input.now ?? new Date();
    await this.#require(this.#pool, input.context, now, READ);
    const current = await this.#pool.query<{
      configuration_key: string;
      configuration_value: unknown;
    }>(
      `SELECT configuration_key, configuration_value FROM marketplace.configuration_versions
        WHERE configuration_key = ANY($1::text[]) AND scope_kind = 'GLOBAL'
          AND status IN ('ACTIVE','SUPERSEDED') AND effective_from <= $2
          AND (effective_until IS NULL OR effective_until > $2)`,
      [CONFIGURATION_CATALOGUE.map((entry) => entry.key), now],
    );
    const inForce = new Map(
      current.rows.map((row) => [row.configuration_key, row.configuration_value]),
    );
    return {
      settings: CONFIGURATION_CATALOGUE.map((entry) => ({
        key: entry.key,
        category: entry.category,
        title: entry.title,
        protected: entry.protected,
        value_type: entry.value_type,
        scopes: entry.scopes,
        rule: entry.rule,
        default_value: entry.default_value,
        global_value: inForce.get(entry.key) ?? null,
      })),
    };
  }

  /** Drafts a catalogued setting with a value its consumer accepts (requirement 1). */
  async draft(input: {
    readonly context: RequestContext;
    readonly configuration_key: string;
    readonly scope_kind: string;
    readonly scope_reference: string;
    readonly configuration_value: unknown;
    readonly reason_code: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const actor = await this.#require(this.#pool, input.context, now, PROPOSE);
    const entry = entryFor(input.configuration_key);
    if (!(entry.scopes as readonly string[]).includes(input.scope_kind)) {
      throw new ConfigurationPublicationInputError(
        `${entry.key} is set ${entry.scopes.join(' or ')}, not ${input.scope_kind}`,
      );
    }
    const issues = entry.check(input.configuration_value);
    if (issues.length > 0) throw new ConfigurationPublicationInputError(issues.join('; '));
    const reference = input.scope_kind === 'GLOBAL' ? 'global' : input.scope_reference;
    if (input.scope_kind === 'ZONE') {
      const zone = await this.#pool.query(
        `SELECT 1 FROM marketplace.vendor_service_zones WHERE service_zone_id::text = $1 AND lifecycle_state = 'ACTIVE'`,
        [reference],
      );
      if (zone.rows.length === 0)
        throw new ConfigurationPublicationNotFoundError('No such active zone');
    }
    const version = await createConfigurationDraft(this.#pool, {
      actor_id: actor,
      configuration_key: entry.key,
      configuration_kind: 'SETTING',
      configuration_value: input.configuration_value,
      correlation_id: input.context.correlation_id,
      reason_code: this.#reason(input.reason_code),
      request_id: input.context.request_id,
      scope: { kind: input.scope_kind as ConfigurationScopeKind, reference },
    });
    return { ...version, protected: entry.protected };
  }

  /**
   * What a version would change (requirement 2): the value in force now at
   * its scope, the one proposed, the fields that differ, worked examples,
   * the scope it touches, and anything wrong with it.
   */
  async preview(input: {
    readonly context: RequestContext;
    readonly configuration_version_id: UuidV7;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.#require(this.#pool, input.context, now, READ);
    const row = await this.#row(this.#pool, input.configuration_version_id);
    return this.#preview(this.#pool, row, now);
  }

  /** The version, its history, and what it changes. */
  async detail(input: {
    readonly context: RequestContext;
    readonly configuration_version_id: UuidV7;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.#require(this.#pool, input.context, now, READ);
    const row = await this.#row(this.#pool, input.configuration_version_id);
    const history = await this.#pool.query<{
      from_status: string | null;
      to_status: string;
      actor_id: string;
      reason_code: string;
      occurred_at: Date;
    }>(
      `SELECT from_status, to_status, actor_id, reason_code, occurred_at
         FROM marketplace.configuration_lifecycle_events WHERE configuration_version_id = $1
        ORDER BY occurred_at, event_id`,
      [row.configuration_version_id],
    );
    return {
      configuration_version_id: row.configuration_version_id,
      configuration_key: row.configuration_key,
      version_number: row.version_number,
      status: row.status,
      scope: { kind: row.scope_kind, reference: row.scope_reference },
      configuration_value: row.configuration_value,
      proposed_by: row.proposed_by,
      validated_by: row.validated_by,
      approved_by: row.approved_by,
      rollback_of_version_id: row.rollback_of_version_id,
      effective_from: row.effective_from?.toISOString() ?? null,
      effective_until: row.effective_until?.toISOString() ?? null,
      closing_reason_code: row.closing_reason_code,
      validation_report: row.validation_report,
      preview: await this.#preview(this.#pool, row, now),
      history: history.rows.map((event) => ({
        ...event,
        occurred_at: event.occurred_at.toISOString(),
      })),
    };
  }

  /** Validates a draft: re-checks it and records the report its approver reads. */
  async validate(input: {
    readonly context: RequestContext;
    readonly configuration_version_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const reason = this.#reason(input.reason_code);
    return tx(this.#pool, async (client) => {
      const actor = await this.#require(client, input.context, now, PROPOSE);
      const row = await this.#row(client, input.configuration_version_id, true);
      if (row.status !== 'DRAFT')
        throw new ConfigurationPublicationStateError('Only a draft is validated');
      const report = await this.#preview(client, row, now);
      if (report.issues.length > 0) {
        throw new ConfigurationPublicationInputError(report.issues.join('; '));
      }
      await client.query(
        `UPDATE marketplace.configuration_versions
            SET status = 'VALIDATED', validated_by = $2, validated_at = $3, validation_report = $4,
                updated_at = $3
          WHERE configuration_version_id = $1 AND status = 'DRAFT'`,
        [row.configuration_version_id, actor, now, JSON.stringify(report)],
      );
      await this.#event(
        client,
        row.configuration_version_id,
        'DRAFT',
        'VALIDATED',
        actor,
        reason,
        input.context,
      );
      return {
        configuration_version_id: row.configuration_version_id,
        status: 'VALIDATED',
        report,
      };
    });
  }

  /** Approves a validated version (requirement 3). */
  async approve(input: {
    readonly context: RequestContext;
    readonly configuration_version_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const actor = await this.#require(this.#pool, input.context, now, APPROVE);
    const row = await this.#row(this.#pool, input.configuration_version_id);
    const entry = entryFor(row.configuration_key);
    if (row.status !== 'VALIDATED')
      throw new ConfigurationPublicationStateError('Only a validated version is approved');
    if (row.proposed_by === actor) {
      throw new ConfigurationPublicationStateError(
        'A change is approved by someone who did not propose it',
      );
    }
    if (entry.protected && row.validated_by === actor) {
      throw new ConfigurationPublicationStateError(
        'A protected change is approved by someone who neither proposed nor validated it',
      );
    }
    return approveConfigurationVersion(this.#pool, {
      actor_id: actor,
      configuration_version_id: row.configuration_version_id,
      reason_code: this.#reason(input.reason_code),
      request_id: input.context.request_id,
    });
  }

  /** Schedules an approved version to start now or later, never in the past (requirement 4). */
  async schedule(input: {
    readonly context: RequestContext;
    readonly configuration_version_id: UuidV7;
    readonly effective_from: Date;
    readonly effective_until?: Date;
    readonly reason_code: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const actor = await this.#require(this.#pool, input.context, now, PROPOSE);
    if (input.effective_from.getTime() < now.getTime()) {
      throw new ConfigurationPublicationInputError(
        'A change starts now or later; starting it in the past would rewrite what was in force',
      );
    }
    const row = await this.#row(this.#pool, input.configuration_version_id);
    // A protected change (money, trusted arrivals) is announced before it
    // takes force, so the people it touches can see it coming.
    if (
      entryFor(row.configuration_key).protected &&
      input.effective_from.getTime() < now.getTime() + PROTECTED_NOTICE_MS
    ) {
      throw new ConfigurationPublicationInputError(
        'A protected change takes force at least an hour after it is scheduled',
      );
    }
    if (row.status !== 'APPROVED')
      throw new ConfigurationPublicationStateError('Only an approved version is scheduled');
    return scheduleConfigurationVersion(this.#pool, {
      actor_id: actor,
      configuration_version_id: row.configuration_version_id,
      effective_from: input.effective_from,
      ...(input.effective_until ? { effective_until: input.effective_until } : {}),
      reason_code: this.#reason(input.reason_code),
      request_id: input.context.request_id,
    });
  }

  /** Turns a proposal down before it is scheduled. */
  async reject(input: {
    readonly context: RequestContext;
    readonly configuration_version_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }) {
    return this.#close(input, ['DRAFT', 'VALIDATED', 'APPROVED'], 'REJECTED', APPROVE);
  }

  /** Calls off a scheduled version before it takes force. */
  async cancel(input: {
    readonly context: RequestContext;
    readonly configuration_version_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }) {
    return this.#close(input, ['SCHEDULED'], 'CANCELLED', PROPOSE);
  }

  /** Drafts a return to an earlier value as a new version (requirement 5). */
  async rollback(input: {
    readonly context: RequestContext;
    readonly target_version_id: UuidV7;
    readonly reason_code: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const actor = await this.#require(this.#pool, input.context, now, PROPOSE);
    const target = await this.#row(this.#pool, input.target_version_id);
    entryFor(target.configuration_key);
    const inForce = await this.#inForce(this.#pool, target, now);
    if (inForce?.configuration_version_id === target.configuration_version_id) {
      throw new ConfigurationPublicationStateError(
        'That version is the one in force; roll back to an earlier one',
      );
    }
    return createConfigurationRollbackDraft(this.#pool, {
      actor_id: actor,
      correlation_id: input.context.correlation_id,
      reason_code: this.#reason(input.reason_code),
      request_id: input.context.request_id,
      target_version_id: target.configuration_version_id,
    });
  }

  // -----------------------------------------------------------------------

  async #close(
    input: {
      readonly context: RequestContext;
      readonly configuration_version_id: UuidV7;
      readonly reason_code: string;
      readonly now?: Date;
    },
    from: readonly string[],
    to: 'REJECTED' | 'CANCELLED',
    capability: string,
  ) {
    const now = input.now ?? new Date();
    const reason = this.#reason(input.reason_code);
    return tx(this.#pool, async (client) => {
      const actor = await this.#require(client, input.context, now, capability);
      const row = await this.#row(client, input.configuration_version_id, true);
      if (!from.includes(row.status)) {
        throw new ConfigurationPublicationStateError(
          `A ${row.status.toLowerCase()} version cannot be ${to.toLowerCase()}`,
        );
      }
      await client.query(
        `UPDATE marketplace.configuration_versions
            SET status = $2, closed_by = $3, closed_at = $4, closing_reason_code = $5, updated_at = $4
          WHERE configuration_version_id = $1 AND status = $6`,
        [row.configuration_version_id, to, actor, now, reason, row.status],
      );
      await this.#event(
        client,
        row.configuration_version_id,
        row.status,
        to,
        actor,
        reason,
        input.context,
      );
      return { configuration_version_id: row.configuration_version_id, status: to };
    });
  }

  async #preview(queryable: Pick<Pool | PoolClient, 'query'>, row: VersionRow, now: Date) {
    const entry = CONFIGURATION_CATALOGUE.find(
      (candidate) => candidate.key === row.configuration_key,
    );
    const issues: string[] = entry
      ? [...entry.check(row.configuration_value)]
      : [`${row.configuration_key} is not in the catalogue`];
    const current = await this.#inForce(queryable, row, now);
    const before = current?.configuration_value ?? entry?.default_value ?? null;
    const changed =
      row.configuration_value !== null &&
      typeof row.configuration_value === 'object' &&
      before &&
      typeof before === 'object'
        ? Object.keys({ ...(before as object), ...(row.configuration_value as object) }).filter(
            (field) =>
              JSON.stringify((before as Record<string, unknown>)[field]) !==
              JSON.stringify((row.configuration_value as Record<string, unknown>)[field]),
          )
        : JSON.stringify(before) === JSON.stringify(row.configuration_value)
          ? []
          : ['value'];
    if (changed.length === 0) issues.push('The proposed value is the one already in force');
    const affected = await queryable.query<{
      locations: string;
      open_orders: string;
      partners: string;
    }>(
      row.scope_kind === 'ZONE'
        ? `SELECT count(DISTINCT z.vendor_location_id)::text AS locations,
                  (SELECT count(*)::text FROM marketplace.vendor_orders o
                    JOIN marketplace.vendor_service_zones zz ON zz.vendor_location_id = o.vendor_location_id
                   WHERE zz.service_zone_id::text = $1
                     AND o.lifecycle_state NOT IN ('DELIVERED','RETURNED','CANCELLED','EXPIRED')) AS open_orders,
                  (SELECT count(*)::text FROM marketplace.partner_availability WHERE availability_state = 'ONLINE') AS partners
             FROM marketplace.vendor_service_zones z
            WHERE z.service_zone_id::text = $1 AND z.lifecycle_state = 'ACTIVE'`
        : `SELECT (SELECT count(*)::text FROM marketplace.vendor_locations WHERE lifecycle_state = 'ACTIVE' AND $1::text IS NOT NULL) AS locations,
                  (SELECT count(*)::text FROM marketplace.vendor_orders
                    WHERE lifecycle_state NOT IN ('DELIVERED','RETURNED','CANCELLED','EXPIRED')) AS open_orders,
                  (SELECT count(*)::text FROM marketplace.partner_availability WHERE availability_state = 'ONLINE') AS partners`,
      [row.scope_reference],
    );
    const counts = affected.rows[0];
    return {
      configuration_key: row.configuration_key,
      title: entry?.title ?? row.configuration_key,
      category: entry?.category ?? null,
      protected: entry?.protected ?? true,
      rule: entry?.rule ?? null,
      scope: { kind: row.scope_kind, reference: row.scope_reference },
      in_force: current
        ? {
            configuration_version_id: current.configuration_version_id,
            version_number: current.version_number,
            value: current.configuration_value,
          }
        : {
            configuration_version_id: null,
            version_number: null,
            value: entry?.default_value ?? null,
            is_default: true,
          },
      proposed: row.configuration_value,
      changed_fields: changed,
      examples: entry ? entry.examples(before, row.configuration_value) : [],
      affected_scope: {
        vendor_locations: Number(counts?.locations ?? 0),
        open_orders: Number(counts?.open_orders ?? 0),
        partners_online: Number(counts?.partners ?? 0),
        note: 'Open orders keep the values they were given; a change applies to what starts after it takes force.',
      },
      issues,
      previewed_at: now.toISOString(),
    };
  }

  async #inForce(queryable: Pick<Pool | PoolClient, 'query'>, row: VersionRow, now: Date) {
    const found = await queryable.query<VersionRow>(
      `SELECT * FROM marketplace.configuration_versions
        WHERE configuration_key = $1 AND scope_kind = $2 AND scope_reference = $3
          AND status IN ('ACTIVE','SUPERSEDED') AND effective_from <= $4
          AND (effective_until IS NULL OR effective_until > $4)
        ORDER BY effective_from DESC LIMIT 1`,
      [row.configuration_key, row.scope_kind, row.scope_reference, now],
    );
    return found.rows[0] ?? null;
  }

  async #row(
    queryable: Pick<Pool | PoolClient, 'query'>,
    id: UuidV7,
    lock = false,
  ): Promise<VersionRow> {
    const found = await queryable.query<VersionRow>(
      `SELECT * FROM marketplace.configuration_versions WHERE configuration_version_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    const row = found.rows[0];
    if (!row) throw new ConfigurationPublicationNotFoundError('No such configuration version');
    return row;
  }

  async #event(
    client: PoolClient,
    id: string,
    from: string,
    to: string,
    actor: string,
    reason: string,
    context: RequestContext,
  ) {
    await client.query(
      `INSERT INTO marketplace.configuration_lifecycle_events
         (event_id, configuration_version_id, from_status, to_status, actor_id, request_id, reason_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [createUuidV7(), id, from, to, actor, parseRequestId(context.request_id), reason],
    );
  }

  #reason(value: string): string {
    if (!REASON.test(value))
      throw new ConfigurationPublicationInputError('Reason code must be shouting-snake-case');
    return value;
  }

  async #require(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    now: Date,
    capability: string,
  ): Promise<UuidV7> {
    if (context.actor?.actor_kind !== 'admin')
      throw new ConfigurationPublicationAuthorizationError();
    const held = await globalAdminCapabilities(queryable, context.actor.actor_id, now);
    if (!held.has(capability)) throw new ConfigurationPublicationAuthorizationError();
    parseUuidV7(context.correlation_id);
    return context.actor.actor_id;
  }
}
