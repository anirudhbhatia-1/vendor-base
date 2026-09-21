import assert from 'node:assert/strict';
import test from 'node:test';
import { waitCreditMinor, waitElapsedSeconds, waitStage, type WaitTimerRow } from './wait-timer.js';

const startedAt = new Date('2026-09-21T10:00:00.000Z');
function row(overrides: Partial<WaitTimerRow> = {}): WaitTimerRow {
  return {
    partner_wait_timer_id: '01a0c40b-070f-7393-8216-0df916eb851f',
    delivery_assignment_id: '01a0c40b-070f-7393-8216-0df916eb8520',
    partner_user_id: '01a0c40b-070f-7393-8216-0df916eb8521',
    wait_state: 'RUNNING',
    started_at: startedAt,
    first_threshold_seconds: 300,
    leave_threshold_seconds: 600,
    max_credit_seconds: 900,
    rate_minor_per_minute: 100,
    ended_at: null,
    version: 1,
    ...overrides,
  };
}
const at = (seconds: number) => new Date(startedAt.getTime() + seconds * 1_000);

test('the wait pays completed minutes past the included ones, to the cap (9.5)', () => {
  assert.equal(waitCreditMinor(row(), at(299)), 0);
  assert.equal(waitCreditMinor(row(), at(359)), 0);
  assert.equal(waitCreditMinor(row(), at(360)), 100);
  assert.equal(waitCreditMinor(row(), at(421)), 200);
  // The cap: max_credit_seconds carries it as time -- 900 s is ten paid minutes.
  assert.equal(waitCreditMinor(row(), at(900)), 1_000);
  assert.equal(waitCreditMinor(row(), at(5_000)), 1_000);
  // A closed wait is measured to its end, not to now.
  assert.equal(waitCreditMinor(row({ ended_at: at(421) }), at(9_999)), 200);
  assert.equal(waitElapsedSeconds(row({ ended_at: at(421) }), at(9_999)), 421);
});

test('the stage follows the thresholds and a closed wait keeps its state', () => {
  assert.equal(waitStage(row(), at(10)), 'RUNNING');
  assert.equal(waitStage(row(), at(300)), 'THRESHOLD_ONE');
  assert.equal(waitStage(row(), at(600)), 'THRESHOLD_TWO');
  assert.equal(waitStage(row({ wait_state: 'RESOLVED', ended_at: at(50) }), at(9_000)), 'RESOLVED');
  assert.equal(
    waitStage(row({ wait_state: 'LEFT_POLICY', ended_at: at(700) }), at(9_000)),
    'LEFT_POLICY',
  );
});
