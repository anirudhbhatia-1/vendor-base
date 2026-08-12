# Neighbourhood Store Marketplace

A vendor-first local commerce platform for India. Customers order from the exact neighbourhood shop they trust, while independent vendors keep their identity, prices, inventory, and customer relationships.

Unlike dark-store quick-commerce platforms, this product does not own inventory or hide the seller behind a generic catalogue. It connects customers, local shops, and shared delivery partners through four product surfaces:

- Customer App / Web
- Vendor Portal
- Delivery Partner App / Portal
- Admin Console

> **Status:** Product definition and validation stage. This repository currently contains planning documentation, not application code.

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
3. The customer selects one store and adds products to a single-store cart.
4. The platform shows item prices, delivery or pickup options, delivery fees, and the expected fulfilment time.
5. The vendor accepts the order, picks the items, and requests approval for substitutions or variable-weight adjustments.
6. For delivery, an eligible delivery partner accepts the job and confirms pickup using an OTP or QR code.
7. The customer tracks the order and confirms delivery using an OTP.
8. The platform settles the order and records vendor earnings, partner earnings, platform fees, refunds, and adjustments.

## Product experiences

### Customer App / Web

- Location and address management
- Search by shop, product, and category
- Favourite and preferred stores
- Dedicated vendor storefronts
- Packaged and variable-weight products
- Substitution preferences and approval
- Single-store cart and checkout
- UPI, cards, supported wallets, and controlled COD support
- Pickup, scheduled delivery, order status, receipts, support, and reordering

### Vendor Portal

- Vendor onboarding and store profile
- Hours, service zones, minimum order, and preparation time
- Catalogue creation and CSV import
- Product pricing, stock status, and variable-weight configuration
- Real-time order acceptance and picking workflow
- Substitution and customer-decision requests
- Handoff to pickup or delivery partner
- Sales, settlements, ratings, fulfilment, and repeat-customer insights

### Delivery Partner App / Portal

- Identity, vehicle, bank, insurance, and eligibility onboarding
- Online/offline availability and service-zone selection
- Job offers with pickup area, drop area, distance, deadline, and expected pay
- Navigation to vendor and customer
- OTP/QR pickup confirmation and OTP proof of delivery
- Exception flows for vendor delays, missing packages, unsafe locations, wrong addresses, and unreachable customers
- Trip-level earnings, incentives, tips, adjustments, and payout history
- Masked customer communication and support escalation

### Admin Console

- Vendor and delivery-partner verification
- Store approval, publishing, pausing, and audit history
- Catalogue and restricted-item moderation
- Service-zone, fee, commission, and payout configuration
- Live order and fulfilment monitoring
- Cancellation, refund, dispute, and support tools
- Fraud and quality controls
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
- Customer store discovery, preferred vendors, single-store ordering, checkout, and tracking
- Vendor onboarding, catalogue management, order acceptance, picking, substitutions, and settlement visibility
- Delivery-partner onboarding, assignment, navigation, verified handoff, exceptions, earnings, and payouts
- Admin onboarding, moderation, order monitoring, refunds, audit logs, and basic analytics
- Pickup, vendor self-delivery, or a small platform-managed delivery-partner pilot

## Deliberate non-goals for the MVP

- Owned inventory or dark stores
- A 10-minute delivery promise
- Multi-vendor checkout
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
| Customer demand | Paid conversion after fee disclosure, repeat-order rate, preferred-store orders, average basket value |
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

Consider multi-vendor checkout, B2B ordering, more store categories, and vendor-managed advertising only after the single-store model is reliable.

## Documentation

- [Product Requirements Document](prd.md) contains the complete product requirements, workflows, business rules, data model, risks, and phased scope.
- [Product Design](design.md) translates the requirements into navigation, screens, interaction states, shared components, accessibility rules, and the white/light visual direction.
- [Architecture](architecture.md) defines the proposed system boundaries, domain modules, data model, state machines, integrations, security, deployment, and scaling path.
- [AI Rules and Boundaries](rules.md) defines what AI contributors may do, must verify, must not do, and when they must stop for approval.
- Mercato was reviewed as product inspiration for local-store discovery, named merchant selection, pickup/delivery, and merchant ecommerce tooling. It is not a specification to copy.

## Current decisions still needed

- Launch neighbourhood and first vendor category
- Initial vendor fee per completed order
- Final customer delivery-fee formula and maximum service radius
- Delivery-partner employment or contracting model
- Payment, payout, and COD policy
- Vendor and partner verification requirements
- Primary launch client: responsive web, Android app, or both
- Pharmacy compliance owner and launch criteria

## Project status

The next product milestone is a concierge-style pilot, followed by a decision on whether the evidence supports building the web MVP. No production architecture or technology stack has been selected yet.
