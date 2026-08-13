# PRD — Neighbourhood Store Marketplace

**Document status:** MVP product contract v0.2
**Synchronized:** 13 August 2026
**Target market:** India (local launch city / pin-code cluster)  
**Product type:** Mobile-first marketplace with Customer App, Vendor Portal, Delivery Partner App/Portal, and Admin Console
**Related documents:** [README](README.md) · [Design](design.md) · [Architecture](architecture.md) · [Workflow](workflow.md) · [Implementation](implementation.md) · [AI Rules](rules.md)

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
- Automatic consolidation of several vendor pickups into one promised delivery before dispatch and fee-allocation reliability are proven.
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

### Customer: order from one or more preferred vendors

1. Customer grants location or enters address / pin code.
2. They see nearby stores, search by name/category/item, or open **My Stores**.
3. They open a store profile containing hours, ETA, minimum order, delivery/pickup options, ratings, catalogue, and policies.
4. They add items from one or more named stores. The cart creates a separate store group with its own subtotal, minimum, substitutions, fulfilment method, fee, and timing.
5. They review every store group and the combined total, then complete one checkout. The platform creates one independent order per vendor location.
6. Each vendor accepts, prepares, and marks only its own order ready; the customer receives an overall checkout summary plus vendor-order status updates.
7. The customer confirms each delivery or pickup, can rate each vendor separately, and can reorder quickly.

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
- Up to four saved addresses in the MVP, with pin-code validation, manual address search, map pin adjustment, landmark, and delivery instructions. Keep the limit configurable rather than a permanent schema constraint.
- Location permission is optional; manual address search must work.
- Customer can favourite stores and set one as a preferred store.

#### Discovery and store selection

- Results page shows eligible vendors near the selected address with category, distance, open/closed state, next available slot, delivery fee, minimum order, rating, and estimated fulfilment time.
- Search by shop name, product name, brand, category, common misspellings, and local-language synonyms/transliteration. Preserve recent searches and rank eligible available results ahead of unavailable results.
- Filters: category, delivery/pickup, open now, delivery fee, rating, vegetarian / specialty attributes, and preferred stores.
- Dedicated store pages preserve the vendor's name, images, description, policies, catalogue, offers, and reviews.
- “Request a shop” lets customers nominate a nearby vendor for onboarding.

#### Catalogue and cart

- Category browsing, search, product details, quantity controls, product images, unit/weight, price, offer, and available/not-available state.
- Support packaged items and loose/variable-weight products (e.g., ₹/kg vegetables).
- A cart may contain multiple vendor-location groups. Adding from a new vendor creates a new group without clearing existing groups; each group remains visibly named and independently editable.
- Each vendor group enforces its own minimum order, stock validation, substitutions, fulfilment method, slot, delivery fee, notes, promotions, and serviceability. A configurable launch safety limit may cap the number of vendor groups; the initial validation default is three stores, not a permanent business rule.
- Availability states are `available`, `low stock`, `vendor confirms`, and `out of stock`. Support maximum quantities, alternative pack sizes, time-bound out-of-stock state, and an internal last-confirmed timestamp.
- Per-item and order-level substitution preferences: no substitution; best match; contact me; vendor-selected match within a price limit.
- Persistent cart, reorder from completed order, and shopping list / frequently bought items.

#### Checkout and post-order

- One grouped checkout containing a separate review section for every vendor: address or pickup point, fulfilment method, slot, minimum, fees/taxes, tip allocation (if enabled), promo allocation, substitution summary, and order notes.
- Before payment, show the combined total and each vendor's item subtotal, delivery/pickup fee, fulfilment window, and independent-acceptance notice. Separate deliveries remain the default unless a combined route is explicitly confirmed.
- MVP payment methods: prepaid UPI, cards, and supported wallets. COD remains hidden until a separately approved cash-handling, safety, reconciliation, and dispute policy exists.
- Checkout-group lifecycle summarizes child orders as processing, partially accepted, active, partially completed, completed, partially cancelled, or cancelled. Each vendor order independently follows placed → accepted → picking → awaiting customer decision (if needed) → ready / out for delivery → delivered or picked up → completed, including cancelled and refunded states.
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
- Show stock-confirmation age and a reconfirmation queue. Products without dependable counts use `vendor confirms`; the platform must not represent them as reserved exact stock.
- Reservation lifecycle: cart creates no hard reservation; checkout may create a short, expiring soft hold where the vendor's inventory model supports it; placed creates a provisional reservation; vendor acceptance commits it; decline, timeout, cancellation, or hold expiry releases it. Concurrent reservation attempts use atomic quantity checks and return an actionable unavailable/quantity-reduced result.

#### Orders and service

- Prominent real-time new-order alert with accept/decline action and configurable preparation time.
- Pick list; item substitutions / out-of-stock edits; final-weight entry; customer decision workflow.
- Mark packed, ready for pickup, handed to rider, completed, or cancelled—with reason codes.
- Before decline or vendor cancellation, show customer/payment/metric impact and require one of: item availability too low, store too busy, closing soon, cannot meet slot, delivery unavailable, catalogue/price error, customer request cannot be fulfilled, safety/compliance problem, or other with explanation.
- A vendor sees only its own child order in a grouped checkout and cannot view sibling vendors, lines, decisions, fees, or settlements.
- Structured escalation reasons: customer not responding, payment adjustment blocked, rider not assigned/late, package-count dispute, customer arrived early, customer refuses pickup, technical problem, unsafe/abusive interaction, or admin intervention. Every escalation returns a case reference, responsible queue, response target, current instruction, and resulting order state.
- New-order notification escalation: immediate push and audible alert → reminder push after configured non-acknowledgement → SMS/provider fallback → auto-cancel at the server deadline. Vendors can test alerts, manage permitted devices, inspect failed delivery attempts, and configure staff escalation order.
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
- Track document expiry, reminders, grace period, replacement upload, review status, restricted capabilities, time-limited manual exceptions, and immutable re-verification history for identity, business/category licences, food licences, payout/bank verification, and other required documents.

#### Catalogue, orders, and support

- Review/edit catalogue for quality and prohibited items; bulk category taxonomy management.
- Live order monitor with filters by vendor, state, exception, and time; manual intervention actions are permissioned and logged.
- Issue resolution tools for cancellation, refund, partial refund, credits, and dispute notes.
- Customer and vendor profile lookup, support ticketing, review moderation, fraud flags, and blocklist management.
- Checkout-group view with all child orders and allocations; actions are child-order scoped by default and must not mutate siblings.
- Risk review queues cover OTP/payment/promotion/refund abuse, vendor stock manipulation, fake fulfilment, partner location/proof anomalies, account sharing, repeated unreachable-customer claims, and suspicious admin activity. A signal creates a review case; restriction requires evidence, reason, duration, actor, review date, and appeal path.
- Structured support desk supports automatic case creation, assignment, priority/SLA, internal and participant-visible messages, evidence permissions, response requests, resolution templates, child-order linkage, duplicate-case merge, reopen/escalate, and quality review.

#### Admin roles, approvals, configuration, and incidents

- Separate roles for vendor onboarding, partner onboarding, catalogue moderation, live operations, customer support, finance, trust and safety, compliance, reporting, and exceptional super-admin access.
- Support may propose but not solely approve high-value refunds; onboarding cannot alter payouts; catalogue moderation cannot view bank details; reporting uses masked data; super-admin actions are exceptional and specially audited.
- Maker-checker approval (one actor proposes, another approves) applies above configured risk/value thresholds to refunds, payout adjustments, bank-detail changes, vendor/partner suspension, fee or service-zone changes, high-risk document approval, and manual payment reconciliation.
- Versioned configuration lifecycle: draft → review → scheduled → active → superseded, with controlled rollback. Version delivery fees, service zones, vendor fees, partner earnings, cancellation/refund rules, timeouts, maximum stores per cart, capacity rules, and approval thresholds. Historical orders retain referenced versions.
- Reversible kill switches may pause a vendor, category, zone, platform delivery, payment method, promotion, grouped checkout creation, substitutions, or provider integration, and may reduce the store-per-cart limit. Every activation requires impact preview, reason, actor, time, expiry/manual-resume rule, and audit event.

#### Finance and operations workspaces

- Finance queues: authorized payment without checkout group, checkout group with unknown payment, capture failure, capture/allocation mismatch, duplicate webhook, refund failure, vendor settlement mismatch, partner earning mismatch, payout failure, and unmatched provider statement.
- Every exception shows severity, amount at risk, age, owner, last retry, next action, safe automated retry, manual-review route, and complete audit history.
- The default operations queue ranks safety incidents, payment/ledger mismatches, stuck customer decisions, expiring vendor acceptance, excessive rider wait, delivery failure, return required, overdue refund, payout failure, then routine onboarding/moderation. Each work item has an owner and SLA.

#### Reporting

- City/zone/vendor/category dashboards for GMV, completed orders, take rate, active vendors, active customers, repeat rate, fulfilment time, cancellations, and refunds.
- Search funnel reporting for query volume, zero-result queries, spelling/local-language misses, result-to-product clicks, search-to-cart conversion, and requested products vendors do not currently list.
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
- One assignment maps to one vendor order by default. Reassignment for expiry, partner inability, vehicle problem, vendor delay, connectivity loss, no movement, admin action, or cancellation preserves every assignment attempt, wait/return compensation, package custody, customer ETA changes, reason/actor, and earnings impact.

#### Pickup, delivery, and exceptions

- Confirm pickup with QR code, barcode, or OTP; show item count, package count, special handling (fragile, cold-chain), and vendor handoff notes.
- Confirm delivery with customer OTP as the default proof; allow photo/signature only where privacy policy and customer consent permit.
- Guided flows for vendor delay, missing package, damaged order, customer unreachable, incorrect address, unsafe location, and cancellation. These flows must avoid revealing the customer's full contact details unnecessarily.
- At vendor arrival, record trusted geofence and/or vendor confirmation, start a server timer, show delay reason and revised pickup estimate, and provide threshold-based wait, leave/reassign, compensation, and support actions. Expected waiting-pay policy is visible before offer acceptance.
- Pickup creates custody only after correct vendor/order, package count and condition, handling flags, OTP/QR, and vendor confirmation are verified. After pickup, vendors cannot silently modify the order; package-count changes require an exception; cancellation becomes a controlled return.
- Return-to-origin lifecycle: support authorizes return → destination/instructions issued → vendor notified → partner returns packages → vendor confirms count/condition → return earning posted. Handle closed/refusing vendor, perishables, damage, customer change-of-mind, incorrect/unsafe address, unreachable customer, alternate return location, and compensation.
- Persistent safety flow covers unsafe pickup/drop, harassment/threat, accident, medical emergency, vehicle breakdown, and suspected prohibited goods, routing to emergency or specialist support rather than generic chat.
- Navigation always includes preferred maps handoff plus text address, landmark, instructions, retry, incorrect-pin reporting, and an operational fallback when background location is unavailable.
- Enable cash collection only after a dedicated reconciliation and risk policy is in place; otherwise support prepaid orders only in MVP.

#### Earnings and performance

- Trip-level earnings breakdown: base pay, distance/time component, incentives, tips, adjustments, cash collected (if enabled), and net payout.
- Daily/weekly earnings, payout history, bank details, tax documents where applicable, and downloadable statements.
- Transparent performance metrics such as completed trips, on-time pickup, customer feedback, and support incidents; surface coaching and dispute paths before any account restriction.
- Earnings disputes cover missing trip, incorrect distance, waiting/return pay, tip, incentive eligibility, payout failure, and unauthorized adjustment. Show original/new amount, reason, actor, dispute deadline, case status, and immutable resolution.

#### Location, device integrity, and privacy

- Define location collection by assignment stage: start only after explicit consent and operational need, vary frequency by offer/assigned/navigation/waiting/handoff state, cap encrypted offline buffering, stop active sharing when the assignment/return ends, and delete or aggregate under an approved retention schedule.
- Only assigned operations/support roles may view live location. Denied or withdrawn permission produces an explicit capability-limited flow; battery/data expectations are visible.
- Detect mock GPS, reused OTP/proof, implausible speed/location, wrong-location completion, repeated unreachable claims, multi-device/account sharing, compromised-device signals, excessive proof failures, and collusion indicators. Signals open a review; they do not alone trigger irreversible punishment.

### 7.5 Pharmacy controls (MVP guardrails)

- Only verified, appropriately licensed pharmacies may list regulated products.
- Separate prescription-upload workflow and human/pharmacist review state before the order can be fulfilled.
- Do not permit automated substitution for prescription medicines; the pharmacy must obtain required confirmation.
- Restrict age-gated / controlled products and display mandatory medical disclaimers according to applicable law.
- Retain only the minimum prescription and health information required; apply stricter access controls and retention policy.
- Legal/compliance review is required before launching pharmacy orders in any jurisdiction.

## 8. Business rules

- A customer may shop any eligible vendor, while favourites and preferred-store ranking make loyal shopping faster.
- One checkout may contain several vendor-scoped orders, but no individual order contains more than one vendor location. Vendor staff never see another vendor's lines, customer decisions, or financial allocation.
- Vendor orders accept, fulfil, cancel, refund, and settle independently. If one vendor declines or times out, accepted vendor orders continue; the failed vendor allocation is voided or refunded and the customer sees the partial outcome. The platform never silently substitutes another vendor.
- Delivery/pickup eligibility, minimum order, slot, distance fee, and fulfilment promise are calculated per vendor group. The customer sees separate fees and expected handoffs before placing the grouped checkout.
- The vendor owns the assortment and listed price; the platform may display price-history or fee transparency but must not silently alter vendor prices.
- Initial SLA: vendor accepts/declines within 5 minutes; configurable per vendor/category.
- If the vendor does not respond, auto-cancel and release the payment authorization; notify the customer and record the event in vendor health.
- Substitutions, variable-weight adjustments, cancellation, refund, and delivery fees must be visible before final payment capture or handled through an explicit, traceable adjustment.
- Pickup and delivery use a server-validated OTP by default. Vendor-to-partner pickup may use QR. Photo/signature is available only through an approved alternative-proof policy and support path.
- Delivery partners can view only the data necessary for the current assignment. They must not see prescription details, customer order history, or vendor settlement data.
- Delivery assignment offers use configured zone, capacity, vehicle suitability, partner availability, and safety constraints; the exact dispatch algorithm is out of scope for MVP.
- Admin overrides must record actor, timestamp, original value, new value, and reason.
- Once custody is confirmed, only the assigned partner or authorized support flow may advance or resolve that assignment. Reassignment after custody requires an explicit custody-transfer or return event.

## 9. Data model (high-level)

| Entity | Key fields |
|---|---|
| Customer | profile, phones, addresses, favourites, consent, order history |
| Vendor | legal/business profile, store locations, licences, status, fees, zones, payout account |
| Product | vendor, SKU, title, category, unit, price, tax, stock, image, restricted flag |
| Inventory reservation | product/vendor location, quantity basis, soft/provisional/committed state, source/confidence, expiry, order/quote reference |
| Cart / Cart vendor group | customer, vendor location, grouped line items, substitutions, fulfilment choice, slot, fee estimate, status, timestamps |
| Checkout group / Order | customer checkout, combined quote/payment reference, one child order per vendor, immutable line/fee allocations, independent status and timestamps |
| Fulfilment / assignment attempt | vendor order, pickup/delivery method, staff/rider, offer/assignment history, wait timer, custody/return state, ETA, proof of handoff, status events |
| Delivery partner | profile, eligibility, vehicle, documents, live availability, active jobs, earnings, payout account |
| Payment / Allocation / Settlement | checkout-group authorization/capture, immutable vendor-order allocations, void/refund, commission, charges, vendor payout, reconciliation status |
| Support case | issue type, evidence, messages, resolution, refund/credit, owner |
| Policy and operations | role/capability, approval request, configuration version, incident control, document review, risk/trust review, finance exception, owner/SLA/audit references |

## 10. Non-functional requirements

- **Security:** encrypt sensitive data in transit and at rest; role-based access; OTP rate limits; audit logs for admin/vendor actions.
- **Privacy:** collect only necessary personal data; consent for communications; customer address and phone details exposed only as needed for fulfilment.
- **Partner safety:** minimise data exposure before assignment acceptance; provide emergency/support escalation; document retention and location tracking follow an explicit consent policy.
- **Reliability:** idempotent grouped-checkout, vendor-order, payment, and refund APIs; retry-safe notifications; clear recovery for partial vendor failure and payment/allocation mismatch.
- **Performance:** location/store results under 3 seconds on standard mobile networks; core checkout actions under 2 seconds excluding payment provider response.
- **Accessibility/localization:** readable typography, keyboard support on web, English and Hindi for every core workflow, INR formatting.
- **Observability:** monitor order-state failures, payment failures, vendor-response SLA, and notification delivery.

## 11. MVP scope and phased rollout

### MVP — one city / 2–3 pin-code clusters

- Customer web app or Android-first app: address, store discovery, preferred vendors, multi-store cart, grouped checkout, vendor-scoped pickup/delivery orders, UPI/cards, order tracking, support.
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

- Cross-store pickup consolidation and optimized combined delivery only after separate fulfilment promises, fee allocation, and partial-failure operations are reliable.
- B2B ordering for local restaurants/hostels, warehouse-assisted inventory services only if aligned with vendor-first model.
- Sophisticated demand insights and vendor-managed advertising, subject to transparent controls.

## 12. Success metrics

| Objective | KPI | Initial target / measurement |
|---|---|---|
| Vendor growth | Monthly vendor GMV growth; active vendors | Track by cohort; validate positive growth after 90 days |
| Vendor retention | 90-day vendor retention | Measure from first completed order |
| Loyal shopping | Orders from a favourite/preferred store; 30-day customer repeat rate | Baseline in launch cohort, improve monthly |
| Multi-store convenience | Multi-store cart use; grouped-checkout conversion; partial acceptance/cancellation rate | Establish pilot baseline and reduce avoidable blocked-group abandonment |
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

## 14. Decision status before implementation

Product behavior already resolved for the MVP is listed in `implementation.md` §2 and must not be reopened during routine implementation. This includes multi-store checkout with vendor-scoped orders, prepaid-only payment, per-completed-order vendor charging, separate fulfilments, default no-substitution, OTP proof, English/Hindi, and disabled pharmacy/COD/consolidation.

Production gates still requiring named owners or evidence are tracked only in `implementation.md` §3. They cover launch geography/cohort, client sequence, backend/hosting, providers, final fee and earning versions, delivery operating model, verification documents, privacy/retention, support/approval thresholds, and recovery objectives.

An unresolved production gate does not authorize a hidden default. Build provider-neutral boundaries where allowed, use synthetic fixtures, and block production activation at the documented gate.

## 15. Mercato-inspired learnings (not a specification to copy)

The inspiration supports the core premise: it begins with location/zip-code discovery, lets a shopper choose a local merchant, supports delivery or pickup, and emphasizes store-packed local orders. Mercato also presents merchant ecommerce, marketplace exposure, order controls, support, and performance reporting. This PRD adds an explicit **preferred-vendor** model, India-oriented payment/localisation assumptions, and a separate customer/vendor/admin operating model.

Sources reviewed: [Mercato overview](https://help.mercato.com/hc/en-us/articles/360048877092-What-is-Mercato), [Mercato order flow and store filters](https://help.mercato.com/hc/en-us/articles/360049356471-How-to-place-an-order), and [Mercato merchant offering](https://www.mercato.com/merchant).

## 16. MVP requirement traceability

| Requirement family | Product requirements | Architecture contract | Screen/interaction contract | Cross-role workflow | Build and verification contract |
|---|---|---|---|---|---|
| Identity, language, consent | §§6–7, 10 | §§6, 16–17 | §§6–7, 13 | §4 | §§7, 10, 12–13 |
| Vendor/location/catalogue/inventory | §§6–8 | §§7–8, 11 | §§7–8, 12 | §§5–7 | §§4–6, 8, 12–13 |
| Multi-store cart and checkout | §§6–8 | §§8–9, 11–12 | §§7.8–7.10 | §§6, 10 | §§5–8, 12–13 |
| Vendor fulfilment and decisions | §§6–8 | §§9, 11, 13 | §8 | §§6–7, 11 | §§5–7, 9, 12–13 |
| Partner assignment, custody, return | §7.4, §8 | §§10–13, 17 | §9 | §§8, 10–11 | §§5–10, 12–13 |
| Payments, ledger, settlement, payout | §§7–10 | §§11–13, 19 | §§7.9, 8.12, 9.9, 10.9 | §§10–12, 16 | §§4–9, 12–14 |
| Support, trust, approvals, controls | §§7.2–7.4, §8 | §§7–8, 16–19 | §§8.14, 9.8, 10 | §§11–12 | §§5, 7–14 |
| Security, privacy, reliability | §10 | §§16–23 | §§12–16 | §§4, 13–16 | §§7–16 |

### 16.1 Product acceptance gate

The MVP is product-complete only when all 15 required end-to-end scenarios in `implementation.md` §13.2 pass and the production gates required by the selected launch model are signed. A successful happy-path demo alone is not acceptance.
