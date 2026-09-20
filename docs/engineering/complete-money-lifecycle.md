# Complete Money Lifecycle and Reconciliation

**Scope:** `phases.md` Phase 10 (10.1–10.7), company-local synthetic development only.  
**Production authority:** None. Real payments, payouts, bank statements, tax rules, and provider credentials remain gated by D-12.

## What is complete

- A durable INR chart of accounts covers customer/provider clearing, platform clearing/revenue/subsidy, vendor and partner payables, and tax payable. Every ledger transaction is append-only and database-enforced to balance before commit.
- Payment attempts support deterministic authorization, capture, unused-authorization void, partial/full refund, decline, malformed response, and unknown-outcome containment. Captured and voided amounts are persisted explicitly. The void reaches the provider through the port's `void` operation; a void the provider declines or does not answer leaves the payment `UNKNOWN_REQUIRES_RECONCILIATION` with a `PAYMENT_UNKNOWN` exception (`RECONCILE_VOID_SAME_OPERATION`) rather than `VOIDED` on a result nobody gave. A provider that throws at authorize, capture, refund or payout is contained as `UNKNOWN` with the same exception the provider's own `UNKNOWN` opens.
- Settlements preserve customer capture/refund, vendor proceeds/fee, partner base/wait/return/tip, and platform adjustment as policy-versioned lines. Completed-order fees are removed from the fully refunded/failed amount path.
- Vendor and partner payouts can be built once per beneficiary/day. A local durable worker schedules the next run at 18:00 Asia/Kolkata, claims the job safely, builds both batches, and schedules the following run.
- Provider statement imports are content- and reference-idempotent. Rows are classified as matched, unmatched, duplicate, amount mismatch, or status mismatch, and every non-match creates an owned finance exception.
- Corrections require a reason, evidence, a balanced preview, a different approving admin, and an unexpired version. Posting creates a linked reversal plus adjustment; it never edits the original transaction.
- Customer receipts, vendor-location settlement statements, partner earning/payout statements, and the admin exception queue have separate authorization boundaries.

## Main implementation boundaries

- Migrations: `0028_complete_money_lifecycle` and `0029_durable_ledger_account_catalogue`.
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
- global zero-sum proof and rejected edits to ledger and provider-statement history.

`pnpm db:verify:connected` applies all 30 migrations, executes the full connected suite, rehearses every rollback boundary, migrates forward again, and performs a deterministic rebuild.

## Deferred production switch

The provider adapter remains synthetic and INR-only. Moving beyond company development requires the production-switch checklist, security/privacy/legal review, provider contract tests, real payment and payout credentials, bank settlement ingestion, approved tax/fee policy versions, monitoring, retention jobs, and a separately approved production environment. None of those are implied by this phase's local completion.
