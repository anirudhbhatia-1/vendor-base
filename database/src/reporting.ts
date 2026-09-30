import { createHash, randomBytes } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import type { Pool, PoolClient } from 'pg';
import { globalAdminCapabilities, zoneAdminCapabilities } from './admin-capabilities.js';
import { releaseServicePool, resolveServicePool } from './database-pool.js';
import { auditMoneyConservation } from './money-conservation.js';
import { transaction as tx } from './transaction.js';

export class ReportingInputError extends Error {}
export class ReportingNotFoundError extends Error {}
export class ReportingStateError extends Error {}
export class ReportingAuthorizationError extends Error {}

export type ReportKind =
  | 'CUSTOMER_FUNNEL'
  | 'MARKETPLACE'
  | 'VENDOR_HEALTH'
  | 'DELIVERY_OPERATIONS'
  | 'FINANCE'
  | 'SUPPORT'
  | 'RISK';

export type Classification = 'INTERNAL' | 'RESTRICTED';
export type MetricUnit = 'COUNT' | 'INR_MINOR' | 'BASIS_POINTS' | 'SECONDS' | 'BOOLEAN';

export type Metric = {
  readonly key: string;
  readonly label: string;
  readonly value: number | null;
  readonly unit: MetricUnit;
  /** What is counted, over what, in words an operator can check. */
  readonly definition: string;
  /** Over the period asked for, or as the data stands now. */
  readonly window: 'PERIOD' | 'NOW';
};

type Catalogue = {
  readonly kind: ReportKind;
  readonly title: string;
  readonly description: string;
  readonly classification: Classification;
  /** Holding any one of these reads the report; `admin.reporting.read` reads every report. */
  readonly readers: readonly string[];
  /** Reported for the whole platform only: its figures have no shop to scope by. */
  readonly global_only: boolean;
};

const ALL = 'admin.reporting.read';
const EXPORT = 'admin.reporting.export';

/**
 * The seven reports (11.8), each read by the people whose work it measures
 * and by incident command. Finance and risk are RESTRICTED and platform-wide;
 * the rest are INTERNAL aggregates and can be scoped to a zone.
 */
export const REPORT_CATALOGUE: readonly Catalogue[] = [
  {
    kind: 'CUSTOMER_FUNNEL',
    title: 'Customer funnel',
    description: 'From a basket started to an order delivered, and the conversion at each step.',
    classification: 'INTERNAL',
    readers: [ALL, 'admin.support.case_manage'],
    global_only: false,
  },
  {
    kind: 'MARKETPLACE',
    title: 'Marketplace',
    description: 'Orders, their value, and how many ended without being fulfilled.',
    classification: 'INTERNAL',
    readers: [ALL, 'admin.finance.ledger_manage'],
    global_only: false,
  },
  {
    kind: 'VENDOR_HEALTH',
    title: 'Vendor health',
    description: 'Whether shops answer orders in time and have them ready when promised.',
    classification: 'INTERNAL',
    readers: [
      ALL,
      'admin.vendor_onboarding.review',
      'admin.vendor_publication.review',
      'admin.catalogue.moderate',
    ],
    global_only: false,
  },
  {
    kind: 'DELIVERY_OPERATIONS',
    title: 'Delivery operations',
    description: 'Deliveries completed and failed, offers that lapsed, and time on the road.',
    classification: 'INTERNAL',
    readers: [ALL, 'admin.delivery.assignment_manage'],
    global_only: false,
  },
  {
    kind: 'FINANCE',
    title: 'Finance',
    description:
      'Money captured, refunded and paid out, what is at risk, and whether the ledger balances.',
    classification: 'RESTRICTED',
    readers: [ALL, 'admin.finance.ledger_manage'],
    global_only: true,
  },
  {
    kind: 'SUPPORT',
    title: 'Support',
    description: 'Cases opened and resolved, what is open, and how often a reply came late.',
    classification: 'INTERNAL',
    readers: [ALL, 'admin.support.case_manage'],
    global_only: false,
  },
  {
    kind: 'RISK',
    title: 'Risk',
    description: 'Signals collected, restrictions decided and in force, and appeals.',
    classification: 'RESTRICTED',
    readers: [ALL, 'admin.trust.restriction_propose', 'admin.trust.restriction_approve'],
    global_only: true,
  },
];

/** A period is at most a quarter. */
export const MAX_PERIOD_MS = 92 * 24 * 60 * 60_000;
const DEFAULT_PERIOD_MS = 7 * 24 * 60 * 60_000;

function entryFor(kind: string): Catalogue {
  const entry = REPORT_CATALOGUE.find((candidate) => candidate.kind === kind);
  if (!entry)
    throw new ReportingInputError(
      `Report must be one of ${REPORT_CATALOGUE.map((c) => c.kind).join(', ')}`,
    );
  return entry;
}

/** Integer basis points; null when there is nothing to divide by. */
export function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.floor((numerator * 10_000) / denominator) : null;
}

/** The period asked for, bounded: at most a quarter, never past now. */
export function reportPeriod(
  from: Date | undefined,
  to: Date | undefined,
  now: Date,
): { from: Date; to: Date } {
  const end = to && to.getTime() < now.getTime() ? to : now;
  const start = from ?? new Date(end.getTime() - DEFAULT_PERIOD_MS);
  if (start.getTime() > end.getTime())
    throw new ReportingInputError('A period starts before it ends');
  if (end.getTime() - start.getTime() > MAX_PERIOD_MS)
    throw new ReportingInputError('A period is at most 92 days');
  return { from: start, to: end };
}

/** The same JSON, however it was assembled, so its hash can be checked. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value as object)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}

export class ReportingService {
  readonly #pool: Pool;

  constructor(input: { readonly connection_string: string; readonly pool?: Pool }) {
    this.#pool = resolveServicePool(input, {
      application_name: 'neighbourhood-store-reporting',
      max: 4,
    });
  }

  async close() {
    await releaseServicePool(this.#pool);
  }

  /** The reports this person may read, and whether they may export them. */
  async catalogue(input: { readonly context: RequestContext; readonly now?: Date }) {
    const now = input.now ?? new Date();
    const actor = admin(input.context);
    const held = await globalAdminCapabilities(this.#pool, actor, now);
    return {
      reports: REPORT_CATALOGUE.filter((entry) => entry.readers.some((c) => held.has(c))).map(
        (entry) => ({
          kind: entry.kind,
          title: entry.title,
          description: entry.description,
          classification: entry.classification,
          global_only: entry.global_only,
          exportable: held.has(EXPORT),
        }),
      ),
    };
  }

  /** One report over a period, for the platform or one zone (requirements 1-3). */
  async report(input: {
    readonly context: RequestContext;
    readonly report_kind: string;
    readonly service_zone_id?: string;
    readonly from?: Date;
    readonly to?: Date;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const entry = entryFor(input.report_kind);
    const actor = await this.#access(
      this.#pool,
      input.context,
      entry,
      input.service_zone_id,
      now,
      false,
    );
    const report = await this.#build(this.#pool, entry, input, now);
    if (entry.classification === 'RESTRICTED')
      await this.#audit(this.#pool, input.context, actor, {
        action: 'REPORT_READ',
        target: entry.kind,
        after: { scope: report.scope, period: report.period },
      });
    return report;
  }

  /**
   * A snapshot of one report, classified at least as the report is, to be
   * taken once by the person who asked for it before it lapses (requirement 4).
   */
  async createExport(input: {
    readonly context: RequestContext;
    readonly report_kind: string;
    readonly service_zone_id?: string;
    readonly from?: Date;
    readonly to?: Date;
    readonly classification?: Classification;
    readonly expires_in_minutes?: number;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const entry = entryFor(input.report_kind);
    const minutes = input.expires_in_minutes ?? 15;
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 60)
      throw new ReportingInputError('An export lapses after 5 to 60 minutes');
    if (entry.classification === 'RESTRICTED' && input.classification === 'INTERNAL')
      throw new ReportingInputError(`${entry.title} is exported RESTRICTED, never lower`);
    const classification = input.classification ?? entry.classification;
    return tx(this.#pool, async (client) => {
      const actor = await this.#access(
        client,
        input.context,
        entry,
        input.service_zone_id,
        now,
        true,
      );
      const report = await this.#build(client, entry, input, now);
      const content = canonicalJson(report);
      const token = randomBytes(32).toString('base64url');
      const id = createUuidV7();
      const expiresAt = new Date(now.getTime() + minutes * 60_000);
      const filters = {
        from: report.period.from,
        to: report.period.to,
        service_zone_id: input.service_zone_id ?? null,
      };
      await client.query(
        `INSERT INTO marketplace.report_exports
           (report_export_id, report_kind, filters, classification, exported_by_user_id,
            expires_at, download_token_hash, request_id, correlation_id, created_at,
            scope_kind, scope_reference, period_from, period_to, content, content_sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id,
          entry.kind,
          JSON.stringify(filters),
          classification,
          actor,
          expiresAt,
          sha256(token),
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
          now,
          input.service_zone_id ? 'ZONE' : 'GLOBAL',
          input.service_zone_id ?? 'global',
          report.period.from,
          report.period.to,
          content,
          sha256(content),
        ],
      );
      await this.#audit(client, input.context, actor, {
        action: 'REPORT_EXPORT_CREATED',
        target: id,
        after: {
          report_kind: entry.kind,
          classification,
          filters,
          expires_at: expiresAt.toISOString(),
        },
      });
      return {
        report_export_id: id,
        report_kind: entry.kind,
        classification,
        expires_at: expiresAt.toISOString(),
        content_sha256: sha256(content),
        download_token: `nsx_${token}`,
      };
    });
  }

  /**
   * Takes an export once. Anyone else, a second take, or a lapsed one is
   * refused, and the attempt is recorded either way (requirement 5).
   */
  async redeemExport(input: {
    readonly context: RequestContext;
    readonly download_token: string;
    readonly now?: Date;
  }) {
    const now = input.now ?? new Date();
    const actor = admin(input.context);
    const raw = input.download_token.startsWith('nsx_') ? input.download_token.slice(4) : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new ReportingInputError('Export token is invalid');
    const result = await tx(this.#pool, async (client) => {
      const found = await client.query<{
        report_export_id: string;
        report_kind: string;
        classification: string;
        exported_by_user_id: string;
        expires_at: Date;
        downloaded_at: Date | null;
        content: unknown;
        content_sha256: string;
      }>(
        `SELECT report_export_id, report_kind, classification, exported_by_user_id, expires_at,
                downloaded_at, content, content_sha256
           FROM marketplace.report_exports WHERE download_token_hash=$1 FOR UPDATE`,
        [sha256(raw)],
      );
      const row = found.rows[0];
      if (!row) return { outcome: 'UNKNOWN' as const };
      const outcome =
        row.exported_by_user_id !== actor
          ? ('REFUSED_NOT_EXPORTER' as const)
          : row.downloaded_at !== null
            ? ('REFUSED_ALREADY_TAKEN' as const)
            : row.expires_at.getTime() <= now.getTime() || row.content === null
              ? ('REFUSED_EXPIRED' as const)
              : ('DOWNLOADED' as const);
      await client.query(
        `INSERT INTO marketplace.report_export_accesses
           (report_export_access_id, report_export_id, actor_id, outcome, request_id, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          createUuidV7(),
          row.report_export_id,
          actor,
          outcome,
          parseRequestId(input.context.request_id),
          now,
        ],
      );
      await this.#audit(client, input.context, actor, {
        action: outcome === 'DOWNLOADED' ? 'REPORT_EXPORT_DOWNLOADED' : 'REPORT_EXPORT_REFUSED',
        target: row.report_export_id,
        after: { outcome, classification: row.classification },
      });
      if (outcome !== 'DOWNLOADED') return { outcome };
      // Taken once: the content goes, its hash stays.
      await client.query(
        `UPDATE marketplace.report_exports
            SET downloaded_at=$2, downloaded_by_user_id=$3, content=NULL, purged_at=$2
          WHERE report_export_id=$1`,
        [row.report_export_id, now, actor],
      );
      return {
        outcome,
        export: {
          report_export_id: row.report_export_id,
          filename: `${row.report_kind.toLowerCase()}-${row.report_export_id.slice(0, 8)}.json`,
          classification: row.classification,
          content_sha256: row.content_sha256,
          content: canonicalJson(row.content),
        },
      };
    });
    switch (result.outcome) {
      case 'DOWNLOADED':
        return result.export;
      case 'UNKNOWN':
      case 'REFUSED_NOT_EXPORTER':
        // Someone else's export is as unknown to them as a made-up token.
        throw new ReportingNotFoundError('No such export');
      case 'REFUSED_ALREADY_TAKEN':
        throw new ReportingStateError('This export has already been taken');
      case 'REFUSED_EXPIRED':
        throw new ReportingStateError('This export has lapsed; ask for a new one');
    }
  }

  /** Exports with who made them, for what, when, classified how, and every attempt to take them. */
  async exports(input: { readonly context: RequestContext; readonly now?: Date }) {
    const now = input.now ?? new Date();
    const actor = admin(input.context);
    const everyone = (await globalAdminCapabilities(this.#pool, actor, now)).has(ALL);
    const rows = await this.#pool.query<{
      report_export_id: string;
      report_kind: string;
      classification: string;
      exported_by_user_id: string;
      filters: Record<string, unknown>;
      scope_kind: string;
      scope_reference: string;
      created_at: Date;
      expires_at: Date;
      downloaded_at: Date | null;
      purged_at: Date | null;
      content_sha256: string | null;
      accesses: { actor_id: string; outcome: string; occurred_at: string }[];
    }>(
      `SELECT e.report_export_id, e.report_kind, e.classification, e.exported_by_user_id, e.filters,
              e.scope_kind, e.scope_reference, e.created_at, e.expires_at, e.downloaded_at,
              e.purged_at, e.content_sha256,
              COALESCE((SELECT json_agg(json_build_object('actor_id', a.actor_id, 'outcome', a.outcome,
                                                         'occurred_at', a.occurred_at)
                                        ORDER BY a.occurred_at)
                          FROM marketplace.report_export_accesses a
                         WHERE a.report_export_id = e.report_export_id), '[]'::json) AS accesses
         FROM marketplace.report_exports e
        WHERE $1 OR e.exported_by_user_id = $2
        ORDER BY e.created_at DESC LIMIT 100`,
      [everyone, actor],
    );
    return {
      exports: rows.rows.map((row) => ({
        ...row,
        state:
          row.downloaded_at !== null
            ? 'TAKEN'
            : row.purged_at !== null || row.expires_at.getTime() <= now.getTime()
              ? 'LAPSED'
              : 'AVAILABLE',
      })),
    };
  }

  /** Drops the content of exports that lapsed untaken; the record and hash stay. */
  async purgeLapsed(input: { readonly context: RequestContext; readonly now?: Date }) {
    const kind = input.context.actor?.actor_kind;
    if (kind !== 'admin' && kind !== 'system') throw new ReportingAuthorizationError();
    const now = input.now ?? new Date();
    const purged = await this.#pool.query(
      `UPDATE marketplace.report_exports SET content=NULL, purged_at=$1
        WHERE content IS NOT NULL AND expires_at <= $1`,
      [now],
    );
    return { purged: purged.rowCount ?? 0 };
  }

  async #access(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    entry: Catalogue,
    zone: string | undefined,
    now: Date,
    exporting: boolean,
  ): Promise<UuidV7> {
    const actor = admin(context);
    if (zone !== undefined && entry.global_only)
      throw new ReportingInputError(`${entry.title} is reported for the whole platform only`);
    const held = zone
      ? await zoneAdminCapabilities(queryable, actor, zone, now)
      : await globalAdminCapabilities(queryable, actor, now);
    if (!entry.readers.some((capability) => held.has(capability)))
      throw new ReportingAuthorizationError();
    if (exporting && !held.has(EXPORT)) throw new ReportingAuthorizationError();
    return actor;
  }

  async #build(
    queryable: Pick<Pool | PoolClient, 'query'>,
    entry: Catalogue,
    input: { readonly service_zone_id?: string; readonly from?: Date; readonly to?: Date },
    now: Date,
  ) {
    const period = reportPeriod(input.from, input.to, now);
    let locations: string[] | null = null;
    let zoneName: string | null = null;
    if (input.service_zone_id) {
      const zone = await queryable.query<{ zone_name: string }>(
        `SELECT zone_name FROM marketplace.vendor_service_zones
          WHERE service_zone_id::text=$1 AND lifecycle_state='ACTIVE'`,
        [input.service_zone_id],
      );
      if (!zone.rows[0]) throw new ReportingNotFoundError('No such active zone');
      zoneName = zone.rows[0].zone_name;
      // The zone is the named area: every shop with an active zone of that name.
      const shops = await queryable.query<{ vendor_location_id: string }>(
        `SELECT DISTINCT vendor_location_id::text FROM marketplace.vendor_service_zones
          WHERE lifecycle_state='ACTIVE' AND (service_zone_id::text=$1 OR zone_name=$2)`,
        [input.service_zone_id, zoneName],
      );
      locations = shops.rows.map((row) => row.vendor_location_id);
    }
    const metrics = await this.#metrics(queryable, entry.kind, period, locations, now);
    return {
      report_kind: entry.kind,
      title: entry.title,
      classification: entry.classification,
      scope: input.service_zone_id
        ? {
            kind: 'ZONE',
            reference: input.service_zone_id,
            zone_name: zoneName,
            shops: locations?.length ?? 0,
          }
        : { kind: 'GLOBAL', reference: 'global', zone_name: null, shops: null },
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      generated_at: now.toISOString(),
      freshness: {
        source: 'LIVE',
        as_of: now.toISOString(),
        note: 'Read from the primary database when generated; nothing is cached or sampled. PERIOD metrics count events inside the period; NOW metrics are the state at generation.',
      },
      metrics,
    };
  }

  async #metrics(
    queryable: Pick<Pool | PoolClient, 'query'>,
    kind: ReportKind,
    period: { from: Date; to: Date },
    locations: string[] | null,
    now: Date,
  ): Promise<Metric[]> {
    const p = [period.from, period.to, locations];
    const one = async (sql: string, params: unknown[] = p) =>
      (await queryable.query<Record<string, string | null>>(sql, params)).rows[0] ?? {};
    const n = (value: string | null | undefined) =>
      value === null || value === undefined ? 0 : Number(value);
    const shop = (column: string) => `($3::uuid[] IS NULL OR ${column} = ANY($3::uuid[]))`;
    const m = (
      key: string,
      label: string,
      value: number | null,
      unit: MetricUnit,
      definition: string,
      window: 'PERIOD' | 'NOW' = 'PERIOD',
    ): Metric => ({ key, label, value, unit, definition, window });
    switch (kind) {
      case 'CUSTOMER_FUNNEL': {
        const row = await one(
          `SELECT
             (SELECT count(*) FROM marketplace.carts c WHERE c.created_at >= $1 AND c.created_at < $2
                AND ($3::uuid[] IS NULL OR EXISTS (SELECT 1 FROM marketplace.cart_vendor_groups g
                      WHERE g.cart_id=c.cart_id AND g.vendor_location_id = ANY($3::uuid[]))))::text AS started,
             (SELECT count(DISTINCT q.cart_id) FROM marketplace.checkout_quotes q
               WHERE q.created_at >= $1 AND q.created_at < $2
                 AND ($3::uuid[] IS NULL OR EXISTS (SELECT 1 FROM marketplace.checkout_quote_groups qg
                       WHERE qg.checkout_quote_id=q.checkout_quote_id AND qg.vendor_location_id = ANY($3::uuid[]))))::text AS quoted,
             (SELECT count(DISTINCT o.checkout_group_id) FROM marketplace.vendor_orders o
               WHERE o.created_at >= $1 AND o.created_at < $2 AND ${shop('o.vendor_location_id')})::text AS placed,
             (SELECT count(*) FROM marketplace.vendor_orders o
               WHERE o.delivered_at >= $1 AND o.delivered_at < $2 AND ${shop('o.vendor_location_id')})::text AS delivered`,
        );
        return [
          m(
            'baskets_started',
            'Baskets started',
            n(row.started),
            'COUNT',
            'Baskets created in the period (in scope: holding a shop in the zone).',
          ),
          m(
            'baskets_quoted',
            'Baskets quoted',
            n(row.quoted),
            'COUNT',
            'Distinct baskets that received at least one checkout quote in the period.',
          ),
          m(
            'checkouts_placed',
            'Checkouts placed',
            n(row.placed),
            'COUNT',
            'Checkout groups with an order created in the period.',
          ),
          m(
            'orders_delivered',
            'Orders delivered',
            n(row.delivered),
            'COUNT',
            'Shop orders marked delivered in the period.',
          ),
          m(
            'quote_to_checkout',
            'Quoted baskets that checked out',
            rate(n(row.placed), n(row.quoted)),
            'BASIS_POINTS',
            'Checkouts placed ÷ baskets quoted, in basis points (10,000 = all).',
          ),
          m(
            'start_to_checkout',
            'Started baskets that checked out',
            rate(n(row.placed), n(row.started)),
            'BASIS_POINTS',
            'Checkouts placed ÷ baskets started, in basis points.',
          ),
        ];
      }
      case 'MARKETPLACE': {
        const row = await one(
          `SELECT count(*)::text AS orders, COALESCE(sum(total_minor),0)::text AS value,
                  count(*) FILTER (WHERE lifecycle_state='CANCELLED')::text AS cancelled,
                  count(*) FILTER (WHERE lifecycle_state='EXPIRED')::text AS expired,
                  (SELECT count(*) FROM marketplace.vendor_locations l
                    WHERE l.lifecycle_state='ACTIVE' AND ${shop('l.vendor_location_id')}
                      AND EXISTS (SELECT 1 FROM marketplace.vendor_publication_cases pub
                                   WHERE pub.vendor_location_id=l.vendor_location_id AND pub.lifecycle_state='PUBLISHED'))::text AS live
             FROM marketplace.vendor_orders o
            WHERE o.created_at >= $1 AND o.created_at < $2 AND ${shop('o.vendor_location_id')}`,
        );
        const orders = n(row.orders);
        return [
          m(
            'orders_placed',
            'Orders placed',
            orders,
            'COUNT',
            'Shop orders created in the period.',
          ),
          m(
            'gross_order_value',
            'Gross order value',
            n(row.value),
            'INR_MINOR',
            'Sum of those orders’ totals as placed, in paise, before refunds.',
          ),
          m(
            'average_order_value',
            'Average order value',
            orders > 0 ? Math.floor(n(row.value) / orders) : null,
            'INR_MINOR',
            'Gross order value ÷ orders placed, rounded down to the paisa.',
          ),
          m(
            'orders_cancelled',
            'Orders cancelled',
            n(row.cancelled),
            'COUNT',
            'Orders created in the period that are now cancelled.',
          ),
          m(
            'orders_expired',
            'Orders expired unanswered',
            n(row.expired),
            'COUNT',
            'Orders created in the period that lapsed without the shop accepting.',
          ),
          m(
            'shops_live',
            'Shops live',
            n(row.live),
            'COUNT',
            'Active shops with a published storefront.',
            'NOW',
          ),
        ];
      }
      case 'VENDOR_HEALTH': {
        const row = await one(
          `SELECT count(*) FILTER (WHERE accepted_at IS NOT NULL)::text AS accepted,
                  count(*) FILTER (WHERE lifecycle_state='EXPIRED')::text AS expired,
                  count(*) FILTER (WHERE decline_reason_code IS NOT NULL)::text AS declined,
                  COALESCE(avg(EXTRACT(EPOCH FROM accepted_at - created_at)) FILTER (WHERE accepted_at IS NOT NULL), 0)::bigint::text AS accept_seconds,
                  count(*) FILTER (WHERE ready_at IS NOT NULL AND pickup_promise_at IS NOT NULL AND ready_at > pickup_promise_at)::text AS late,
                  count(*) FILTER (WHERE ready_at IS NOT NULL)::text AS ready
             FROM marketplace.vendor_orders o
            WHERE o.created_at >= $1 AND o.created_at < $2 AND ${shop('o.vendor_location_id')}`,
        );
        const decided = n(row.accepted) + n(row.expired) + n(row.declined);
        return [
          m(
            'orders_answered',
            'Orders a shop answered or let lapse',
            decided,
            'COUNT',
            'Orders created in the period that were accepted, declined or expired.',
          ),
          m(
            'acceptance_rate',
            'Acceptance rate',
            rate(n(row.accepted), decided),
            'BASIS_POINTS',
            'Accepted ÷ (accepted + declined + expired), in basis points.',
          ),
          m(
            'orders_expired',
            'Orders expired unanswered',
            n(row.expired),
            'COUNT',
            'Orders the shop did not accept before its deadline.',
          ),
          m(
            'average_accept_time',
            'Average time to accept',
            n(row.accepted) > 0 ? n(row.accept_seconds) : null,
            'SECONDS',
            'Mean seconds from order placed to accepted, over accepted orders.',
          ),
          m(
            'ready_late',
            'Ready after the promised time',
            rate(n(row.late), n(row.ready)),
            'BASIS_POINTS',
            'Orders ready after their pickup promise ÷ orders made ready, in basis points.',
          ),
        ];
      }
      case 'DELIVERY_OPERATIONS': {
        const row = await one(
          `SELECT
             (SELECT count(*) FROM marketplace.vendor_orders o
               WHERE o.delivered_at >= $1 AND o.delivered_at < $2 AND o.picked_up_at IS NOT NULL
                 AND ${shop('o.vendor_location_id')})::text AS delivered,
             (SELECT COALESCE(avg(EXTRACT(EPOCH FROM o.delivered_at - o.picked_up_at)), 0)::bigint FROM marketplace.vendor_orders o
               WHERE o.delivered_at >= $1 AND o.delivered_at < $2 AND o.picked_up_at IS NOT NULL
                 AND ${shop('o.vendor_location_id')})::text AS road_seconds,
             (SELECT count(*) FROM marketplace.delivery_assignments a
               WHERE a.created_at >= $1 AND a.created_at < $2 AND ${shop('a.vendor_location_id')}
                 AND a.assignment_state IN ('DELIVERY_FAILED','RETURN_REQUIRED','RETURN_AUTHORIZED','RETURNING','RETURNED','FAILED_PICKUP'))::text AS failed,
             (SELECT count(*) FROM marketplace.delivery_assignments a
               WHERE a.created_at >= $1 AND a.created_at < $2 AND ${shop('a.vendor_location_id')}
                 AND a.assignment_state='OFFER_EXPIRED')::text AS lapsed,
             (SELECT count(*) FROM marketplace.partner_availability WHERE availability_state='ONLINE')::text AS online`,
        );
        const metrics = [
          m(
            'deliveries_completed',
            'Deliveries completed',
            n(row.delivered),
            'COUNT',
            'Orders picked up by a partner and delivered in the period.',
          ),
          m(
            'average_road_time',
            'Average pickup to door',
            n(row.delivered) > 0 ? n(row.road_seconds) : null,
            'SECONDS',
            'Mean seconds from pickup to delivery over those orders.',
          ),
          m(
            'delivery_attempts_failed',
            'Attempts that failed or returned',
            n(row.failed),
            'COUNT',
            'Delivery attempts created in the period now failed, failed at pickup, or in or through a return.',
          ),
          m(
            'offers_lapsed',
            'Offers that lapsed',
            n(row.lapsed),
            'COUNT',
            'Delivery attempts created in the period whose offer expired unanswered.',
          ),
        ];
        // Presence has no shop, so it is platform-wide only.
        if (locations === null)
          metrics.push(
            m(
              'partners_online',
              'Partners online',
              n(row.online),
              'COUNT',
              'Partners whose presence is ONLINE.',
              'NOW',
            ),
          );
        return metrics;
      }
      case 'FINANCE': {
        const row = await one(
          `SELECT
             (SELECT COALESCE(sum(captured_amount_minor),0) FROM marketplace.payment_transactions
               WHERE payment_state='CAPTURED' AND updated_at >= $1 AND updated_at < $2)::text AS captured,
             (SELECT COALESCE(sum(refund_total_minor),0) FROM marketplace.refunds
               WHERE refund_state='SUCCEEDED' AND updated_at >= $1 AND updated_at < $2)::text AS refunded,
             (SELECT COALESCE(sum(amount_minor),0) FROM marketplace.payouts
               WHERE payout_state='PAID' AND paid_at >= $1 AND paid_at < $2)::text AS paid_out,
             (SELECT count(*) FROM marketplace.finance_exceptions WHERE exception_state <> 'RESOLVED')::text AS open,
             (SELECT COALESCE(sum(amount_at_risk_minor),0) FROM marketplace.finance_exceptions WHERE exception_state <> 'RESOLVED')::text AS at_risk`,
          [period.from, period.to],
        );
        const conservation = await auditMoneyConservation(queryable);
        return [
          m(
            'captured',
            'Captured',
            n(row.captured),
            'INR_MINOR',
            'Payments captured, by the amount captured, last changed in the period.',
          ),
          m(
            'refunded',
            'Refunded',
            n(row.refunded),
            'INR_MINOR',
            'Refunds that succeeded in the period, by their total.',
          ),
          m(
            'paid_out',
            'Paid out',
            n(row.paid_out),
            'INR_MINOR',
            'Payouts to shops and partners paid in the period.',
          ),
          m(
            'open_exceptions',
            'Open finance exceptions',
            n(row.open),
            'COUNT',
            'Finance exceptions not resolved, in any queue.',
            'NOW',
          ),
          m(
            'money_at_risk',
            'Money at risk',
            n(row.at_risk),
            'INR_MINOR',
            'Sum of the amount at risk on those exceptions.',
            'NOW',
          ),
          m(
            'ledger_conserved',
            'Ledger balances',
            conservation.conserved ? 1 : 0,
            'BOOLEAN',
            'Whether every conservation invariant holds: the trial balance, clearings, payables and statements (1 = yes).',
            'NOW',
          ),
        ];
      }
      case 'SUPPORT': {
        const scoped = `($3::uuid[] IS NULL OR EXISTS (SELECT 1 FROM marketplace.vendor_orders o
                          WHERE o.vendor_order_id=s.vendor_order_id AND o.vendor_location_id = ANY($3::uuid[])))`;
        const row = await one(
          `SELECT
             (SELECT count(*) FROM marketplace.support_cases s WHERE s.created_at >= $1 AND s.created_at < $2 AND ${scoped})::text AS opened,
             (SELECT count(*) FROM marketplace.support_cases s WHERE s.resolved_at >= $1 AND s.resolved_at < $2 AND ${scoped})::text AS resolved,
             (SELECT count(*) FROM marketplace.support_cases s WHERE s.lifecycle_state IN ('OPEN','IN_PROGRESS') AND ${scoped})::text AS open,
             (SELECT count(*) FROM marketplace.support_cases s WHERE s.created_at >= $1 AND s.created_at < $2 AND ${scoped}
                AND s.response_due_at IS NOT NULL
                AND ((s.first_responded_at IS NOT NULL AND s.first_responded_at > s.response_due_at)
                     OR (s.first_responded_at IS NULL AND s.response_due_at < $4)))::text AS late,
             (SELECT COALESCE(avg(EXTRACT(EPOCH FROM s.first_responded_at - s.created_at)), 0)::bigint FROM marketplace.support_cases s
               WHERE s.created_at >= $1 AND s.created_at < $2 AND s.first_responded_at IS NOT NULL AND ${scoped})::text AS first_reply,
             (SELECT count(*) FROM marketplace.support_cases s WHERE s.created_at >= $1 AND s.created_at < $2 AND s.reopen_count > 0 AND ${scoped})::text AS reopened`,
          [...p, now],
        );
        return [
          m(
            'cases_opened',
            'Cases opened',
            n(row.opened),
            'COUNT',
            'Support cases opened in the period.',
          ),
          m(
            'cases_resolved',
            'Cases resolved',
            n(row.resolved),
            'COUNT',
            'Cases resolved in the period, whenever opened.',
          ),
          m('cases_open', 'Cases open', n(row.open), 'COUNT', 'Cases open or in progress.', 'NOW'),
          m(
            'replies_late',
            'Replies late',
            rate(n(row.late), n(row.opened)),
            'BASIS_POINTS',
            'Cases opened in the period whose first reply came after it was due, or is still owed past due, ÷ cases opened.',
          ),
          m(
            'average_first_reply',
            'Average first reply',
            n(row.first_reply) || null,
            'SECONDS',
            'Mean seconds from a case opening to its first reply, over cases replied to.',
          ),
          m(
            'cases_reopened',
            'Cases reopened',
            n(row.reopened),
            'COUNT',
            'Cases opened in the period that were reopened at least once.',
          ),
        ];
      }
      case 'RISK': {
        const row = await one(
          `SELECT
             (SELECT count(*) FROM marketplace.trust_signals WHERE collected_at >= $1 AND collected_at < $2)::text AS signals,
             (SELECT count(*) FROM marketplace.trust_restriction_cases WHERE decided_at >= $1 AND decided_at < $2 AND approved_by_user_id IS NOT NULL)::text AS approved,
             (SELECT count(*) FROM marketplace.trust_restriction_cases WHERE decided_at >= $1 AND decided_at < $2 AND lifecycle_state='REJECTED')::text AS rejected,
             (SELECT count(*) FROM marketplace.trust_restriction_cases WHERE lifecycle_state='ACTIVE' AND effective_until > $3)::text AS active,
             (SELECT count(*) FROM marketplace.trust_appeals WHERE created_at >= $1 AND created_at < $2)::text AS appeals,
             (SELECT count(*) FROM marketplace.trust_appeals WHERE decided_at >= $1 AND decided_at < $2)::text AS appeals_decided`,
          [period.from, period.to, now],
        );
        return [
          m(
            'signals_collected',
            'Signals collected',
            n(row.signals),
            'COUNT',
            'Risk signals collected for review in the period.',
          ),
          m(
            'restrictions_approved',
            'Restrictions approved',
            n(row.approved),
            'COUNT',
            'Restriction proposals approved by a second person in the period.',
          ),
          m(
            'restrictions_rejected',
            'Restrictions rejected',
            n(row.rejected),
            'COUNT',
            'Restriction proposals turned down in the period.',
          ),
          m(
            'restrictions_active',
            'Restrictions in force',
            n(row.active),
            'COUNT',
            'Restrictions active and not yet lapsed.',
            'NOW',
          ),
          m(
            'appeals_opened',
            'Appeals opened',
            n(row.appeals),
            'COUNT',
            'Appeals against a restriction made in the period.',
          ),
          m(
            'appeals_decided',
            'Appeals decided',
            n(row.appeals_decided),
            'COUNT',
            'Appeals decided in the period.',
          ),
        ];
      }
    }
  }

  async #audit(
    queryable: Pick<Pool | PoolClient, 'query'>,
    context: RequestContext,
    actor: string,
    input: {
      readonly action: string;
      readonly target: string;
      readonly after: Record<string, unknown>;
    },
  ) {
    await queryable.query(
      `INSERT INTO marketplace.operational_audit_events
         (operational_audit_event_id, action, target_kind, target_reference, actor_id, reason_code,
          before_value, after_value, request_id, correlation_id)
       VALUES ($1,$2,'REPORT',$3,$4,$2,NULL,$5,$6,$7)`,
      [
        createUuidV7(),
        input.action,
        input.target,
        actor,
        JSON.stringify(input.after),
        parseRequestId(context.request_id),
        parseUuidV7(context.correlation_id),
      ],
    );
  }
}

function admin(context: RequestContext): UuidV7 {
  if (context.actor?.actor_kind !== 'admin') throw new ReportingAuthorizationError();
  return context.actor.actor_id;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
