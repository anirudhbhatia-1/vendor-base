# Complete Money Lifecycle and Reconciliation

**Scope:** `phases.md` Phase 10 (10.1–10.7), company-local synthetic development only.  
**Production authority:** None. Real payments, payouts, bank statements, tax rules, and provider credentials remain gated by D-12.

## What is complete

- A durable INR chart of accounts covers customer/provider clearing, platform clearing/revenue/subsidy, vendor and partner payables, and tax payable. Every ledger transaction is append-only and database-enforced to balance before commit.
- The posting engine (10.1, audit run 66): a posting commits in the same transaction as the state it records — a capture, a refund's success, a paid payout — or not at all. Each transaction carries its business reference, the provider operation and the policy version it was made under, and the request/correlation; each entry names the order it divides and, on the vendor and partner payables, the vendor location or partner user the amount belongs to (the catalogue's `owner_dimension`; the schema refuses an entry on those accounts that names nobody, except in a reversal, which mirrors history as posted). A closed account accepts no postings; a transaction with fewer than two entries is refused at commit; the catalogue itself may only be closed or reopened. `GET /admin/finance/v2/ledger` is the trial balance, rendered only when the totals agree, and `GET /admin/finance/v2/ledger/transactions/:id` reads one posting with its entries and references.
- The capture, void and refund lifecycle (10.2, audit run 67): a capture or a refund the provider leaves unanswered is not parked for good — the operations worker asks the provider (`reconcileUnknownOperations`, via the port's `status`) once a minute has passed, and an operator can apply the provider's statement through `POST /admin/finance/payments/:id/reconcile` and `POST /admin/finance/refunds/:id/reconcile`; "succeeded" is the capture or refund, posted in the same transaction, "failed" leaves the authorisation standing or makes the refund retryable, and the exception closes. An unanswered *authorisation* stays the checkout's to settle. `settleAuthorizationForOrder` reports `CAPTURE_UNKNOWN` and `CAPTURE_FAILED` as themselves. A refund is bounded by the order it returns from and by every refund not yet failed (a pending proposal reserves its amount), names the exact lines it returns (`refund_lines`, summing to its item amount), may be proposed by the platform (with three days for a person to approve, against fifteen minutes for a person's own proposal), and a replayed proposal or approval is its outcome again. An order cancelled after capture — a packed bag nobody is carrying yet — has its refund filed by the platform on the ending (`refundEndedOrder`: item, tax and tip less the discount; the delivery fee kept, as the customer was told).
- Payment attempts support deterministic authorization, capture, unused-authorization void, partial/full refund, decline, malformed response, and unknown-outcome containment. Captured and voided amounts are persisted explicitly. The void reaches the provider through the port's `void` operation; a void the provider declines or does not answer leaves the payment `UNKNOWN_REQUIRES_RECONCILIATION` with a `PAYMENT_UNKNOWN` exception (`RECONCILE_VOID_SAME_OPERATION`) rather than `VOIDED` on a result nobody gave. A provider that throws at authorize, capture, refund or payout is contained as `UNKNOWN` with the same exception the provider's own `UNKNOWN` opens.
- Settlements preserve customer capture/refund, vendor proceeds/fee, partner base/wait/return/tip, and platform adjustment as policy-versioned lines. Completed-order fees are removed from the fully refunded/failed amount path.
- Vendor and partner payouts can be built once per beneficiary/day. A local durable worker schedules the next run at 18:00 Asia/Kolkata, claims the job safely, builds both batches, and schedules the following run.
- Provider statement imports are content- and reference-idempotent. Rows are classified as matched, unmatched, duplicate, amount mismatch, or status mismatch, and every non-match creates an owned finance exception.
- Corrections require a reason, evidence, a balanced preview, a different approving admin, and an unexpired version. Posting creates a linked reversal plus adjustment; it never edits the original transaction.
- Customer receipts, vendor-location settlement statements, partner earning/payout statements, and the admin exception queue have separate authorization boundaries.

## Main implementation boundaries

- Migrations: `0028_complete_money_lifecycle`, `0029_durable_ledger_account_catalogue`, `0108_ledger_posting_engine` and `0109_refund_lines_and_reconciliation`.
- Persistence/services: `MoneyLifecycleService` and `CompleteMoneyLifecycleService`.
- API: the original `/admin/finance` lifecycle plus `/admin/finance/v2`; read projections live under `/customer/finance`, `/vendor/locations/:vendor_location_id/finance`, and `/partner/finance`.
- Worker: `FinancePayoutWorkerService`, using the existing PostgreSQL durable-job engine and `finance.payout` queue scope.

The account catalogue intentionally does not use lifecycle foreign keys from optional owner-scope identifiers. That keeps durable accounting configuration intact when disposable local vendor/user fixtures are rebuilt with `TRUNCATE ... CASCADE`. Ledger entries still reference the account catalogue and financial histories remain protected by append-only triggers.

## Verification

`database/scripts/verify-money-lifecycle.ts` executes 22 connected scenarios, including:

- successful capture, partial refund, vendor/partner settlement and payout;
- unknown authorization and payout outcomes followed by reconciliation;
- exact authorization void and resolved-amount persistence;
- complete settlement-line preservation;
- idempotent 18:00 payout scheduling and daily batch replay;
- matched, duplicate, unmatched, amount-mismatch, and status-mismatch statement rows;
- maker self-approval rejection and checker-posted reversal/adjustment;
- global zero-sum proof and rejected edits to ledger and provider-statement history;
- (10.2) a capture the provider did not answer, reconciled from its status by the sweep (not before a minute has passed) and from a statement as failed, the authorisation left standing; a refund the provider did not answer, settled from its statement; an unanswered authorisation refused here; a refund beyond the order's own charge refused while the payment's would allow it; a replayed proposal and a replayed approval each returning their outcome once; and, in the fulfilment walk, a packed order cancelled before custody with the refund filed against it and its exact line, replay-safe, approved and read on the receipt;
- (10.1) references and owners on every posting of the walk; an entry naming no vendor, an empty transaction, a posting to a closed account, a retyped or deleted account each refused by the schema; a capture whose posting is refused leaves no capture, and the same command then succeeds whole; the trial balance and a posting read back.

`pnpm db:verify:connected` applies all 30 migrations, executes the full connected suite, rehearses every rollback boundary, migrates forward again, and performs a deterministic rebuild.

## Deferred production switch

The provider adapter remains synthetic and INR-only. Moving beyond company development requires the production-switch checklist, security/privacy/legal review, provider contract tests, real payment and payout credentials, bank settlement ingestion, approved tax/fee policy versions, monitoring, retention jobs, and a separately approved production environment. None of those are implied by this phase's local completion.
