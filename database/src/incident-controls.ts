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
import { transaction as tx } from './transaction.js';

export class IncidentControlInputError extends Error {}
export class IncidentControlNotFoundError extends Error {}
export class IncidentControlStateError extends Error {}
export class IncidentControlAuthorizationError extends Error {}

export type IncidentControlKey =
  | 'VENDOR_PAUSE'
  | 'CATEGORY_PAUSE'
  | 'ZONE_PAUSE'
  | 'DELIVERY_PAUSE'
  | 'PARTNER_ASSIGNMENT_PAUSE'
  | 'PAYMENT_PAUSE'
  | 'SUBSTITUTION_PAUSE'
  | 'GROUPED_CHECKOUT_PAUSE'
  | 'PAYOUT_PAUSE';

export type IncidentScopeKind =
  'GLOBAL' | 'ZONE' | 'VENDOR_LOCATION' | 'CATEGORY' | 'PAYMENT_METHOD' | 'PAYOUT_BENEFICIARY';

type CatalogueEntry = {
  readonly key: IncidentControlKey;
  readonly title: string;
  readonly scopes: readonly IncidentScopeKind[];
  /** Pausing it touches money, so a second person approves it at any scope. */
  readonly money: boolean;
  /** What stops while it is engaged. */
  readonly stops: string;
  /** What must and does carry on. */
  readonly continues: readonly string[];
  /** Worked before it is lifted. */
  readonly checklist: readonly string[];
};

const STORE_SCOPES: readonly IncidentScopeKind[] = ['GLOBAL', 'ZONE', 'VENDOR_LOCATION'];
const ORDERS_CONTINUE =
  'Orders already placed are accepted, picked, handed over and delivered as normal; refunds and support continue.';
const CUSTODY_CONTINUES = 'Partners already carrying an order keep it until delivery or return.';
const COMMON_CHECKLIST = [
  'The cause is fixed or no longer applies',
  'Orders placed before the pause are moving (none stalled by it)',
  'The people it affected have been told it is lifting',
];

/**
 * The pauses operations can engage (11.7), each in the scopes the code that
 * honours it can see. Promotions do not exist in this product, so there is
 * no promotion pause to engage: offering one would pause nothing.
 */
export const INCIDENT_CATALOGUE: readonly CatalogueEntry[] = [
  {
    key: 'VENDOR_PAUSE',
    title: 'Pause a shop',
    scopes: ['VENDOR_LOCATION'],
    money: false,
    stops: 'New orders from the shop: checkout blocks its group.',
    continues: [ORDERS_CONTINUE, CUSTODY_CONTINUES],
    checklist: COMMON_CHECKLIST,
  },
  {
    key: 'CATEGORY_PAUSE',
    title: 'Pause a category',
    scopes: ['CATEGORY'],
    money: false,
    stops: 'New orders for items in the category, at every shop.',
    continues: [ORDERS_CONTINUE, CUSTODY_CONTINUES],
    checklist: COMMON_CHECKLIST,
  },
  {
    key: 'ZONE_PAUSE',
    title: 'Pause a zone',
    scopes: ['ZONE'],
    money: false,
    stops: 'New orders from every shop in the zone.',
    continues: [
      ORDERS_CONTINUE,
      'Orders already placed there are still offered to partners.',
      CUSTODY_CONTINUES,
    ],
    checklist: COMMON_CHECKLIST,
  },
  {
    key: 'DELIVERY_PAUSE',
    title: 'Pause platform delivery',
    scopes: STORE_SCOPES,
    money: false,
    stops:
      'New platform-delivery orders; customers can still choose pickup where the shop offers it.',
    continues: [
      'Platform-delivery orders already placed are still offered to partners and delivered.',
      CUSTODY_CONTINUES,
    ],
    checklist: COMMON_CHECKLIST,
  },
  {
    key: 'PARTNER_ASSIGNMENT_PAUSE',
    title: 'Pause partner assignment',
    scopes: STORE_SCOPES,
    money: false,
    stops: 'New offers to partners: orders waiting for a partner wait.',
    continues: [
      CUSTODY_CONTINUES,
      'Shops keep preparing; operations may cancel or return a waiting order from the monitor.',
    ],
    checklist: [...COMMON_CHECKLIST, 'Orders that waited for a partner are being offered again'],
  },
  {
    key: 'PAYMENT_PAUSE',
    title: 'Pause payment (a method, or the provider)',
    scopes: ['GLOBAL', 'PAYMENT_METHOD'],
    money: true,
    stops:
      'New payments: placing an order with the paused method (or any, for the provider) is refused before the provider is asked.',
    continues: [
      'Authorised payments are captured; refunds are submitted; unanswered payments are reconciled.',
      ORDERS_CONTINUE,
    ],
    checklist: [...COMMON_CHECKLIST, 'Unanswered payments from the incident are reconciled'],
  },
  {
    key: 'SUBSTITUTION_PAUSE',
    title: 'Pause substitutions',
    scopes: STORE_SCOPES,
    money: false,
    stops: 'New substitution proposals from shops.',
    continues: [
      'Proposals already sent still await the customer’s decision.',
      'Shops can still mark an item unavailable or propose a weight.',
    ],
    checklist: COMMON_CHECKLIST,
  },
  {
    key: 'GROUPED_CHECKOUT_PAUSE',
    title: 'Pause grouped checkout',
    scopes: ['GLOBAL'],
    money: false,
    stops: 'Checkout of more than one shop at once; a single shop still checks out.',
    continues: ['Grouped checkouts already placed continue.', ORDERS_CONTINUE],
    checklist: COMMON_CHECKLIST,
  },
  {
    key: 'PAYOUT_PAUSE',
    title: 'Pause payouts',
    scopes: ['GLOBAL', 'PAYOUT_BENEFICIARY'],
    money: true,
    stops: 'Submitting payouts to shops or partners: scheduled payouts wait.',
    continues: [
      'Earnings and settlements keep accruing in the ledger.',
      'Payouts already submitted are reconciled.',
    ],
    checklist: [...COMMON_CHECKLIST, 'Payouts held by the pause are submitted'],
  },
];

const MANAGE = 'admin.incident.manage';
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
const CATEGORY = /^[A-Z][A-Z0-9_]{2,63}$/;
/** An engagement lasts at most a week; a longer one is a product change. */
export const MAX_INCIDENT_MS = 7 * 24 * 60 * 60_000;
/** Someone looks at it at least daily. */
export const MAX_REVIEW_MS = 24 * 60 * 60_000;

export type IncidentAction = 'APPROVE' | 'REJECT' | 'REVIEW' | 'CHECK' | 'REVOKE';

type ControlRow = {
  incident_control_id: string;
  control_key: IncidentControlKey;
  scope_kind: IncidentScopeKind;
  scope_reference: string;
  lifecycle_state: string;
  reason_code: string;
  owner_user_id: string;
  proposed_by: string;
  approval_required: boolean;
  approved_by: string | null;
  approved_at: Date | null;
  activated_at: Date | null;
  expires_at: Date;
  review_at: Date;
  closed_by: string | null;
  closed_at: Date | null;
  closing_reason_code: string | null;
  banner: string | null;
  impact: unknown;
  recovery_checklist: { item: string; done_by: string | null; done_at: string | null }[];
  version: number;
  created_at: Date;
};

function entryFor(key: string): CatalogueEntry {
  const entry = INCIDENT_CATALOGUE.find((candidate) => candidate.key === key);
  if (!entry) {
    throw new IncidentControlInputError(
      key === 'PROMOTION_PAUSE'
        ? 'There are no promotions to pause'
        : `Control must be one of ${INCIDENT_CATALOGUE.map((c) => c.key).join(', ')}`,
    );
  }
  return entry;
}

/** Broad or money-touching pauses need a second person before they take force. */
export function needsApproval(key: string, scopeKind: string): boolean {
  return scopeKind === 'GLOBAL' || entryFor(key).money;
}

/** The steps a control's state allows. */
export function incidentActionsFor(state: string): readonly IncidentAction[] {
  switch (state) {
    case 'PENDING_APPROVAL':
      return ['APPROVE', 'REJECT'];
    case 'ACTIVE':
      return ['REVIEW', 'CHECK', 'REVOKE'];
    default:
      return [];
  }
}

export class IncidentControlService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-incident-controls',
      max: 4,
    });
  }

  async close() {
    await releaseServicePool(this.#pool);
  }

  catalogue() {
    return {
      controls: INCIDENT_CATALOGUE.map((entry) => ({
        key: entry.key,
        title: entry.title,
        scopes: entry.scopes,
        approval: entry.money ? 'ALWAYS' : 'WHEN_GLOBAL',
        stops: entry.stops,
        continues: entry.continues,
        checklist: entry.checklist,
      })),
    };
  }

  /** What a pause would stop now and what would carry on (requirement 2). Changes nothing. */
  async preview(input: {
    readonly context: RequestContext;
    readonly control_key: string;
    readonly scope_kind: string;
    readonly scope_reference: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.#require(this.#pool, input.context, now);
    const scope = await this.#scope(this.#pool, input);
    return this.#impact(this.#pool, scope.entry, scope.kind, scope.reference, now);
  }

  /** Engages a pause, or proposes it for approval (requirements 1 and 3). */
  async engage(input: {
    readonly context: RequestContext;
    readonly control_key: string;
    readonly scope_kind: string;
    readonly scope_reference: string;
    readonly reason_code: string;
    readonly banner: string;
    readonly expires_at: Date;
    readonly review_at: Date;
    readonly owner_user_id?: UuidV7;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const reasonCode = reason(input.reason_code);
    const banner = input.banner.trim();
    if (banner.length < 8 || banner.length > 200)
      throw new IncidentControlInputError('The banner is 8 to 200 characters');
    if (input.expires_at.getTime() <= now.getTime())
      throw new IncidentControlInputError('A control expires in the future');
    if (input.expires_at.getTime() > now.getTime() + MAX_INCIDENT_MS)
      throw new IncidentControlInputError('A control lasts at most seven days');
    if (
      input.review_at.getTime() <= now.getTime() ||
      input.review_at.getTime() > input.expires_at.getTime() ||
      input.review_at.getTime() > now.getTime() + MAX_REVIEW_MS
    )
      throw new IncidentControlInputError(
        'A review is due within a day, and no later than the expiry',
      );
    return tx(this.#pool, async (client) => {
      const actor = await this.#require(client, input.context, now);
      const scope = await this.#scope(client, input);
      const owner = input.owner_user_id ?? actor;
      if (owner !== actor && !(await globalAdminCapabilities(client, owner, now)).has(MANAGE))
        throw new IncidentControlInputError('The owner is someone who manages incidents');
      const approval = needsApproval(scope.entry.key, scope.kind);
      const impact = await this.#impact(client, scope.entry, scope.kind, scope.reference, now);
      const id = createUuidV7();
      try {
        await client.query(
          `INSERT INTO marketplace.incident_controls
             (incident_control_id, control_key, scope_kind, scope_reference, lifecycle_state,
              reason_code, owner_user_id, proposed_by, approval_required, activated_at,
              expires_at, review_at, obligations, banner, impact, recovery_checklist,
              request_id, correlation_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)`,
          [
            id,
            scope.entry.key,
            scope.kind,
            scope.reference,
            approval ? 'PENDING_APPROVAL' : 'ACTIVE',
            reasonCode,
            owner,
            actor,
            approval,
            approval ? null : now,
            input.expires_at,
            input.review_at,
            JSON.stringify(scope.entry.continues),
            banner,
            JSON.stringify(impact),
            JSON.stringify(
              scope.entry.checklist.map((item) => ({ item, done_by: null, done_at: null })),
            ),
            parseRequestId(input.context.request_id),
            parseUuidV7(input.context.correlation_id),
            now,
          ],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new IncidentControlStateError('That pause is already engaged or awaiting approval');
        throw error;
      }
      // Engaged at once, or proposed for a second person: the first event says which.
      await this.#event(
        client,
        id,
        approval ? 'PROPOSED' : 'ACTIVATED',
        null,
        approval ? 'PENDING_APPROVAL' : 'ACTIVE',
        actor,
        reasonCode,
        now,
        { owner_user_id: owner, impact },
      );
      await this.#audit(client, input.context, actor, {
        action: approval ? 'INCIDENT_CONTROL_PROPOSED' : 'INCIDENT_CONTROL_ENGAGED',
        id,
        reason_code: reasonCode,
        before: null,
        after: {
          control_key: scope.entry.key,
          scope_kind: scope.kind,
          scope_reference: scope.reference,
        },
      });
      return this.#project(client, id, now);
    });
  }

  /** Approve, reject, review, tick a checklist item, or lift (requirements 3 and 4). */
  async act(input: {
    readonly context: RequestContext;
    readonly incident_control_id: UuidV7;
    readonly action: IncidentAction;
    readonly expected_version: number;
    readonly reason_code: string;
    readonly review_at?: Date;
    readonly expires_at?: Date;
    readonly item_index?: number;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const reasonCode = reason(input.reason_code);
    return tx(this.#pool, async (client) => {
      const actor = await this.#require(client, input.context, now);
      const row = await this.#row(client, input.incident_control_id, true);
      if (row.version !== input.expected_version)
        throw new IncidentControlStateError('The control changed since it was read');
      if (!incidentActionsFor(row.lifecycle_state).includes(input.action))
        throw new IncidentControlStateError(
          `A ${row.lifecycle_state.toLowerCase()} control cannot be ${input.action.toLowerCase()}ed`,
        );
      const before = { state: row.lifecycle_state, version: row.version };
      let to = row.lifecycle_state;
      switch (input.action) {
        case 'APPROVE': {
          if (row.proposed_by === actor)
            throw new IncidentControlStateError(
              'A pause is approved by someone who did not propose it',
            );
          if (row.expires_at.getTime() <= now.getTime())
            throw new IncidentControlStateError('The proposal expired before it was approved');
          to = 'ACTIVE';
          await client.query(
            `UPDATE marketplace.incident_controls
                SET lifecycle_state='ACTIVE', approved_by=$2, approved_at=$3, activated_at=$3,
                    version=version+1, updated_at=$3
              WHERE incident_control_id=$1`,
            [row.incident_control_id, actor, now],
          );
          await this.#event(
            client,
            row.incident_control_id,
            'APPROVED',
            'PENDING_APPROVAL',
            'PENDING_APPROVAL',
            actor,
            reasonCode,
            now,
          );
          await this.#event(
            client,
            row.incident_control_id,
            'ACTIVATED',
            'PENDING_APPROVAL',
            'ACTIVE',
            actor,
            reasonCode,
            now,
          );
          break;
        }
        case 'REJECT':
        case 'REVOKE': {
          if (input.action === 'REVOKE') {
            const open = row.recovery_checklist.filter((entry) => entry.done_at === null);
            if (open.length > 0)
              throw new IncidentControlStateError(
                `The recovery checklist is not worked: ${open.map((entry) => entry.item).join('; ')}`,
              );
          }
          to = input.action === 'REJECT' ? 'REJECTED' : 'REVOKED';
          await client.query(
            `UPDATE marketplace.incident_controls
                SET lifecycle_state=$2, closed_by=$3, closed_at=$4, closing_reason_code=$5,
                    version=version+1, updated_at=$4
              WHERE incident_control_id=$1`,
            [row.incident_control_id, to, actor, now, reasonCode],
          );
          await this.#event(
            client,
            row.incident_control_id,
            input.action === 'REJECT' ? 'REJECTED' : 'REVOKED',
            row.lifecycle_state,
            to,
            actor,
            reasonCode,
            now,
          );
          break;
        }
        case 'REVIEW': {
          const expires = input.expires_at ?? row.expires_at;
          const review = input.review_at;
          if (!review)
            throw new IncidentControlInputError('A review sets when the next one is due');
          const started = (row.activated_at ?? row.created_at).getTime();
          if (expires.getTime() <= now.getTime() || expires.getTime() > started + MAX_INCIDENT_MS)
            throw new IncidentControlInputError(
              'A control lasts at most seven days from when it took force',
            );
          if (
            review.getTime() <= now.getTime() ||
            review.getTime() > expires.getTime() ||
            review.getTime() > now.getTime() + MAX_REVIEW_MS
          )
            throw new IncidentControlInputError(
              'The next review is due within a day, and no later than the expiry',
            );
          await client.query(
            `UPDATE marketplace.incident_controls
                SET review_at=$2, expires_at=$3, version=version+1, updated_at=$4
              WHERE incident_control_id=$1`,
            [row.incident_control_id, review, expires, now],
          );
          await this.#event(
            client,
            row.incident_control_id,
            'REVIEWED',
            'ACTIVE',
            'ACTIVE',
            actor,
            reasonCode,
            now,
            {
              review_at: review.toISOString(),
              expires_at: expires.toISOString(),
            },
          );
          break;
        }
        case 'CHECK': {
          const index = input.item_index;
          const entry = index === undefined ? undefined : row.recovery_checklist[index];
          if (index === undefined || !entry)
            throw new IncidentControlInputError('Name a checklist item');
          if (entry.done_at !== null)
            throw new IncidentControlStateError('That item is already done');
          const checklist = row.recovery_checklist.map((item, at) =>
            at === index ? { ...item, done_by: actor, done_at: now.toISOString() } : item,
          );
          await client.query(
            `UPDATE marketplace.incident_controls
                SET recovery_checklist=$2, version=version+1, updated_at=$3
              WHERE incident_control_id=$1`,
            [row.incident_control_id, JSON.stringify(checklist), now],
          );
          await this.#event(
            client,
            row.incident_control_id,
            'CHECKLIST_ITEM_DONE',
            'ACTIVE',
            'ACTIVE',
            actor,
            reasonCode,
            now,
            {
              item: entry.item,
            },
          );
          break;
        }
      }
      await this.#audit(client, input.context, actor, {
        action: `INCIDENT_CONTROL_${input.action}`,
        id: row.incident_control_id,
        reason_code: reasonCode,
        before,
        after: { state: to, version: row.version + 1 },
        approval_reference: input.action === 'APPROVE' ? row.incident_control_id : null,
      });
      return this.#project(client, row.incident_control_id, now);
    });
  }

  /** Live controls first, then the most recent closed ones. */
  async list(input: { readonly context: RequestContext; readonly now?: Date }) {
    const now = input.now ?? new Date();
    await this.#require(this.#pool, input.context, now);
    const rows = await this.#pool.query<{ incident_control_id: string }>(
      `(SELECT incident_control_id, 0 AS rank, created_at FROM marketplace.incident_controls
         WHERE lifecycle_state IN ('PENDING_APPROVAL','ACTIVE'))
       UNION ALL
       (SELECT incident_control_id, 1 AS rank, created_at FROM marketplace.incident_controls
         WHERE lifecycle_state NOT IN ('PENDING_APPROVAL','ACTIVE')
         ORDER BY created_at DESC LIMIT 30)
       ORDER BY rank, created_at DESC`,
    );
    const controls = [];
    for (const row of rows.rows)
      controls.push(await this.#project(this.#pool, row.incident_control_id, now));
    return { controls };
  }

  async detail(input: {
    readonly context: RequestContext;
    readonly incident_control_id: UuidV7;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    await this.#require(this.#pool, input.context, now);
    await this.#row(this.#pool, input.incident_control_id, false);
    const history = await this.#pool.query<{
      event_type: string;
      from_state: string | null;
      to_state: string;
      actor_id: string | null;
      reason_code: string;
      payload: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `SELECT event_type, from_state, to_state, actor_id, reason_code, payload, occurred_at
         FROM marketplace.incident_control_events WHERE incident_control_id=$1
        ORDER BY occurred_at, incident_control_event_id`,
      [input.incident_control_id],
    );
    return {
      ...(await this.#project(this.#pool, input.incident_control_id, now)),
      history: history.rows,
    };
  }

  /**
   * The banners every surface shows while a pause is in force (requirement
   * 4). Public: they say what is paused and until when, nothing about who.
   */
  async banners(input: { readonly now?: Date } = {}) {
    const now = input.now ?? new Date();
    const rows = await this.#pool.query<{
      control_key: string;
      scope_kind: string;
      scope_reference: string;
      banner: string;
      expires_at: Date;
    }>(
      `SELECT control_key, scope_kind, scope_reference, banner, expires_at
         FROM marketplace.incident_controls
        WHERE lifecycle_state='ACTIVE' AND activated_at <= $1 AND expires_at > $1 AND banner IS NOT NULL
        ORDER BY activated_at`,
      [now],
    );
    return {
      banners: rows.rows.map((row) => ({
        control_key: row.control_key,
        scope_kind: row.scope_kind,
        scope_reference: row.scope_reference,
        message: row.banner,
        until: row.expires_at.toISOString(),
      })),
    };
  }

  /** Closes what has run out, pending or engaged, on its own record. */
  async expireDue(input: { readonly context: RequestContext; readonly now?: Date }) {
    const kind = input.context.actor?.actor_kind;
    if (kind !== 'admin' && kind !== 'system') throw new IncidentControlAuthorizationError();
    const now = input.now ?? new Date();
    return tx(this.#pool, async (client) => {
      const lapsed = await client.query<{ incident_control_id: string; lifecycle_state: string }>(
        `SELECT incident_control_id, lifecycle_state FROM marketplace.incident_controls
          WHERE lifecycle_state IN ('PENDING_APPROVAL','ACTIVE') AND expires_at <= $1
          FOR UPDATE SKIP LOCKED`,
        [now],
      );
      for (const row of lapsed.rows) {
        await client.query(
          `UPDATE marketplace.incident_controls
              SET lifecycle_state='EXPIRED', closed_at=$2, version=version+1, updated_at=$2
            WHERE incident_control_id=$1`,
          [row.incident_control_id, now],
        );
        await this.#event(
          client,
          row.incident_control_id,
          'EXPIRED',
          row.lifecycle_state,
          'EXPIRED',
          null,
          'EXPIRY_REACHED',
          now,
        );
      }
      return { incidents: lapsed.rows.length };
    });
  }

  async #scope(
    queryable: Pick<Pool | PoolClient, 'query'>,
    input: {
      readonly control_key: string;
      readonly scope_kind: string;
      readonly scope_reference: string;
    },
  ) {
    const entry = entryFor(input.control_key);
    const kind = input.scope_kind as IncidentScopeKind;
    if (!entry.scopes.includes(kind))
      throw new IncidentControlInputError(
        `${entry.title} is scoped ${entry.scopes.join(' or ')}, not ${input.scope_kind}`,
      );
    const raw = input.scope_reference.trim();
    let reference = raw;
    switch (kind) {
      case 'GLOBAL':
        reference = 'global';
        break;
      case 'VENDOR_LOCATION': {
        const found = await queryable.query(
          'SELECT 1 FROM marketplace.vendor_locations WHERE vendor_location_id::text = $1',
          [raw],
        );
        if (!found.rows.length) throw new IncidentControlNotFoundError('No such shop');
        break;
      }
      case 'ZONE': {
        const found = await queryable.query(
          `SELECT 1 FROM marketplace.vendor_service_zones
            WHERE lifecycle_state='ACTIVE' AND (service_zone_id::text = $1 OR zone_name = $1) LIMIT 1`,
          [raw],
        );
        if (!found.rows.length) throw new IncidentControlNotFoundError('No such active zone');
        break;
      }
      case 'CATEGORY': {
        if (!CATEGORY.test(raw)) throw new IncidentControlInputError('Name a category');
        const found = await queryable.query(
          'SELECT 1 FROM marketplace.catalogue_products WHERE category = $1 LIMIT 1',
          [raw],
        );
        if (!found.rows.length)
          throw new IncidentControlNotFoundError('No product is in that category');
        break;
      }
      case 'PAYMENT_METHOD':
        if (!['UPI', 'CARD', 'WALLET'].includes(raw))
          throw new IncidentControlInputError('A payment method is UPI, CARD or WALLET');
        break;
      case 'PAYOUT_BENEFICIARY':
        if (!['PARTNER', 'VENDOR'].includes(raw))
          throw new IncidentControlInputError('Payouts are paused for PARTNER or VENDOR');
        break;
    }
    return { entry, kind, reference };
  }

  /** Counts of what would stop and what carries on, for the preview and the record. */
  async #impact(
    queryable: Pick<Pool | PoolClient, 'query'>,
    entry: CatalogueEntry,
    kind: IncidentScopeKind,
    reference: string,
    now: Date,
  ) {
    const count = async (sql: string, params: unknown[]) =>
      Number(
        (await queryable.query<{ n: string }>(`SELECT (${sql})::text AS n`, params)).rows[0]?.n ??
          0,
      );
    // The shops a store-scoped pause reaches.
    const scoped = `SELECT l.vendor_location_id FROM marketplace.vendor_locations l
       WHERE l.lifecycle_state='ACTIVE' AND (
         $1::text IN ('GLOBAL','CATEGORY')
         OR ($1='VENDOR_LOCATION' AND l.vendor_location_id::text=$2)
         OR ($1='ZONE' AND EXISTS (SELECT 1 FROM marketplace.vendor_service_zones z
               WHERE z.vendor_location_id=l.vendor_location_id AND z.lifecycle_state='ACTIVE'
                 AND (z.service_zone_id::text=$2 OR z.zone_name=$2))))`;
    const params = [kind, reference];
    const openOrders = () =>
      count(
        `SELECT count(*) FROM marketplace.vendor_orders o WHERE o.vendor_location_id IN (${scoped})
           AND o.lifecycle_state NOT IN ('DELIVERED','RETURNED','CANCELLED','EXPIRED')`,
        params,
      );
    const underWay = () =>
      count(
        `SELECT count(*) FROM marketplace.delivery_assignments a WHERE a.vendor_location_id IN (${scoped})
           AND a.assignment_state IN ('ASSIGNED','AT_VENDOR','PICKED_UP','EN_ROUTE_TO_CUSTOMER','ARRIVED',
                                      'DELIVERY_FAILED','RETURN_REQUIRED','RETURN_AUTHORIZED','RETURNING')`,
        params,
      );
    const liveQuotes = (extra = '') =>
      count(
        `SELECT count(DISTINCT q.checkout_quote_id) FROM marketplace.checkout_quotes q
           JOIN marketplace.checkout_quote_groups g USING (checkout_quote_id)
          WHERE q.lifecycle_state='ACTIVE' AND q.expires_at > $3 AND g.vendor_location_id IN (${scoped}) ${extra}`,
        [...params, now],
      );
    const stops: { label: string; count: number }[] = [];
    const continues: { label: string; count: number }[] = [];
    switch (entry.key) {
      case 'VENDOR_PAUSE':
      case 'ZONE_PAUSE':
      case 'DELIVERY_PAUSE': {
        const method =
          entry.key === 'DELIVERY_PAUSE' ? "AND g.fulfilment_method='PLATFORM_DELIVERY'" : '';
        stops.push({
          label: 'Shops taking no new orders',
          count: await count(`SELECT count(*) FROM (${scoped}) s`, params),
        });
        stops.push({
          label: 'Active baskets with a group there',
          count: await count(
            `SELECT count(DISTINCT g.cart_id) FROM marketplace.cart_vendor_groups g
               JOIN marketplace.carts c USING (cart_id)
              WHERE c.lifecycle_state='ACTIVE' AND g.lifecycle_state='ACTIVE'
                AND g.vendor_location_id IN (${scoped}) ${method}`,
            params,
          ),
        });
        stops.push({ label: 'Live quotes that will not place', count: await liveQuotes() });
        continues.push({ label: 'Open orders that continue', count: await openOrders() });
        continues.push({ label: 'Deliveries under way that continue', count: await underWay() });
        break;
      }
      case 'CATEGORY_PAUSE':
        stops.push({
          label: 'Products in the category taking no new orders',
          count: await count(
            `SELECT count(*) FROM marketplace.catalogue_products WHERE category=$1 AND lifecycle_state='ACTIVE'`,
            [reference],
          ),
        });
        stops.push({
          label: 'Active baskets holding one',
          count: await count(
            `SELECT count(DISTINCT c.cart_id) FROM marketplace.cart_lines cl
               JOIN marketplace.cart_vendor_groups g USING (cart_vendor_group_id)
               JOIN marketplace.carts c ON c.cart_id=g.cart_id
               JOIN marketplace.catalogue_product_variants v ON v.catalogue_variant_id=cl.catalogue_variant_id
               JOIN marketplace.catalogue_products p ON p.catalogue_product_id=v.catalogue_product_id
              WHERE c.lifecycle_state='ACTIVE' AND cl.lifecycle_state='ACTIVE' AND p.category=$1`,
            [reference],
          ),
        });
        continues.push({
          label: 'Open orders holding one that continue',
          count: await count(
            `SELECT count(DISTINCT o.vendor_order_id) FROM marketplace.vendor_orders o
               JOIN marketplace.vendor_order_lines ol ON ol.vendor_order_id=o.vendor_order_id
               JOIN marketplace.catalogue_product_variants v ON v.catalogue_variant_id=ol.catalogue_variant_id
               JOIN marketplace.catalogue_products p ON p.catalogue_product_id=v.catalogue_product_id
              WHERE p.category=$1
                AND o.lifecycle_state NOT IN ('DELIVERED','RETURNED','CANCELLED','EXPIRED')`,
            [reference],
          ),
        });
        break;
      case 'PARTNER_ASSIGNMENT_PAUSE':
        stops.push({
          label: 'Orders waiting for a partner, who will wait',
          count: await count(
            `SELECT count(*) FROM marketplace.delivery_assignments a WHERE a.vendor_location_id IN (${scoped})
               AND a.assignment_state IN ('UNASSIGNED','OFFERED')`,
            params,
          ),
        });
        continues.push({ label: 'Deliveries under way that continue', count: await underWay() });
        break;
      case 'SUBSTITUTION_PAUSE':
        stops.push({
          label: 'Open orders whose shop cannot propose a substitute',
          count: await openOrders(),
        });
        continues.push({
          label: 'Orders awaiting a customer decision that continue',
          count: await count(
            `SELECT count(*) FROM marketplace.vendor_order_customer_decisions d
               JOIN marketplace.vendor_orders o USING (vendor_order_id)
              WHERE o.vendor_location_id IN (${scoped}) AND d.proposal_kind='SUBSTITUTION'
                AND d.answer='PENDING'`,
            params,
          ),
        });
        break;
      case 'GROUPED_CHECKOUT_PAUSE':
        stops.push({
          label: 'Active baskets with more than one shop',
          count: await count(
            `SELECT count(*) FROM (SELECT g.cart_id FROM marketplace.cart_vendor_groups g
               JOIN marketplace.carts c USING (cart_id)
              WHERE c.lifecycle_state='ACTIVE' AND g.lifecycle_state='ACTIVE'
              GROUP BY g.cart_id HAVING count(*) > 1) multi`,
            [],
          ),
        });
        continues.push({
          label: 'Checkouts already placed that continue',
          count: await count(
            `SELECT count(*) FROM marketplace.checkout_groups WHERE lifecycle_state IN ('PROCESSING','ACTIVE','PARTIALLY_CANCELLED')`,
            [],
          ),
        });
        break;
      case 'PAYMENT_PAUSE':
        stops.push({
          label: 'Live quotes that cannot be paid this way',
          count: await count(
            `SELECT count(*) FROM marketplace.checkout_quotes WHERE lifecycle_state='ACTIVE' AND expires_at > $1`,
            [now],
          ),
        });
        continues.push({
          label: 'Authorised payments still captured',
          count: await count(
            `SELECT count(*) FROM marketplace.payment_transactions
              WHERE payment_state IN ('AUTHORIZED','CAPTURE_PENDING')
                AND ($1::text = 'global' OR payment_method = $1)`,
            [reference],
          ),
        });
        continues.push({
          label: 'Refunds still submitted',
          count: await count(
            `SELECT count(*) FROM marketplace.refunds
              WHERE refund_state IN ('REQUESTED','PENDING_APPROVAL','SUBMITTED','FAILED_RETRYABLE')`,
            [],
          ),
        });
        break;
      case 'PAYOUT_PAUSE': {
        const beneficiary = "($1::text = 'global' OR beneficiary_kind = $1)";
        stops.push({
          label: 'Scheduled payouts that will wait',
          count: await count(
            `SELECT count(*) FROM marketplace.payouts WHERE payout_state='SCHEDULED' AND ${beneficiary}`,
            [reference],
          ),
        });
        continues.push({
          label: 'Submitted payouts still reconciled',
          count: await count(
            `SELECT count(*) FROM marketplace.payouts WHERE payout_state='SUBMITTED' AND ${beneficiary}`,
            [reference],
          ),
        });
        break;
      }
    }
    return {
      control_key: entry.key,
      title: entry.title,
      scope: { kind, reference },
      approval_required: needsApproval(entry.key, kind),
      stops: { rule: entry.stops, counts: stops },
      continues: { rules: entry.continues, counts: continues },
      checklist: entry.checklist,
      previewed_at: now.toISOString(),
    };
  }

  async #project(queryable: Pick<Pool | PoolClient, 'query'>, id: string, now: Date) {
    const row = await this.#row(queryable, id, false);
    const entry = INCIDENT_CATALOGUE.find((candidate) => candidate.key === row.control_key);
    return {
      incident_control_id: row.incident_control_id,
      control_key: row.control_key,
      title: entry?.title ?? row.control_key,
      scope: { kind: row.scope_kind, reference: row.scope_reference },
      state: row.lifecycle_state,
      reason_code: row.reason_code,
      owner_user_id: row.owner_user_id,
      proposed_by: row.proposed_by,
      approval_required: row.approval_required,
      approved_by: row.approved_by,
      activated_at: row.activated_at?.toISOString() ?? null,
      expires_at: row.expires_at.toISOString(),
      review_at: row.review_at.toISOString(),
      review_overdue: row.lifecycle_state === 'ACTIVE' && row.review_at.getTime() <= now.getTime(),
      closed_by: row.closed_by,
      closed_at: row.closed_at?.toISOString() ?? null,
      closing_reason_code: row.closing_reason_code,
      banner: row.banner,
      impact: row.impact,
      stops: entry?.stops ?? null,
      continues: entry?.continues ?? [],
      recovery_checklist: row.recovery_checklist,
      checklist_open: row.recovery_checklist.filter((item) => item.done_at === null).length,
      actions: incidentActionsFor(row.lifecycle_state),
      version: row.version,
    };
  }

  async #row(queryable: Pick<Pool | PoolClient, 'query'>, id: string, lock: boolean) {
    const found = await queryable.query<ControlRow>(
      `SELECT * FROM marketplace.incident_controls WHERE incident_control_id::text=$1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    const row = found.rows[0];
    if (!row) throw new IncidentControlNotFoundError('No such incident control');
    return row;
  }

  async #require(queryable: Pick<Pool | PoolClient, 'query'>, context: RequestContext, now: Date) {
    if (context.actor?.actor_kind !== 'admin') throw new IncidentControlAuthorizationError();
    const held = await globalAdminCapabilities(queryable, context.actor.actor_id, now);
    if (!held.has(MANAGE)) throw new IncidentControlAuthorizationError();
    return context.actor.actor_id;
  }

  async #event(
    client: Pick<PoolClient, 'query'>,
    id: string,
    type: string,
    from: string | null,
    to: string,
    actor: string | null,
    reasonCode: string,
    at: Date,
    payload: Record<string, unknown> = {},
  ) {
    await client.query(
      `INSERT INTO marketplace.incident_control_events
         (incident_control_event_id, incident_control_id, event_type, from_state, to_state,
          actor_id, reason_code, payload, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [createUuidV7(), id, type, from, to, actor, reasonCode, JSON.stringify(payload), at],
    );
  }

  async #audit(
    client: Pick<PoolClient, 'query'>,
    context: RequestContext,
    actor: string,
    input: {
      readonly action: string;
      readonly id: string;
      readonly reason_code: string;
      readonly before: Record<string, unknown> | null;
      readonly after: Record<string, unknown> | null;
      readonly approval_reference?: string | null;
    },
  ) {
    await client.query(
      `INSERT INTO marketplace.operational_audit_events
         (operational_audit_event_id, action, target_kind, target_reference, actor_id, reason_code,
          before_value, after_value, request_id, correlation_id, approval_reference)
       VALUES ($1,$2,'INCIDENT_CONTROL',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        createUuidV7(),
        input.action,
        input.id,
        actor,
        input.reason_code,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        parseRequestId(context.request_id),
        parseUuidV7(context.correlation_id),
        input.approval_reference ?? null,
      ],
    );
  }
}

function reason(value: string): string {
  if (!REASON.test(value)) throw new IncidentControlInputError('Reason code is invalid');
  return value;
}
