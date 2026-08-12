# PRD — Neighbourhood Store Marketplace

**Document status:** Draft for product inspiration  
**Target market:** India (local launch city / pin-code cluster)  
**Product type:** Mobile-first marketplace with Customer App, Vendor Portal, Delivery Partner App/Portal, and Admin Console

## 1. Product summary

Build a marketplace that helps neighbourhood retailers grow digital sales without losing their identity or their direct relationship with customers. Shoppers can discover nearby stores, choose a specific trusted vendor, browse that vendor's catalogue, and order for pickup or delivery.

The product is intentionally different from a dark-store quick-commerce model. Inventory belongs to the local shop; the vendor sets assortment, prices, availability, service radius, and fulfilment times. The platform supplies discovery, ordering, payments, communication, fulfilment visibility, and operational tools.

Initial store categories:

- Fruits and vegetables
- Kirana / grocery
- Pharmacy / medical shop (regulated workflow)
- Bakery, dairy, meat, and specialty stores (after launch validation)

## 2. Problem and opportunity

Quick-commerce apps optimize for speed and centralized fulfilment. That can reduce visibility and repeat sales for independent shops, even where shoppers prefer a known local vendor for freshness, credit, familiarity, cultural assortment, or trust.

Local retailers often lack a practical way to maintain an accurate digital catalogue, accept online orders, coordinate delivery, and market to nearby customers. Shoppers, meanwhile, lack one reliable place to find and order from *their* preferred neighbourhood stores.

## 3. Vision and goals

### Vision

Make every good neighbourhood shop as easy to choose online as a major delivery app—while keeping the shop at the center of the customer relationship.

### Primary goals

1. Increase participating vendors' digital orders and repeat customers.
2. Let customers explicitly select and favourite a specific shop, not just an anonymous catalogue.
3. Make pickup and vendor-led fulfilment first-class options alongside delivery.
4. Give admins a controlled way to onboard, verify, launch, and support vendors.
5. Deliver a simple workflow that works for vendors with limited time and digital experience.

### Non-goals for MVP

- Operating owned inventory or dark stores.
- Promising 10-minute delivery.
- Multi-vendor baskets or split fulfilment in a single checkout.
- A full POS or accounting replacement.
- Sale of prescription medicines without compliant prescription validation and licensed-pharmacy controls.

## 4. Product principles

- **Vendor first:** Each store has a distinct storefront, branding, policies, and loyal-customer base.
- **Choice over forced substitution:** The customer chooses the seller and receives clear substitution approval controls.
- **Honest availability:** Show vendor-set hours, preparation estimate, delivery fee, and stock confidence.
- **Accessible operations:** Critical vendor actions must work well on a low-end Android phone and via notifications.
- **Trust and compliance:** Verify vendors before publishing them; build special safeguards for pharmacies.

## 5. Users and needs

| User | Need | Primary outcome |
|---|---|---|
| Customer | Buy from a known or nearby trusted shop with minimal friction. | Correct items arrive from the chosen vendor. |
| Vendor owner / staff | Gain online demand and manage orders without disrupting in-store work. | More completed, profitable local sales. |
| Delivery partner | Accept nearby jobs, navigate safely, complete handoff, and see clear earnings. | Reliable delivery and predictable payouts. |
| Admin / operations | Build a trusted supply network and resolve exceptions. | Healthy vendor coverage, reliable orders, controlled risk. |

## 6. Core user journeys

### Customer: order from a preferred vendor

1. Customer grants location or enters address / pin code.
2. They see nearby stores, search by name/category/item, or open **My Stores**.
3. They open a store profile containing hours, ETA, minimum order, delivery/pickup options, ratings, catalogue, and policies.
4. They add items to a **single-store cart**, set substitution preferences, and choose pickup or delivery.
5. They select a time slot (where enabled), pay online or choose an approved pay-on-delivery method.
6. The vendor accepts, prepares, and marks the order ready; customer receives live status updates.
7. Customer confirms delivery/pickup, can rate the vendor, and can reorder quickly.

### Customer: item unavailable / variable-weight item

1. Vendor flags an item as unavailable, proposes a substitute, or enters final weight/price for loose produce.
2. Customer receives an in-app notification and approves, rejects, or selects “contact me for all changes.”
3. The payable amount is adjusted before capture or through a clearly explained partial refund process.
4. The order proceeds only under the customer's selected substitution rule.

### Vendor: fulfil an order

1. New-order alert appears in the Vendor Portal; staff accepts or declines with a reason within the configured response time.
2. Staff picks items, records substitutions or weights, and contacts the customer only through protected in-app chat/call masking where available.
3. Staff marks the order **Ready for pickup** or **Handed to delivery partner**.
4. The vendor sees settlement, sales, repeat-customer, and cancellation insights.

### Delivery partner: complete a delivery

1. Verified delivery partner switches **Online** and receives an offer showing pickup area, drop area, distance, estimated earnings, and pickup deadline—without exposing unnecessary customer details.
2. The partner accepts the assignment, navigates to the vendor, and confirms pickup using an order QR code or OTP.
3. The partner sees the delivery address and customer instructions, can use external maps, and updates status to **Arrived**.
4. Customer provides a delivery OTP (or another approved proof of delivery); the partner marks the order delivered.
5. The partner sees completed-trip earnings, incentives, tips, issues raised, and payout status.

### Admin: onboard and publish a vendor

1. Admin creates a vendor lead or invites a shop.
2. Admin collects business details, address/location, bank/payout information, licences and category-specific documents.
3. Admin reviews documents, configures service area, commission/fees, delivery model, and catalogue import method.
4. Admin completes a test order, approves the vendor, and publishes the storefront.
5. Admin monitors order reliability and may pause, unpublish, or support the vendor with an auditable reason.

## 7. Functional requirements

### 7.1 Customer App / Web

#### Account and location

- Phone-number OTP sign-in; optional email and profile completion.
- Multiple saved addresses, pin-code validation, map pin adjustment, and delivery instructions.
- Location permission is optional; manual address search must work.
- Customer can favourite stores and set one as a preferred store.

#### Discovery and store selection

- Results page shows eligible vendors near the selected address with category, distance, open/closed state, next available slot, delivery fee, minimum order, rating, and estimated fulfilment time.
- Search by shop name, product name, category, and common local-language synonyms.
- Filters: category, delivery/pickup, open now, delivery fee, rating, vegetarian / specialty attributes, and preferred stores.
- Dedicated store pages preserve the vendor's name, images, description, policies, catalogue, offers, and reviews.
- “Request a shop” lets customers nominate a nearby vendor for onboarding.

#### Catalogue and cart

- Category browsing, search, product details, quantity controls, product images, unit/weight, price, offer, and available/not-available state.
- Support packaged items and loose/variable-weight products (e.g., ₹/kg vegetables).
- One store per cart in MVP. If a customer adds from another store, they can save the current cart or replace it after confirmation.
- Per-item and order-level substitution preferences: no substitution; best match; contact me; vendor-selected match within a price limit.
- Persistent cart, reorder from completed order, and shopping list / frequently bought items.

#### Checkout and post-order

- Address, fulfilment method (pickup/delivery), slot selection, fees/taxes, tip (optional), promo code, and order notes.
- Payment methods: UPI, cards, supported wallets, and COD only when vendor/admin enables it.
- Order lifecycle: placed → accepted → picking → awaiting customer decision (if needed) → ready / out for delivery → delivered or picked up → completed; include cancelled and refunded states.
- Push/SMS notifications for material status changes; in-app order history and receipt.
- Help flow for late, missing, damaged, wrong, or quality issues; attach photo where relevant.
- Vendor rating and item/order feedback after completion.

### 7.2 Vendor Portal (mobile web or vendor app)

#### Store setup

- Store profile: business name, logo/banner, description, categories, address/map pin, languages, contact details, GST/other registration details as applicable.
- Operating hours, holiday/temporary-closure controls, pickup instructions, minimum order, service radius or delivery zones, lead time, and delivery fee rules.
- Staff roles: owner, manager, picker; least-privilege access and activity log for sensitive actions.

#### Catalogue and inventory

- Add/edit products individually or import by CSV; fields include name, category, brand, description, image, unit, base price, tax, stock status, and substitution suggestions.
- Bulk availability toggle and time-bound out-of-stock status.
- Variable-weight product configuration with a permitted final-price variance communicated at checkout.
- Low-stock alerts and optional manual inventory count. POS integrations are a later phase.

#### Orders and service

- Prominent real-time new-order alert with accept/decline action and configurable preparation time.
- Pick list; item substitutions / out-of-stock edits; final-weight entry; customer decision workflow.
- Mark packed, ready for pickup, handed to rider, completed, or cancelled—with reason codes.
- Customer messaging with templates (e.g., “Please approve this substitute”); retain a support-visible message log.
- Delivery mode configuration: vendor self-delivery, platform delivery (future), or pickup only.

#### Vendor insights and payouts

- Dashboard: orders, gross sales, net payout estimate, acceptance rate, cancellation rate, average preparation time, ratings, and repeat customers.
- Settlement ledger with commission, payment fees, refunds, adjustments, taxes, and payout status.
- Downloadable order and settlement reports.
- Optional vendor-funded offers and loyalty rewards with clear cost preview.

### 7.3 Admin Console

#### Vendor network management

- Vendor lead pipeline: requested, invited, applied, documents pending, under review, test order, approved, live, paused, rejected.
- Create, edit, import, and invite vendors; assign account owner and onboarding checklist.
- Document collection, verification status, expiry reminders, and immutable reviewer notes.
- Publish, pause, or unpublish storefronts; all changes require reason and audit log.
- Manage delivery zones, store/category eligibility, fees, commissions, payouts, and store-level exceptions.

#### Catalogue, orders, and support

- Review/edit catalogue for quality and prohibited items; bulk category taxonomy management.
- Live order monitor with filters by vendor, state, exception, and time; manual intervention actions are permissioned and logged.
- Issue resolution tools for cancellation, refund, partial refund, credits, and dispute notes.
- Customer and vendor profile lookup, support ticketing, review moderation, fraud flags, and blocklist management.

#### Reporting

- City/zone/vendor/category dashboards for GMV, completed orders, take rate, active vendors, active customers, repeat rate, fulfilment time, cancellations, and refunds.
- Vendor health score based on availability, acceptance, fulfilment, quality feedback, and cancellation rate.
- Exportable operational and finance reports with role-based access.

### 7.4 Delivery Partner App / Portal

#### Onboarding and account

- Phone OTP sign-in and profile setup with name, photo, preferred language, service areas, vehicle type, and emergency contact.
- Upload and track required identity, driving, vehicle, bank/payout, and insurance documents according to the operating model and local law.
- Account states: applied, documents pending, under review, approved, suspended, rejected, and inactive; show actionable reasons for incomplete onboarding.
- In-app training/checklist for pickup etiquette, customer privacy, safety, cash handling (if enabled), and support escalation.

#### Availability and assignments

- Online/offline toggle, active-zone selection, background location consent, and battery/data-use guidance.
- Job offer card shows vendor name/area, drop-off area, approximate distance, pickup-by deadline, expected pay, tip if already known, and item/order handling notes.
- Accept or decline an offer; auto-expire offers after a short configurable time. A delivery partner must not be penalised for declining unsafe or impractical jobs.
- Active job states: assigned → navigating to vendor → arrived at vendor → picked up → navigating to customer → arrived at customer → delivered; include failed pickup, customer unavailable, returned, and cancelled exception states.
- In-app link to preferred navigation app, masked customer contact where required, and one-tap support / emergency assistance.

#### Pickup, delivery, and exceptions

- Confirm pickup with QR code, barcode, or OTP; show item count, package count, special handling (fragile, cold-chain), and vendor handoff notes.
- Confirm delivery with customer OTP as the default proof; allow photo/signature only where privacy policy and customer consent permit.
- Guided flows for vendor delay, missing package, damaged order, customer unreachable, incorrect address, unsafe location, and cancellation. These flows must avoid revealing the customer's full contact details unnecessarily.
- Enable cash collection only after a dedicated reconciliation and risk policy is in place; otherwise support prepaid orders only in MVP.

#### Earnings and performance

- Trip-level earnings breakdown: base pay, distance/time component, incentives, tips, adjustments, cash collected (if enabled), and net payout.
- Daily/weekly earnings, payout history, bank details, tax documents where applicable, and downloadable statements.
- Transparent performance metrics such as completed trips, on-time pickup, customer feedback, and support incidents; surface coaching and dispute paths before any account restriction.

### 7.5 Pharmacy controls (MVP guardrails)

- Only verified, appropriately licensed pharmacies may list regulated products.
- Separate prescription-upload workflow and human/pharmacist review state before the order can be fulfilled.
- Do not permit automated substitution for prescription medicines; the pharmacy must obtain required confirmation.
- Restrict age-gated / controlled products and display mandatory medical disclaimers according to applicable law.
- Retain only the minimum prescription and health information required; apply stricter access controls and retention policy.
- Legal/compliance review is required before launching pharmacy orders in any jurisdiction.

## 8. Business rules

- A customer may shop any eligible vendor, while favourites and preferred-store ranking make loyal shopping faster.
- The vendor owns the assortment and listed price; the platform may display price-history or fee transparency but must not silently alter vendor prices.
- Initial SLA: vendor accepts/declines within 5 minutes; configurable per vendor/category.
- If the vendor does not respond, auto-cancel and release the payment authorization; notify the customer and record the event in vendor health.
- Substitutions, variable-weight adjustments, cancellation, refund, and delivery fees must be visible before final payment capture or handled through an explicit, traceable adjustment.
- Pickup requires a customer order ID/OTP confirmation. Delivery requires delivery confirmation (OTP/photo/signature policy to be decided).
- Delivery partners can view only the data necessary for the current assignment. They must not see prescription details, customer order history, or vendor settlement data.
- Delivery assignment offers use configured zone, capacity, vehicle suitability, partner availability, and safety constraints; the exact dispatch algorithm is out of scope for MVP.
- Admin overrides must record actor, timestamp, original value, new value, and reason.

## 9. Data model (high-level)

| Entity | Key fields |
|---|---|
| Customer | profile, phones, addresses, favourites, consent, order history |
| Vendor | legal/business profile, store locations, licences, status, fees, zones, payout account |
| Product | vendor, SKU, title, category, unit, price, tax, stock, image, restricted flag |
| Cart / Order | customer, one vendor, line items, substitutions, slot, fees, payment, status, timestamps |
| Fulfilment | pickup/delivery method, staff/rider, ETA, proof of handoff, status events |
| Delivery partner | profile, eligibility, vehicle, documents, live availability, active jobs, earnings, payout account |
| Payment / Settlement | authorization, capture/refund, commission, charges, vendor payout, reconciliation status |
| Support case | issue type, evidence, messages, resolution, refund/credit, owner |

## 10. Non-functional requirements

- **Security:** encrypt sensitive data in transit and at rest; role-based access; OTP rate limits; audit logs for admin/vendor actions.
- **Privacy:** collect only necessary personal data; consent for communications; customer address and phone details exposed only as needed for fulfilment.
- **Partner safety:** minimise data exposure before assignment acceptance; provide emergency/support escalation; document retention and location tracking follow an explicit consent policy.
- **Reliability:** idempotent payment and order APIs; retry-safe notifications; clear recovery for payment/order mismatch.
- **Performance:** location/store results under 3 seconds on standard mobile networks; core checkout actions under 2 seconds excluding payment provider response.
- **Accessibility/localization:** readable typography, keyboard support on web, English plus launch-region languages, INR formatting.
- **Observability:** monitor order-state failures, payment failures, vendor-response SLA, and notification delivery.

## 11. MVP scope and phased rollout

### MVP — one city / 2–3 pin-code clusters

- Customer web app or Android-first app: address, store discovery, preferred vendors, single-store ordering, pickup/delivery, UPI/cards, order tracking, support.
- Vendor portal: onboarding, store hours, catalogue CRUD/import, order accept/pick/substitute/ready workflow, basic sales and settlement view.
- Delivery partner app/portal: onboarding and document review, availability toggle, assignment offers, pickup/delivery status, OTP proof of delivery, exception flows, and basic earnings/payout history. Launch only if platform delivery is selected; otherwise keep the data model ready for Phase 2.
- Admin console: vendor creation/review/publish, catalogue checks, order monitoring, refund tools, basic analytics and audit logs.
- Categories: vegetables and kirana first. Pharmacy only after compliance sign-off and specific workflow testing.
- Delivery: choose either vendor self-delivery + pickup, or a small platform-managed delivery-partner pilot in the launch clusters.

### Phase 2

- Expand platform delivery partners, live tracking, batch assignment, and route optimisation after validating unit economics and safety workflows.
- Vendor loyalty programmes, scheduled recurring baskets, shared family lists, and personalised discovery.
- POS/inventory integrations, barcode scanning, bulk catalogue enrichment, and advanced vendor marketing.
- Customer chat/call masking, referral programme, and richer support automation.

### Phase 3

- Multi-vendor checkout with separate fulfilment promises and clear fees.
- B2B ordering for local restaurants/hostels, warehouse-assisted inventory services only if aligned with vendor-first model.
- Sophisticated demand insights and vendor-managed advertising, subject to transparent controls.

## 12. Success metrics

| Objective | KPI | Initial target / measurement |
|---|---|---|
| Vendor growth | Monthly vendor GMV growth; active vendors | Track by cohort; validate positive growth after 90 days |
| Vendor retention | 90-day vendor retention | Measure from first completed order |
| Loyal shopping | Orders from a favourite/preferred store; 30-day customer repeat rate | Baseline in launch cohort, improve monthly |
| Fulfilment quality | Vendor acceptance rate; on-time ready/delivery rate | ≥90% acceptance; target defined after pilot baseline |
| Partner reliability | Delivery-partner acceptance, completed-trip, and proof-of-delivery rates | Measure by zone and partner cohort from pilot launch |
| Customer trust | Issue/refund rate; post-order rating | Monitor by vendor/category and resolve root causes |
| Operations | Median vendor onboarding time; time to first order | Reduce weekly during pilot |

## 13. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Inaccurate inventory causes cancellations | Start with small, well-maintained catalogues; fast stock toggles; measure availability and coach vendors. |
| Vendors cannot respond quickly during peak store hours | Simple one-tap order actions, notification escalation, staff accounts, conservative SLAs. |
| Delivery economics are weak | Make pickup prominent; begin with vendor self-delivery; set transparent zone/minimum-order rules. |
| Delivery partner supply, safety, or payout disputes | Pilot in small zones; show earnings before acceptance; use OTP handoffs, rapid support, and auditable trip/payout records. |
| Customers expect quick-commerce speed | Position around *your trusted local shop*, better choice and quality, with clear ETAs rather than unrealistic promises. |
| Pharmacy regulatory exposure | Defer prescription ordering until jurisdiction-specific legal, pharmacy, and data-protection review is complete. |
| Platform captures the customer relationship | Give stores named storefronts, favourites, repeat ordering, vendor analytics, and controlled promotional tools. |

## 14. Decisions required before design/build

1. Launch geography, target customer segment, and first 20–50 vendor cohort.
2. Revenue model: vendor commission, customer delivery/service fee, subscription, or a combination.
3. Delivery ownership at launch: pickup-only, vendor self-delivery, or contracted fleet.
4. Delivery-partner engagement model: employees, third-party fleet, or independent partners; define insurance, safety, and payout responsibilities.
5. Primary client: Android app, responsive web, or both.
6. Payments and payout provider; COD eligibility and reconciliation workflow.
7. Minimum vendor-verification requirements and the legal/compliance owner for pharmacy operations.
8. Whether customer contact data can be used by vendors for marketing, subject to explicit consent and applicable law.

## 15. Mercato-inspired learnings (not a specification to copy)

The inspiration supports the core premise: it begins with location/zip-code discovery, lets a shopper choose a local merchant, supports delivery or pickup, and emphasizes store-packed local orders. Mercato also presents merchant ecommerce, marketplace exposure, order controls, support, and performance reporting. This PRD adds an explicit **preferred-vendor** model, India-oriented payment/localisation assumptions, and a separate customer/vendor/admin operating model.

Sources reviewed: [Mercato overview](https://help.mercato.com/hc/en-us/articles/360048877092-What-is-Mercato), [Mercato order flow and store filters](https://help.mercato.com/hc/en-us/articles/360049356471-How-to-place-an-order), and [Mercato merchant offering](https://www.mercato.com/merchant).
