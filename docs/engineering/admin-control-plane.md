# Admin Control Plane

**Scope:** Phase 11, company-local synthetic development only. Production authority: none.

Migration `0030_admin_control_plane` completes the admin operating layer around existing orders, finance, identity, partner, and configuration records.

- `/admin/control/dashboard` ranks support, finance, trust, and incident work without changing the underlying severity or ownership.
- `/admin/control/orders` exposes grouped-order projections without combining sibling orders.
- Support work records assignment, internal/participant messages, evidence, escalation, resolution, reopening, and quality review as append-only history.
- Trust restrictions require separate proposal and approval actors; each restriction is scoped, reviewable, and time-bounded.
- Incident controls are scoped, expire, retain continuing obligations, and are auditable rather than destructive.
- Reports declare their synthetic freshness and protected exports expire after 15 minutes. Audit records are immutable and searchable by action, target, reason, and actor.

Existing versioned configuration remains the source of truth for configuration maker-checker, scheduling, activation, and rollback; Phase 11 surfaces it through the admin capability boundary rather than duplicating configuration state.

Production provider operations, customer data exports, and irreversible trust actions are explicitly outside this local phase and require D-12 approval.
