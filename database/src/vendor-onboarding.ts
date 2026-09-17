import { createDatabasePool } from './database-pool.js';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';
import {
  type ProtectedMediaType,
  type ProtectedObjectStorage,
  type StorageScanScenario,
} from './protected-object-storage.js';
import { transaction } from './transaction.js';
import { grantRoleAssignment } from './role-grants.js';

export type OnboardingEntryKind = 'APPLICATION' | 'INVITATION' | 'LEAD';
export type OnboardingState =
  | 'APPROVED'
  | 'EXPIRING'
  | 'GRACE'
  | 'INVITED'
  | 'LEAD'
  | 'PENDING'
  | 'REJECTED'
  | 'REVERIFICATION'
  | 'UNDER_REVIEW';
export type VerificationDocumentKind =
  'BUSINESS_REGISTRATION' | 'FOOD_SAFETY_DECLARATION' | 'PAYOUT_ACCOUNT_PROOF';
export type VerificationDocumentState =
  | 'APPROVED'
  | 'EXPIRING'
  | 'GRACE'
  | 'PENDING'
  | 'REJECTED'
  | 'REVERIFICATION'
  | 'SUPERSEDED'
  | 'UNDER_REVIEW';
export type AffectedCapability = 'VENDOR_PAYOUT' | 'VENDOR_PUBLICATION';

export interface OnboardingCaseSummary {
  readonly applicant_user_id: UuidV7 | null;
  readonly business_profile_reference: string | null;
  readonly documents: readonly VerificationDocumentSummary[];
  readonly entry_kind: OnboardingEntryKind;
  readonly invitation_reference: string | null;
  readonly lifecycle_state: OnboardingState;
  readonly onboarding_case_id: UuidV7;
  readonly payout_profile_reference: string | null;
  readonly vendor_id: UuidV7 | null;
  readonly vendor_location_id: UuidV7 | null;
  readonly version: number;
}

export interface VerificationDocumentSummary {
  readonly affected_capability: AffectedCapability;
  readonly document_kind: VerificationDocumentKind;
  readonly document_version: number;
  readonly expires_on: string | null;
  readonly grace_until: string | null;
  readonly lifecycle_state: VerificationDocumentState;
  readonly media_type: ProtectedMediaType;
  readonly verification_document_id: UuidV7;
}

export interface ProposedVendorProfile {
  readonly business_name: string;
  readonly business_profile_reference: string;
  readonly category: 'FRUIT_VEGETABLE';
  readonly latitude: number;
  readonly location_name: string;
  readonly longitude: number;
  readonly minimum_order_minor: number;
  readonly operating_timezone: string;
  readonly payout_profile_reference: string;
  readonly preparation_seconds: number;
  readonly profile_description?: string | null;
}

export class VendorOnboardingInputError extends Error {
  readonly code = 'INVALID_ARGUMENT';
}
export class VendorOnboardingNotFoundError extends Error {
  readonly code = 'RESOURCE_NOT_FOUND';
}
/**
 * Carries which kind of conflict it is.
 *
 * The code was the literal string 'CONFLICT', which is not a stable error code,
 * so the filter ignored it and the response read as VERSION_CONFLICT -- "Refresh
 * and try again" -- for all thirteen refusals. Only the stale-version ones are
 * fixed by reloading.
 */
export class VendorOnboardingConflictError extends Error {
  readonly code: 'ORDER_STATE_CONFLICT' | 'VERSION_CONFLICT';

  constructor(
    message: string,
    code: 'ORDER_STATE_CONFLICT' | 'VERSION_CONFLICT' = 'ORDER_STATE_CONFLICT',
  ) {
    super(message);
    this.code = code;
  }
}
export class VendorOnboardingAuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
}
export class VendorOnboardingIncompleteError extends Error {
  readonly code = 'UNPROCESSABLE_ENTITY';
}

const NAME = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'().,-]{1,118}$/u;
const BUSINESS_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{5,127}$/;
const PAYOUT_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{5,127}$/;
const INVITATION_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{5,127}$/;

/**
 * How long an unclaimed invitation stays claimable.
 *
 * D-15 requires an expiring one-use invitation and does not name a period, so this is a
 * default an owner can revise rather than a decision hidden in a call site. Fourteen
 * days is long enough for a vendor to be reached and to sign up, and short enough that
 * a reference which leaks does not stay usable indefinitely.
 */
const INVITATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
const EVIDENCE_REFERENCE = /^[A-Z0-9][A-Z0-9._:/-]{5,127}$/;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const REQUIRED_DOCUMENTS = new Set<VerificationDocumentKind>([
  'BUSINESS_REGISTRATION',
  'FOOD_SAFETY_DECLARATION',
  'PAYOUT_ACCOUNT_PROOF',
]);

interface CaseRow {
  readonly invitation_expires_at: Date | null;
  readonly applicant_user_id: string | null;
  readonly business_profile_reference: string | null;
  readonly created_by_user_id: string | null;
  readonly entry_kind: OnboardingEntryKind;
  readonly invitation_reference: string | null;
  readonly lifecycle_state: OnboardingState;
  readonly onboarding_case_id: string;
  readonly payout_profile_reference: string | null;
  readonly proposed_business_name: string | null;
  readonly proposed_category: 'FRUIT_VEGETABLE' | null;
  readonly proposed_location_name: string | null;
  readonly proposed_minimum_order_minor: string | null;
  readonly proposed_operating_timezone: string | null;
  readonly proposed_preparation_seconds: number | null;
  readonly proposed_profile_description: string | null;
  readonly vendor_id: string | null;
  readonly vendor_location_id: string | null;
  readonly version: number;
}

interface DocumentRow {
  readonly affected_capability: AffectedCapability;
  readonly content_sha256: string;
  readonly document_kind: VerificationDocumentKind;
  readonly document_version: number;
  readonly expires_on: Date | string | null;
  readonly grace_until: Date | string | null;
  readonly lifecycle_state: VerificationDocumentState;
  readonly media_type: ProtectedMediaType;
  readonly object_key: string;
  readonly onboarding_case_id: string;
  readonly verification_document_id: string;
}

function ids(context: RequestContext) {
  return {
    actorId: context.actor?.actor_id ?? null,
    correlationId: parseUuidV7(context.correlation_id),
    requestId: parseRequestId(context.request_id),
  };
}

function requireAdmin(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'admin') {
    throw new VendorOnboardingAuthorizationError('Admin actor is required');
  }
  return context.actor.actor_id;
}

function requireReason(value: string): string {
  if (!REASON.test(value)) throw new VendorOnboardingInputError('Reason code is invalid');
  return value;
}

function requireNote(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 3 || normalized.length > 1_000) {
    throw new VendorOnboardingInputError('Evidence note must contain 3 to 1000 characters');
  }
  return normalized;
}

function requireReference(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) throw new VendorOnboardingInputError(`${label} is invalid`);
  return value;
}

function requireName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!NAME.test(normalized)) {
    throw new VendorOnboardingInputError('Vendor name contains unsupported characters');
  }
  return normalized;
}

function requireDescription(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 1 || normalized.length > 500) {
    throw new VendorOnboardingInputError('Profile description must contain 1 to 500 characters');
  }
  return normalized;
}

function requireTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
  } catch {
    throw new VendorOnboardingInputError('Operating timezone is invalid');
  }
  return value;
}

function requireCoordinate(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new VendorOnboardingInputError('Coordinate is outside valid bounds');
  }
  return value;
}

function requireProfile(input: ProposedVendorProfile) {
  if (input.category !== 'FRUIT_VEGETABLE') {
    throw new VendorOnboardingInputError('Category is not currently enabled');
  }
  if (
    !Number.isSafeInteger(input.minimum_order_minor) ||
    input.minimum_order_minor < 0 ||
    input.minimum_order_minor > 10_000_000
  ) {
    throw new VendorOnboardingInputError('Minimum order must use integer INR minor units');
  }
  if (
    !Number.isSafeInteger(input.preparation_seconds) ||
    input.preparation_seconds < 300 ||
    input.preparation_seconds > 14_400
  ) {
    throw new VendorOnboardingInputError('Preparation time must be between 300 and 14400 seconds');
  }
  return {
    businessName: requireName(input.business_name),
    businessReference: requireReference(
      input.business_profile_reference,
      BUSINESS_REFERENCE,
      'Business profile reference',
    ),
    description: requireDescription(input.profile_description),
    latitude: requireCoordinate(input.latitude, -90, 90),
    locationName: requireName(input.location_name),
    longitude: requireCoordinate(input.longitude, -180, 180),
    payoutReference: requireReference(
      input.payout_profile_reference,
      PAYOUT_REFERENCE,
      'Payout profile reference',
    ),
    timezone: requireTimezone(input.operating_timezone),
  };
}

async function lockCase(client: PoolClient, caseId: UuidV7, expectedVersion?: number) {
  const result = await client.query<CaseRow>(
    'SELECT * FROM marketplace.vendor_onboarding_cases WHERE onboarding_case_id=$1 FOR UPDATE',
    [parseUuidV7(caseId)],
  );
  const row = result.rows[0];
  if (!row) throw new VendorOnboardingNotFoundError('Onboarding case was not found');
  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    throw new VendorOnboardingConflictError('Onboarding case version is stale', 'VERSION_CONFLICT');
  }
  return row;
}

function requireApplicant(row: CaseRow, userId: UuidV7): void {
  if (row.applicant_user_id !== userId) {
    throw new VendorOnboardingNotFoundError('Onboarding case was not found');
  }
}

async function event(
  client: PoolClient,
  input: {
    readonly actor_user_id?: UuidV7 | null;
    readonly case_version: number;
    readonly context: RequestContext;
    readonly event_type:
      | 'APPEAL_REVIEWED'
      | 'APPEAL_SUBMITTED'
      | 'APPLICATION_CREATED'
      | 'APPLICATION_SUBMITTED'
      | 'APPROVED'
      | 'DOCUMENT_REVIEWED'
      | 'DOCUMENT_UPLOADED'
      | 'EXPIRING'
      | 'GRACE_GRANTED'
      | 'INVITATION_CREATED'
      | 'LEAD_CREATED'
      | 'REJECTED'
      | 'REVERIFICATION_REQUIRED'
      | 'REVIEW_STARTED';
    readonly note?: string | null;
    readonly now: Date;
    readonly onboarding_case_id: UuidV7;
    readonly reason_code: string;
  },
) {
  const contextIds = ids(input.context);
  await client.query(
    `INSERT INTO marketplace.vendor_onboarding_events
    (onboarding_event_id, onboarding_case_id, case_version, event_type, actor_user_id,
     reason_code, note, request_id, correlation_id, occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      createUuidV7({ now_ms: input.now.getTime() }),
      input.onboarding_case_id,
      input.case_version,
      input.event_type,
      input.actor_user_id === undefined ? contextIds.actorId : input.actor_user_id,
      requireReason(input.reason_code),
      input.note ? requireNote(input.note) : null,
      contextIds.requestId,
      contextIds.correlationId,
      input.now,
    ],
  );
}

function isoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function documentSummary(row: DocumentRow): VerificationDocumentSummary {
  return Object.freeze({
    affected_capability: row.affected_capability,
    document_kind: row.document_kind,
    document_version: row.document_version,
    expires_on: isoDate(row.expires_on),
    grace_until: isoDate(row.grace_until),
    lifecycle_state: row.lifecycle_state,
    media_type: row.media_type,
    verification_document_id: parseUuidV7(row.verification_document_id),
  });
}

export class VendorOnboardingService {
  readonly #pool: Pool;
  readonly #storage: ProtectedObjectStorage;

  constructor(input: {
    readonly connection_string: string;
    readonly storage: ProtectedObjectStorage;
  }) {
    this.#storage = input.storage;
    this.#pool = createDatabasePool({
      application_name: 'neighbourhood-store-vendor-onboarding',
      connectionString: input.connection_string,
      connectionTimeoutMillis: 5_000,
      max: 8,
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #create(input: {
    readonly applicant_user_id?: UuidV7 | null;
    readonly context: RequestContext;
    readonly created_by_user_id?: UuidV7 | null;
    readonly entry_kind: OnboardingEntryKind;
    readonly invitation_expires_at?: Date | null;
    readonly invitation_reference?: string | null;
    readonly now?: Date;
  }): Promise<UuidV7> {
    const now = input.now ?? new Date();
    const caseId = createUuidV7({ now_ms: now.getTime() });
    const lifecycleState: OnboardingState =
      input.entry_kind === 'LEAD'
        ? 'LEAD'
        : input.entry_kind === 'INVITATION'
          ? 'INVITED'
          : 'PENDING';
    const reasonCode =
      input.entry_kind === 'LEAD'
        ? 'LEAD_CREATED'
        : input.entry_kind === 'INVITATION'
          ? 'INVITATION_CREATED'
          : 'APPLICATION_CREATED';
    await transaction(this.#pool, async (client) => {
      const contextIds = ids(input.context);
      await client.query(
        `INSERT INTO marketplace.vendor_onboarding_cases
        (onboarding_case_id, entry_kind, lifecycle_state, applicant_user_id, created_by_user_id,
         invitation_reference, invitation_expires_at, current_reason_code, request_id,
         correlation_id, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [
          caseId,
          input.entry_kind,
          lifecycleState,
          input.applicant_user_id ?? null,
          input.created_by_user_id ?? null,
          input.invitation_reference ?? null,
          input.invitation_expires_at ?? null,
          reasonCode,
          contextIds.requestId,
          contextIds.correlationId,
          now,
        ],
      );
      await event(client, {
        case_version: 1,
        context: input.context,
        event_type: reasonCode,
        now,
        onboarding_case_id: caseId,
        reason_code: reasonCode,
        ...(input.created_by_user_id
          ? { actor_user_id: input.created_by_user_id }
          : input.applicant_user_id
            ? { actor_user_id: input.applicant_user_id }
            : {}),
      });
    });
    return caseId;
  }

  async createLead(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<UuidV7> {
    const admin = requireAdmin(input.context);
    return this.#create({
      context: input.context,
      created_by_user_id: admin,
      entry_kind: 'LEAD',
      ...(input.now ? { now: input.now } : {}),
    });
  }

  async createInvitation(input: {
    readonly applicant_user_id?: UuidV7;
    readonly context: RequestContext;
    readonly expires_at?: Date;
    readonly invitation_reference: string;
    readonly now?: Date;
  }): Promise<UuidV7> {
    const admin = requireAdmin(input.context);
    const issuedAt = input.now ?? new Date();
    const expiresAt = input.expires_at ?? new Date(issuedAt.getTime() + INVITATION_LIFETIME_MS);
    if (expiresAt.getTime() <= issuedAt.getTime()) {
      throw new VendorOnboardingInputError('Invitation expiry must be after it is issued');
    }
    return this.#create({
      applicant_user_id: input.applicant_user_id ?? null,
      invitation_expires_at: expiresAt,
      context: input.context,
      created_by_user_id: admin,
      entry_kind: 'INVITATION',
      invitation_reference: requireReference(
        input.invitation_reference,
        INVITATION_REFERENCE,
        'Invitation reference',
      ),
      ...(input.now ? { now: input.now } : {}),
    });
  }

  async createApplication(input: {
    readonly applicant_user_id: UuidV7;
    readonly context: RequestContext;
    readonly now?: Date;
  }): Promise<UuidV7> {
    return this.#create({
      applicant_user_id: input.applicant_user_id,
      context: input.context,
      entry_kind: 'APPLICATION',
      ...(input.now ? { now: input.now } : {}),
    });
  }

  async claimInvitation(input: {
    readonly applicant_user_id: UuidV7;
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly invitation_reference: string;
    readonly now?: Date;
  }): Promise<number> {
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const found = await client.query<CaseRow>(
        `SELECT * FROM marketplace.vendor_onboarding_cases
        WHERE invitation_reference=$1 FOR UPDATE`,
        [
          requireReference(
            input.invitation_reference,
            INVITATION_REFERENCE,
            'Invitation reference',
          ),
        ],
      );
      const row = found.rows[0];
      if (!row) throw new VendorOnboardingNotFoundError('Invitation was not found');
      if (row.version !== input.expected_version)
        throw new VendorOnboardingConflictError(
          'Onboarding case version is stale',
          'VERSION_CONFLICT',
        );
      if (
        row.lifecycle_state !== 'INVITED' ||
        (row.applicant_user_id !== null && row.applicant_user_id !== input.applicant_user_id)
      ) {
        throw new VendorOnboardingAuthorizationError(
          'Invitation cannot be claimed by this identity',
        );
      }
      // Refused separately from the identity check so an expired invitation says so,
      // rather than reading as though the caller were the wrong person.
      if (
        row.invitation_expires_at !== null &&
        row.invitation_expires_at.getTime() <= now.getTime()
      ) {
        throw new VendorOnboardingAuthorizationError('Invitation has expired');
      }
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_onboarding_cases SET applicant_user_id=$2,
        lifecycle_state='PENDING', current_reason_code='INVITATION_CLAIMED', version=$3,
        updated_at=$4 WHERE onboarding_case_id=$1`,
        [row.onboarding_case_id, input.applicant_user_id, version, now],
      );
      await event(client, {
        actor_user_id: input.applicant_user_id,
        case_version: version,
        context: input.context,
        event_type: 'APPLICATION_SUBMITTED',
        now,
        onboarding_case_id: parseUuidV7(row.onboarding_case_id),
        reason_code: 'INVITATION_CLAIMED',
      });
      return version;
    });
  }

  async submitProfile(input: {
    readonly applicant_user_id: UuidV7;
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly onboarding_case_id: UuidV7;
    readonly profile: ProposedVendorProfile;
  }): Promise<number> {
    const profile = requireProfile(input.profile);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.onboarding_case_id, input.expected_version);
      requireApplicant(row, input.applicant_user_id);
      if (!['INVITED', 'PENDING', 'REJECTED', 'REVERIFICATION'].includes(row.lifecycle_state)) {
        throw new VendorOnboardingConflictError('Profile cannot be submitted in this state');
      }
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_onboarding_cases SET lifecycle_state='PENDING',
        business_profile_reference=$2, payout_profile_reference=$3, proposed_business_name=$4,
        proposed_location_name=$5, proposed_profile_description=$6,
        proposed_operating_timezone=$7,
        proposed_coordinates=ST_SetSRID(ST_MakePoint($8,$9),4326)::geography,
        proposed_category=$10, proposed_minimum_order_minor=$11, proposed_currency='INR',
        proposed_preparation_seconds=$12, current_reason_code='APPLICATION_SUBMITTED',
        submitted_at=$13, rejected_at=NULL, version=$14, updated_at=$13
        WHERE onboarding_case_id=$1`,
        [
          input.onboarding_case_id,
          profile.businessReference,
          profile.payoutReference,
          profile.businessName,
          profile.locationName,
          profile.description,
          profile.timezone,
          profile.longitude,
          profile.latitude,
          input.profile.category,
          input.profile.minimum_order_minor,
          input.profile.preparation_seconds,
          now,
          version,
        ],
      );
      await event(client, {
        actor_user_id: input.applicant_user_id,
        case_version: version,
        context: input.context,
        event_type: 'APPLICATION_SUBMITTED',
        now,
        onboarding_case_id: input.onboarding_case_id,
        reason_code: 'APPLICATION_SUBMITTED',
      });
      return version;
    });
  }

  async uploadDocument(input: {
    readonly affected_capability: AffectedCapability;
    readonly applicant_user_id: UuidV7;
    readonly content: Uint8Array;
    readonly context: RequestContext;
    readonly document_kind: VerificationDocumentKind;
    readonly expected_case_version: number;
    readonly expires_on?: string | null;
    readonly media_type: ProtectedMediaType;
    readonly now?: Date;
    readonly onboarding_case_id: UuidV7;
    readonly scan_scenario?: StorageScanScenario;
  }): Promise<VerificationDocumentSummary> {
    if (!REQUIRED_DOCUMENTS.has(input.document_kind))
      throw new VendorOnboardingInputError('Document kind is invalid');
    if (
      input.affected_capability !== 'VENDOR_PUBLICATION' &&
      input.affected_capability !== 'VENDOR_PAYOUT'
    ) {
      throw new VendorOnboardingInputError('Affected capability is invalid');
    }
    if (
      input.expires_on !== undefined &&
      input.expires_on !== null &&
      !/^\d{4}-\d{2}-\d{2}$/.test(input.expires_on)
    ) {
      throw new VendorOnboardingInputError('Document expiry must be YYYY-MM-DD');
    }
    const now = input.now ?? new Date();
    const documentId = createUuidV7({ now_ms: now.getTime() });
    const objectKey = `vendor-onboarding/${input.onboarding_case_id}/${documentId}/object`;
    const stored = await this.#storage.put({
      content: input.content,
      media_type: input.media_type,
      object_key: objectKey,
      ...(input.scan_scenario ? { scan_scenario: input.scan_scenario } : {}),
    });
    try {
      return await transaction(this.#pool, async (client) => {
        const row = await lockCase(client, input.onboarding_case_id, input.expected_case_version);
        requireApplicant(row, input.applicant_user_id);
        if (
          !['PENDING', 'REJECTED', 'REVERIFICATION', 'GRACE', 'EXPIRING'].includes(
            row.lifecycle_state,
          )
        ) {
          throw new VendorOnboardingConflictError('Documents cannot be uploaded in this state');
        }
        const latest = await client.query<{
          document_version: number;
          verification_document_id: string;
        }>(
          `SELECT document_version, verification_document_id
             FROM marketplace.vendor_verification_documents
            WHERE onboarding_case_id=$1 AND document_kind=$2
            ORDER BY document_version DESC LIMIT 1 FOR UPDATE`,
          [input.onboarding_case_id, input.document_kind],
        );
        const documentVersion = (latest.rows[0]?.document_version ?? 0) + 1;
        const contextIds = ids(input.context);
        const inserted = await client.query<DocumentRow>(
          `INSERT INTO marketplace.vendor_verification_documents
          (verification_document_id, onboarding_case_id, document_kind, document_version,
           lifecycle_state, object_key, content_sha256, content_length, media_type, scan_state,
           expires_on, affected_capability, replaces_document_id, uploaded_by_user_id,
           request_id, correlation_id, created_at, updated_at)
          VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
          RETURNING *`,
          [
            documentId,
            input.onboarding_case_id,
            input.document_kind,
            documentVersion,
            stored.object_key,
            stored.content_sha256,
            stored.content_length,
            stored.media_type,
            stored.scan_state,
            input.expires_on ?? null,
            input.affected_capability,
            latest.rows[0]?.verification_document_id ?? null,
            input.applicant_user_id,
            contextIds.requestId,
            contextIds.correlationId,
            now,
          ],
        );
        const caseVersion = row.version + 1;
        await client.query(
          `UPDATE marketplace.vendor_onboarding_cases SET lifecycle_state='PENDING',
          current_reason_code='DOCUMENT_UPLOADED', version=$2, updated_at=$3
          WHERE onboarding_case_id=$1`,
          [input.onboarding_case_id, caseVersion, now],
        );
        await event(client, {
          actor_user_id: input.applicant_user_id,
          case_version: caseVersion,
          context: input.context,
          event_type: 'DOCUMENT_UPLOADED',
          now,
          onboarding_case_id: input.onboarding_case_id,
          reason_code: 'DOCUMENT_UPLOADED',
        });
        return documentSummary(inserted.rows[0] as DocumentRow);
      });
    } catch (error) {
      await this.#storage.delete(stored.object_key).catch(() => undefined);
      throw error;
    }
  }

  async startReview(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly onboarding_case_id: UuidV7;
  }): Promise<number> {
    const reviewer = requireAdmin(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.onboarding_case_id, input.expected_version);
      if (row.lifecycle_state !== 'PENDING')
        throw new VendorOnboardingConflictError('Application is not pending review');
      if (
        !row.business_profile_reference ||
        !row.payout_profile_reference ||
        !row.proposed_business_name ||
        !row.proposed_location_name
      ) {
        throw new VendorOnboardingIncompleteError('Application profile is incomplete');
      }
      const documents = await client.query<{ document_kind: VerificationDocumentKind }>(
        `SELECT DISTINCT ON (document_kind) document_kind FROM marketplace.vendor_verification_documents
          WHERE onboarding_case_id=$1 AND lifecycle_state <> 'SUPERSEDED'
          ORDER BY document_kind, document_version DESC`,
        [input.onboarding_case_id],
      );
      if (
        documents.rows.length !== REQUIRED_DOCUMENTS.size ||
        documents.rows.some((document) => !REQUIRED_DOCUMENTS.has(document.document_kind))
      ) {
        throw new VendorOnboardingIncompleteError('Required verification documents are missing');
      }
      await client.query(
        `UPDATE marketplace.vendor_verification_documents SET
        lifecycle_state='UNDER_REVIEW', updated_at=$2 WHERE onboarding_case_id=$1
        AND lifecycle_state='PENDING'`,
        [input.onboarding_case_id, now],
      );
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_onboarding_cases SET lifecycle_state='UNDER_REVIEW',
        current_reason_code='REVIEW_STARTED', review_started_at=$2, version=$3, updated_at=$2
        WHERE onboarding_case_id=$1`,
        [input.onboarding_case_id, now, version],
      );
      await event(client, {
        actor_user_id: reviewer,
        case_version: version,
        context: input.context,
        event_type: 'REVIEW_STARTED',
        now,
        onboarding_case_id: input.onboarding_case_id,
        reason_code: 'REVIEW_STARTED',
      });
      return version;
    });
  }

  async reviewDocument(input: {
    readonly context: RequestContext;
    readonly decision: 'APPROVED' | 'REJECTED';
    readonly evidence_reference: string;
    readonly expected_case_version: number;
    readonly now?: Date;
    readonly onboarding_case_id: UuidV7;
    readonly reason_code: string;
    readonly reviewer_note: string;
    readonly verification_document_id: UuidV7;
  }): Promise<number> {
    const reviewer = requireAdmin(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.onboarding_case_id, input.expected_case_version);
      if (row.lifecycle_state !== 'UNDER_REVIEW')
        throw new VendorOnboardingConflictError('Case is not under review');
      if (row.created_by_user_id === reviewer) {
        throw new VendorOnboardingAuthorizationError(
          'Case creator cannot review their own onboarding evidence',
        );
      }
      const found = await client.query<DocumentRow>(
        `SELECT * FROM marketplace.vendor_verification_documents
        WHERE verification_document_id=$1 AND onboarding_case_id=$2 FOR UPDATE`,
        [input.verification_document_id, input.onboarding_case_id],
      );
      const document = found.rows[0];
      if (!document || document.lifecycle_state !== 'UNDER_REVIEW') {
        throw new VendorOnboardingConflictError('Document is not under review');
      }
      const contextIds = ids(input.context);
      await client.query(
        `UPDATE marketplace.vendor_verification_documents SET lifecycle_state=$2,
        updated_at=$3 WHERE verification_document_id=$1`,
        [input.verification_document_id, input.decision, now],
      );
      if (input.decision === 'APPROVED' && document.document_version > 1) {
        await client.query(
          `UPDATE marketplace.vendor_verification_documents SET lifecycle_state='SUPERSEDED',
          updated_at=$3 WHERE onboarding_case_id=$1 AND document_kind=$2 AND document_version < $4
          AND lifecycle_state <> 'SUPERSEDED'`,
          [input.onboarding_case_id, document.document_kind, now, document.document_version],
        );
      }
      await client.query(
        `INSERT INTO marketplace.vendor_document_reviews
        (document_review_id, verification_document_id, reviewer_user_id, previous_state,
         resulting_state, decision, reason_code, reviewer_note, evidence_reference,
         request_id, correlation_id, occurred_at)
        VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          input.verification_document_id,
          reviewer,
          document.lifecycle_state,
          input.decision,
          requireReason(input.reason_code),
          requireNote(input.reviewer_note),
          requireReference(input.evidence_reference, EVIDENCE_REFERENCE, 'Evidence reference'),
          contextIds.requestId,
          contextIds.correlationId,
          now,
        ],
      );
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_onboarding_cases SET version=$2,
        current_reason_code=$3, updated_at=$4 WHERE onboarding_case_id=$1`,
        [
          input.onboarding_case_id,
          version,
          input.decision === 'APPROVED' ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED',
          now,
        ],
      );
      await event(client, {
        actor_user_id: reviewer,
        case_version: version,
        context: input.context,
        event_type: 'DOCUMENT_REVIEWED',
        note: input.reviewer_note,
        now,
        onboarding_case_id: input.onboarding_case_id,
        reason_code: input.reason_code,
      });
      return version;
    });
  }

  async approve(input: {
    readonly context: RequestContext;
    readonly evidence_reference: string;
    readonly expected_version: number;
    readonly now?: Date;
    readonly onboarding_case_id: UuidV7;
    readonly reason_code: string;
    readonly reviewer_note: string;
  }): Promise<{
    readonly vendor_id: UuidV7;
    readonly vendor_location_id: UuidV7;
    readonly version: number;
  }> {
    const reviewer = requireAdmin(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.onboarding_case_id, input.expected_version);
      if (row.lifecycle_state !== 'UNDER_REVIEW')
        throw new VendorOnboardingConflictError('Case is not under review');
      if (row.created_by_user_id === reviewer)
        throw new VendorOnboardingAuthorizationError('Case creator cannot approve it');
      const documents = await client.query<{
        document_kind: VerificationDocumentKind;
        lifecycle_state: VerificationDocumentState;
      }>(
        `SELECT DISTINCT ON (document_kind) document_kind, lifecycle_state
           FROM marketplace.vendor_verification_documents WHERE onboarding_case_id=$1
          ORDER BY document_kind, document_version DESC`,
        [input.onboarding_case_id],
      );
      if (
        documents.rows.length !== REQUIRED_DOCUMENTS.size ||
        documents.rows.some((document) => document.lifecycle_state !== 'APPROVED')
      ) {
        throw new VendorOnboardingIncompleteError('Every required document must be approved');
      }
      if (
        !row.proposed_business_name ||
        !row.proposed_location_name ||
        !row.proposed_operating_timezone ||
        !row.proposed_category ||
        row.proposed_minimum_order_minor === null ||
        row.proposed_preparation_seconds === null
      ) {
        throw new VendorOnboardingIncompleteError('Application profile is incomplete');
      }
      requireReference(input.evidence_reference, EVIDENCE_REFERENCE, 'Evidence reference');
      const vendorId = createUuidV7({ now_ms: now.getTime() });
      const locationId = createUuidV7({ now_ms: now.getTime() });
      const contextIds = ids(input.context);
      await client.query(
        `INSERT INTO marketplace.vendors
        (vendor_id, business_name, profile_description, request_id, correlation_id, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [
          vendorId,
          row.proposed_business_name,
          row.proposed_profile_description,
          contextIds.requestId,
          contextIds.correlationId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.vendor_locations
        (vendor_location_id, vendor_id, location_name, profile_description, operating_timezone,
         coordinates, category, minimum_order_minor, preparation_seconds, request_id,
         correlation_id, created_at, updated_at)
        SELECT $1,$2,proposed_location_name,proposed_profile_description,
          proposed_operating_timezone,proposed_coordinates,proposed_category,
          proposed_minimum_order_minor,proposed_preparation_seconds,$3,$4,$5,$5
          FROM marketplace.vendor_onboarding_cases WHERE onboarding_case_id=$6`,
        [
          locationId,
          vendorId,
          contextIds.requestId,
          contextIds.correlationId,
          now,
          input.onboarding_case_id,
        ],
      );
      for (const aggregate of [
        { id: vendorId, type: 'VENDOR' },
        { id: locationId, type: 'VENDOR_LOCATION' },
      ] as const) {
        await client.query(
          `INSERT INTO marketplace.vendor_network_events
          (event_id, aggregate_type, aggregate_id, resulting_version, event_type, actor_id,
           reason_code, request_id, correlation_id, occurred_at)
          VALUES ($1,$2,$3,1,'CREATED',$4,'ONBOARDING_APPROVED',$5,$6,$7)`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            aggregate.type,
            aggregate.id,
            reviewer,
            contextIds.requestId,
            contextIds.correlationId,
            now,
          ],
        );
      }
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_onboarding_cases SET lifecycle_state='APPROVED',
        vendor_id=$2, vendor_location_id=$3, current_reason_code=$4, approved_at=$5,
        rejected_at=NULL, version=$6, updated_at=$5 WHERE onboarding_case_id=$1`,
        [
          input.onboarding_case_id,
          vendorId,
          locationId,
          requireReason(input.reason_code),
          now,
          version,
        ],
      );
      // Close the onboarding -> access loop: grant the applicant a
      // VENDOR_OWNER staff membership at the new location, inline in this
      // transaction so an approved vendor can never be ownerless. Mirrors the
      // grant shape in verify-discoverable-store-fixture.ts. A lead approved
      // without a claimed applicant (applicant_user_id null) has no user to
      // own it, so the grant is skipped in that case.
      if (row.applicant_user_id) {
        // Through the one grant path, so the access history records that the
        // approval is what made them an owner -- this write used to skip that.
        const ownerRoleAssignmentId = await grantRoleAssignment(client, {
          user_id: parseUuidV7(row.applicant_user_id),
          role_key: 'VENDOR_OWNER',
          granted_by_user_id: reviewer,
          reason_code: 'ONBOARDING_APPROVED',
          now,
          request_id: contextIds.requestId,
          correlation_id: contextIds.correlationId,
        });
        await client.query(
          `INSERT INTO marketplace.staff_memberships
             (staff_membership_id, role_assignment_id, user_id, vendor_location_id)
           VALUES ($1,$2,$3,$4)`,
          [
            createUuidV7({ now_ms: now.getTime() }),
            ownerRoleAssignmentId,
            row.applicant_user_id,
            locationId,
          ],
        );
      }
      await event(client, {
        actor_user_id: reviewer,
        case_version: version,
        context: input.context,
        event_type: 'APPROVED',
        note: input.reviewer_note,
        now,
        onboarding_case_id: input.onboarding_case_id,
        reason_code: input.reason_code,
      });
      return Object.freeze({ vendor_id: vendorId, vendor_location_id: locationId, version });
    });
  }

  async reject(input: {
    readonly context: RequestContext;
    readonly expected_version: number;
    readonly now?: Date;
    readonly onboarding_case_id: UuidV7;
    readonly reason_code: string;
    readonly reviewer_note: string;
  }): Promise<number> {
    const reviewer = requireAdmin(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.onboarding_case_id, input.expected_version);
      if (!['PENDING', 'UNDER_REVIEW', 'REVERIFICATION'].includes(row.lifecycle_state)) {
        throw new VendorOnboardingConflictError('Case cannot be rejected in this state');
      }
      if (row.created_by_user_id === reviewer)
        throw new VendorOnboardingAuthorizationError('Case creator cannot reject it');
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_onboarding_cases SET lifecycle_state='REJECTED',
        current_reason_code=$2, rejected_at=$3, version=$4, updated_at=$3
        WHERE onboarding_case_id=$1`,
        [input.onboarding_case_id, requireReason(input.reason_code), now, version],
      );
      await event(client, {
        actor_user_id: reviewer,
        case_version: version,
        context: input.context,
        event_type: 'REJECTED',
        note: input.reviewer_note,
        now,
        onboarding_case_id: input.onboarding_case_id,
        reason_code: input.reason_code,
      });
      return version;
    });
  }

  async submitAppeal(input: {
    readonly appeal_note: string;
    readonly applicant_user_id: UuidV7;
    readonly context: RequestContext;
    readonly evidence_reference?: string | null;
    readonly expected_case_version: number;
    readonly now?: Date;
    readonly onboarding_case_id: UuidV7;
    readonly reason_code: string;
    readonly verification_document_id?: UuidV7;
  }): Promise<UuidV7> {
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.onboarding_case_id, input.expected_case_version);
      requireApplicant(row, input.applicant_user_id);
      if (!['REJECTED', 'REVERIFICATION'].includes(row.lifecycle_state)) {
        throw new VendorOnboardingConflictError('Case is not eligible for appeal');
      }
      if (input.verification_document_id) {
        const owned = await client.query(
          `SELECT 1 FROM marketplace.vendor_verification_documents
          WHERE verification_document_id=$1 AND onboarding_case_id=$2`,
          [input.verification_document_id, input.onboarding_case_id],
        );
        if (!owned.rows[0]) throw new VendorOnboardingNotFoundError('Document was not found');
      }
      const appealId = createUuidV7({ now_ms: now.getTime() });
      const contextIds = ids(input.context);
      await client.query(
        `INSERT INTO marketplace.vendor_onboarding_appeals
        (onboarding_appeal_id, onboarding_case_id, verification_document_id,
         submitted_by_user_id, reason_code, appeal_note, evidence_reference,
         request_id, correlation_id, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
        [
          appealId,
          input.onboarding_case_id,
          input.verification_document_id ?? null,
          input.applicant_user_id,
          requireReason(input.reason_code),
          requireNote(input.appeal_note),
          input.evidence_reference
            ? requireReference(input.evidence_reference, EVIDENCE_REFERENCE, 'Evidence reference')
            : null,
          contextIds.requestId,
          contextIds.correlationId,
          now,
        ],
      );
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_onboarding_cases SET version=$2,
        current_reason_code='APPEAL_SUBMITTED', updated_at=$3 WHERE onboarding_case_id=$1`,
        [input.onboarding_case_id, version, now],
      );
      await event(client, {
        actor_user_id: input.applicant_user_id,
        case_version: version,
        context: input.context,
        event_type: 'APPEAL_SUBMITTED',
        note: input.appeal_note,
        now,
        onboarding_case_id: input.onboarding_case_id,
        reason_code: input.reason_code,
      });
      return appealId;
    });
  }

  async reviewAppeal(input: {
    readonly context: RequestContext;
    readonly decision: 'OVERTURNED' | 'UPHELD';
    readonly expected_case_version: number;
    readonly now?: Date;
    readonly onboarding_appeal_id: UuidV7;
    readonly onboarding_case_id: UuidV7;
    readonly reason_code: string;
    readonly reviewer_note: string;
  }): Promise<number> {
    const reviewer = requireAdmin(input.context);
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.onboarding_case_id, input.expected_case_version);
      const appeal = await client.query<{ lifecycle_state: string; submitted_by_user_id: string }>(
        `SELECT lifecycle_state, submitted_by_user_id FROM marketplace.vendor_onboarding_appeals
          WHERE onboarding_appeal_id=$1 AND onboarding_case_id=$2 FOR UPDATE`,
        [input.onboarding_appeal_id, input.onboarding_case_id],
      );
      if (appeal.rows[0]?.lifecycle_state !== 'SUBMITTED') {
        throw new VendorOnboardingConflictError('Appeal is not pending');
      }
      if (appeal.rows[0].submitted_by_user_id === reviewer) {
        throw new VendorOnboardingAuthorizationError('Appeal submitter cannot review it');
      }
      await client.query(
        `UPDATE marketplace.vendor_onboarding_appeals SET lifecycle_state=$2,
        reviewer_user_id=$3, review_reason_code=$4, reviewer_note=$5, reviewed_at=$6,
        version=version+1, updated_at=$6 WHERE onboarding_appeal_id=$1`,
        [
          input.onboarding_appeal_id,
          input.decision,
          reviewer,
          requireReason(input.reason_code),
          requireNote(input.reviewer_note),
          now,
        ],
      );
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_onboarding_cases SET
        lifecycle_state=CASE WHEN $2='OVERTURNED' THEN 'PENDING' ELSE lifecycle_state END,
        current_reason_code=$3, version=$4, updated_at=$5 WHERE onboarding_case_id=$1`,
        [input.onboarding_case_id, input.decision, input.reason_code, version, now],
      );
      await event(client, {
        actor_user_id: reviewer,
        case_version: version,
        context: input.context,
        event_type: 'APPEAL_REVIEWED',
        note: input.reviewer_note,
        now,
        onboarding_case_id: input.onboarding_case_id,
        reason_code: input.reason_code,
      });
      return version;
    });
  }

  async grantDocumentGrace(input: {
    readonly context: RequestContext;
    readonly expected_case_version: number;
    readonly grace_until: string;
    readonly now?: Date;
    readonly onboarding_case_id: UuidV7;
    readonly reason_code: string;
    readonly reviewer_note: string;
    readonly verification_document_id: UuidV7;
  }): Promise<number> {
    const reviewer = requireAdmin(input.context);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.grace_until))
      throw new VendorOnboardingInputError('Grace date must be YYYY-MM-DD');
    const now = input.now ?? new Date();
    return transaction(this.#pool, async (client) => {
      const row = await lockCase(client, input.onboarding_case_id, input.expected_case_version);
      const found = await client.query<DocumentRow>(
        `SELECT * FROM marketplace.vendor_verification_documents
        WHERE verification_document_id=$1 AND onboarding_case_id=$2 FOR UPDATE`,
        [input.verification_document_id, input.onboarding_case_id],
      );
      const document = found.rows[0];
      if (
        !document ||
        !['EXPIRING', 'REVERIFICATION'].includes(document.lifecycle_state) ||
        !document.expires_on
      ) {
        throw new VendorOnboardingConflictError('Document is not eligible for grace');
      }
      const expiresOn = isoDate(document.expires_on);
      if (!expiresOn || input.grace_until < expiresOn) {
        throw new VendorOnboardingConflictError('Document is not eligible for grace');
      }
      const contextIds = ids(input.context);
      await client.query(
        `UPDATE marketplace.vendor_verification_documents SET lifecycle_state='GRACE',
        grace_until=$2, updated_at=$3 WHERE verification_document_id=$1`,
        [input.verification_document_id, input.grace_until, now],
      );
      await client.query(
        `INSERT INTO marketplace.vendor_document_reviews
        (document_review_id, verification_document_id, reviewer_user_id, previous_state,
         resulting_state, decision, reason_code, reviewer_note, evidence_reference,
         request_id, correlation_id, occurred_at)
        VALUES ($1,$2,$3,$4,'GRACE','GRACE_GRANTED',$5,$6,'SYNTH-EVIDENCE-GRACE-GRANTED',$7,$8,$9)`,
        [
          createUuidV7({ now_ms: now.getTime() }),
          input.verification_document_id,
          reviewer,
          document.lifecycle_state,
          requireReason(input.reason_code),
          requireNote(input.reviewer_note),
          contextIds.requestId,
          contextIds.correlationId,
          now,
        ],
      );
      const version = row.version + 1;
      await client.query(
        `UPDATE marketplace.vendor_onboarding_cases SET lifecycle_state='GRACE',
        current_reason_code=$2, version=$3, updated_at=$4 WHERE onboarding_case_id=$1`,
        [input.onboarding_case_id, input.reason_code, version, now],
      );
      await event(client, {
        actor_user_id: reviewer,
        case_version: version,
        context: input.context,
        event_type: 'GRACE_GRANTED',
        note: input.reviewer_note,
        now,
        onboarding_case_id: input.onboarding_case_id,
        reason_code: input.reason_code,
      });
      return version;
    });
  }

  async advanceDocumentDeadlines(input: {
    readonly at?: Date;
    readonly context: RequestContext;
  }): Promise<number> {
    const at = input.at ?? new Date();
    const today = at.toISOString().slice(0, 10);
    const expiringCutoff = new Date(at.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
    return transaction(this.#pool, async (client) => {
      const candidates = await client.query<DocumentRow>(`SELECT document.*
        FROM marketplace.vendor_verification_documents document
        WHERE document.expires_on IS NOT NULL
          AND document.lifecycle_state IN ('APPROVED','EXPIRING','GRACE')
          AND NOT EXISTS (
            SELECT 1 FROM marketplace.vendor_verification_documents newer
             WHERE newer.onboarding_case_id=document.onboarding_case_id
               AND newer.document_kind=document.document_kind
               AND newer.document_version>document.document_version)
        FOR UPDATE OF document`);
      const caseStates = new Map<string, OnboardingState>();
      let changed = 0;
      for (const document of candidates.rows) {
        const expiresOn = isoDate(document.expires_on);
        if (!expiresOn) continue;
        const graceUntil = isoDate(document.grace_until);
        let next: VerificationDocumentState | null = null;
        if (
          expiresOn > today &&
          expiresOn <= expiringCutoff &&
          document.lifecycle_state === 'APPROVED'
        )
          next = 'EXPIRING';
        else if (
          expiresOn <= today &&
          graceUntil &&
          graceUntil >= today &&
          document.lifecycle_state !== 'GRACE'
        )
          next = 'GRACE';
        else if (expiresOn <= today && (!graceUntil || graceUntil < today)) next = 'REVERIFICATION';
        if (!next || next === document.lifecycle_state) continue;
        await client.query(
          `UPDATE marketplace.vendor_verification_documents SET lifecycle_state=$2,
          updated_at=$3 WHERE verification_document_id=$1`,
          [document.verification_document_id, next, at],
        );
        const priority = (value: OnboardingState): number =>
          value === 'REVERIFICATION' ? 3 : value === 'GRACE' ? 2 : 1;
        const current = caseStates.get(document.onboarding_case_id);
        if (!current || priority(next as OnboardingState) > priority(current)) {
          caseStates.set(document.onboarding_case_id, next as OnboardingState);
        }
        changed += 1;
      }
      for (const [caseId, state] of caseStates) {
        const row = await lockCase(client, parseUuidV7(caseId));
        const version = row.version + 1;
        const eventType =
          state === 'EXPIRING'
            ? 'EXPIRING'
            : state === 'GRACE'
              ? 'GRACE_GRANTED'
              : 'REVERIFICATION_REQUIRED';
        const reasonCode =
          state === 'EXPIRING'
            ? 'DOCUMENT_EXPIRING'
            : state === 'GRACE'
              ? 'DOCUMENT_GRACE_ACTIVE'
              : 'DOCUMENT_REVERIFICATION_REQUIRED';
        await client.query(
          `UPDATE marketplace.vendor_onboarding_cases SET lifecycle_state=$2,
          current_reason_code=$3, version=$4, updated_at=$5 WHERE onboarding_case_id=$1`,
          [caseId, state, reasonCode, version, at],
        );
        await event(client, {
          actor_user_id: null,
          case_version: version,
          context: input.context,
          event_type: eventType,
          now: at,
          onboarding_case_id: parseUuidV7(caseId),
          reason_code: reasonCode,
        });
      }
      return changed;
    });
  }

  async getForApplicant(input: {
    readonly applicant_user_id: UuidV7;
    readonly onboarding_case_id: UuidV7;
  }): Promise<OnboardingCaseSummary> {
    const result = await this.#pool.query<CaseRow>(
      `SELECT * FROM marketplace.vendor_onboarding_cases
      WHERE onboarding_case_id=$1 AND applicant_user_id=$2`,
      [input.onboarding_case_id, input.applicant_user_id],
    );
    if (!result.rows[0]) throw new VendorOnboardingNotFoundError('Onboarding case was not found');
    return this.#summary(result.rows[0]);
  }

  /**
   * The review queue.
   *
   * The console could open a case by id and nothing else, so an admin could only
   * review an application whose UUID had reached them through some channel
   * outside the product — which meant self-service vendor onboarding had no
   * usable path to approval at all. Cases awaiting a decision come first;
   * decided ones stay visible so a reviewer can find what they just did.
   */
  async listForAdmin(input: { readonly context: RequestContext; readonly limit?: number }): Promise<
    readonly {
      readonly onboarding_case_id: UuidV7;
      readonly lifecycle_state: string;
      readonly entry_kind: string;
      readonly business_profile_reference: string | null;
      readonly document_count: number;
      readonly awaiting_review: boolean;
      readonly updated_at: Date;
    }[]
  > {
    requireAdmin(input.context);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const result = await this.#pool.query<{
      onboarding_case_id: string;
      lifecycle_state: string;
      entry_kind: string;
      business_profile_reference: string | null;
      document_count: string;
      awaiting_review: boolean;
      updated_at: Date;
    }>(
      `SELECT c.onboarding_case_id, c.lifecycle_state, c.entry_kind,
              c.business_profile_reference, c.updated_at,
              c.lifecycle_state IN ('PENDING', 'UNDER_REVIEW', 'REVERIFICATION') AS awaiting_review,
              (SELECT count(*) FROM marketplace.vendor_verification_documents d
                WHERE d.onboarding_case_id = c.onboarding_case_id)::text AS document_count
         FROM marketplace.vendor_onboarding_cases c
        ORDER BY (c.lifecycle_state IN ('PENDING', 'UNDER_REVIEW', 'REVERIFICATION')) DESC,
                 c.updated_at DESC
        LIMIT $1`,
      [limit],
    );
    return Object.freeze(
      result.rows.map((row) =>
        Object.freeze({
          awaiting_review: row.awaiting_review,
          business_profile_reference: row.business_profile_reference,
          document_count: Number(row.document_count),
          entry_kind: row.entry_kind,
          lifecycle_state: row.lifecycle_state,
          onboarding_case_id: parseUuidV7(row.onboarding_case_id),
          updated_at: row.updated_at,
        }),
      ),
    );
  }

  async getForAdmin(input: {
    readonly context: RequestContext;
    readonly onboarding_case_id: UuidV7;
  }): Promise<OnboardingCaseSummary> {
    requireAdmin(input.context);
    const result = await this.#pool.query<CaseRow>(
      'SELECT * FROM marketplace.vendor_onboarding_cases WHERE onboarding_case_id=$1',
      [input.onboarding_case_id],
    );
    if (!result.rows[0]) throw new VendorOnboardingNotFoundError('Onboarding case was not found');
    return this.#summary(result.rows[0]);
  }

  async #summary(row: CaseRow): Promise<OnboardingCaseSummary> {
    const documents = await this.#pool.query<DocumentRow>(
      `SELECT DISTINCT ON (document_kind) *
      FROM marketplace.vendor_verification_documents WHERE onboarding_case_id=$1
      ORDER BY document_kind, document_version DESC`,
      [row.onboarding_case_id],
    );
    return Object.freeze({
      applicant_user_id: row.applicant_user_id ? parseUuidV7(row.applicant_user_id) : null,
      business_profile_reference: row.business_profile_reference,
      documents: Object.freeze(documents.rows.map(documentSummary)),
      entry_kind: row.entry_kind,
      invitation_reference: row.invitation_reference,
      lifecycle_state: row.lifecycle_state,
      onboarding_case_id: parseUuidV7(row.onboarding_case_id),
      payout_profile_reference: row.payout_profile_reference,
      vendor_id: row.vendor_id ? parseUuidV7(row.vendor_id) : null,
      vendor_location_id: row.vendor_location_id ? parseUuidV7(row.vendor_location_id) : null,
      version: row.version,
    });
  }

  async issueDocumentReadGrant(input: {
    readonly context: RequestContext;
    readonly verification_document_id: UuidV7;
  }): Promise<{
    readonly content_sha256: string;
    readonly grant: string;
    readonly media_type: ProtectedMediaType;
  }> {
    requireAdmin(input.context);
    const found = await this.#pool.query<DocumentRow>(
      `SELECT * FROM marketplace.vendor_verification_documents
      WHERE verification_document_id=$1`,
      [input.verification_document_id],
    );
    const document = found.rows[0];
    if (!document) throw new VendorOnboardingNotFoundError('Document was not found');
    return Object.freeze({
      content_sha256: document.content_sha256,
      grant: this.#storage.issueReadGrant({ object_key: document.object_key, ttl_seconds: 60 }),
      media_type: document.media_type,
    });
  }

  async readDocumentWithGrant(input: {
    readonly context: RequestContext;
    readonly grant: string;
    readonly verification_document_id: UuidV7;
  }): Promise<{ readonly content: Uint8Array; readonly media_type: ProtectedMediaType }> {
    requireAdmin(input.context);
    const found = await this.#pool.query<DocumentRow>(
      `SELECT * FROM marketplace.vendor_verification_documents
      WHERE verification_document_id=$1`,
      [input.verification_document_id],
    );
    const document = found.rows[0];
    if (!document) throw new VendorOnboardingNotFoundError('Document was not found');
    const content = await this.#storage.readGranted({
      expected_sha256: document.content_sha256,
      grant: input.grant,
    });
    return Object.freeze({ content, media_type: document.media_type });
  }
}
