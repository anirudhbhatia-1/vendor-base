import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import { transaction } from './transaction.js';

export type PublicationState =
  | 'APPROVED'
  | 'CHANGES_REQUIRED'
  | 'DRAFT'
  | 'PAUSED'
  | 'PENDING_APPROVAL'
  | 'PUBLISHED'
  | 'UNPUBLISHED';

export type PublicationCheckKey =
  | 'DOCUMENTS_CURRENT'
  | 'FULFILMENT_APPROVED'
  | 'ONBOARDING_APPROVED'
  | 'OPERATING_HOURS_CONFIGURED'
  | 'PROFILE_COMPLETE'
  | 'SERVICE_ZONE_ACTIVE';

export interface PublicationCheck {
  readonly key: PublicationCheckKey;
  readonly ready: boolean;
  readonly reason: string;
}

export interface PublicationSummary {
  readonly business_name: string;
  readonly checks: readonly PublicationCheck[];
  readonly lifecycle_state: PublicationState;
  readonly location_name: string;
  readonly publication_case_id: UuidV7;
  readonly ready: boolean;
  readonly updated_at: string;
  readonly vendor_id: UuidV7;
  readonly vendor_location_id: UuidV7;
  readonly version: number;
}

export class VendorPublicationInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class VendorPublicationNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
export class VendorPublicationConflictError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
}
export class VendorPublicationVersionError extends Error {
  readonly code = 'VERSION_CONFLICT';
}
export class VendorPublicationAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}
export class VendorPublicationIncompleteError extends Error {
  readonly code = 'UNPROCESSABLE_ENTITY';
  readonly missing_checks: readonly PublicationCheckKey[];
  constructor(checks: readonly PublicationCheck[]) {
    super('Vendor publication readiness is incomplete');
    this.missing_checks = checks.filter((check) => !check.ready).map((check) => check.key);
  }
}

interface CaseRow {
  approved_by_user_id: string | null;
  business_name: string;
  current_note: string;
  current_reason_code: string;
  lifecycle_state: PublicationState;
  location_name: string;
  onboarding_case_id: string;
  proposed_by_user_id: string;
  publication_case_id: string;
  readiness_snapshot: unknown;
  updated_at: Date;
  vendor_id: string;
  vendor_location_id: string;
  version: number;
}

const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const EVIDENCE = /^[A-Z0-9][A-Z0-9._:/-]{5,127}$/;

function admin(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'admin') {
    throw new VendorPublicationAuthorizationError('An authenticated admin is required');
  }
  return context.actor.actor_id;
}

function reason(value: string): string {
  if (!REASON.test(value)) throw new VendorPublicationInputError('Reason code is invalid');
  return value;
}

function note(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 3 || normalized.length > 1000) {
    throw new VendorPublicationInputError('Publication note must contain 3 to 1000 characters');
  }
  return normalized;
}

function evidence(value: string): string {
  if (!EVIDENCE.test(value)) {
    throw new VendorPublicationInputError('Evidence reference is invalid');
  }
  return value;
}

function contextIds(context: RequestContext) {
  return {
    correlationId: parseUuidV7(context.correlation_id),
    requestId: parseRequestId(context.request_id),
  };
}

function parseChecks(value: unknown): readonly PublicationCheck[] {
  if (!value || typeof value !== 'object' || !('checks' in value) || !Array.isArray(value.checks)) {
    return [];
  }
  return value.checks.filter(
    (item): item is PublicationCheck =>
      typeof item === 'object' &&
      item !== null &&
      'key' in item &&
      typeof item.key === 'string' &&
      'ready' in item &&
      typeof item.ready === 'boolean' &&
      'reason' in item &&
      typeof item.reason === 'string',
  );
}

function readinessSnapshot(checks: readonly PublicationCheck[]): string {
  return JSON.stringify({ checks });
}

async function readiness(
  client: PoolClient,
  ids: { readonly onboarding_case_id: string; readonly vendor_location_id: string },
): Promise<readonly PublicationCheck[]> {
  const result = await client.query<{
    documents_current: boolean;
    fulfilment_count: string;
    hours_count: string;
    onboarding_state: string;
    profile_complete: boolean;
    zone_count: string;
  }>(
    `SELECT onboarding.lifecycle_state AS onboarding_state,
       (vendor.profile_description IS NOT NULL AND location.profile_description IS NOT NULL) AS profile_complete,
       (SELECT count(*)::text FROM marketplace.vendor_location_operating_hours hours
         WHERE hours.vendor_location_id=location.vendor_location_id) AS hours_count,
       (SELECT count(*)::text FROM marketplace.vendor_service_zones zone
         WHERE zone.vendor_location_id=location.vendor_location_id AND zone.lifecycle_state='ACTIVE') AS zone_count,
       (SELECT count(*)::text FROM marketplace.vendor_location_fulfilment_modes mode
         WHERE mode.vendor_location_id=location.vendor_location_id AND mode.approval_state='APPROVED') AS fulfilment_count,
       NOT EXISTS (
         SELECT 1 FROM (
           SELECT DISTINCT ON (document_kind) document_kind, lifecycle_state, expires_on, grace_until
             FROM marketplace.vendor_verification_documents
            WHERE onboarding_case_id=onboarding.onboarding_case_id
              AND affected_capability='VENDOR_PUBLICATION'
            ORDER BY document_kind, document_version DESC
         ) current_document
         WHERE current_document.lifecycle_state NOT IN ('APPROVED','EXPIRING','GRACE')
            OR (current_document.expires_on IS NOT NULL
                AND current_document.expires_on < CURRENT_DATE
                AND (current_document.grace_until IS NULL OR current_document.grace_until < CURRENT_DATE))
       ) AND (
         SELECT count(*) FROM (
           SELECT DISTINCT ON (document_kind) document_kind
             FROM marketplace.vendor_verification_documents
            WHERE onboarding_case_id=onboarding.onboarding_case_id
              AND affected_capability='VENDOR_PUBLICATION'
            ORDER BY document_kind, document_version DESC
         ) required_documents
       ) >= 2 AS documents_current
     FROM marketplace.vendor_onboarding_cases onboarding
     JOIN marketplace.vendor_locations location
       ON location.vendor_location_id=$2 AND location.vendor_id=onboarding.vendor_id
     JOIN marketplace.vendors vendor ON vendor.vendor_id=location.vendor_id
    WHERE onboarding.onboarding_case_id=$1`,
    [ids.onboarding_case_id, ids.vendor_location_id],
  );
  const row = result.rows[0];
  if (!row) throw new VendorPublicationNotFoundError('Publication resources were not found');
  return Object.freeze([
    {
      key: 'ONBOARDING_APPROVED',
      ready: row.onboarding_state === 'APPROVED',
      reason:
        row.onboarding_state === 'APPROVED'
          ? 'Onboarding approved'
          : 'Onboarding approval required',
    },
    {
      key: 'PROFILE_COMPLETE',
      ready: row.profile_complete,
      reason: row.profile_complete
        ? 'Vendor and location profiles complete'
        : 'Vendor and location descriptions required',
    },
    {
      key: 'OPERATING_HOURS_CONFIGURED',
      ready: Number(row.hours_count) > 0,
      reason:
        Number(row.hours_count) > 0 ? 'Operating hours configured' : 'Operating hours required',
    },
    {
      key: 'SERVICE_ZONE_ACTIVE',
      ready: Number(row.zone_count) > 0,
      reason:
        Number(row.zone_count) > 0
          ? 'Active service zone configured'
          : 'Active service zone required',
    },
    {
      key: 'FULFILMENT_APPROVED',
      ready: Number(row.fulfilment_count) > 0,
      reason:
        Number(row.fulfilment_count) > 0
          ? 'Fulfilment method approved'
          : 'Approved fulfilment method required',
    },
    {
      key: 'DOCUMENTS_CURRENT',
      ready: row.documents_current,
      reason: row.documents_current
        ? 'Publication documents current'
        : 'Current approved publication documents required',
    },
  ] satisfies readonly PublicationCheck[]);
}

async function lockCase(client: PoolClient, caseId: UuidV7, expectedVersion: number) {
  const result = await client.query<CaseRow>(
    `SELECT publication.*, vendor.business_name, location.location_name
       FROM marketplace.vendor_publication_cases publication
       JOIN marketplace.vendors vendor USING (vendor_id)
       JOIN marketplace.vendor_locations location USING (vendor_location_id)
      WHERE publication_case_id=$1 FOR UPDATE OF publication`,
    [caseId],
  );
  const row = result.rows[0];
  if (!row) throw new VendorPublicationNotFoundError('Publication case was not found');
  if (!Number.isInteger(expectedVersion) || row.version !== expectedVersion) {
    throw new VendorPublicationVersionError('Publication case version is stale');
  }
  return row;
}

async function appendEvent(
  client: PoolClient,
  input: {
    readonly actor: UuidV7;
    readonly case_id: UuidV7;
    readonly context: RequestContext;
    readonly event_type: string;
    readonly evidence_reference?: string;
    readonly note: string;
    readonly previous_state: PublicationState | null;
    readonly readiness: readonly PublicationCheck[];
    readonly reason_code: string;
    readonly resulting_state: PublicationState;
    readonly version: number;
  },
) {
  const ids = contextIds(input.context);
  await client.query(
    `INSERT INTO marketplace.vendor_publication_events
      (publication_event_id, publication_case_id, case_version, event_type, previous_state,
       resulting_state, actor_user_id, reason_code, note, evidence_reference,
       readiness_snapshot, request_id, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)`,
    [
      createUuidV7(),
      input.case_id,
      input.version,
      input.event_type,
      input.previous_state,
      input.resulting_state,
      input.actor,
      input.reason_code,
      input.note,
      input.evidence_reference ?? null,
      readinessSnapshot(input.readiness),
      ids.requestId,
      ids.correlationId,
    ],
  );
}

function summary(row: CaseRow): PublicationSummary {
  const checks = parseChecks(row.readiness_snapshot);
  return Object.freeze({
    business_name: row.business_name,
    checks,
    lifecycle_state: row.lifecycle_state,
    location_name: row.location_name,
    publication_case_id: parseUuidV7(row.publication_case_id),
    ready: checks.length === 6 && checks.every((check) => check.ready),
    updated_at: row.updated_at.toISOString(),
    vendor_id: parseUuidV7(row.vendor_id),
    vendor_location_id: parseUuidV7(row.vendor_location_id),
    version: row.version,
  });
}

export class VendorPublicationService {
  readonly #pool: Pool;
  constructor(input: { readonly connection_string: string }) {
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-vendor-publication',
      connectionString: input.connection_string,
      connectionTimeoutMillis: 5_000,
      max: 8,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }
  async close() {
    await this.#pool.end();
  }

  async create(input: { readonly context: RequestContext; readonly onboarding_case_id: UuidV7 }) {
    const actor = admin(input.context);
    return transaction(this.#pool, async (client) => {
      const source = await client.query<{
        onboarding_case_id: string;
        vendor_id: string;
        vendor_location_id: string;
      }>(
        `SELECT onboarding_case_id, vendor_id, vendor_location_id
           FROM marketplace.vendor_onboarding_cases
          WHERE onboarding_case_id=$1 AND lifecycle_state='APPROVED'
            AND vendor_id IS NOT NULL AND vendor_location_id IS NOT NULL FOR SHARE`,
        [input.onboarding_case_id],
      );
      const row = source.rows[0];
      if (!row) throw new VendorPublicationConflictError('Approved onboarding is required');
      const caseId = createUuidV7();
      const checks = await readiness(client, row);
      const ids = contextIds(input.context);
      await client.query(
        `INSERT INTO marketplace.vendor_publication_cases
          (publication_case_id, onboarding_case_id, vendor_id, vendor_location_id,
           readiness_snapshot, proposed_by_user_id, current_reason_code, current_note,
           request_id, correlation_id)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,'PUBLICATION_DRAFT_CREATED',
                 'Synthetic publication draft created.',$7,$8)`,
        [
          caseId,
          row.onboarding_case_id,
          row.vendor_id,
          row.vendor_location_id,
          readinessSnapshot(checks),
          actor,
          ids.requestId,
          ids.correlationId,
        ],
      );
      await appendEvent(client, {
        actor,
        case_id: caseId,
        context: input.context,
        event_type: 'CREATED',
        note: 'Synthetic publication draft created.',
        previous_state: null,
        readiness: checks,
        reason_code: 'PUBLICATION_DRAFT_CREATED',
        resulting_state: 'DRAFT',
        version: 1,
      });
      return caseId;
    });
  }

  async list(input: { readonly context: RequestContext; readonly state?: PublicationState }) {
    admin(input.context);
    const values: unknown[] = [];
    const where = input.state
      ? (values.push(input.state), 'WHERE publication.lifecycle_state=$1')
      : '';
    const result = await this.#pool.query<CaseRow>(
      `SELECT publication.*, vendor.business_name, location.location_name
         FROM marketplace.vendor_publication_cases publication
         JOIN marketplace.vendors vendor USING (vendor_id)
         JOIN marketplace.vendor_locations location USING (vendor_location_id)
         ${where} ORDER BY publication.updated_at DESC, publication.publication_case_id LIMIT 100`,
      values,
    );
    return Object.freeze(result.rows.map(summary));
  }

  async get(input: { readonly context: RequestContext; readonly publication_case_id: UuidV7 }) {
    admin(input.context);
    const result = await this.#pool.query<CaseRow>(
      `SELECT publication.*, vendor.business_name, location.location_name
         FROM marketplace.vendor_publication_cases publication
         JOIN marketplace.vendors vendor USING (vendor_id)
         JOIN marketplace.vendor_locations location USING (vendor_location_id)
        WHERE publication_case_id=$1`,
      [input.publication_case_id],
    );
    const row = result.rows[0];
    if (!row) throw new VendorPublicationNotFoundError('Publication case was not found');
    return summary(row);
  }

  async evaluate(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly publication_case_id: UuidV7;
  }) {
    const actor = admin(input.context);
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.publication_case_id, input.expected_version);
      const checks = await readiness(client, row);
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_publication_cases SET readiness_snapshot=$2::jsonb, version=$3, updated_at=clock_timestamp() WHERE publication_case_id=$1`,
        [input.publication_case_id, readinessSnapshot(checks), version],
      );
      await appendEvent(client, {
        actor,
        case_id: input.publication_case_id,
        context: input.context,
        event_type: 'READINESS_EVALUATED',
        note: 'Publication readiness evaluated.',
        previous_state: row.lifecycle_state,
        readiness: checks,
        reason_code: 'PUBLICATION_READINESS_EVALUATED',
        resulting_state: row.lifecycle_state,
        version,
      });
      return { checks, ready: checks.every((check) => check.ready), version };
    });
  }

  async submit(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly note: string;
    readonly publication_case_id: UuidV7;
    readonly reason_code: string;
  }) {
    const actor = admin(input.context);
    const safeNote = note(input.note);
    const safeReason = reason(input.reason_code);
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.publication_case_id, input.expected_version);
      if (!['DRAFT', 'CHANGES_REQUIRED'].includes(row.lifecycle_state))
        throw new VendorPublicationConflictError('Publication case cannot be submitted');
      const checks = await readiness(client, row);
      if (!checks.every((check) => check.ready)) throw new VendorPublicationIncompleteError(checks);
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_publication_cases SET lifecycle_state='PENDING_APPROVAL', readiness_snapshot=$2::jsonb, proposed_by_user_id=$3, current_reason_code=$4, current_note=$5, version=$6, updated_at=clock_timestamp() WHERE publication_case_id=$1`,
        [
          input.publication_case_id,
          readinessSnapshot(checks),
          actor,
          safeReason,
          safeNote,
          version,
        ],
      );
      await appendEvent(client, {
        actor,
        case_id: input.publication_case_id,
        context: input.context,
        event_type: 'SUBMITTED',
        note: safeNote,
        previous_state: row.lifecycle_state,
        readiness: checks,
        reason_code: safeReason,
        resulting_state: 'PENDING_APPROVAL',
        version,
      });
      return version;
    });
  }

  async decide(input: {
    readonly context: RequestContext;
    readonly decision: 'APPROVED' | 'CHANGES_REQUIRED';
    readonly evidence_reference: string;
    readonly expected_version: number;
    readonly note: string;
    readonly publication_case_id: UuidV7;
    readonly reason_code: string;
  }) {
    const actor = admin(input.context);
    const safeNote = note(input.note);
    const safeReason = reason(input.reason_code);
    const safeEvidence = evidence(input.evidence_reference);
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.publication_case_id, input.expected_version);
      if (row.lifecycle_state !== 'PENDING_APPROVAL')
        throw new VendorPublicationConflictError('Publication case is not pending approval');
      if (row.proposed_by_user_id === actor)
        throw new VendorPublicationAuthorizationError(
          'Publication proposer cannot approve the same case',
        );
      const checks = await readiness(client, row);
      if (input.decision === 'APPROVED' && !checks.every((check) => check.ready))
        throw new VendorPublicationIncompleteError(checks);
      const version = row.version + 1;
      const approved = input.decision === 'APPROVED';
      await client.query(
        `UPDATE marketplace.vendor_publication_cases SET lifecycle_state=$2, readiness_snapshot=$3::jsonb, approved_by_user_id=$4, approved_at=$5, current_reason_code=$6, current_note=$7, version=$8, updated_at=clock_timestamp() WHERE publication_case_id=$1`,
        [
          input.publication_case_id,
          input.decision,
          readinessSnapshot(checks),
          approved ? actor : null,
          approved ? new Date() : null,
          safeReason,
          safeNote,
          version,
        ],
      );
      await appendEvent(client, {
        actor,
        case_id: input.publication_case_id,
        context: input.context,
        event_type: approved ? 'APPROVED' : 'CHANGES_REQUESTED',
        evidence_reference: safeEvidence,
        note: safeNote,
        previous_state: row.lifecycle_state,
        readiness: checks,
        reason_code: safeReason,
        resulting_state: input.decision,
        version,
      });
      return version;
    });
  }

  async publish(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly note: string;
    readonly publication_case_id: UuidV7;
    readonly reason_code: string;
  }) {
    return this.#operate({
      ...input,
      event: 'PUBLISHED',
      from: ['APPROVED', 'PAUSED'],
      to: 'PUBLISHED',
    });
  }
  async pause(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly note: string;
    readonly publication_case_id: UuidV7;
    readonly reason_code: string;
  }) {
    return this.#operate({ ...input, event: 'PAUSED', from: ['PUBLISHED'], to: 'PAUSED' });
  }
  async unpublish(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly note: string;
    readonly publication_case_id: UuidV7;
    readonly reason_code: string;
  }) {
    return this.#operate({
      ...input,
      event: 'UNPUBLISHED',
      from: ['PUBLISHED', 'PAUSED'],
      to: 'UNPUBLISHED',
    });
  }

  /**
   * Restores an unpublished location straight back to PUBLISHED, re-checking
   * readiness the same way publish() does. The resulting event is recorded
   * with event_type PUBLISHED and previous_state UNPUBLISHED, so the audit
   * trail already distinguishes a restore from a first publish without a new
   * event-type value.
   */
  async restore(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly note: string;
    readonly publication_case_id: UuidV7;
    readonly reason_code: string;
  }) {
    return this.#operate({
      ...input,
      event: 'PUBLISHED',
      from: ['UNPUBLISHED'],
      to: 'PUBLISHED',
    });
  }

  /**
   * Impact preview for pause/unpublish/restore: how many currently active
   * shopping-cart groups reference this location right now. Informational
   * only - it never blocks the transition, and cart state is unaffected by
   * this call; the customer's own revalidate() call is what later resolves
   * the impact this surfaces.
   */
  async impact(input: {
    readonly context: RequestContext;
    readonly publication_case_id: UuidV7;
  }): Promise<{ readonly active_cart_groups: number; readonly active_products: number }> {
    admin(input.context);
    const result = await this.#pool.query<{
      vendor_location_id: string;
    }>(
      'SELECT vendor_location_id FROM marketplace.vendor_publication_cases WHERE publication_case_id=$1',
      [input.publication_case_id],
    );
    const locationId = result.rows[0]?.vendor_location_id;
    if (!locationId) throw new VendorPublicationNotFoundError();
    const counts = await this.#pool.query<{ active_cart_groups: string; active_products: string }>(
      `SELECT
         (SELECT count(*)::text FROM marketplace.cart_vendor_groups
           WHERE vendor_location_id=$1 AND lifecycle_state='ACTIVE') AS active_cart_groups,
         (SELECT count(*)::text FROM marketplace.catalogue_products
           WHERE vendor_location_id=$1 AND lifecycle_state='ACTIVE') AS active_products`,
      [locationId],
    );
    return Object.freeze({
      active_cart_groups: Number(counts.rows[0]?.active_cart_groups ?? '0'),
      active_products: Number(counts.rows[0]?.active_products ?? '0'),
    });
  }

  async #operate(input: {
    readonly context: RequestContext;
    readonly event: 'PAUSED' | 'PUBLISHED' | 'UNPUBLISHED';
    readonly expected_version: number;
    readonly from: readonly PublicationState[];
    readonly note: string;
    readonly publication_case_id: UuidV7;
    readonly reason_code: string;
    readonly to: PublicationState;
  }) {
    const actor = admin(input.context);
    const safeNote = note(input.note);
    const safeReason = reason(input.reason_code);
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.publication_case_id, input.expected_version);
      if (!input.from.includes(row.lifecycle_state))
        throw new VendorPublicationConflictError(`Publication case cannot become ${input.to}`);
      const checks = await readiness(client, row);
      if (input.to === 'PUBLISHED' && !checks.every((check) => check.ready))
        throw new VendorPublicationIncompleteError(checks);
      await this.#transitionNetwork(client, row, input.to, actor, safeReason, input.context);
      const version = row.version + 1;
      const timestampColumn =
        input.to === 'PUBLISHED'
          ? 'published_at'
          : input.to === 'PAUSED'
            ? 'paused_at'
            : 'unpublished_at';
      await client.query(
        `UPDATE marketplace.vendor_publication_cases SET lifecycle_state=$2, readiness_snapshot=$3::jsonb, current_reason_code=$4, current_note=$5, version=$6, ${timestampColumn}=clock_timestamp(), updated_at=clock_timestamp() WHERE publication_case_id=$1`,
        [
          input.publication_case_id,
          input.to,
          readinessSnapshot(checks),
          safeReason,
          safeNote,
          version,
        ],
      );
      await appendEvent(client, {
        actor,
        case_id: input.publication_case_id,
        context: input.context,
        event_type: input.event,
        note: safeNote,
        previous_state: row.lifecycle_state,
        readiness: checks,
        reason_code: safeReason,
        resulting_state: input.to,
        version,
      });
      return version;
    });
  }

  async #transitionNetwork(
    client: PoolClient,
    row: CaseRow,
    target: PublicationState,
    actor: UuidV7,
    reasonCode: string,
    context: RequestContext,
  ) {
    const ids = contextIds(context);
    const vendor = await client.query<{ lifecycle_state: string; version: number }>(
      'SELECT lifecycle_state, version FROM marketplace.vendors WHERE vendor_id=$1 FOR UPDATE',
      [row.vendor_id],
    );
    const location = await client.query<{ lifecycle_state: string; version: number }>(
      'SELECT lifecycle_state, version FROM marketplace.vendor_locations WHERE vendor_location_id=$1 FOR UPDATE',
      [row.vendor_location_id],
    );
    const vendorRow = vendor.rows[0];
    const locationRow = location.rows[0];
    if (!vendorRow || !locationRow)
      throw new VendorPublicationNotFoundError('Vendor network was not found');
    const vendorTarget = target === 'UNPUBLISHED' ? 'SUSPENDED' : 'ACTIVE';
    const locationTarget = target === 'PUBLISHED' ? 'ACTIVE' : 'PAUSED';
    if (vendorRow.lifecycle_state !== vendorTarget) {
      const version = vendorRow.version + 1;
      await client.query(
        'UPDATE marketplace.vendors SET lifecycle_state=$2, version=$3, updated_at=clock_timestamp() WHERE vendor_id=$1',
        [row.vendor_id, vendorTarget, version],
      );
      await client.query(
        `INSERT INTO marketplace.vendor_network_events (event_id, aggregate_type, aggregate_id, resulting_version, event_type, actor_id, reason_code, request_id, correlation_id) VALUES ($1,'VENDOR',$2,$3,'LIFECYCLE_CHANGED',$4,$5,$6,$7)`,
        [
          createUuidV7(),
          row.vendor_id,
          version,
          actor,
          reasonCode,
          ids.requestId,
          ids.correlationId,
        ],
      );
    }
    if (locationRow.lifecycle_state !== locationTarget) {
      const version = locationRow.version + 1;
      await client.query(
        'UPDATE marketplace.vendor_locations SET lifecycle_state=$2, version=$3, updated_at=clock_timestamp() WHERE vendor_location_id=$1',
        [row.vendor_location_id, locationTarget, version],
      );
      await client.query(
        `INSERT INTO marketplace.vendor_network_events (event_id, aggregate_type, aggregate_id, resulting_version, event_type, actor_id, reason_code, request_id, correlation_id) VALUES ($1,'VENDOR_LOCATION',$2,$3,'LIFECYCLE_CHANGED',$4,$5,$6,$7)`,
        [
          createUuidV7(),
          row.vendor_location_id,
          version,
          actor,
          reasonCode,
          ids.requestId,
          ids.correlationId,
        ],
      );
    }
  }
}
