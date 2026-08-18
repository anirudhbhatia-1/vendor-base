# Internal Role Training and Assessment

**Owner:** Operations Lead
**Assessors:** Role lead plus a different authorized reviewer
**Use:** Train company testers to operate fictional roles with the manual kit
**Evidence location:** Approved protected company workspace; Git receives no filled assessments

## Training principles

- Training uses only synthetic people, shops, documents, routes, addresses, contacts, money, proofs, and provider results.
- A tester may stop at any time and must never be pressured to move quickly or perform a real-world transaction/delivery.
- The assessor observes a scenario; they do not supply answers that conceal a failed control.
- Self-assessment cannot create readiness.
- A missed safety, custody, privacy, authorization, external-side-effect, or financial-balance control requires retraining and reassessment.

## Common module

Every tester must demonstrate:

1. Identify the `TEST`, `REQ`, `ORD`, `TRIP`, `PAY`, `CASE`, `REF`, and `SET` references used by their role.
2. Explain why one vendor order never contains or changes a sibling vendor's lines.
3. Locate their minimum permitted fields and state when access expires.
4. Detect and stop on real data, credentials, external messaging, real payment/payout, or real delivery risk.
5. Record a handoff with current state, unresolved item, timestamps, destination role, and acknowledgement.
6. Open a structured case without copying OTP, bank, address, or other sensitive content.
7. Handle duplicate, timeout, stale, and retry outcomes without creating a second success.
8. State the Monday–Saturday 09:00–19:00 `Asia/Kolkata` window and named after-hours handoff rule.

## Role modules

| Module | Roles | Required demonstrations |
|---|---|---|
| Vendor/catalogue | Catalogue and Vendor Confirmation Operators | Versioned 20-item catalogue, stock result, response deadline, substitution/weight decision, readiness handoff |
| Customer | Customer-role testers and Intake Operator | Notice/language, optional choice, named vendor, visible final total, fake payment branches, support request |
| Dispatch/delivery | Dispatcher and Delivery-role testers | Minimum-data release, one active trip, wait, proof without OTP content, custody, return, safe stop/reconnect |
| Support/incident | Support Test Operator and Operations Lead | P0–P3 classification, acknowledgement, scoped control, evidence limits, staffed-hours handoff, resumption |
| Finance | Finance Test Operator and Reconciliation Reviewer | Integer paise, refund preview, maker-checker, unknown provider result, vendor/partner/platform balance |
| Privacy/compliance | Privacy and Compliance Test Reviewers | Fictional pack lifecycle, least privilege, hold, expiry, rejection/appeal, deletion target |

## Assessment scenarios

| Assessment ID | Scenario | Pass condition |
|---|---|---|
| `TRN-T-01` | Normal single-vendor order | All references and handoffs complete; proof and settlement balance |
| `TRN-T-02` | Multi-vendor request | Separate orders/totals; one failure does not mutate sibling |
| `TRN-T-03` | Substitution and variable weight | Explicit decision and revised visible total before continuation |
| `TRN-T-04` | Payment timeout/unknown | Same operation remains unresolved until reconciliation |
| `TRN-T-05` | Vendor timeout before pickup | Order expires; fake refund and stock release are traceable |
| `TRN-T-06` | Failure after pickup | Case, return authorization, proof, earnings, and custody closure |
| `TRN-T-07` | Offline/reconnect and duplicate proof | No duplicate state, custody, wait credit, earning, or refund |
| `TRN-T-08` | P1 near staffed-hours close | Timely acknowledgement and named receiving owner |
| `TRN-T-09` | Refund above ₹500 | Separate Finance approver; self/stale/reused approval rejected |
| `TRN-T-10` | Real-data/external-side-effect injection | Immediate stop, safe evidence, correct escalation; no copying value |

## Individual assessment record

Store completed records outside Git.

| Field | Entry |
|---|---|
| Protected operator assignment ref | `<safe access-controlled ref>` |
| Fictional role/persona IDs | `<IDs>` |
| Common module version/result | `<version / PASS / RETRAIN>` |
| Role module/result | `<module / PASS / RETRAIN>` |
| Scenario IDs attempted | `<TRN-T-...>` |
| Critical-control failures | `<NONE or structured codes>` |
| Retraining action/deadline | `<action/time or NONE>` |
| Assessor role/evidence ref | `<different role / protected ref>` |
| Operations approval/time | `<APPROVED / NOT_READY / timestamp>` |
| Access start/expiry | `<timestamps>` |

## Scoring rule

An assessment is `PASS` only when all applicable critical controls pass and every created record is traceable. Speed is not a pass criterion. A tester who needs prompting on safety, custody, privacy, money balance, authorization, or stop conditions is `RETRAIN`, regardless of other answers.

## Training completion report

| Role group | Assigned count | Passed count | Retrain count | Not run | Evidence owner | Readiness |
|---|---:|---:|---:|---:|---|---|
| Vendor operators | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `<role>` | `<READY / NOT_READY>` |
| Customer-role testers | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `<role>` | `<READY / NOT_READY>` |
| Delivery-role testers | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `<role>` | `<READY / NOT_READY>` |
| Support/operations | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `<role>` | `<READY / NOT_READY>` |
| Finance/reconciliation | `<integer>` | `<integer>` | `<integer>` | `<integer>` | `<role>` | `<READY / NOT_READY>` |

Do not mark a count or result in repository documentation unless it is a synthetic fixture. Actual training results must be reported from protected evidence and must never be fabricated.
