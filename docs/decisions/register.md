# Production Decision Register

**Register status:** Active  
**Established:** 13 August 2026  
**Scope:** D-01 through D-10 from `implementation.md` §3

The owner and due date columns assign responsibility for producing evidence and a recommendation. They do not approve the underlying decision.

| ID | Decision | Accountable owner | Due date | Status | Blocks | Required evidence/output |
|---|---|---|---|---|---|---|
| [D-01](D-01.md) | Launch neighbourhood and vendor cohort | Operations Lead | 20 August 2026 | APPROVED — INTERNAL TEST ONLY | Real pilot recruitment and production zones remain blocked | Jaipur candidate test zones, 9 synthetic fruit-and-vegetable vendors, 20-item catalogue, test service and support hours |
| [D-02](D-02.md) | Primary clients and delivery sequence | Engineering Lead | 21 August 2026 | APPROVED — INTERNAL DEVELOPMENT ONLY | Public client release remains blocked | Simultaneous Next.js PWA and Expo/React Native Android delivery with bounded shared code |
| [D-03](D-03.md) | Internal development technology foundation | Engineering Lead | 28 August 2026 | APPROVED — INTERNAL DEVELOPMENT STACK ONLY | Hosting, shared environments, recovery, and production release remain blocked | [ADR-001](../architecture/ADR-001-internal-development-stack.md), supported-version policy, local topology, compatibility and test gates |
| [D-04](D-04.md) | Provider simulators and future real-provider gate | Finance Lead with Engineering Lead | 4 September 2026 | APPROVED — LOCAL SIMULATORS ONLY | Real providers, credentials, external side effects, and production certification remain blocked | [Simulator contracts](../providers/simulator-contracts.md), real-provider conformance and canary gates |
| [D-05](D-05.md) | Synthetic fee, earning, and settlement policy | Finance Lead | 11 September 2026 | APPROVED — INTERNAL TEST POLICY ONLY | Production prices, taxes, contracts, refunds, settlements, and payouts remain blocked | [Versioned synthetic policy and balanced examples](../finance/test-financial-policy.md) |
| [D-06](D-06.md) | Delivery operating model | Operations Lead | 18 September 2026 | OPEN | Phase 0.5; Phase 9 partner production launch | Legal engagement review, insurance, safety, payout, incident, and custody ownership |
| [D-07](D-07.md) | Verification and document policy | Compliance Lead | 25 September 2026 | OPEN | Phase 0.5; Phase 5 vendor and Phase 9 partner publication | Required documents, lawful purpose, viewers, expiry/grace effects, reverification, restriction, and appeal SLA |
| [D-08](D-08.md) | Privacy and retention | Privacy Lead | 2 October 2026 | OPEN | Phase 0.5; Phase 4 use of production personal data | Data-class purpose, viewer, consent, location precision, retention, deletion, export, and incident rules |
| [D-09](D-09.md) | Support and approval thresholds | Operations Lead | 9 October 2026 | OPEN | Phase 0.5; Phase 11 refunds, restrictions, and configuration publication | Role matrix, staffed hours, SLAs, escalation paths, maker-checker and monetary thresholds |
| [D-10](D-10.md) | Recovery objectives | Engineering Lead | 16 October 2026 | OPEN | Phase 0.5; Phase 13 public launch | RPO, RTO, backup/restore design, restore-test evidence, incident escalation and communications policy |

## Governance defaults

D-01 through D-04 owners and dates were explicitly approved by the project owner. D-01 through D-05 now approve only internal company testing: synthetic pilot data, clients, local stack, provider simulators, and test-money rules. Hosting and every production portion remain deferred. D-06 through D-10 use role-based owners and staggered weekly due dates so responsibility is visible without inventing the underlying production decisions. These governance defaults may be reassigned by the project owner; reassignment does not approve or alter product policy.

## Validation-only assumptions

The delivery-fee example and provider simulators are now approved only as internal synthetic policy under D-04 and D-05. The service-radius example, initial three-vendor cart limit, other timing defaults, manual pilot procedures, and any proposed technology not explicitly approved in its decision record remain validation-only. None may be presented as permanent production policy.
