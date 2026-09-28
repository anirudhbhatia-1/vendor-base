/**
 * How the admin dashboard ranks work (11.1).
 *
 * The order is the same for every operator: safety and security first, then
 * the ledger, then live orders, then compliance, then routine work. Within a
 * tier, severity (the D-09 labels in docs/governance/support-service-levels.md)
 * decides, then whichever is overdue or due soonest, then the money at risk,
 * then age. Filtering by what an operator may act on removes rows; it never
 * changes a row's tier, severity or deadline, so two operators who can both
 * see an item see it ranked the same way.
 *
 * A deadline is the item's own where it has one (a support case's response
 * due, a proposal's approval window, an incident's review); otherwise it is
 * the first-response window of its severity from when it was raised.
 * Escalation is due at 75% of that window.
 */
export type WorkTier = 'SAFETY_SECURITY' | 'LEDGER' | 'LIVE_ORDER' | 'COMPLIANCE' | 'ROUTINE';
export type WorkSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export const TIER_ORDER: readonly WorkTier[] = Object.freeze([
  'SAFETY_SECURITY',
  'LEDGER',
  'LIVE_ORDER',
  'COMPLIANCE',
  'ROUTINE',
]);
const SEVERITY_ORDER: readonly WorkSeverity[] = Object.freeze([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
]);

/**
 * First response by severity (D-09): critical 5 minutes, high 15 minutes,
 * medium 4 staffed hours, low the next staffed day. Staffed hours are read
 * as clock hours here; the desk calendar is not modelled.
 */
export const RESPONSE_WINDOW_MS: Readonly<Record<WorkSeverity, number>> = Object.freeze({
  CRITICAL: 5 * 60_000,
  HIGH: 15 * 60_000,
  MEDIUM: 4 * 3_600_000,
  LOW: 24 * 3_600_000,
});

/** Who a severity escalates to (D-09). */
export const ESCALATION_OWNER: Readonly<Record<WorkSeverity, string>> = Object.freeze({
  CRITICAL: 'INCIDENT_COMMANDER',
  HIGH: 'OPERATIONS_LEAD',
  MEDIUM: 'QUEUE_OWNER',
  LOW: 'SUPPORT_AGENT',
});

export type RawWorkItem = {
  readonly kind: string;
  readonly tier: WorkTier;
  readonly severity: WorkSeverity;
  readonly object_kind: string;
  readonly object_id: string;
  readonly title: string;
  readonly owner: string;
  readonly next_action: string;
  readonly created_at: Date;
  /** The item's own deadline, where it has one. */
  readonly due_at?: Date | null;
  /**
   * When the clock for that deadline started, where it restarts (a support
   * case owes a new reply each time the customer writes); otherwise the
   * item's creation. Escalation is due at 75% of the way from here.
   */
  readonly due_since?: Date | null;
  readonly amount_at_risk_minor: number;
  readonly custody_risk: 'NONE' | 'GOODS_IN_CUSTODY';
};

export type RankedWorkItem = Omit<RawWorkItem, 'created_at' | 'due_at' | 'due_since'> & {
  readonly rank: number;
  readonly created_at: string;
  readonly sla_due_at: string;
  readonly escalate_at: string;
  readonly age_seconds: number;
  readonly overdue: boolean;
  readonly escalation_due: boolean;
  readonly escalation_owner: string;
  /** The legacy name the panels read. */
  readonly risk_minor: number;
};

export function rankWork(items: readonly RawWorkItem[], now: Date): readonly RankedWorkItem[] {
  const shaped = items.map((item) => {
    const window = RESPONSE_WINDOW_MS[item.severity];
    const due = item.due_at ?? new Date(item.created_at.getTime() + window);
    const since = item.due_at && item.due_since ? item.due_since : item.created_at;
    const span = Math.max(0, due.getTime() - since.getTime());
    const escalate = new Date(since.getTime() + Math.floor(span * 0.75));
    return {
      item,
      due,
      escalate,
      overdue: due.getTime() <= now.getTime(),
    };
  });
  shaped.sort((left, right) => {
    const tier = TIER_ORDER.indexOf(left.item.tier) - TIER_ORDER.indexOf(right.item.tier);
    if (tier !== 0) return tier;
    const severity =
      SEVERITY_ORDER.indexOf(left.item.severity) - SEVERITY_ORDER.indexOf(right.item.severity);
    if (severity !== 0) return severity;
    if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
    const due = left.due.getTime() - right.due.getTime();
    if (due !== 0) return due;
    const money = right.item.amount_at_risk_minor - left.item.amount_at_risk_minor;
    if (money !== 0) return money;
    const age = left.item.created_at.getTime() - right.item.created_at.getTime();
    if (age !== 0) return age;
    return left.item.object_id < right.item.object_id ? -1 : 1;
  });
  return Object.freeze(
    shaped.map(({ item, due, escalate, overdue }, index) => {
      const created = item.created_at;
      return Object.freeze({
        kind: item.kind,
        tier: item.tier,
        severity: item.severity,
        object_kind: item.object_kind,
        object_id: item.object_id,
        title: item.title,
        owner: item.owner,
        next_action: item.next_action,
        amount_at_risk_minor: item.amount_at_risk_minor,
        custody_risk: item.custody_risk,
        rank: index + 1,
        created_at: created.toISOString(),
        sla_due_at: due.toISOString(),
        escalate_at: escalate.toISOString(),
        age_seconds: Math.max(0, Math.floor((now.getTime() - created.getTime()) / 1_000)),
        overdue,
        escalation_due: escalate.getTime() <= now.getTime(),
        escalation_owner: ESCALATION_OWNER[item.severity],
        risk_minor: item.amount_at_risk_minor,
      });
    }),
  );
}
