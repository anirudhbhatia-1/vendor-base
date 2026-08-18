# Conditional Local-Foundation Build Decision

**Decision ID:** `BUILD-01`
**Status:** `APPROVED_WITH_BOUNDARIES`
**Selected option:** B — conditional go for Phase 2 local foundation only
**Approved by:** Project owner
**Approval date:** 17 August 2026
**Accountable owner:** Engineering Lead
**Review owner:** Operations Lead

## Context

Phase 1 produced a manual kit, fictional cohort, desk simulations, balanced synthetic financial examples, and a measurement dictionary. It did not assign/train company testers or observe real customer, vendor, delivery, support, timing, demand, repeat-order, or unit-economics evidence. Business thresholds are unapproved.

The project owner chose to start reversible local engineering foundation work despite the unmet market-validation gate. This is an explicit exception to treating Phase 1 exit as a prerequisite for local Phase 2 foundation only; it does not waive the evidence gate for wider product investment or production.

## Decision

Authorize Phase 2 Steps 2.1–2.4 in numbered order for local company development. Step 2.5 may author CI configuration and prove its commands locally, but no external CI account, push, runner, or billable resource is authorized. Step 2.6 and Phase 3 onward remain blocked pending a new project-owner decision informed by better evidence.

## Why this option

- The local stack and clients are already approved for synthetic company development.
- Repository/tooling work is reversible and useful even if business assumptions change.
- Free local containers and fake adapters avoid provider, hosting, and production commitments.
- The boundary prevents a zero-evidence “go” from silently becoming a full-product or launch decision.

## Evidence used

- Eight desk scenarios and nine vendor-order rows.
- Zero unexplained financial difference across the synthetic rows.
- Coverage of completion, cancellation, pickup, return, partial refund, unknown payment, and sibling isolation.
- Explicit `NOT_OBSERVED` status for demand, timing, support effort, repeat ordering, and real economics.

## Approved work

| Phase 2 step | Approval | Boundary |
|---|---|---|
| 2.1 Scaffold repository | `APPROVED_LOCAL` | Manifests, pinned runtimes, directories, scripts, ownership map |
| 2.2 Quality/contribution controls | `APPROVED_LOCAL` | Formatting, linting, types, boundaries, local secret/dependency checks |
| 2.3 Entry-point skeletons | `APPROVED_LOCAL` | Minimal local PWA, Android, API and worker shells; no product claims |
| 2.4 Database migration/seed flow | `APPROVED_LOCAL` | Local PostgreSQL/PostGIS, Valkey, migrations, synthetic seeds and reset |
| 2.5 CI pipeline | `CONFIG_ONLY` | Workflow may be written; external execution/push requires separate approval |
| 2.6 Non-production deployment | `BLOCKED` | Hosting provider, account, secrets, cost, rollback and environment approval missing |

## Explicitly blocked

- Phase 3 and later product/domain implementation without a new owner decision.
- Real customers, vendors, delivery partners, identity/verification documents, addresses, contacts, locations, payments, payouts, OTPs, proofs, or support cases.
- External notifications, maps, storage, payment, payout, identity, or OTP calls.
- Cloud/shared environments, deployment, domains, certificates, public access, or production data.
- Paid resources, external accounts, legal acceptance, recruitment, contracting, insurance, or public promises.
- Claims of market validation, production readiness, positive unit economics, or scale proof.

## Stop conditions

Stop the affected work if it requires an external write/account, real data, paid dependency/service, production credential, public release, destructive migration, unresolved financial policy, or a technology boundary beyond D-02/D-03. Preserve safe evidence and request project-owner direction.

## Reconsideration triggers

A new explicit project-owner decision is required before:

1. external CI is activated or repository changes are pushed;
2. Step 2.6 begins;
3. Phase 3 begins;
4. any real provider or controlled real case is used;
5. money, privacy, delivery, verification, tax, employment/contracting, or production policy changes;
6. a hosting provider or ongoing cost is selected.

## Reversibility

This decision is rated 5/5 reversible. Local foundation files can be removed or revised without production migration or customer impact. Any future database fixture remains synthetic and resettable. Reversal does not delete planning evidence or rewrite prior decisions.

## Supersession

**Supersedes:** No prior build/no-build decision
**Superseded by:** None

## GSTACK REVIEW REPORT

| Runs | Status | Findings |
|---:|---|---|
| 1 | `DONE_WITH_CONCERNS` | Hold scope; local foundation permitted; market validation, deployment and Phase 3+ remain blocked |

**VERDICT:** Conditional local-foundation work is a reversible engineering bet, not a validated-product bet.

NO UNRESOLVED DECISIONS
