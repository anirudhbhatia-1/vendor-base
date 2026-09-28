import assert from 'node:assert/strict';
import test from 'node:test';
import { rankWork, type RawWorkItem } from './work-ranking.js';

const now = new Date('2027-07-01T10:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const item = (overrides: Partial<RawWorkItem>): RawWorkItem => ({
  kind: 'FINANCE',
  tier: 'LEDGER',
  severity: 'MEDIUM',
  object_kind: 'FINANCE_EXCEPTION',
  object_id: 'a',
  title: 'T',
  owner: 'FINANCE_OPERATIONS',
  next_action: 'REVIEW',
  created_at: minutesAgo(1),
  amount_at_risk_minor: 0,
  custody_risk: 'NONE',
  ...overrides,
});

test('safety outranks the ledger, which outranks live orders, compliance and routine work', () => {
  const ranked = rankWork(
    [
      item({ object_id: 'routine', tier: 'ROUTINE', severity: 'CRITICAL' }),
      item({ object_id: 'ledger', tier: 'LEDGER', amount_at_risk_minor: 10_000_000 }),
      item({ object_id: 'safety', tier: 'SAFETY_SECURITY', severity: 'LOW' }),
      item({ object_id: 'compliance', tier: 'COMPLIANCE' }),
      item({ object_id: 'order', tier: 'LIVE_ORDER' }),
    ],
    now,
  );
  assert.deepEqual(
    ranked.map((row) => row.object_id),
    ['safety', 'ledger', 'order', 'compliance', 'routine'],
  );
  assert.deepEqual(
    ranked.map((row) => row.rank),
    [1, 2, 3, 4, 5],
  );
});

test('within a tier, severity, then overdue, then due soonest, then money, then age', () => {
  const ranked = rankWork(
    [
      item({ object_id: 'medium-rich', amount_at_risk_minor: 900_000 }),
      item({ object_id: 'high', severity: 'HIGH' }),
      item({ object_id: 'medium-overdue', created_at: minutesAgo(300) }),
      item({ object_id: 'medium-poor', amount_at_risk_minor: 10 }),
    ],
    now,
  );
  assert.deepEqual(
    ranked.map((row) => row.object_id),
    ['high', 'medium-overdue', 'medium-rich', 'medium-poor'],
  );
});

test('the deadline is the severity window unless the item has its own, and escalation is at 75%', () => {
  const [critical] = rankWork([item({ severity: 'CRITICAL', created_at: minutesAgo(4) })], now);
  assert.equal(critical?.sla_due_at, new Date(now.getTime() + 60_000).toISOString());
  assert.equal(critical?.escalate_at, new Date(minutesAgo(4).getTime() + 225_000).toISOString());
  assert.equal(critical?.escalation_due, true);
  assert.equal(critical?.overdue, false);
  assert.equal(critical?.escalation_owner, 'INCIDENT_COMMANDER');
  assert.equal(critical?.age_seconds, 240);
  const [own] = rankWork(
    [item({ due_at: new Date(now.getTime() + 3_600_000), created_at: minutesAgo(60) })],
    now,
  );
  assert.equal(own?.sla_due_at, new Date(now.getTime() + 3_600_000).toISOString());
  assert.equal(own?.escalation_due, false);
});

test('removing rows an operator cannot act on never changes the rank of the rest', () => {
  const all = [
    item({ object_id: 'safety', tier: 'SAFETY_SECURITY', severity: 'CRITICAL' }),
    item({ object_id: 'ledger', tier: 'LEDGER', severity: 'HIGH' }),
    item({ object_id: 'order', tier: 'LIVE_ORDER', severity: 'HIGH' }),
  ];
  const everyone = rankWork(all, now);
  const some = rankWork(
    all.filter((row) => row.object_id !== 'ledger'),
    now,
  );
  for (const row of some) {
    const same = everyone.find((other) => other.object_id === row.object_id);
    assert.equal(row.severity, same?.severity);
    assert.equal(row.tier, same?.tier);
    assert.equal(row.sla_due_at, same?.sla_due_at);
  }
  assert.deepEqual(
    some.map((row) => row.object_id),
    ['safety', 'order'],
  );
});
