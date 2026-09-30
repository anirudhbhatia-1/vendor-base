# End-to-End Scenario Traceability

**Scope:** maps the 15 required end-to-end scenarios in `implementation.md` §13.2 to the
connected verifiers that cover them. Company-local synthetic environment.
**Status legend:** `covered` (a connected verifier in the `pnpm db:verify` ladder asserts
it) · `partial` (core behaviour covered, a named sub-part is not) · `deferred` (requires
external infrastructure/people; recorded in the launch register).

Every verifier named below is wired into `database/scripts/verify-lifecycle.ts` and runs on
every `pnpm db:verify`.

Partner shift availability and dispatch eligibility are additionally exercised by
`verify-partner-availability.ts`: only eligible partners can go online, device-health
warnings and server-owned online duration are recorded, and nearby online partners become
visible to the admin dispatch query.

`verify-local-notifications.ts` proves deduplicated local intents, preference-aware fake channel
delivery, durable in-app inbox ownership, read state, bounded transient retry, and recovery. The
same inbox is integrated in all eight clients; real providers remain an explicit external gate.

| # | §13.2 scenario | Status | Verifier(s) / evidence |
|---|---|---|---|
| 1 | One-store pickup completes and settles exactly once | covered | `verify-vendor-fulfilment.ts` — accept → pick → ready → OTP pickup → `settleInventoryOnPickup` commits reservations once, and (since batch 10) the collected order's money settles once through `recordDeliveryEarnings` with no partner earning; `apps/worker/src/domain-event-handler.spec.ts` asserts the worker runs that on `vendor_order.picked_up` only for a collected order. Before batch 10 this row covered inventory only — a collected order never settled. |
| 2 | Three-store checkout: two accept, one times out; siblings continue, only failed allocation releases | covered | `verify-grouped-checkout.ts` (blocked-group isolation) + `verify-vendor-fulfilment.ts` (decline releases only its own holds; sibling stays PLACED) |
| 3 | Two customers compete for the last counted unit; at most one reservation commits | covered | `verify-inventory-reservations.ts` — concurrent `softHold` under `FOR UPDATE`, over-reservation refused |
| 4 | Vendor proposes substitution; customer approves, rejects, and times out (separate tests) | covered | `verify-vendor-fulfilment.ts` — substitution→approve (with authorization-delta assertion), weight→reject, weight→timeout, plus double-answer and foreign-customer negatives |
| 5 | Payment authorization times out but later webhook succeeds; one checkout, no duplicate charge | covered | `verify-grouped-checkout.ts` — PAYMENT_UNKNOWN → `receiveWebhook` reconciles to ACTIVE, idempotent by provider event id |
| 6 | Partner offer expires, second partner accepts; first attempt + compensation history remains | covered | `verify-assignment-custody.ts` — offer expiry, one-active-attempt uniqueness, non-deleting decline/expiry |
| 7 | Partner waits past both thresholds, leaves under policy, earning adjustment posted once | covered | `verify-partner-wait-policy.ts` — server-owned timer records both thresholds, prevents early leave, routes post-pickup custody to recovery, and posts one wait adjustment under retry. The operations worker advances due timers independently of the client. |
| 8 | Customer cancels after pickup; return closes custody before final financial resolution | covered | `verify-operations-gate.ts` — delivery operations direct the return of goods a partner holds, custody kept, cancellation refused; `verify-assignment-custody.ts` — `requireReturn`/`authorizeReturn`/`completeReturn` close custody independently of settlement |
| 9 | Delivery proof saved offline, retried, synchronized without duplicate completion | covered | `verify-partner-lifecycle.ts` — `saveOfflineProof` → digest-checked idempotent `syncOfflineProof`, single-pending guard |
| 10 | Support resolves one child order without mutating siblings | covered | `verify-order-monitor.ts` — previewed operator cancellation of one child with its sibling unaffected; `verify-support-cases.ts` — cases scoped to one child order; `verify-operations-gate.ts` — the cancellation walked from support's side with the sibling's state and version unchanged |
| 11 | Support proposes a protected refund, finance approves; self-approval rejected | covered | `verify-operations-gate.ts` — the customer's case reaches support, support proposes the refund (0124 grants support the proposal, not the approval), cannot approve its own, finance approves from its queue, support resolves the case on it; both steps on the operational audit by approval reference. `verify-money-lifecycle.ts` — maker-checker at the service |
| 12 | Risk signal opens review; no irreversible restriction without an attributable decision and appeal path | covered | `verify-trust-review.ts` — signals, evidence, second-person decision, appeal; `verify-operations-gate.ts` — a damaged-item case becomes a signal against the shop, the proposer cannot approve, a second person does, the shop appeals, a third decides |
| 13 | A kill switch blocks new scoped work while existing custody and ledger history remain intact | covered | `verify-incident-controls.ts` — nine pauses enforced, preview, approval, checklist, and a ledger/orders/custody snapshot unchanged by engaging and lifting; `verify-operations-gate.ts` — the shop paused with goods on a partner and a refund on record, all unchanged |
| 14 | Expired partner/vendor document blocks going online under policy but does not strand an active package | covered | `verify-vendor-onboarding.ts` — document expiry / reverification lifecycle; publication readiness gate |
| 15 | English/Hindi, keyboard/screen-reader, 200% zoom, 360 px, slow network, reconnect across every role task | **partial / deferred** | Localization data + CI missing-translation gate: `0033_locale_registry` + `verify-launch-readiness.ts`; locale bundle consumed by a UI + `en`/`hi` toggle (customer-pwa); automated a11y lint (`jsx-a11y` in `pnpm lint`). **Deferred:** manual screen-reader/AT passes, real low-end device + slow-network testing — need external infrastructure; see the launch register |

## Open items (functional, fixable without external infrastructure)

No repository-local functional gaps remain in the enumerated scenarios. Admin membership
grant and revoke are exposed through `AdminAccessController`, require the global
`admin.access.role_manage` capability, reject self-grants, preserve separation-of-duty rules,
and retain the identity-access event history.

## Externally-bounded items (cannot be evidenced in a synthetic environment)

Recorded in `docs/engineering/launch-readiness-and-localization.md` with owners and
acceptance criteria: manual screen-reader/AT (12.2), physical low-end-device farm (12.4),
production-scale p99 load (12.6), external penetration test (12.1), live-replica RPO/RTO
restore drill (12.5 / D-10), and human stakeholder gate signatures (12.7). These are not
faked; the register makes them explicit and trackable.
