# Synthetic money lifecycle

**Scope:** Phase 5.6, company-local synthetic development only  
**Authority:** D-05 and D-09 internal test policies  
**Real money:** Prohibited

Phase 5.6 supplies a deterministic fake-provider path for payment authorization, capture, refund, settlement, payout, and reconciliation. Every amount is integer INR paise and every externally shaped identifier must begin with `SYNTH-`. No card, UPI, bank, beneficiary, tax, or real provider data is stored.

## State and ownership

- Payments record `CREATED → AUTHORIZING → AUTHORIZED → CAPTURE_PENDING → CAPTURED`. Declines become `FAILED`; ambiguous outcomes become `UNKNOWN_REQUIRES_RECONCILIATION` and open one finance exception.
- Refunds require a captured payment, cannot exceed the remaining capture, expire after 15 minutes, and require a different authenticated admin to approve. Success posts a linked refund ledger transaction; unknown results remain in finance review.
- Completed-order settlement uses the approved ₹5 vendor fee, the synthetic delivery/wait/return formula, and 100% of the tip for the partner. Eligibility begins after 24 hours.
- Payouts use fictional beneficiary references. An unknown result remains `SUBMITTED` until a matching synthetic statement resolves the same provider operation. A successful statement closes the exception without creating another payout.

The finance mutation API is under `/admin/finance` and requires the global `admin.finance.ledger_manage` capability. Customer, vendor, and partner clients do not receive mutation authority. Their future projections must use scoped read capabilities and server-derived values.

## Ledger invariant

Capture, refund, settlement, and paid payout each post a separate transaction. Every ledger transaction is checked twice: application code verifies exact debit/credit equality, and a deferred PostgreSQL constraint prevents an unbalanced transaction from committing. Posted transactions and entries are append-only. Corrections must use a new reversal or adjustment; there is no edit or force-balance path.

## Local verification

`pnpm db:verify` proves:

- the D-05 distance, wait, fee, partner earning, refund, and rounding rules;
- payment authorization/capture and unknown-result containment;
- refund amount bounds and maker-checker separation;
- settlement balance after a partial refund;
- successful vendor payout and unknown partner payout reconciliation;
- zero aggregate debit/credit difference and append-only ledger history;
- rollback and forward migration across all 16 reviewed migrations.

This evidence is synthetic correctness only. Before production, the replacement register still requires provider selection, sandbox contracts, signed callbacks, independent secrets, real statement formats, finance/tax/legal approval, controlled company transactions, monitoring, recovery, and a limited canary.

The remaining Phase 5.6 integration work begins when checkout and order aggregates exist: separate authorization/capture provider operations, automatic 18:00 Asia/Kolkata payout batching through the durable scheduler, scoped read projections and downloads, and order-owned customer/vendor/partner APIs. The current finance-only mutation surface does not fabricate those missing ownership boundaries.
