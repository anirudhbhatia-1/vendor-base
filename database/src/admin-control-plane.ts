import { createHash } from 'node:crypto';
import {
  createUuidV7,
  parseRequestId,
  parseUuidV7,
  type RequestContext,
  type UuidV7,
} from '@neighbourhood-store/domain-types';
import { Pool, type PoolClient } from 'pg';

export class AdminControlInputError extends Error {}
export class AdminControlNotFoundError extends Error {}
export class AdminControlStateError extends Error {}
export class AdminControlAuthorizationError extends Error {}
const SYNTH = /^SYNTH-[A-Z0-9-]{4,64}$/;
const REASON = /^[A-Z][A-Z0-9_]{2,63}$/;
function admin(context: RequestContext) {
  if (context.actor?.actor_kind !== 'admin') throw new AdminControlAuthorizationError();
  return context.actor.actor_id;
}
function operator(context: RequestContext) {
  if (context.actor?.actor_kind !== 'admin' && context.actor?.actor_kind !== 'system')
    throw new AdminControlAuthorizationError();
  return context.actor.actor_id;
}
function reason(value: string) {
  if (!REASON.test(value)) throw new AdminControlInputError('Reason code is invalid');
  return value;
}
function marked(value: string) {
  if (!SYNTH.test(value)) throw new AdminControlInputError('Reference is not synthetic');
  return value;
}
async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export class AdminControlPlaneService {
  readonly #pool: Pool;
  constructor(input: { readonly connection_string: string }) {
    this.#pool = new Pool({
      connectionString: input.connection_string,
      application_name: 'neighbourhood-store-admin-control',
      max: 10,
    });
  }
  async close() {
    await this.#pool.end();
  }
  async dashboard(input: { readonly context: RequestContext }) {
    admin(input.context);
    const r = await this.#pool.query(`SELECT * FROM (
    SELECT 'FINANCE' kind,finance_exception_id::text object_id,exception_kind title,amount_at_risk_minor risk_minor,created_at, next_action_code next_action FROM marketplace.finance_exceptions WHERE exception_state<>'RESOLVED'
    UNION ALL SELECT 'SUPPORT',support_case_id::text,category,0,created_at,COALESCE(lifecycle_state,'OPEN') FROM marketplace.support_cases WHERE lifecycle_state NOT IN ('RESOLVED','WITHDRAWN')
    UNION ALL SELECT 'TRUST',trust_restriction_case_id::text,reason_code,0,created_at,lifecycle_state FROM marketplace.trust_restriction_cases WHERE lifecycle_state='PROPOSED'
    UNION ALL SELECT 'INCIDENT',incident_control_id::text,control_key,0,created_at,lifecycle_state FROM marketplace.incident_controls WHERE lifecycle_state='ACTIVE'
  ) q ORDER BY risk_minor DESC,created_at ASC LIMIT 100`);
    return { items: r.rows };
  }
  async orderMonitor(input: {
    readonly context: RequestContext;
    readonly checkout_group_id?: UuidV7;
  }) {
    admin(input.context);
    const r = await this.#pool.query(
      `SELECT cg.*,COALESCE(json_agg(json_build_object('vendor_order_id',o.vendor_order_id,'reference',o.order_reference,'state',o.lifecycle_state,'vendor_location_id',o.vendor_location_id) ORDER BY o.order_reference) FILTER(WHERE o.vendor_order_id IS NOT NULL),'[]') orders FROM marketplace.checkout_groups cg LEFT JOIN marketplace.vendor_orders o USING(checkout_group_id) WHERE ($1::uuid IS NULL OR cg.checkout_group_id=$1) GROUP BY cg.checkout_group_id ORDER BY cg.updated_at DESC LIMIT 100`,
      [input.checkout_group_id ?? null],
    );
    return { checkout_groups: r.rows };
  }
  async createSupportCase(input: {
    readonly context: RequestContext;
    readonly vendor_order_id: UuidV7;
    readonly category: string;
    readonly description: string;
    readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    readonly response_due_at: Date;
  }) {
    const who = admin(input.context);
    if (input.description.trim().length < 1 || input.description.length > 1000)
      throw new AdminControlInputError('Support description is invalid');
    return tx(this.#pool, async (client) => {
      const existing = await client.query(
        `SELECT * FROM marketplace.support_cases WHERE vendor_order_id=$1 AND category=$2
          AND lifecycle_state IN ('OPEN','IN_PROGRESS') ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [input.vendor_order_id, reason(input.category)],
      );
      if (existing.rows[0]) return { ...existing.rows[0], deduplicated: true };
      const supportCaseId = createUuidV7();
      const r = await client.query(
        `INSERT INTO marketplace.support_cases(support_case_id,vendor_order_id,opened_by_user_id,
          category,description,severity,response_due_at,request_id,correlation_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          supportCaseId,
          input.vendor_order_id,
          who,
          reason(input.category),
          input.description.trim(),
          input.severity,
          input.response_due_at,
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      await client.query(
        `INSERT INTO marketplace.support_case_events(support_case_event_id,support_case_id,event_type,
          actor_id,reason_code,request_id,correlation_id) VALUES($1,$2,'OPENED',$3,$4,$5,$6)`,
        [
          createUuidV7(),
          supportCaseId,
          who,
          reason(input.category),
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      await this.#audit(
        client,
        input.context,
        who,
        'SUPPORT_CASE_OPENED',
        'SUPPORT_CASE',
        supportCaseId,
        reason(input.category),
        null,
        { severity: input.severity },
      );
      return { ...r.rows[0], deduplicated: false };
    });
  }
  async attachSupportEvidence(input: {
    readonly context: RequestContext;
    readonly support_case_id: UuidV7;
    readonly evidence_reference: string;
    readonly classification: 'INTERNAL' | 'RESTRICTED';
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    return tx(this.#pool, async (client) => {
      const exists = await client.query(
        'SELECT 1 FROM marketplace.support_cases WHERE support_case_id=$1',
        [input.support_case_id],
      );
      if (!exists.rows[0]) throw new AdminControlNotFoundError();
      const evidenceId = createUuidV7();
      await client.query(
        `INSERT INTO marketplace.support_case_evidence(support_case_evidence_id,support_case_id,evidence_reference,classification,attached_by_user_id) VALUES($1,$2,$3,$4,$5)`,
        [
          evidenceId,
          input.support_case_id,
          marked(input.evidence_reference),
          input.classification,
          who,
        ],
      );
      await client.query(
        `INSERT INTO marketplace.support_case_events(support_case_event_id,support_case_id,event_type,actor_id,reason_code,payload,request_id,correlation_id) VALUES($1,$2,'EVIDENCE_ATTACHED',$3,$4,$5,$6,$7)`,
        [
          createUuidV7(),
          input.support_case_id,
          who,
          reason(input.reason_code),
          JSON.stringify({
            evidence_reference: input.evidence_reference,
            classification: input.classification,
          }),
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      return { support_case_evidence_id: evidenceId };
    });
  }
  async mergeSupportCases(input: {
    readonly context: RequestContext;
    readonly source_case_id: UuidV7;
    readonly target_case_id: UuidV7;
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    if (input.source_case_id === input.target_case_id) throw new AdminControlInputError();
    return tx(this.#pool, async (client) => {
      const r = await client.query(
        `UPDATE marketplace.support_cases SET lifecycle_state='WITHDRAWN',merged_into_case_id=$2,updated_at=clock_timestamp() WHERE support_case_id=$1 AND lifecycle_state IN ('OPEN','IN_PROGRESS') RETURNING support_case_id`,
        [input.source_case_id, input.target_case_id],
      );
      if (!r.rows[0]) throw new AdminControlStateError();
      await client.query(
        `INSERT INTO marketplace.support_case_events(support_case_event_id,support_case_id,event_type,actor_id,reason_code,payload,request_id,correlation_id) VALUES($1,$2,'MERGED',$3,$4,$5,$6,$7)`,
        [
          createUuidV7(),
          input.source_case_id,
          who,
          reason(input.reason_code),
          JSON.stringify({ target_case_id: input.target_case_id }),
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      return { merged: true };
    });
  }
  async supportAction(input: {
    readonly context: RequestContext;
    readonly support_case_id: UuidV7;
    readonly action:
      'ASSIGN' | 'NOTE' | 'MESSAGE' | 'RESOLVE' | 'REOPEN' | 'ESCALATE' | 'QUALITY_REVIEW';
    readonly reason_code: string;
    readonly body?: string;
    readonly owner_user_id?: UuidV7;
    readonly owner_team?: string;
  }) {
    const who = admin(input.context);
    return tx(this.#pool, async (client) => {
      const c = await client.query<{ lifecycle_state: string }>(
        'SELECT * FROM marketplace.support_cases WHERE support_case_id=$1 FOR UPDATE',
        [input.support_case_id],
      );
      if (!c.rows[0]) throw new AdminControlNotFoundError();
      const state =
        input.action === 'RESOLVE'
          ? 'RESOLVED'
          : input.action === 'REOPEN'
            ? 'OPEN'
            : input.action === 'ASSIGN' || input.action === 'ESCALATE'
              ? 'IN_PROGRESS'
              : c.rows[0].lifecycle_state;
      await client.query(
        `UPDATE marketplace.support_cases SET lifecycle_state=$2,owner_user_id=COALESCE($3,owner_user_id),owner_team=COALESCE($4,owner_team),updated_at=clock_timestamp() WHERE support_case_id=$1`,
        [input.support_case_id, state, input.owner_user_id ?? null, input.owner_team ?? null],
      );
      if (input.body) {
        await client.query(
          `INSERT INTO marketplace.support_case_messages(support_case_message_id,support_case_id,author_user_id,audience,body) VALUES($1,$2,$3,$4,$5)`,
          [
            createUuidV7(),
            input.support_case_id,
            who,
            input.action === 'MESSAGE' ? 'PARTICIPANT' : 'INTERNAL',
            input.body,
          ],
        );
      }
      await this.#audit(
        client,
        input.context,
        who,
        `SUPPORT_${input.action}`,
        'SUPPORT_CASE',
        input.support_case_id,
        reason(input.reason_code),
        null,
        { lifecycle_state: state },
      );
      await client.query(
        `INSERT INTO marketplace.support_case_events(support_case_event_id,support_case_id,event_type,actor_id,reason_code,request_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          createUuidV7(),
          input.support_case_id,
          input.action === 'NOTE'
            ? 'NOTE_ADDED'
            : input.action === 'MESSAGE'
              ? 'MESSAGE_SENT'
              : input.action === 'QUALITY_REVIEW'
                ? 'QUALITY_REVIEWED'
                : input.action === 'ASSIGN'
                  ? 'ASSIGNED'
                  : input.action === 'RESOLVE'
                    ? 'RESOLVED'
                    : input.action === 'REOPEN'
                      ? 'REOPENED'
                      : 'ESCALATED',
          who,
          reason(input.reason_code),
          parseRequestId(input.context.request_id),
          parseUuidV7(input.context.correlation_id),
        ],
      );
      return { support_case_id: input.support_case_id, lifecycle_state: state };
    });
  }
  async proposeTrust(input: {
    readonly context: RequestContext;
    readonly subject_kind: string;
    readonly subject_reference: string;
    readonly scope_kind: string;
    readonly scope_reference: string;
    readonly reason_code: string;
    readonly evidence_reference: string;
    readonly policy_reference: string;
    readonly effective_until: Date;
    readonly review_at: Date;
  }) {
    const who = admin(input.context);
    if (input.review_at > input.effective_until) throw new AdminControlInputError();
    const r = await this.#pool.query(
      `INSERT INTO marketplace.trust_restriction_cases(trust_restriction_case_id,subject_kind,subject_reference,scope_kind,scope_reference,reason_code,evidence_reference,policy_reference,proposed_by_user_id,effective_until,review_at,request_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        createUuidV7(),
        input.subject_kind,
        marked(input.subject_reference),
        input.scope_kind,
        marked(input.scope_reference),
        reason(input.reason_code),
        marked(input.evidence_reference),
        marked(input.policy_reference),
        who,
        input.effective_until,
        input.review_at,
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return r.rows[0];
  }
  async approveTrust(input: {
    readonly context: RequestContext;
    readonly trust_restriction_case_id: UuidV7;
    readonly expected_version: number;
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    const r = await this.#pool.query(
      `UPDATE marketplace.trust_restriction_cases SET lifecycle_state='ACTIVE',approved_by_user_id=$2::uuid,version=version+1,updated_at=clock_timestamp() WHERE trust_restriction_case_id=$1 AND lifecycle_state='PROPOSED' AND version=$3 AND proposed_by_user_id<>$2::uuid RETURNING *`,
      [input.trust_restriction_case_id, who, input.expected_version],
    );
    if (!r.rows[0]) throw new AdminControlStateError();
    await this.#pool.query(
      `INSERT INTO marketplace.operational_audit_events(operational_audit_event_id,action,target_kind,target_reference,actor_id,reason_code,request_id,correlation_id,approval_reference)VALUES($1,'TRUST_RESTRICTION_APPROVED','TRUST_RESTRICTION',$2::text,$3,$4,$5,$6,$2::uuid)`,
      [
        createUuidV7(),
        input.trust_restriction_case_id,
        who,
        reason(input.reason_code),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return r.rows[0];
  }
  async transitionTrust(input: {
    readonly context: RequestContext;
    readonly trust_restriction_case_id: UuidV7;
    readonly expected_version: number;
    readonly action: 'REJECT' | 'REVOKE';
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    const from = input.action === 'REJECT' ? 'PROPOSED' : 'ACTIVE';
    const to = input.action === 'REJECT' ? 'REJECTED' : 'REVOKED';
    const r = await this.#pool.query(
      `UPDATE marketplace.trust_restriction_cases SET lifecycle_state=$4,version=version+1,updated_at=clock_timestamp() WHERE trust_restriction_case_id=$1 AND lifecycle_state=$2 AND version=$3 RETURNING *`,
      [input.trust_restriction_case_id, from, input.expected_version, to],
    );
    if (!r.rows[0]) throw new AdminControlStateError();
    await this.#pool.query(
      `INSERT INTO marketplace.operational_audit_events(operational_audit_event_id,action,target_kind,target_reference,actor_id,reason_code,request_id,correlation_id)VALUES($1,$2,'TRUST_RESTRICTION',$3,$4,$5,$6,$7)`,
      [
        createUuidV7(),
        `TRUST_RESTRICTION_${to}`,
        input.trust_restriction_case_id,
        who,
        reason(input.reason_code),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return r.rows[0];
  }
  async setIncident(input: {
    readonly context: RequestContext;
    readonly control_key: string;
    readonly scope_kind: string;
    readonly scope_reference: string;
    readonly reason_code: string;
    readonly expires_at: Date;
    readonly review_at: Date;
    readonly obligations: object;
  }) {
    const who = admin(input.context);
    if (input.review_at > input.expires_at) throw new AdminControlInputError();
    const r = await this.#pool.query(
      `INSERT INTO marketplace.incident_controls(incident_control_id,control_key,scope_kind,scope_reference,reason_code,owner_user_id,expires_at,review_at,obligations,request_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(control_key,scope_kind,scope_reference) DO UPDATE SET lifecycle_state='ACTIVE',reason_code=EXCLUDED.reason_code,owner_user_id=EXCLUDED.owner_user_id,expires_at=EXCLUDED.expires_at,review_at=EXCLUDED.review_at,obligations=EXCLUDED.obligations,updated_at=clock_timestamp() RETURNING *`,
      [
        createUuidV7(),
        input.control_key,
        input.scope_kind,
        marked(input.scope_reference),
        reason(input.reason_code),
        who,
        input.expires_at,
        input.review_at,
        JSON.stringify(input.obligations),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return r.rows[0];
  }
  async revokeIncident(input: {
    readonly context: RequestContext;
    readonly incident_control_id: UuidV7;
    readonly reason_code: string;
  }) {
    const who = admin(input.context);
    const r = await this.#pool.query(
      `UPDATE marketplace.incident_controls SET lifecycle_state='REVOKED',updated_at=clock_timestamp() WHERE incident_control_id=$1 AND lifecycle_state='ACTIVE' RETURNING *`,
      [input.incident_control_id],
    );
    if (!r.rows[0]) throw new AdminControlStateError();
    await this.#pool.query(
      `INSERT INTO marketplace.operational_audit_events(operational_audit_event_id,action,target_kind,target_reference,actor_id,reason_code,request_id,correlation_id)VALUES($1,'INCIDENT_CONTROL_REVOKED','INCIDENT_CONTROL',$2,$3,$4,$5,$6)`,
      [
        createUuidV7(),
        input.incident_control_id,
        who,
        reason(input.reason_code),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return r.rows[0];
  }
  async expireOperationalControls(input: {
    readonly context: RequestContext;
    readonly now?: Date;
  }) {
    operator(input.context);
    const now = input.now ?? new Date();
    const trust = await this.#pool.query(
      `UPDATE marketplace.trust_restriction_cases SET lifecycle_state='EXPIRED',version=version+1,updated_at=$1 WHERE lifecycle_state='ACTIVE' AND effective_until<=$1`,
      [now],
    );
    const incidents = await this.#pool.query(
      `UPDATE marketplace.incident_controls SET lifecycle_state='EXPIRED',updated_at=$1 WHERE lifecycle_state='ACTIVE' AND expires_at<=$1`,
      [now],
    );
    return { trust: trust.rowCount ?? 0, incidents: incidents.rowCount ?? 0 };
  }
  async audit(input: { readonly context: RequestContext; readonly query?: string }) {
    admin(input.context);
    const r = await this.#pool.query(
      `SELECT * FROM marketplace.operational_audit_events WHERE ($1::text IS NULL OR action ILIKE '%'||$1||'%' OR target_reference ILIKE '%'||$1||'%' OR reason_code ILIKE '%'||$1||'%') ORDER BY occurred_at DESC LIMIT 200`,
      [input.query ?? null],
    );
    return { events: r.rows };
  }
  async report(input: { readonly context: RequestContext; readonly report_kind: string }) {
    admin(input.context);
    const queries: Record<string, string> = {
      FINANCE: `SELECT count(*) open_exceptions,COALESCE(sum(amount_at_risk_minor),0) risk_minor FROM marketplace.finance_exceptions WHERE exception_state<>'RESOLVED'`,
      SUPPORT: `SELECT lifecycle_state,count(*) count FROM marketplace.support_cases GROUP BY lifecycle_state`,
      MARKETPLACE: `SELECT lifecycle_state,count(*) count FROM marketplace.checkout_groups GROUP BY lifecycle_state`,
      DELIVERY_OPERATIONS: `SELECT assignment_state,count(*) count FROM marketplace.delivery_assignments GROUP BY assignment_state`,
      RISK: `SELECT lifecycle_state,count(*) count FROM marketplace.trust_restriction_cases GROUP BY lifecycle_state`,
      VENDOR_HEALTH: `SELECT lifecycle_state,count(*) count FROM marketplace.vendor_locations GROUP BY lifecycle_state`,
      CUSTOMER_FUNNEL: `SELECT lifecycle_state,count(*) count FROM marketplace.carts GROUP BY lifecycle_state`,
    };
    const query = queries[input.report_kind];
    if (!query) throw new AdminControlInputError();
    return {
      definition: `Synthetic ${input.report_kind} snapshot; freshness is query time.`,
      rows: (await this.#pool.query(query)).rows,
    };
  }
  async createExport(input: {
    readonly context: RequestContext;
    readonly report_kind: string;
    readonly filters: object;
    readonly classification: 'INTERNAL' | 'RESTRICTED';
  }) {
    const who = admin(input.context);
    const token = createUuidV7();
    const r = await this.#pool.query(
      `INSERT INTO marketplace.report_exports(report_export_id,report_kind,filters,classification,exported_by_user_id,expires_at,download_token_hash,request_id,correlation_id)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes',$6,$7,$8)RETURNING report_export_id,expires_at`,
      [
        createUuidV7(),
        input.report_kind,
        JSON.stringify(input.filters),
        input.classification,
        who,
        createHash('sha256').update(token).digest('hex'),
        parseRequestId(input.context.request_id),
        parseUuidV7(input.context.correlation_id),
      ],
    );
    return { ...r.rows[0], download_token: `synthetic-export-${token}` };
  }
  async redeemExport(input: { readonly context: RequestContext; readonly download_token: string }) {
    const who = admin(input.context);
    const raw = input.download_token.replace(/^synthetic-export-/, '');
    let token: UuidV7;
    try {
      token = parseUuidV7(raw);
    } catch {
      throw new AdminControlInputError('Export token is invalid');
    }
    return tx(this.#pool, async (client) => {
      const r = await client.query(
        `UPDATE marketplace.report_exports SET downloaded_at=clock_timestamp(),downloaded_by_user_id=$2 WHERE download_token_hash=$1 AND downloaded_at IS NULL AND expires_at>clock_timestamp() RETURNING *`,
        [createHash('sha256').update(token).digest('hex'), who],
      );
      const row = r.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new AdminControlNotFoundError();
      const report = await this.report({
        context: input.context,
        report_kind: String(row['report_kind']),
      });
      await this.#audit(
        client,
        input.context,
        who,
        'REPORT_EXPORT_DOWNLOADED',
        'REPORT_EXPORT',
        parseUuidV7(String(row['report_export_id'])),
        'REPORT_EXPORT_DOWNLOADED',
        null,
        { classification: row['classification'] },
      );
      return {
        filename: `${String(row['report_kind']).toLowerCase()}-${String(row['report_export_id']).slice(0, 8)}.json`,
        classification: row['classification'],
        content: JSON.stringify(report),
      };
    });
  }
  async #audit(
    client: PoolClient,
    context: RequestContext,
    actor: UuidV7,
    action: string,
    targetKind: string,
    targetRef: UuidV7,
    reasonCode: string,
    before: object | null,
    after: object | null,
  ) {
    await client.query(
      `INSERT INTO marketplace.operational_audit_events(operational_audit_event_id,action,target_kind,target_reference,actor_id,reason_code,before_value,after_value,request_id,correlation_id)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        createUuidV7(),
        action,
        targetKind,
        targetRef,
        actor,
        reasonCode,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        parseRequestId(context.request_id),
        parseUuidV7(context.correlation_id),
      ],
    );
  }
}
