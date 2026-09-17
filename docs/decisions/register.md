# Production Decision Register

**Register status:** Active  
**Established:** 13 August 2026  
**Scope:** D-01 through D-16; historical records retained, current staging amendment D-15, test compute D-16

The owner and due date columns assign responsibility for producing evidence and a recommendation. They do not approve the underlying decision.

| ID | Decision | Accountable owner | Due date | Status | Blocks | Required evidence/output |
|---|---|---|---|---|---|---|
| [D-01](D-01.md) | Launch neighbourhood and vendor cohort | Operations Lead | 20 August 2026 | APPROVED — INTERNAL TEST ONLY | Real pilot recruitment and production zones remain blocked | Jaipur candidate test zones, 9 synthetic fruit-and-vegetable vendors, 20-item catalogue, test service and support hours |
| [D-02](D-02.md) | Primary clients and delivery sequence | Engineering Lead | 21 August 2026 | APPROVED — INTERNAL DEVELOPMENT ONLY | Public client release remains blocked | Customer, Vendor, Delivery Partner, and Admin each receive a Next.js PWA and Expo/React Native Android app, with bounded shared code |
| [D-03](D-03.md) | Internal development technology foundation | Engineering Lead | 28 August 2026 | APPROVED — INTERNAL DEVELOPMENT STACK ONLY | Hosting, shared environments, recovery, and production release remain blocked | [ADR-001](../architecture/ADR-001-internal-development-stack.md), supported-version policy, local topology, compatibility and test gates |
| [D-04](D-04.md) | Provider simulators and future real-provider gate | Finance Lead with Engineering Lead | 4 September 2026 | APPROVED — LOCAL SIMULATORS ONLY | Real providers, credentials, external side effects, and production certification remain blocked | [Simulator contracts](../providers/simulator-contracts.md), real-provider conformance and canary gates |
| [D-05](D-05.md) | Synthetic fee, earning, and settlement policy | Finance Lead | 11 September 2026 | APPROVED — INTERNAL TEST POLICY ONLY | Production prices, taxes, contracts, refunds, settlements, and payouts remain blocked | [Versioned synthetic policy and balanced examples](../finance/test-financial-policy.md) |
| [D-06](D-06.md) | Internal delivery testing and future operating-model gate | Operations Lead | 18 September 2026 | APPROVED — COMPANY TEST COHORT ONLY | Real recruitment, delivery, contracting, insurance, payout, and production launch remain blocked | Synthetic safety/custody tests and production evidence register |
| [D-07](D-07.md) | Synthetic verification-document lifecycle | Compliance Lead | 25 September 2026 | APPROVED — FICTIONAL DOCUMENTS ONLY | Real requirements and production publication remain blocked | Category-aware lifecycle, expiry, restriction, reverification, and appeal tests |
| [D-08](D-08.md) | Internal privacy, access, and synthetic retention | Privacy Lead | 2 October 2026 | APPROVED — SYNTHETIC DATA ONLY | Real personal-data processing remains blocked | [Data schedule, access matrix, consent, rights and location](../governance/internal-safety-and-production-transition.md); [production replacement gates](../production/test-to-production-replacement-register.md) |
| [D-09](D-09.md) | Internal support, incidents, and approval thresholds | Operations Lead | 9 October 2026 | APPROVED — INTERNAL TEST OPERATIONS ONLY | Public support promises and production authority remain blocked | P0–P3 targets, staffed hours, handoff, maker-checker, incident and audit tests |
| [D-10](D-10.md) | Recovery targets and synthetic restore drills | Engineering Lead | 16 October 2026 | APPROVED TARGETS — PRODUCTION CAPABILITY UNPROVEN | Public launch remains blocked until recovery is proven | Tiered RPO/RTO, isolated restore, reconciliation and resumption evidence |
| [D-11](D-11.md) | Free online company-test provider selection | Engineering Lead | 18 August 2026 | APPROVED — ONLINE COMPANY TEST TARGETS; NOT DEPLOYED | Shared online testing remains blocked until its implementation and control gates pass; production remains blocked | [ADR-003](../architecture/ADR-003-free-online-company-test-stack.md) and the [free online migration plan](../production/free-online-company-test-migration-plan.md) |
| [D-12](D-12.md) | Return to local-only active development | Project Owner with Engineering Lead | 18 August 2026 | APPROVED — LOCAL ACTIVE; ONLINE TEST PAUSED | Further online provisioning, integration, deployment, and credential use remain blocked until an explicit resume decision | Local entry points, paused-resource inventory, credential cleanup, and preserved online reference files |

## Governance defaults

D-01 through D-04 owners and dates were explicitly approved by the project owner. D-01 through D-09 approve only internal company testing: synthetic pilot data, clients, local stack, provider simulators, test-money rules, company delivery testers, fictional documents, synthetic privacy controls, and internal support. D-10 approves recovery targets and synthetic drills but does not claim production capability. D-11 preserves the researched online provider target. D-12 pauses its execution and makes local company development the only active path. Every production portion remains deferred. These owners may be reassigned by the project owner; reassignment does not approve or alter product policy.

## Validation-only assumptions

The delivery-fee example, provider simulators, privacy periods, support targets, approval threshold, and recovery targets are approved only for the boundaries stated in D-04 through D-10. The service-radius example, initial three-vendor cart limit, other timing defaults, manual pilot procedures, and any proposed technology not explicitly approved in its decision record remain validation-only. None may be presented as permanent production policy or achieved capability.

## Current superseding decisions — recorded 6 September 2026

| ID | Owner / date | Status | Effect and remaining gate |
|---|---|---|---|
| [D-13](D-13.md) | Project Owner / Engineering Lead; 29 August 2026 | Historical approved database resumption | Supabase development resumed; D-15 supersedes its permissive TLS and simulator-only target. |
| [D-14](D-14.md) | Engineering Lead; recorded 29 August 2026 | Accepted implementation design; production not activated | Separate least-privilege production database design; no staging/production capability certification. |
| [D-15](D-15.md) | Project Owner implementation request / Engineering Lead; recorded 6 September 2026 | Current staging implementation direction | Eight clients, selected staging adapters and revised checkout; deployment, provider access, payout selection and public launch remain gated. |
| [D-16](D-16.md) | Project Owner / Engineering Lead; recorded 17 September 2026 | Approved test deployment direction; synthetic only | Azure for Students VM replaces the paused OCI compute target; static shells on Azure Static Web Apps; customer PWA as a container; every other D-15 gate unchanged. |

D-12 is not the current blanket prohibition on Supabase/staging implementation. D-04's local-simulator-only scope remains historical test evidence, not permission to select fake staging providers. Existing due dates are historical accountability records; do not manufacture new approvals or completion evidence.
