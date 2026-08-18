# Revised Assumption Register

**Source:** Phase 1 synthetic preparation, desk runs, measurement, and decision review
**Rule:** Synthetic evidence may change a design assumption, but cannot establish market or production truth

| ID | Earlier assumption | Current finding | Revised assumption | Evidence needed next | Status |
|---|---|---|---|---|---|
| `A-01` | Manual records may be enough to reason about the transaction | References and handoffs can represent the main branches | Preserve the manual reference and handoff model in local contracts; human usability remains unknown | Timed trained-operator rehearsal | `REVISED` |
| `A-02` | The synthetic fee could support delivery and platform economics | Normal orders produce a fee remainder, but return/wait exposure made the scripted total negative | Treat pricing only as an arithmetic fixture; do not infer viability | Pre-approved real-cost threshold and controlled evidence | `FAILED_AS_BUSINESS_EVIDENCE` |
| `A-03` | One completed path would be enough to start engineering | Failures touch custody, support, refunds, ledger and sibling isolation | Foundation must support deterministic failure fixtures and observable states from the start | Local tests during Phase 2 and later slices | `REVISED` |
| `A-04` | Multi-vendor grouping is mainly a customer-display concern | One sibling cancellation changes group projection and payment allocation while the other continues | Make vendor-order isolation a data and money invariant, not only a UI grouping | Contract, transaction and concurrency tests | `CONFIRMED_SYNTHETIC` |
| `A-05` | Fake-provider success paths are sufficient initially | Unknown payment must pause fulfilment and reconcile under the same reference | Every fake adapter needs timeout, unknown, duplicate, malformed and reconciliation scenarios | Provider-contract tests | `REVISED` |
| `A-06` | Delivery failure is just an order cancellation | Failure after pickup creates continuing custody, return, pay and refund duties | Custody/return is a first-class state contract | State-machine and end-to-end tests | `CONFIRMED_SYNTHETIC` |
| `A-07` | Platform fee per completion implies positive contribution | Protected wait/return earnings can exceed completed-order fee income | Contribution must include exception, support, provider, labour, insurance, tax and infrastructure costs | Controlled cost evidence | `FAILED_AS_BUSINESS_EVIDENCE` |
| `A-08` | Twenty fictional personas can approximate customer validation | Scripted personas only prove scenario coverage | Do not use fictional confirmation/repeat actions as demand or retention evidence | Approved participant validation | `FAILED_AS_MARKET_EVIDENCE` |
| `A-09` | Phase 1 must fully pass before any engineering file exists | Project owner accepts a reversible local-foundation bet | Permit Phase 2 local foundation only, while keeping deployment and Phase 3+ gated | `BUILD-01` review before expansion | `OWNER_EXCEPTION` |
| `A-10` | Designing for lakhs of users requires early distributed services | No measured load or code exists, and current boundaries fit a modular monolith | Preserve scalable identifiers, indexes, queues and bounded work without premature microservices | Measured local performance and later load tests | `UNCHANGED` |

## Product or Operations fixes before full build

- Approve genuine business thresholds before collecting outcome evidence.
- Run trained human rehearsals to measure handoff usability and timing.
- Resolve real delivery engagement, safety, insurance, support and liability gates before controlled delivery.
- Validate exception costs, particularly failed delivery and return.
- Test customer understanding of named vendors, grouped orders, separate outcomes, and revised amounts.
- Measure vendor incremental effort, spoilage, disruption, and willingness.

## Engineering implications now

- Keep local foundation provider-neutral, deterministic, resettable, and synthetic.
- Treat PostgreSQL as authoritative; Valkey state must be rebuildable.
- Preserve one vendor order per vendor location and explicit payment allocations.
- Put idempotency, outbox, state transition, permission, and reconciliation requirements into the foundation/test conventions rather than deferring them to production hardening.
- Do not introduce microservices, hosted search, route optimisation, pharmacy, COD, or real adapters.
