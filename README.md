# Neighbourhood Store Marketplace

A vendor-first local commerce platform for India. Customers order from the exact neighbourhood shop they trust, while independent vendors keep their identity, prices, inventory, and customer relationships.

Unlike dark-store quick-commerce platforms, this product does not own inventory or hide the seller behind a generic catalogue. It connects customers, local shops, and shared delivery partners through four product surfaces:

- Customer App / Web
- Vendor Portal
- Delivery Partner App / Portal
- Admin Console

> **Status:** Local application development remains active, with the synthetic Supabase development database (D-13). Since 17 September 2026 the same synthetic environment also runs on Azure Container Apps for company testing under [D-16](docs/decisions/D-16.md): every provider is still fake or filesystem-backed, the runtime declares itself synthetic to start, and no production authority is implied. Real providers, real people, real money and public launch remain gated by [D-15](docs/decisions/D-15.md).
> **Documentation baseline:** 18 September 2026 · local, Supabase-database and Azure company-test environments active

## Start here

Use the documents in this order before implementation:

1. Read this README for product intent and scope.
2. Read [prd.md](prd.md) for required outcomes and MVP acceptance.
3. Read [architecture.md](architecture.md) for module ownership and durable state.
4. Read [design.md](design.md) for every role's screens and interaction states.
5. Read [workflow.md](workflow.md) for cross-role chronology and operational handoffs.
6. Execute through [implementation.md](implementation.md), the canonical build contract for identifiers, timers, APIs, data, events, slices, tests, and release gates.
7. Apply [rules.md](rules.md) to every contributor and change.

To use Supabase for the synthetic development database, follow the
[Supabase development database runbook](runbooks/supabase-dev/README.md). Do not paste or commit the
connection string.

Production database preparation is isolated from development and documented in the
[Supabase production database runbook](runbooks/supabase-production/README.md) and
[D-14](docs/decisions/D-14.md). Passing these database controls does not by itself declare the full
marketplace production-ready.

If documents conflict, stop and resolve the conflict using the authority table in `implementation.md` §1. Do not encode an assumption in code.

## Why this product

Quick-commerce services make ordering convenient, but they can reduce sales and visibility for independent kirana stores, vegetable sellers, pharmacies, and specialty shops. Many local vendors cannot afford a dedicated delivery employee, vehicle costs, or the software needed to run online ordering themselves.

The marketplace is designed around a different promise:

> Buy from your trusted local shop, with convenient ordering and shared delivery.

The shop remains visible throughout the experience. It controls its catalogue, prices, availability, service area, fulfilment time, and substitution policy.

## Who it serves

| User | What they need |
|---|---|
| Customer | Discover nearby shops, choose a preferred vendor, order confidently, and receive or collect the order. |
| Vendor | Gain digital orders without hiring a dedicated delivery team or losing the shop's identity. |
| Delivery partner | Receive suitable delivery jobs, complete verified handoffs, and understand earnings and payouts. |
| Admin / operations | Verify vendors and partners, manage service areas, monitor orders, resolve issues, and control risk. |

## How an order works

1. The customer enters an address or pin code.
2. The platform shows eligible local stores, including the customer's favourite or preferred shops.
3. The customer adds products from one or more named stores. The cart keeps a separate store group for every vendor location.
4. The platform validates each store group and shows its own minimum, delivery or pickup choice, fee, and fulfilment window before showing the combined checkout total.
5. One checkout creates a checkout group containing one independent order per vendor. Each vendor accepts, picks, and requests approval for its own substitutions or variable-weight adjustments.
6. Each store order is collected, vendor-delivered, or assigned to an eligible delivery partner. Separate deliveries remain visible unless the platform explicitly confirms a safe combined route.
7. The customer tracks the overall checkout and each vendor order, confirming every pickup or delivery with the applicable OTP.
8. The platform allocates payment and settles each vendor order independently, including vendor earnings, partner earnings, platform fees, refunds, and adjustments.

## Product experiences

### Customer App / Web

- Location and address management
- Search by shop, product, brand, and category, with recent searches and local-language matching
- Favourite and preferred stores
- Dedicated vendor storefronts
- Packaged and variable-weight products
- Substitution preferences and approval
- Multi-store cart grouped by named vendor, with one vendor-scoped order and fulfilment promise per store
- Prepaid UPI, cards, and supported wallets; COD remains disabled until a separate cash-handling and reconciliation policy is approved
- Pickup, scheduled delivery, order status, receipts, support, and reordering

### Vendor Portal

- Vendor onboarding and store profile
- Hours, service zones, minimum order, and preparation time
- Catalogue creation and CSV import
- Product pricing, stock status, and variable-weight configuration
- Inventory freshness, checkout soft holds, and acceptance-time stock commitment
- Real-time order acceptance, alert escalation, impact-aware decline/cancellation, and picking workflow
- Substitution and customer-decision requests
- Handoff to pickup or delivery partner
- Structured operational escalation plus sales, settlements, ratings, fulfilment, and repeat-customer insights

### Delivery Partner App / Portal

- Identity, vehicle, bank, insurance, and eligibility onboarding
- Online/offline availability and service-zone selection
- Job offers with pickup area, drop area, distance, deadline, and expected pay
- Navigation to vendor and customer
- OTP/QR pickup confirmation and OTP proof of delivery
- Assignment/reassignment history, vendor-wait timers, package custody, and controlled return-to-origin
- Exception and emergency flows for vendor delays, missing packages, unsafe locations, accidents, wrong addresses, and unreachable customers
- Privacy-bounded location tracking and text/landmark navigation fallback
- Trip-level base, distance/time, waiting, return, incentive, tip, adjustment, dispute, and payout history
- Masked customer communication and support escalation

### Admin Console

- Vendor and delivery-partner verification, expiry, reverification, restriction, and appeal workflows
- Store approval, publishing, pausing, and audit history
- Catalogue and restricted-item moderation
- Versioned service-zone, fee, commission, payout, and operational-policy configuration with maker-checker approval
- Checkout-group and child-order live monitoring with fulfilment, custody, settlement, and sibling isolation
- Structured cancellation, refund, finance reconciliation, dispute, and support queues
- Evidence-based trust reviews, quality controls, scoped restrictions, and appeal paths
- Reversible, scoped incident kill switches with impact preview and audit history
- Marketplace, vendor, delivery, finance, and operational reporting

## Business model

The current pilot direction uses two transaction-linked charges:

- **Customer delivery fee:** calculated transparently using delivery distance. A working validation example is a ₹15 base fee plus ₹8 per kilometre after the first 2 km, making a 5 km delivery ₹39. This is a test assumption, not final pricing.
- **Vendor platform fee:** charged per successfully completed order instead of as a monthly subscription. Failed, platform-cancelled, or fully refunded orders should not generate the normal vendor fee.

The pilot must measure whether customer delivery fees cover rider pay, pickup waiting time, failed trips, support, payment costs, and platform margin. Final pricing should come from completed orders rather than survey responses.

## Recommended validation pilot

Before building the full marketplace, validate the core transaction in one dense neighbourhood:

- Start with 3–10 vendors from one category cluster.
- Recruit 10–20 known customers within roughly 3–5 km.
- List only 20–50 fast-moving products per store.
- Show the complete delivery fee before order confirmation.
- Use one or two delivery partners and manual dispatch initially.
- Track checkout conversion after the fee appears, vendor acceptance time, pickup delay, delivery time, rider payout, vendor earnings, cancellations, and repeat orders.

The pilot should answer three questions:

1. Will customers pay a distance-based fee to order from a specific trusted shop?
2. Can vendors prepare orders accurately and quickly enough without disrupting walk-in business?
3. Can each completed order pay the delivery partner and platform while creating incremental profit for the vendor?

## MVP scope

After the pilot proves demand and workable unit economics, the initial product should support:

- One city with two or three launch pin-code clusters
- Kirana or vegetables as the first category
- Customer store discovery, preferred vendors, multi-store cart, grouped checkout, vendor-scoped orders, and tracking
- Vendor onboarding, catalogue management, order acceptance, picking, substitutions, and settlement visibility
- Delivery-partner onboarding, assignment, navigation, verified handoff, exceptions, earnings, and payouts
- Admin onboarding, moderation, order monitoring, refunds, audit logs, and basic analytics
- Pickup, vendor self-delivery, or a small platform-managed delivery-partner pilot

## Deliberate non-goals for the MVP

- Owned inventory or dark stores
- A 10-minute delivery promise
- Automatic consolidation of multiple store pickups into one delivery route before dispatch reliability and fee allocation are proven
- Automated route optimisation
- A complete POS or accounting replacement
- Large, citywide delivery coverage before zone economics work
- Prescription medicine sales before legal, pharmacy, and data-protection review

## Product principles

- **Vendor first:** Every shop has its own identity, catalogue, policies, and loyal customers.
- **Transparent economics:** Customers and vendors see applicable prices and fees before committing.
- **Honest fulfilment:** Display realistic preparation times, delivery windows, stock confidence, and exception states.
- **Customer control:** Substitutions and variable-weight price changes follow explicit customer preferences.
- **Accessible operations:** Core vendor and partner workflows must work on low-end Android devices and standard mobile networks.
- **Trust by design:** Verify participants, minimise exposed personal data, and audit sensitive actions.

## Pharmacy safeguards

Pharmacy ordering is a regulated expansion, not a default launch category. It requires verified licences, prescription upload and human review, restricted-product controls, no automatic prescription substitution, limited access to health information, and jurisdiction-specific legal approval.

Delivery partners must never receive prescription contents, customer medical history, or other information unnecessary for delivery.

## Success measures

| Area | Measures |
|---|---|
| Customer demand | Paid conversion after fee disclosure, repeat-order rate, preferred-store orders, average basket value, multi-store checkout conversion |
| Vendor value | Incremental orders, GMV growth, vendor retention, acceptance rate, cancellation rate |
| Fulfilment | Preparation time, pickup delay, on-time delivery, completion rate, issue/refund rate |
| Delivery partners | Job acceptance, completed trips, earnings per active hour, payout accuracy, safety incidents |
| Unit economics | Customer delivery revenue, vendor fee revenue, rider payout, support/payment costs, contribution per order |

## Roadmap

### Phase 1: Validate and launch

Run the neighbourhood pilot, prove paid demand and delivery economics, then launch the four core product experiences in a small service area.

### Phase 2: Improve retention and operations

Add live tracking, batch assignment, route optimisation, loyalty rewards, recurring baskets, shared shopping lists, POS/inventory integrations, and richer vendor marketing tools.

### Phase 3: Expand the marketplace

Improve cross-store delivery consolidation, then consider B2B ordering, more store categories, and vendor-managed advertising after vendor-scoped order economics are reliable.

## Documentation

- [Product Requirements Document](prd.md) contains the complete product requirements, workflows, business rules, data model, risks, and phased scope.
- [Product Design](design.md) translates the requirements into navigation, screens, interaction states, shared components, accessibility rules, and the white/light visual direction.
- [Architecture](architecture.md) defines the proposed system boundaries, domain modules, data model, state machines, integrations, security, deployment, and scaling path.
- [Repository Structure and Import Boundaries](docs/architecture/repository-structure.md) defines the Phase 2 workspace directories, package responsibilities, import direction, root commands, and pinned toolchain.
- [Contributing](CONTRIBUTING.md) defines the local quality, safety, review, and verification workflow.
- [Testing Conventions](docs/engineering/testing-conventions.md) defines test layers, locations, synthetic fixtures, and mandatory failure coverage.
- [Local Application Entry Points](docs/engineering/local-entry-points.md) lists every PWA, Android, API, and worker command, port, health route, and current limitation.
- [End-to-End Workflow Architecture](workflow.md) joins the customer, vendor, delivery-partner, admin, category, order, payment, settlement, exception, and support journeys from entry through final closure.
- [Implementation Blueprint](implementation.md) is the executable contract for terminology, IDs, state records, timers, endpoints, persistence, workers, permissions, build slices, tests, releases, and rollback.
- [Test-to-Production Replacement Register](docs/production/test-to-production-replacement-register.md) lists every known synthetic, fake, local-only, or unproven component and the evidence required before production use.
- [Free Online Company-Test Migration Plan](docs/production/free-online-company-test-migration-plan.md) maps every local component to a researched free-tier or open-source online candidate, defines the implementation/change structure, and identifies unavoidable production costs.
- [ADR-003](docs/architecture/ADR-003-free-online-company-test-stack.md) records the researched online-test stack. [D-12](docs/decisions/D-12.md) pauses the broader cloud deployment; [D-13](docs/decisions/D-13.md) narrowly resumes Supabase as a database-only synthetic development target.
- [Continuous Integration](docs/engineering/continuous-integration.md) documents the least-privilege GitHub Actions gate, safe evidence, local equivalent, and external activation requirements.
- [Online-Test Deployment](docs/engineering/online-test-deployment.md) documents the controlled Cloudflare/Supabase/OCI skeleton, and the [setup runbook](runbooks/online-test/README.md) gives the account, deployment, health, evidence, and rollback sequence.
- [AI Rules and Boundaries](rules.md) defines what AI contributors may do, must verify, must not do, and when they must stop for approval.
- Mercato was reviewed as product inspiration for local-store discovery, named merchant selection, pickup/delivery, and merchant ecommerce tooling. It is not a specification to copy.

## Production gates still needing named owners

- Launch neighbourhood and first vendor category
- Initial vendor fee per completed order
- Final customer delivery-fee formula and maximum service radius
- Delivery-partner employment or contracting model
- Payment and payout providers plus reconciliation behavior; COD remains disabled
- Vendor and partner verification requirements
- Hosting, shared-environment, rollback, recovery, and production cost direction; the internal client and technology stack are approved in D-02 and D-03
- Privacy/retention schedule, support/approval thresholds, and recovery objectives

These gates do not permit engineers to invent production policy. Their IDs, owners, blocked stages, and required outputs are maintained in `implementation.md` §3. Provider-neutral interfaces and synthetic test adapters may be built before provider selection.

## Project status

Phases 2–11 are built and covered by the connected database ladder within their approved local synthetic scope; the [phase conformance audit](docs/engineering/phase-conformance-audit.md) has re-verified steps 2.1–6.3 one by one (Phases 3 and 4 exit gates met; 2 open on branch protection; 5 partial on the test-order gate and the CSV scan) and the [repair batches](docs/engineering/repair-batch-10-evidence.md) record what one order walked end to end has found since. The head migration is `0080_vendor_self_delivery`, and `pnpm db:verify` rehearses all 81 migrations forward and back and runs 35 connected verifier modules. The hosted CI gate first passed on a tree containing domain code on 18 September 2026 ([run 35329095886](https://github.com/anirudhbhatia-1/vendor-base/actions/runs/35329095886)); branch protection requiring it on `main` is still to be enabled.

**Local end-to-end (post-sprint):** Admin, vendor, and partner web applications authenticate exclusively through Supabase email/password. Admin provisioning creates the Supabase user and marketplace identity, role, scope, and lifecycle records through idempotent onboarding commands. Customers authenticate through the OTP session flow. Vendors publish priced, stocked products through `POST /vendor/locations/:id/catalogue/products`; customers discover them, complete grouped checkout, and receive persisted order history; the worker creates per-order delivery offers that eligible partners can accept. `POST /auth/password/verify` remains temporarily available only for existing native clients and is [explicitly deprecated](docs/engineering/native-auth-migration-todo.md). Local adapters remain synthetic and production readiness is not claimed until the external launch gates are complete.
