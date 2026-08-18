# Phase 1 Build Decision Package

**Phase/step:** Phase 1, Step 1.5
**Decision:** `CONDITIONAL_GO_LOCAL_FOUNDATION_ONLY`
**Approved by:** Project owner
**Decision date:** 17 August 2026
**Review mode:** Hold scope

## Outcome

The project may begin Phase 2 local foundation work inside the company. This is an engineering-readiness decision, not a market-validation result. Phase 1's real-transaction exit gate remains unmet.

## Package

| File | Responsibility |
|---|---|
| [Decision record](decision-record.md) | States exactly what is approved, blocked, reversible, and required for reconsideration |
| [Evidence assessment](evidence-assessment.md) | Compares current evidence with every Phase 1 outcome and gate |
| [Thresholds and revalidation](thresholds-and-revalidation.md) | Separates engineering-foundation gates from future business-validation thresholds |
| [Revised assumptions](revised-assumptions.md) | Records what the synthetic work proved, disproved, or left unknown |
| [Acceptance tests from exceptions](acceptance-tests-from-exceptions.md) | Converts scripted exceptions into later build-test contracts |
| [CEO hold-scope review](ceo-scope-review.md) | Pressure-tests architecture, failure, security, test, rollout, and long-term boundaries |

## Permission boundary

```text
APPROVED NOW
└── Phase 2 local foundation
    ├── 2.1 repository/workspace scaffold
    ├── 2.2 local quality and contribution controls
    ├── 2.3 local application/worker entry-point skeletons
    ├── 2.4 local PostgreSQL/PostGIS, Valkey, migrations and synthetic seeds
    └── 2.5 CI definition may be authored and verified locally

NOT APPROVED NOW
├── external CI execution requiring push/account changes
├── 2.6 shared non-production or cloud deployment
├── Phase 3+ product/domain implementation
├── real participants, documents, personal data or transactions
├── real OTP/payment/payout/maps/messages/storage providers
└── staging, production, public launch or production-readiness claims
```

Local work remains free/open-source where already approved, uses synthetic data and fake adapters, and creates no external account or ongoing cost.

## Next numbered step

The next permitted step is Phase 2, Step 2.1. Starting it still requires the normal pre-step repository inspection and file-by-file scope statement. This decision does not authorize completing several Phase 2 steps together.
