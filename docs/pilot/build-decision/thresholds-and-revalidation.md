# Thresholds and Revalidation Plan

**Business threshold status:** `UNAPPROVED`
**Engineering-foundation gates:** Defined below
**Owner:** Product/Operations for business thresholds; Engineering Lead for local foundation gates

## Local foundation gates

These are quality gates for the authorized engineering work, not proof that the business should launch.

| Gate | Required result | Failure action |
|---|---|---|
| Reproducible setup | Clean local checkout installs with pinned supported tools | Stop; fix documentation/tool pinning |
| Free local runtime | Compose-compatible stack starts with approved PostgreSQL/PostGIS and Valkey | Stop; no paid/cloud substitution without approval |
| Synthetic isolation | Seeds contain no real or supplied participant data | Stop, remove unsafe fixture, open safe incident record |
| Fake-provider isolation | OTP/payment/payout/maps/messages/storage cannot create real side effect | Stop; block adapter selection and investigate |
| Quality commands | Format, lint, type, unit, integration, build commands exist and pass when applicable | Step remains incomplete |
| Financial integrity | Relevant synthetic ledger/reconciliation checks have zero unexplained difference | Stop money-affecting work |
| Reset/rebuild | Local state can be reset and rebuilt without manual hidden edits | Fix before dependent implementation |
| Documentation | Directory ownership, commands, failures and recovery are explained | Step remains incomplete |

## Future business-threshold decision

Before a controlled participant validation, Product/Operations and Finance must approve numeric thresholds and their denominators for:

- fee-visible conversion;
- vendor response and acceptance;
- preparation and pickup delay;
- delivery/return completion and safety;
- cancellation and refund incidence;
- support cases and handling effort;
- partner pay per active hour;
- vendor incremental profit;
- platform contribution after all included costs;
- repeat ordering within a defined interval.

This file intentionally supplies no target numbers. Choosing them after seeing results would permit outcome cherry-picking.

## Evidence sequence

```text
Current synthetic desk evidence
→ assign/train authorized company rehearsal roles
→ timed synthetic human rehearsal
→ approve real-case legal/privacy/finance/operations gates
→ controlled real-provider/company-account tests
→ controlled participant validation with pre-approved thresholds
→ independent reconciliation and decision review
→ explicit owner decision on Phase 3/full product scope
```

## Revalidation record template

| Field | Required entry |
|---|---|
| Evidence mode and cohort version | `<SYNTHETIC_HUMAN / CONTROLLED_REAL_CASE>` |
| Metric dictionary/threshold version | `<immutable versions approved before collection>` |
| Collection interval/timezone | `<start/end / Asia/Kolkata>` |
| Eligible request/order/person counts | `<safe aggregate counts>` |
| Missing/invalid/duplicate records | `<counts and treatment>` |
| Demand/operations/economics results | `<aggregated results>` |
| Reconciliation difference | `<must be zero or explicit unresolved case>` |
| Privacy/safety/incident review | `<status and safe evidence refs>` |
| Recommendation | `<APPROVE / REVISE / REPEAT / STOP>` |
| Project-owner decision | `<explicit choice/date>` |

No evidence stage automatically unlocks the next. Every transition needs the named approval and must preserve rollback, in-flight obligations, and source evidence.
