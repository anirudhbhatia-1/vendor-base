# Partner Lifecycle, Earnings, and Field-Ops

**Scope:** phases.md Phase 9 remainder — 9.1 partner onboarding, 9.7 offline
proof recovery, 9.8 guided exceptions and safety, 9.10 earnings and disputes.
Company-local synthetic development only.
**Production authority:** None.

## What this closes

Migration 0014 (`assignment-custody`) and `AssignmentCustodyService` already
delivered 9.2–9.6 and 9.9: offer/expiry, one-active-attempt uniqueness, active-
job transitions (arrive/begin route/arrive customer), pickup with server
confirmation, delivery, and return-to-origin. This slice completes the phase
without touching that aggregate:

- **9.1 Partner onboarding.** `partner_applications` with identity/vehicle/
  bank/insurance/emergency/training/zone references, a DRAFT → SUBMITTED →
  UNDER_REVIEW → CHANGES_REQUIRED → APPROVED/REJECTED lifecycle, append-only
  `partner_application_events`, and a version-guarded transition machine.
- **9.7 Offline proof recovery.** `partner_offline_proofs` stores only the
  SHA-256 of the encrypted payload plus a key reference; the plaintext stays
  on the partner's device until sync. A unique partial index on
  `(partner_user_id) WHERE sync_state='PENDING'` blocks a second pending proof
  per partner — the partner cannot walk away from an unsynced proof and take
  new work.
- **9.8 Guided exceptions and safety.** `partner_exception_events` records
  every exception with a named `resolution_state` (OPEN, RETRY, CONTINUE,
  RETURN_TO_VENDOR, CANCEL, REASSIGN, SUPPORT) rather than free text. Emergency
  kinds (ACCIDENT/MEDICAL_EMERGENCY/THREAT) share the same shape but the
  `EMERGENCY_KINDS` set flags them for separate downstream routing so an
  incident does not blend into the generic support bucket.
- **9.10 Earnings and disputes.** `partner_earnings_records` breaks each
  completed delivery into base/distance/time/wait/return/incentive/tip/
  adjustment; `net_minor` is a database-enforced sum of those components, so
  the partner statement can never drift from what admin reconciles. Disputes
  live in `partner_dispute_cases` with one open dispute per (record, component)
  and a partner-vs-admin resolution split.

## Rules this slice enforces

- Only the applicant can create, submit, or read their own application. Only an
  admin can start review, request changes, approve, or reject. Every transition
  requires an `expected_version` and appends an append-only event.
- A partner may have exactly one application via a UNIQUE constraint on
  `applicant_user_id`.
- **Documents expire and are reverified (9.1, audit run 56).** The application carries when the
  identity document, the vehicle registration and the insurance lapse (0099; each must be in the
  future when applied). `documentStanding` reads each as VALID, EXPIRING (within
  `DOCUMENT_EXPIRY_WARNING_DAYS`, 30), EXPIRED or UNDATED. The worker's `sweepExpiredDocuments`
  restricts a partner whose document has lapsed — eligibility `RESTRICTED`, reason
  `DOCUMENT_EXPIRED`, a `DOCUMENT_EXPIRED` event naming the documents — and touches no delivery in
  their custody. The partner submits a renewal (`partner_document_renewals`: one in review per
  document, a new reference and expiry); an admin with `admin.partner_application.review`
  approves or rejects it with a reason; approval writes the document onto the application and
  restores eligibility when nothing else has lapsed. Until run 56 nothing expired and nothing was
  reverified, while the partner's profile carried copy for "a document has expired" that nothing
  emitted.
- **The blockers are exact (9.1).** `onlineEligibility` names why a partner cannot go online —
  `NO_APPLICATION`, `APPLICATION_NOT_APPROVED` (with the state), `DOCUMENT_EXPIRED` (with the
  document), `ELIGIBILITY_RESTRICTED` / `SUSPENDED` / `PENDING` (with the reason),
  `RESTRICTION_ACTIVE` (a GLOBAL trust restriction), `OFFLINE_PROOF_PENDING` — and what is about
  to (`DOCUMENT_EXPIRING`). Going online is refused for the same reasons as
  `PARTNER_NOT_ELIGIBLE`, whose sentence sends the partner to the profile that lists them; until
  run 56 it failed as a bare state conflict.
- **Restrictions are capability-specific (9.1).** An ACTIVE trust restriction on a partner keeps
  them off the road and off every offer when `GLOBAL`, off one store's offers when
  `VENDOR_LOCATION`, and off the offers of stores whose active service zone carries that name when
  `ZONE` (`PartnerAvailabilityService.eligible`). Until run 56 a restriction restricted nothing.
  A delivery already in custody is never ended by a restriction or a lapse: custody obligations
  stand, and an appeal is offered on every restriction in force.
- `net_minor` is `base + distance + time + wait + return + incentive + tip +
  adjustment`, checked at the row level. A schema-enforced identity, not an
  application invariant.
- Earnings ingestion is `system` or `admin` only. Two ingestions for the same
  `delivery_assignment_id` collide on a UNIQUE constraint.
- Disputes are scoped to the partner who owns the earnings record. An open
  dispute reads its `disputed_amount_minor` from the earnings record itself, so
  the partner cannot dispute a phantom amount.
- The offline-proof sync path is idempotent — replaying against a SYNCED row
  returns the current row rather than transitioning again — and the digest of
  the payload must match what was recorded, so a partner cannot substitute an
  edited proof at sync time.
- Guided exception resolution refuses to record a "closure" against a kind
  that has no open event on that assignment, so operations cannot accumulate
  phantom closures.
- Application, exception, and (implicit) all event tables are append-only
  triggers that raise SQLSTATE 55000 on UPDATE/DELETE.

## Deliberate scope decisions

- **`partner.assignment.act` is reused, not duplicated.** The capability
  already existed from migration 0008 for active-assignment routes. Offline
  proof and exceptions are exactly that boundary; adding a new capability
  would fracture the mental model.
- **Earnings settlement stays in Phase 10.** This slice records the amount
  breakdown and the outcome; posting to the ledger and generating payouts is
  `money-lifecycle` territory. `recordEarnings` is designed to be idempotent
  under retry so the Phase 10 worker can safely re-post.
- **Support tooling for disputes is minimal.** A dispute currently transitions
  OPEN → RESOLVED / WITHDRAWN with a deadline. Structured negotiation (multi-
  round proposals) is deferred until Phase 11 admin surfaces are built.
- **Partner UI (Expo app) is out of scope** for this slice — same persistent
  gap as every phase to date. All routes are exercised at the API and
  connected-verifier layer.

## Verification

`database/scripts/verify-partner-lifecycle.ts` — 25 connected scenarios:
- Application create/submit, single application per partner, admin review with
  change-request loop, approve, stale-version rejection, non-admin reject
  rejection, cross-partner read concealment, 7-event application audit trail.
- Offline proof save, second-pending block, wrong-digest sync rejection,
  successful sync with `synced_at`, idempotent sync replay, save-again after
  sync, expiry sweeper transition PENDING → EXPIRED, non-partner save rejection.
- Guided exception raise (regular + emergency), resolve to
  RETURN_TO_VENDOR, missing-open-exception NotFound, invalid resolution
  input rejection, append-only history triggered by SQLSTATE 55000.
- Earnings record with correct net sum, duplicate rejection, dispute open
  with schema-sourced disputed amount, duplicate open dispute blocked,
  cross-partner dispute concealment, admin resolve with proposed amount,
  partner withdraw of their own dispute, earnings list scoped to caller.

Wired into `verify-lifecycle.ts` as `partner_lifecycle_scenarios`.

## Boundaries

- Delivery assignment offer/accept/pickup/deliver/return remain in
  `assignment-custody`, not this service.
- Ledger posting and payout batching remain in `money-lifecycle` (Phase 10).
- Admin support tooling for disputes and escalation queues are Phase 11.
