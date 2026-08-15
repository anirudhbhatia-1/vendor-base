# ADR-002 — Provider simulators and synthetic money policy

**Status:** Accepted for internal company testing  
**Decision date:** 14 August 2026  
**Owners:** Finance Lead and Engineering Lead  
**Production authority:** None

## Context

Phase 2 needs complete provider boundaries and financial state tests, but the company-development phase must remain free, local, synthetic, and disconnected from real providers. The future product may serve lakhs of users, so duplicates, unknown results, reconciliation, and bounded processing cannot be deferred.

## Decision

- Implement deterministic local simulators for OTP, payments, payouts, maps, push, SMS, email, and filesystem storage.
- Select explicit success and failure scenarios; never make automated tests depend on random faults.
- Keep simulator controls and protected outboxes unavailable outside local/test modes.
- Use the versioned synthetic financial policy in [test-financial-policy.md](../finance/test-financial-policy.md).
- Save authoritative order and balanced ledger records transactionally before retryable provider work.
- Process provider operations through idempotent, horizontally scalable BullMQ workers.
- Treat timeouts as unknown until callback, lookup, or statement evidence resolves them.
- Reconcile incrementally through saved checkpoints and bounded pages.
- Certify future real adapters against the same contract suite, then run controlled company-account transactions and a limited production canary after separate approvals.

## Test coverage map

```text
Test scenario
   │
   ├── OTP ───────> request / expiry / attempts / replay / protected outbox
   ├── Payment ───> authorize / capture / void / refund / unknown / statement
   ├── Payout ────> batch / beneficiary / failure / duplicate / reconciliation
   ├── Maps ──────> route / out-of-zone / timeout / stale result
   ├── Messaging ─> delivered / delayed / rejected / rate limit / outage
   └── Storage ───> upload / checksum / scan / type / size / path permission
                              │
                              ▼
             invalid signature / malformed / replay / duplicate
                              │
                              ▼
        one durable outcome or one visible exception — never a guessed result
```

## Failure modes

| Failure | Required response |
|---|---|
| Provider timeout | Keep unknown state and reconcile; never report a false failure |
| Duplicate request or callback | Return or retain the original effect |
| Invalid callback signature | Reject without state change and record safe security metadata |
| Malformed provider payload | Reject validation and create an actionable exception where money may be at risk |
| Worker crash | Retry the same idempotent operation |
| Statement mismatch | Hold affected settlement and open one finance exception |
| Reconciliation backlog | Apply backpressure, scale workers, and alert on age and money at risk |
| Test control enabled outside allowed mode | Fail application startup |
| Real credential or personal data supplied locally | Reject configuration or fixture validation |

## Alternatives rejected

- **Success-only fakes:** do not prove recovery, duplicate safety, or reconciliation.
- **Random simulator failures:** create unreliable tests that cannot be reproduced.
- **Fixed universal OTP:** creates an authentication bypass that can escape development.
- **Real providers during current development:** introduces cost, credentials, privacy, compliance, and external side effects before their gates are approved.
- **Immediate provider calls inside database transactions:** slow providers would hold locks and reduce scale.
- **Nightly full-history reconciliation:** becomes progressively slower as transactions grow.
- **Production fee or tax assumptions:** require evidence and qualified review that the current test phase does not have.

## Consequences

Phase 2 can build every adapter boundary and financial failure path without external services. Simulator success cannot prove real-provider correctness. Production pricing, tax, legal treatment, credentials, provider selection, support, operating cost, and real-data use remain blocked.

## Related records

- [Simulator contracts](../providers/simulator-contracts.md)
- [Synthetic financial policy](../finance/test-financial-policy.md)
- [D-04](../decisions/D-04.md)
- [D-05](../decisions/D-05.md)

