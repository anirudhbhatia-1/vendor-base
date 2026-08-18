# Fictional Verification-Pack Register

**Owner:** Compliance Test Reviewer
**Use:** Exercise category-aware document submission, review, expiry, rejection, appeal, and revocation without collecting real documents
**Data classification:** Fictional metadata and fake files only
**Production effect:** None

## Rules

- A verification pack is a test-state container, not proof of identity, eligibility, employment, contracting, insurance, banking, licensing, or legal compliance.
- Files must be clearly watermarked `FICTIONAL — INTERNAL TEST ONLY` and contain synthetic values.
- Store only safe fake-file references here; filled files and review evidence belong in the protected test workspace.
- Allowed lifecycle: `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED`, with `REJECTED`, `APPEAL/RESUBMIT`, `EXPIRING`, `EXPIRED`, and `REVOKED` branches.
- High-risk test approval uses a second reviewer. No reviewer approves their own submission.
- An expired/revoked pack blocks new rehearsal work but never abandons active synthetic custody, refund, settlement, or payout obligations.
- Missing, conflicting, duplicated, stale, or rejected evidence leaves the actor `NOT_READY`.

## Role-specific fictional requirements

| Actor type | Required fictional evidence | Not requested |
|---|---|---|
| Vendor fixture | Vendor-role attestation, category acknowledgement, catalogue safety checklist, fictional payout token | Real registration, tax, licence, bank, address, owner, staff, or supplier document |
| Customer persona | Synthetic-use acknowledgement, notice/language exercise, scenario briefing acknowledgement | Real identity, age, address, phone, payment, or consent record |
| Delivery role | Company-test authorization reference, safety/data briefing, synthetic custody assessment, fictional payout token | Real identity, licence, vehicle, insurance, bank, background, contract, or employment record |

## Pack register

| Pack ID | Fictional actor | Actor type | Scenario requirement | Initial lifecycle state | Reviewer requirement | Readiness result |
|---|---|---|---|---|---|---|
| `VPK-T-FV-01` | `FV-01` | Vendor fixture | Normal catalogue/order acknowledgement | `DRAFT` | Compliance Test Reviewer | `NOT_READY` |
| `VPK-T-FV-02` | `FV-02` | Vendor fixture | Out-of-stock reason and refund handoff | `DRAFT` | Compliance Test Reviewer | `NOT_READY` |
| `VPK-T-FV-03` | `FV-03` | Vendor fixture | Variable-weight disclosure and decision | `DRAFT` | Compliance Test Reviewer | `NOT_READY` |
| `VPK-T-FV-04` | `FV-04` | Vendor fixture | Substitution proposal | `DRAFT` | Compliance Test Reviewer | `NOT_READY` |
| `VPK-T-FV-05` | `FV-05` | Vendor fixture | Customer rejection and fallback | `DRAFT` | Compliance Test Reviewer | `NOT_READY` |
| `VPK-T-FV-06` | `FV-06` | Vendor fixture | Timeout and expiry | `DRAFT` | Compliance Test Reviewer | `NOT_READY` |
| `VPK-T-FV-07` | `FV-07` | Vendor fixture | Customer-pickup proof | `DRAFT` | Compliance Test Reviewer | `NOT_READY` |
| `VPK-T-FV-08` | `FV-08` | Vendor fixture | Vendor-confirms stock | `DRAFT` | Compliance Test Reviewer | `NOT_READY` |
| `VPK-T-FV-09` | `FV-09` | Vendor fixture | Multi-package custody | `DRAFT` | Compliance Test Reviewer | `NOT_READY` |
| `VPK-T-CUS-01` | `CUS-T-01` | Customer persona | Synthetic-use and scenario acknowledgement | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-02` | `CUS-T-02` | Customer persona | Hindi notice exercise | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-03` | `CUS-T-03` | Customer persona | Out-of-stock decision | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-04` | `CUS-T-04` | Customer persona | Substitution approval | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-05` | `CUS-T-05` | Customer persona | Substitution refusal | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-06` | `CUS-T-06` | Customer persona | Weight/price decision | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-07` | `CUS-T-07` | Customer persona | Pickup proof | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-08` | `CUS-T-08` | Customer persona | Vendor-timeout outcome | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-09` | `CUS-T-09` | Customer persona | Fake decline handling | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-10` | `CUS-T-10` | Customer persona | Unknown-payment handling | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-11` | `CUS-T-11` | Customer persona | Duplicate handling | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-12` | `CUS-T-12` | Customer persona | Unreachable/return | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-13` | `CUS-T-13` | Customer persona | Incorrect-address case | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-14` | `CUS-T-14` | Customer persona | Refusal/return | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-15` | `CUS-T-15` | Customer persona | Partial refund | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-16` | `CUS-T-16` | Customer persona | Full refund | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-17` | `CUS-T-17` | Customer persona | Package count | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-18` | `CUS-T-18` | Customer persona | Offline/reconnect | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-19` | `CUS-T-19` | Customer persona | Optional-consent refusal | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-CUS-20` | `CUS-T-20` | Customer persona | Support escalation | `DRAFT` | Customer Test Coordinator | `NOT_READY` |
| `VPK-T-DPT-01` | `DPT-T-01` | Delivery role | Safety, custody, return, data briefing | `DRAFT` | Compliance + Operations reviewers | `NOT_READY` |
| `VPK-T-DPT-02` | `DPT-T-02` | Delivery role | Safety, packages, reconnect, data briefing | `DRAFT` | Compliance + Operations reviewers | `NOT_READY` |

## Review record template

| Field | Entry |
|---|---|
| Pack/actor reference | `<VPK-T-... / actor ID>` |
| Fake document type/version | `<fictional type/version>` |
| Fake-file reference/checksum | `<protected safe ref / checksum>` |
| Submitted/reviewed at | `<timestamps>` |
| Reviewer role(s) | `<role tokens; no names in Git>` |
| Decision/reason | `<APPROVE / REJECT / APPEAL / REVOKE / safe code>` |
| Effective/expiry time | `<timestamps>` |
| Restriction effect | `<new rehearsal work only>` |
| Appeal/resubmission ref | `<safe ref or NONE>` |

Reminders at 30, 7, and 1 test day are exercised with a controllable test clock. These periods and fictional types are not production legal requirements.
