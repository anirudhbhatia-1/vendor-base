# Internal Cohort Readiness Register

**Owner:** Operations Lead
**Purpose:** Separate fictional fixture preparation from real company-tester assignment and training
**Current overall status:** `PREPARED_NOT_TRAINED`
**Production effect:** None

## Status meanings

| Status | Meaning |
|---|---|
| `PREPARED_NOT_TRAINED` | Fictional scenario exists; no claim that an operator is assigned or trained |
| `PENDING_VERIFICATION` | Protected assignment exists; fictional pack/training evidence is incomplete |
| `RETRAIN` | Assessment found a control that must be taught and reassessed |
| `READY_FOR_REHEARSAL` | Protected assignment, fictional verification, training, fake-adapter check, and independent approval exist |
| `SUSPENDED` | New rehearsal work is blocked; active obligations still require safe closure |

## Vendor-role readiness

The existing vendor fixtures are catalogue-ready. This table separately tracks whether a company tester is trained to operate each role.

| Actor | Fixture status | Pack | Protected operator assigned | Training evidence | Independent approval | Rehearsal status |
|---|---|---|---|---|---|---|
| `FV-01` | `READY_FOR_INTERNAL_TEST` | `VPK-T-FV-01` | `NO` | `NONE` | `NONE` | `PREPARED_NOT_TRAINED` |
| `FV-02` | `READY_FOR_INTERNAL_TEST` | `VPK-T-FV-02` | `NO` | `NONE` | `NONE` | `PREPARED_NOT_TRAINED` |
| `FV-03` | `READY_FOR_INTERNAL_TEST` | `VPK-T-FV-03` | `NO` | `NONE` | `NONE` | `PREPARED_NOT_TRAINED` |
| `FV-04` | `READY_FOR_INTERNAL_TEST` | `VPK-T-FV-04` | `NO` | `NONE` | `NONE` | `PREPARED_NOT_TRAINED` |
| `FV-05` | `READY_FOR_INTERNAL_TEST` | `VPK-T-FV-05` | `NO` | `NONE` | `NONE` | `PREPARED_NOT_TRAINED` |
| `FV-06` | `READY_FOR_INTERNAL_TEST` | `VPK-T-FV-06` | `NO` | `NONE` | `NONE` | `PREPARED_NOT_TRAINED` |
| `FV-07` | `READY_FOR_INTERNAL_TEST` | `VPK-T-FV-07` | `NO` | `NONE` | `NONE` | `PREPARED_NOT_TRAINED` |
| `FV-08` | `READY_FOR_INTERNAL_TEST` | `VPK-T-FV-08` | `NO` | `NONE` | `NONE` | `PREPARED_NOT_TRAINED` |
| `FV-09` | `READY_FOR_INTERNAL_TEST` | `VPK-T-FV-09` | `NO` | `NONE` | `NONE` | `PREPARED_NOT_TRAINED` |

## Customer-persona readiness

| Actors | Count | Scenario cards | Protected operators assigned | Training evidence | Rehearsal status |
|---|---:|---|---|---|---|
| `CUS-T-01` through `CUS-T-20` | 20 | `PREPARED` | `NO` | `NONE` | `PREPARED_NOT_TRAINED` |

Each persona must be advanced individually in the protected workspace. A group status cannot hide one untrained assignment.

## Delivery-role readiness

| Actor | Pack | Protected operator assigned | Safety briefing | Custody assessment | Independent approval | Rehearsal status |
|---|---|---|---|---|---|---|
| `DPT-T-01` | `VPK-T-DPT-01` | `NO` | `NOT_RUN` | `NOT_RUN` | `NONE` | `PREPARED_NOT_TRAINED` |
| `DPT-T-02` | `VPK-T-DPT-02` | `NO` | `NOT_RUN` | `NOT_RUN` | `NONE` | `PREPARED_NOT_TRAINED` |

## Supporting-role readiness

| Role | Protected assignment | Required module | Independent assessor | Status |
|---|---|---|---|---|
| Operations Lead | `PENDING` | Common + support/incident + dispatch safety | Separate authorized reviewer | `NOT_READY` |
| Catalogue Test Operator | `PENDING` | Common + vendor/catalogue | Operations Lead | `NOT_READY` |
| Customer Intake Operator | `PENDING` | Common + customer | Customer Test Coordinator | `NOT_READY` |
| Vendor Confirmation Operator | `PENDING` | Common + vendor/catalogue | Operations Lead | `NOT_READY` |
| Dispatcher | `PENDING` | Common + dispatch/delivery | Operations Lead | `NOT_READY` |
| Support Test Operator | `PENDING` | Common + support/incident | Operations Lead | `NOT_READY` |
| Finance Test Operator | `PENDING` | Common + finance | Reconciliation Reviewer | `NOT_READY` |
| Reconciliation Reviewer | `PENDING` | Common + finance | Finance Lead | `NOT_READY` |
| Compliance Test Reviewer | `PENDING` | Common + privacy/compliance | Operations/Privacy reviewer | `NOT_READY` |

## Operations activation checklist

Complete this checklist in the protected workspace; store only a safe approval reference here if policy later permits.

- [ ] Authorized company testers are assigned to every staffed role needed by the selected scenario.
- [ ] No assignment creates an employment, contractor, insurance, payout, or real-delivery claim.
- [ ] Every selected fictional actor has an approved fake verification pack.
- [ ] Common and role training passed with independent evidence.
- [ ] Fake OTP, payment, payout, maps, push, SMS, email, and storage adapters are isolated from real parties.
- [ ] All customer, vendor, partner, route, address, contact, package, proof, and money inputs are synthetic.
- [ ] Test hours, support owner, incident owner, Finance reviewer, and stop authority are named.
- [ ] The manual kit and scripted scenarios are accessible to assigned roles.
- [ ] Filled records and evidence have approved access, retention, and deletion/hold handling.
- [ ] No order/session begins until every selected actor and supporting role is `READY_FOR_REHEARSAL`.

## Operations approval record

| Field | Entry |
|---|---|
| Protected cohort evidence reference | `<NONE until assigned/trained>` |
| Selected actor IDs | `<fictional IDs>` |
| Ready/not-ready counts | `<safe counts>` |
| Fake-adapter isolation result | `<PASS / FAIL / NOT_RUN>` |
| Open retraining/verification items | `<safe refs or NONE>` |
| Operations decision | `<APPROVE_REHEARSAL / DO_NOT_START>` |
| Approved by role/time | `<Operations Lead / timestamp>` |
| Independent review/time | `<reviewer role / timestamp>` |

The current repository state is intentionally `DO_NOT_START`: it contains prepared fictional roles and blank evidence structures, but no proof that real company testers have been assigned or trained.
