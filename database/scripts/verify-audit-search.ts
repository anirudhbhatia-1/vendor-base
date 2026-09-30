import { createUuidV7, type UuidV7 } from '@neighbourhood-store/domain-types';
import { Pool } from 'pg';
import {
  AuditSearchAuthorizationError,
  AuditSearchInputError,
  AuditSearchService,
  type AuditFilters,
} from '../src/audit-search.js';
import { adminContext, check, rejects } from './verify-support.js';

const DAY = 24 * 60 * 60_000;

/**
 * 11.9 -- the searchable audit, walked.
 *
 * Three entries under one tag: a refund approved by an incident commander
 * (money, evidence and a token hash in its before and after), a case note by
 * a support agent under the same request, and an older entry by a finance
 * approver. Each is found by actor, action, target, reason, time, request
 * and approval reference, and pages newest first. A support agent sees the
 * evidence but not the money; a finance approver the money but not the
 * evidence; nobody sees the token. Seeing withheld-by-default fields is
 * recorded. The commander cannot change, delete or truncate their own entry,
 * and a cascade from the people table no longer reaches it.
 */
export async function verifyAuditSearch(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 4, application_name: 'audit-search-verifier' });
  const audit = new AuditSearchService({ connection_string: connectionString });
  const now = new Date(Date.now() - 2 * 60_000);
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1_000);
  const people = {
    commander: createUuidV7(),
    support: createUuidV7(),
    financeApprover: createUuidV7(),
    configOperator: createUuidV7(),
  };
  const grant = async (user: UuidV7, role: string) => {
    const assignment = createUuidV7();
    await pool.query(
      `INSERT INTO marketplace.role_assignments
         (role_assignment_id, user_id, role_key, valid_from, granted_by_user_id,
          request_id, correlation_id, retention_review_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,NULL,$5,$5,$6,$4,$4)`,
      [
        assignment,
        user,
        role,
        new Date(now.getTime() - 90 * DAY),
        createUuidV7(),
        later(365 * 86_400),
      ],
    );
    await pool.query(
      `INSERT INTO marketplace.admin_membership_scopes
         (admin_membership_scope_id, role_assignment_id, user_id, scope_kind, scope_id, created_at)
       VALUES ($1,$2,$3,'GLOBAL',NULL,$4)`,
      [createUuidV7(), assignment, user, new Date(now.getTime() - 90 * DAY)],
    );
  };
  const tag = people.commander.replaceAll('-', '').slice(-8).toUpperCase();
  const prefix = `SYNTH_AUDIT_${tag}`;
  const sharedRequest = createUuidV7();
  const approval = createUuidV7();
  const ids = { refund: createUuidV7(), note: createUuidV7(), old: createUuidV7() };
  const insert = async (row: {
    id: string;
    action: string;
    target_kind: string;
    target_reference: string;
    actor: string;
    reason: string;
    before: unknown;
    after: unknown;
    request: string;
    approval: string | null;
    at: Date;
  }) =>
    pool.query(
      `INSERT INTO marketplace.operational_audit_events
         (operational_audit_event_id, action, target_kind, target_reference, actor_id, reason_code,
          before_value, after_value, request_id, correlation_id, approval_reference, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11)`,
      [
        row.id,
        row.action,
        row.target_kind,
        row.target_reference,
        row.actor,
        row.reason,
        row.before === null ? null : JSON.stringify(row.before),
        row.after === null ? null : JSON.stringify(row.after),
        row.request,
        row.approval,
        row.at,
      ],
    );
  const found = async (user: UuidV7, filters: AuditFilters, limit?: number, before?: string) =>
    audit.search({
      context: adminContext(user),
      filters,
      ...(limit ? { limit } : {}),
      ...(before ? { before } : {}),
      now: later(120),
    });
  const idsOf = (page: { entries: readonly { operational_audit_event_id: string }[] }) =>
    page.entries.map((entry) => entry.operational_audit_event_id);

  try {
    await pool.query(
      "INSERT INTO marketplace.users (user_id,state,data_classification) SELECT unnest($1::uuid[]),'ACTIVE','RESTRICTED'",
      [Object.values(people)],
    );
    await grant(people.commander, 'INCIDENT_COMMANDER');
    await grant(people.support, 'SUPPORT_AGENT');
    await grant(people.financeApprover, 'FINANCE_APPROVER');
    await grant(people.configOperator, 'CONFIG_OPERATOR');

    await insert({
      id: ids.refund,
      action: `${prefix}_REFUND_APPROVED`,
      target_kind: 'REFUND',
      target_reference: `SYNTH-REFUND-${tag}`,
      actor: people.commander,
      reason: 'CUSTOMER_OVERCHARGED',
      before: {
        state: 'PENDING_APPROVAL',
        amount_minor: 5_000,
        evidence_reference: 'SYNTH-EVIDENCE-PHOTO-1',
        download_token_hash: 'deadbeef',
      },
      after: {
        state: 'APPROVED',
        amount_minor: 5_000,
        detail: {
          refund_total_minor: 5_000,
          note: 'SYNTH customer showed the receipt',
          otp: '123456',
        },
        // A secret inside a financial field a ledger manager may open.
        amount_breakdown: { item_minor: 5_000, provider_signature: 'sig-abc' },
      },
      request: sharedRequest,
      approval,
      at: later(10),
    });
    await insert({
      id: ids.note,
      action: `${prefix}_CASE_NOTED`,
      target_kind: 'SUPPORT_CASE',
      target_reference: `SYNTH-CASE-${tag}`,
      actor: people.support,
      reason: 'CUSTOMER_CALLED',
      before: null,
      after: { state: 'IN_PROGRESS' },
      request: sharedRequest,
      approval: null,
      at: later(20),
    });
    await insert({
      id: ids.old,
      action: `${prefix}_PAYOUT_HELD`,
      target_kind: 'PAYOUT',
      target_reference: `SYNTH-PAYOUT-${tag}`,
      actor: people.financeApprover,
      reason: 'BANK_REJECTED',
      before: { state: 'SCHEDULED' },
      after: { state: 'HELD' },
      request: createUuidV7(),
      approval: null,
      at: new Date(now.getTime() - 60 * DAY),
    });

    // A near miss: same actor, target kind and reason as the refund, another
    // action family and record, so every filter has something to leave out.
    await insert({
      id: createUuidV7(),
      action: `SYNTH_ELSE_${tag}_REFUND_APPROVED`,
      target_kind: 'REFUND',
      target_reference: `SYNTH-REFUND-OTHER-${tag}`,
      actor: people.commander,
      reason: 'CUSTOMER_OVERCHARGED',
      before: null,
      after: { state: 'APPROVED' },
      request: createUuidV7(),
      approval: null,
      at: later(15),
    });

    // 1. Who reads.
    await rejects(
      () => found(people.configOperator, { action_prefix: prefix }),
      AuditSearchAuthorizationError,
      'Someone without audit access searched the audit',
    );

    // 2. Every field an investigation starts from.
    const all = new Date(now.getTime() - 90 * DAY);
    const exactly = async (filters: AuditFilters, expected: readonly string[], message: string) => {
      const page = await found(people.commander, { from: all, ...filters });
      check(idsOf(page).join(',') === expected.join(','), `${message} (${idsOf(page).join(',')})`);
    };
    await exactly(
      { actor_id: people.commander, action_prefix: prefix },
      [ids.refund],
      'Search by actor',
    );
    await exactly({ action: `${prefix}_CASE_NOTED` }, [ids.note], 'Search by action');
    await exactly(
      { action_prefix: prefix },
      [ids.note, ids.refund, ids.old],
      'Search by action prefix, newest first',
    );
    await exactly(
      { target_kind: 'REFUND', target_reference: `SYNTH-REFUND-${tag}` },
      [ids.refund],
      'Search by target',
    );
    await exactly(
      { reason_code: 'BANK_REJECTED', action_prefix: prefix },
      [ids.old],
      'Search by reason',
    );
    await exactly({ request_id: sharedRequest }, [ids.note, ids.refund], 'Search by request');
    await exactly({ approval_reference: approval }, [ids.refund], 'Search by approval reference');
    await exactly({ text: `refund-${tag.toLowerCase()}` }, [ids.refund], 'Search by text');
    await exactly(
      { action_prefix: prefix, from: later(15), to: later(25) },
      [ids.note],
      'Search by time',
    );
    // Without a window, the last thirty days: the old entry is not in it.
    const recent = await found(people.commander, { action_prefix: prefix });
    check(
      !idsOf(recent).includes(ids.old) && idsOf(recent).length === 2,
      'The default window reached back past thirty days',
    );
    // Pages, newest first, by a cursor the search gave.
    const first = await found(people.commander, { action_prefix: prefix, from: all }, 2);
    check(first.next !== null, 'A full page gave no cursor');
    const second = await found(
      people.commander,
      { action_prefix: prefix, from: all },
      2,
      first.next ?? undefined,
    );
    check(
      idsOf(first).join(',') === [ids.note, ids.refund].join(',') &&
        idsOf(second).join(',') === ids.old &&
        second.next === null,
      'Paging skipped or repeated an entry',
    );
    for (const [filters, message] of [
      [{ actor_id: 'someone' }, 'A malformed actor id was searched'],
      [{ action: "x' OR 1=1" }, 'A malformed action was searched'],
      [{ text: 'ab' }, 'A two-character text search ran'],
      [{ from: new Date(now.getTime() - 400 * DAY) }, 'A search ran over more than a year'],
      [{ from: later(30), to: later(10) }, 'A search window ended before it started'],
    ] as const)
      await rejects(() => found(people.commander, filters), AuditSearchInputError, message);
    await rejects(
      () => found(people.commander, { action_prefix: prefix }, 1, 'not-a-cursor'),
      AuditSearchInputError,
      'A made-up cursor was accepted',
    );

    // 3. Before and after, as each reader may see them.
    const entryFor = async (user: UuidV7) => {
      const page = await found(user, { approval_reference: approval, from: all });
      const entry = page.entries[0];
      check(entry, 'The refund entry was not found');
      return entry as typeof entry & {
        before: Record<string, unknown>;
        after: Record<string, unknown> & { detail: Record<string, unknown> };
      };
    };
    const bySupport = await entryFor(people.support);
    const byFinance = await entryFor(people.financeApprover);
    const secret = (value: unknown) => typeof value === 'string' && value.startsWith('[secret');
    const hidden = (value: unknown, kind: string) =>
      typeof value === 'string' && value.startsWith(`[${kind}`);
    check(
      hidden(bySupport.before['amount_minor'], 'financial') &&
        hidden(bySupport.after.detail['refund_total_minor'], 'financial') &&
        bySupport.before['evidence_reference'] === 'SYNTH-EVIDENCE-PHOTO-1' &&
        bySupport.after.detail['note'] === 'SYNTH customer showed the receipt' &&
        bySupport.after['state'] === 'APPROVED',
      `The support agent was shown money, or not shown evidence (${JSON.stringify(bySupport)})`,
    );
    check(
      byFinance.before['amount_minor'] === 5_000 &&
        byFinance.after.detail['refund_total_minor'] === 5_000 &&
        (byFinance.after['amount_breakdown'] as Record<string, unknown>)['item_minor'] === 5_000 &&
        secret(
          (byFinance.after['amount_breakdown'] as Record<string, unknown>)['provider_signature'],
        ) &&
        hidden(byFinance.before['evidence_reference'], 'evidence') &&
        hidden(byFinance.after.detail['note'], 'evidence'),
      `The finance approver was shown evidence, or not shown money (${JSON.stringify(byFinance)})`,
    );
    check(
      [bySupport, byFinance].every(
        (entry) =>
          secret(entry.before['download_token_hash']) &&
          secret(entry.after.detail['otp']) &&
          entry.withheld.includes('before.download_token_hash') &&
          entry.withheld.includes('after.detail.otp'),
      ),
      'A secret was shown, or its withholding was not listed',
    );
    check(
      // The amount did not change; the rest did, by name only.
      bySupport.changed_fields.join(',') ===
        'amount_breakdown,detail,download_token_hash,evidence_reference,state',
      `The changed fields are not the ones the change touched (${bySupport.changed_fields.join(',')})`,
    );

    // 4. Seeing withheld-by-default fields is recorded; seeing none is not.
    const detail = await audit.detail({
      context: adminContext(people.financeApprover),
      operational_audit_event_id: ids.refund,
      now: later(130),
    });
    await audit.detail({
      context: adminContext(people.support),
      operational_audit_event_id: ids.note,
      now: later(131),
    });
    const views = await pool.query<{
      actor_id: string;
      target_reference: string;
      after_value: { fields: string[] };
    }>(
      `SELECT actor_id::text, target_reference, after_value FROM marketplace.operational_audit_events
        WHERE action='AUDIT_ENTRY_VIEWED' AND target_reference = ANY($1::text[])`,
      [[ids.refund, ids.note]],
    );
    check(
      detail.same_request.some((event) => event.operational_audit_event_id === ids.note) &&
        views.rows.length === 1 &&
        views.rows[0]?.actor_id === people.financeApprover &&
        views.rows[0].after_value.fields.includes('before.amount_minor') &&
        !views.rows[0].after_value.fields.some((field) => field.includes('token')),
      `Viewing the money was not recorded, or viewing nothing sensitive was (${JSON.stringify(views.rows)})`,
    );

    // 5. The commander cannot erase their own action, by any route.
    const snapshot = async () =>
      JSON.stringify(
        (
          await pool.query(
            'SELECT * FROM marketplace.operational_audit_events WHERE operational_audit_event_id=$1',
            [ids.refund],
          )
        ).rows,
      );
    const original = await snapshot();
    const refused = async (sql: string, params: unknown[] = []) => {
      try {
        await pool.query(sql, params);
        return false;
      } catch (error) {
        return (error as { code?: string }).code === '55000';
      }
    };
    const updateRefused = await refused(
      `UPDATE marketplace.operational_audit_events SET reason_code='NOTHING_HAPPENED' WHERE operational_audit_event_id=$1 AND actor_id=$2`,
      [ids.refund, people.commander],
    );
    const deleteRefused = await refused(
      'DELETE FROM marketplace.operational_audit_events WHERE operational_audit_event_id=$1 AND actor_id=$2',
      [ids.refund, people.commander],
    );
    const truncateRefused = await refused('TRUNCATE marketplace.operational_audit_events');
    // A cascade from the people table used to empty the audit with it.
    const client = await pool.connect();
    let survivedCascade = false;
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE marketplace.users CASCADE');
      survivedCascade =
        (
          await client.query(
            'SELECT 1 FROM marketplace.operational_audit_events WHERE operational_audit_event_id=$1',
            [ids.refund],
          )
        ).rows.length === 1;
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const methods = Object.getOwnPropertyNames(AuditSearchService.prototype).sort().join(',');
    check(
      updateRefused &&
        deleteRefused &&
        truncateRefused &&
        survivedCascade &&
        (await snapshot()) === original &&
        methods === 'close,constructor,detail,search',
      `An admin could change or remove their own audit entry (${JSON.stringify({ updateRefused, deleteRefused, truncateRefused, survivedCascade, methods })})`,
    );
  } finally {
    await Promise.all([pool.end(), audit.close()]);
  }
}
