# Internal safety, governance, recovery, and production-transition policy

**Status:** Approved for internal company testing only  
**Decision date:** 17 August 2026  
**Applies to:** Synthetic local and automated test environments  
**Production authority:** None

## 1. Purpose and boundary

This document gives Phase 2 one executable policy for privacy, retention, verification documents, delivery testing, support, approvals, incidents, backup, and recovery. It also records exactly what must be replaced or newly approved before real deployment.

Only fictional people, businesses, documents, locations, contacts, money, accounts, cases, and incidents may be used. Passing these tests does not establish legal compliance, production staffing, insurance, provider readiness, recovery readiness, or permission to process real personal data.

## 2. Synthetic data retention schedule

| Data class | Internal purpose | Synthetic retention | Deletion result | Permitted hold |
|---|---|---|---|---|
| OTP content | Login or delivery-proof test | Until used or expired; maximum 10 minutes | Destroy content | None after verification evidence is recorded |
| Safe OTP attempt metadata | Abuse, expiry, and rate-limit tests | 30 days | Delete or aggregate non-identifying counts | Open security test investigation |
| Raw partner-location samples | Dispatch, custody, reconnect, and route tests | Active assignment plus no more than 24 hours | Delete raw samples; retain anonymous test metrics | Active simulated safety/custody incident |
| Synthetic contact and address fixtures | Customer and fulfilment tests | 30 days after last test use | Delete and re-seed when needed | Active synthetic order/refund/case |
| Fake verification documents | Document lifecycle tests | 30 days after case closure | Delete file and sensitive extracted fields | Open appeal or test incident |
| Synthetic support evidence | Support and incident tests | 30 days after case closure | Delete evidence; retain safe outcome summary | Open appeal, safety, privacy, or financial test |
| Synthetic support cases | Queue, SLA, handoff, and appeal tests | 90 days after closure | Anonymize free text, then delete remaining eligible detail | Open linked obligation |
| Synthetic finance and audit records | Ledger, payout, reconciliation, and audit tests | 1 year | Delete/anonymize under a controlled test policy | Open reconciliation or approved audit test |
| Automated test-run records | Isolated verification | End of test run | Immediate cleanup | None |
| Restore-drill artifacts | Recovery verification | 7 days | Automatic deletion | Failed drill investigation only |

Retention periods are versioned test inputs, not production legal periods. A retention worker records safe counts, policy version, outcome, and error code without copying deleted personal content into logs.

### Scalable retention processing

- Store a retention class and next-action time on eligible records.
- Index due-time fields and process bounded cursor batches.
- Recheck active holds immediately before deletion or anonymization.
- Coordinate workers so a record is acted on once despite retries.
- Apply backpressure while the database is busy.
- Consider time partitioning for raw location data only after measured volume justifies it.
- Send repeated failures to a privacy-operations queue with owner, age, and next action.
- Monitor oldest overdue action, queue depth, failure count, and held-record review age.

## 3. Sensitive-data access matrix

| Actor | May view | Must not view by default | Access expiry |
|---|---|---|---|
| Customer | Own profile, addresses, orders, payment references, privacy requests, and cases | Other people, vendor operations, partner earnings, internal risk data | Account/purpose end, subject to approved hold |
| Vendor staff | Own vendor/location, catalogue, staff, child orders, and settlement summary | Sibling vendors/orders, partner private data, unrelated customer history | Staff membership or task end |
| Vendor delivery staff | Exact address only for an approved active vendor-delivery task | Customer history and unrelated addresses | Delivery/return closure |
| Delivery partner | Assigned pickup data; exact drop address during active delivery stage | Customer history, sibling orders, full payment data | Assignment/return closure |
| Support | Minimum data required by an assigned case | Broad searches or unrelated documents, bank data, locations, and orders | Case handoff or closure |
| Finance | Provider references, allocations, ledger, and masked payout tokens | Exact addresses, identity documents, raw location | Finance task closure |
| Compliance | Required synthetic verification documents and reviews | Customer orders unless linked to an approved incident | Review/appeal closure |
| Operations | Active dispatch, custody, safety, incident, and handoff data | Unrelated historical personal data | Assignment/incident closure |
| Reporting | Aggregated or anonymized measures | Direct identifiers and free-form evidence | Query completion |

Authorization is enforced by the server using role, capability, resource ownership, vendor location, current assignment/case, workflow state, and purpose. Hiding a field in the interface is not authorization.

Emergency access is time-limited, reason-required, scoped, audited, and reviewed afterward. It cannot grant unrestricted database access or erase history.

## 4. Notice, consent, location, and privacy requests

### Notice and consent

- Provide clear English and Hindi notices.
- State the data, purpose, viewer category, consequence of refusal, and applicable retention class.
- Separate necessary service processing from optional choices such as marketing.
- Ask for device location when a relevant feature needs it; offer manual address entry when possible.
- Record notice version, language, purpose, decision, and timestamp.
- Allow optional consent to be withdrawn as easily as it was granted.
- Withdrawal stops future optional processing without corrupting active orders, refunds, custody, or required audit records.
- Prohibit preselected optional consent, deceptive hierarchy, and repeated coercive prompts.

Production wording, lawful basis, rights handling, and deadlines require qualified privacy/legal approval under the then-current Indian rules.

### Delivery-partner location

| Partner state | Collection policy |
|---|---|
| Offline | No collection |
| Online and unassigned | Coarse zone-level location after meaningful movement or approximately every 2 minutes |
| Active assignment/return | Precise adaptive updates approximately every 10–30 seconds while moving and less often while stationary |

The application shows a persistent indicator while collection is active. It records purpose, assignment, start/stop time, precision mode, and viewers. A bounded encrypted offline buffer reconnects safely and expires. Precise collection stops immediately after delivery, return, reassignment, or approved incident purpose ends.

### Access, export, correction, and deletion request

1. Verify requester identity without exposing whether another person's record exists.
2. Open one case with a stable reference and deduplication key.
3. Export only authorized data in readable and machine-readable form.
4. Correct, delete, or anonymize eligible fields rather than only hiding the account.
5. Complete the synthetic workflow within 7 test days using a controllable clock.
6. Report categories deleted, anonymized, or held without exposing internal security signals.
7. Resume deletion automatically when every hold ends.
8. Provide escalation and appeal.

A hold requires purpose, owner, exact record scope, review date, and expiry condition. Held data is restricted from ordinary product, marketing, and analytics use. Acceptable synthetic hold purposes are an active order, refund, payout, fraud test, safety/custody incident, privacy incident, or required audit test.

## 5. Verification-document lifecycle

Use fictional document types and synthetic files only.

```text
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED
                      │      │
                      │      └──> REJECTED → APPEAL/RESUBMIT
                      └─────────> EXPIRING → EXPIRED
APPROVED ───────────────────────> REVOKED
```

Every type records purpose, actor/category, allowed reviewers, issue/expiry fields, restriction effect, and production approval source. Reminders occur 30, 7, and 1 test day before expiry. Rejection/revocation requires a structured reason and safe explanation.

High-risk approval uses a second reviewer. Expiry or revocation may block new publication, going online, or new work only under the active policy version. It never abandons an accepted order, package custody, return, refund, settlement, or payout. Synthetic appeals target a response within 7 test days.

Real document names, lawful purposes, and requirements remain blocked until Compliance and legal reviewers approve each vendor category, partner model, and operating area.

## 6. Delivery testing and safety

- Use authorized company team members or specifically approved known testers only.
- Use synthetic customers, vendors, orders, routes, proofs, earnings, and payouts.
- Do not present testers as production employees or contractors.
- Brief testers on location visibility, safe stopping, synthetic custody, emergency stop, incident reporting, and data handling.
- Do not encourage unsafe driving or time-pressure promises.
- The test lead may stop an assignment at any time.
- Simulate waiting, failure, no movement, reconnect, return, proof, payout, and dispute paths.

Public partner recruitment, real delivery, payout, insurance, background checks, equipment rules, engagement terms, and liability require later legal and operational approval.

## 7. Incidents, support, and handoff

### Severity and targets

| Severity | Meaning | Internal test acknowledgement target |
|---|---|---|
| P0 | Immediate safety threat, major personal-data exposure, or widespread financial-integrity failure | Immediate escalation; within 5 minutes |
| P1 | Active custody failure, missing partner, account takeover, serious payment mismatch, or unsafe interaction | Within 15 minutes |
| P2 | One stuck order, overdue refund, document issue, or degraded service with a workaround | Within 4 staffed hours |
| P3 | Routine question, correction, or non-urgent request | By next staffed day |

Staffed company-testing hours are Monday–Saturday, 09:00–19:00 `Asia/Kolkata`. Do not start a test order unless it can reasonably finish before closing. Safety, custody, payment, or privacy work that remains open at 19:00 receives a named handoff owner; it is never abandoned.

### Incident command

- A help action may connect to the configured internal response path but must not impersonate a public emergency service.
- Scoped controls may pause new checkout, dispatch, provider use, payout, category, vendor, or zone work.
- Controls never silently cancel accepted work or erase custody, refund, ledger, or payout obligations.
- Each control records scope, reason, actor, start, expiry/review, communication, recovery owner, and rollback plan.
- Evidence is access-limited and retained only under an approved hold.
- Closure requires business-state reconciliation and a documented safe-resumption check.
- One risk signal cannot automatically create a permanent punishment.

## 8. Roles and approval thresholds

- Assigned support may communicate and perform approved non-financial recovery actions.
- An authorized support lead may execute a synthetic refund or adjustment up to ₹500 after impact preview.
- More than ₹500 requires a separate Finance approver.
- A different authorized approver is always required for payout-account change, vendor/partner publication, permanent restriction/reinstatement, policy activation, privacy deletion hold, high-risk document approval, and broad incident control.
- The proposer cannot approve their own request.
- Approval expires after its configured period or when the underlying previewed state changes.
- Emergency action is narrow and time-limited and receives after-action review.
- Proposal, approval, rejection, expiry, execution, and rollback are audited.

The ₹500 boundary is a synthetic workflow threshold, not production financial authority.

## 9. Recovery objectives and drills

### Future production design targets

| Capability | Recovery point objective | Recovery time objective | Extra recovery gate |
|---|---|---|---|
| Orders, payments/ledger, refunds, payouts, active custody | No logical loss for acknowledged writes; backup point no older than 5 minutes | Usable within 1 hour | Provider and ledger reconciliation |
| Identity, vendor, catalogue, inventory, support, configuration | No older than 1 hour | Usable within 4 hours | Permission and state checks |
| Search projections, reports, analytics | No older than 24 hours | Within 24 hours | Rebuild from authoritative sources where possible |

These are targets, not achieved claims. Hosting, replication, managed recovery, cost, regional failure, secret isolation, and production evidence remain unresolved.

### Internal restore drill

1. Create a synthetic PostgreSQL/PostGIS and filesystem-adapter backup.
2. Restore into a separate empty test environment, never over active developer data.
3. Verify schema and migration version, row counts, constraints, PostGIS, object checksums, balanced ledgers, permission fixtures, and audit history.
4. Rebuild or replay pending work from durable database outbox records without duplicate effects; Valkey cache and queue state are not authoritative.
5. Reconcile fictional provider statements, queue state, custody, payments, refunds, settlements, and payouts.
6. Record start/end time, checkpoint, achieved RPO/RTO, failures, evidence, reviewer, and next action.
7. Run after migration changes and on the regular company test schedule.
8. Delete drill artifacts automatically after 7 days.

Restoring data never reopens checkout automatically. Incident command must confirm database integrity, permissions, queues, providers, financial reconciliation, custody, notifications, monitoring, rollback readiness, and staffed ownership before resumption.

## 10. Required test coverage

```text
Policy input
├── privacy/retention ──> allow + deny + hold + expiry + deletion + appeal
├── location ───────────> offline + coarse + precise + reconnect + stop + cleanup
├── documents ──────────> submit + review + reject + expire + revoke + appeal
├── support ────────────> P0/P1/P2/P3 + closed hours + breach + handoff
├── approvals ──────────> below/above threshold + self-deny + stale + expired
├── incident controls ──> scoped pause + active obligations + rollback + resume
└── recovery ───────────> backup + isolated restore + replay + reconcile + resume
```

- Jest unit tests cover pure schedules, policy decisions, timers, and permission rules.
- Integration tests cover database authorization, state transitions, retention workers, holds, outbox replay, and restore integrity.
- End-to-end drills cover privacy requests, document expiry, support escalation, maker-checker, incident containment, and recovery/resumption.
- Tests use synthetic data, controllable clocks, deterministic failures, and duplicate/retry cases.

## 11. Test-to-production replacement register

The detailed register moved to the dedicated [Test-to-Production Replacement Register](../production/test-to-production-replacement-register.md). That file is the single source of truth for synthetic data, fake providers, local infrastructure, test financial rules, operating assumptions, production evidence, owners, exact future change locations, and rollback or containment.

This governance policy remains authoritative for the current synthetic retention, privacy, access, verification, delivery-testing, support, approval, incident and recovery rules. Do not copy the replacement rows back into this file; link to the canonical register so the two documents cannot drift.

No register row may move to ready merely because code exists. Evidence, accountable approval, rollback, monitoring, support ownership, and safe handling of in-flight work are mandatory.

## 12. References and unresolved production work

- [Digital Personal Data Protection Act 2023](https://www.meity.gov.in/writereaddata/files/Digital%20Personal%20Data%20Protection%20Act%202023.pdf)
- [Digital Personal Data Protection Rules 2025](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa)

Qualified reviewers must confirm the then-current law and applicability before real data. Production privacy language, retention periods, document requirements, partner model, staffing, insurance, thresholds, hosting, recovery implementation, and public promises remain unresolved.
