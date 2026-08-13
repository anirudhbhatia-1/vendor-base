# Finished Product Feature Catalogue — Neighbourhood Store Marketplace

**Status:** Canonical product-capability catalogue
**Version:** v1.0 · 13 August 2026
**Applies to:** Customer App/Web, Vendor Portal, Delivery Partner App/Portal, Admin Console, backend services, workers, integrations, data, finance, support, security, and operations

## 1. Purpose

This file lists the capabilities the product is expected to contain when the applicable release phase is complete. It is a feature inventory, not an implementation sequence or permission to invent unresolved business policy.

Detailed behaviour remains governed by:

| Question | Authoritative document |
|---|---|
| Product outcomes and scope | `prd.md` |
| Domain boundaries, state, security, and reliability | `architecture.md` |
| Screens, interactions, accessibility, and responsive behaviour | `design.md` |
| Cross-role chronology and operational handoffs | `workflow.md` |
| APIs, data, events, timers, build slices, and tests | `implementation.md` |
| Contributor authority and prohibited actions | `rules.md` |

If this catalogue conflicts with those documents, implementation stops until the conflict is resolved. This file must then be synchronized with the approved decision.

## 2. Feature status legend

| Status | Meaning |
|---|---|
| **Launch** | Required for the production MVP after the validation pilot and applicable production gates pass. |
| **Later** | Planned product capability after the launch foundation is reliable; not required to declare the initial MVP ready. |
| **Gated** | May exist only after named legal, operational, privacy, safety, or financial approval. |
| **Excluded** | Deliberately not part of the defined product unless the product strategy is formally changed. |

## 3. Product-wide marketplace capabilities

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| MKT-01 | Named local-store marketplace | Launch | Customers always know which vendor location supplies each item. The platform does not hide sellers behind a shared anonymous catalogue. |
| MKT-02 | Vendor-owned storefront identity | Launch | Each vendor controls its profile, catalogue, prices, availability, hours, preparation time, service area, and approved fulfilment modes. |
| MKT-03 | Address-based eligibility | Launch | Store discovery, products, promises, fees, and fulfilment choices are calculated for the customer's selected address and active service zone. |
| MKT-04 | Multi-store shopping | Launch | One cart may contain separate groups from multiple vendor locations, subject to the configured group limit. |
| MKT-05 | Grouped checkout | Launch | One customer checkout creates a checkout group containing exactly one independent child order per vendor location. |
| MKT-06 | Vendor-order isolation | Launch | Acceptance, cancellation, fulfilment, support, refund, and settlement decisions affect only the selected child order unless a separately confirmed group action is valid. |
| MKT-07 | Independent fulfilment promises | Launch | Every vendor order has its own preparation estimate, method, fee, delivery or pickup window, assignment, proof, and outcome. |
| MKT-08 | Transparent pricing | Launch | Customers see store-level item totals, fees, discounts, adjustments, authorization buffers, and the combined amount before payment. |
| MKT-09 | Honest availability | Launch | Availability freshness, store hours, preparation estimates, delivery windows, and exceptions are shown without an unsupported instant-delivery promise. |
| MKT-10 | Versioned operating policies | Launch | Fees, commissions, deadlines, limits, service rules, and incident controls retain the exact policy version used for each order. |
| MKT-11 | English and Hindi | Launch | Critical journeys and operational content work in both languages, including validation, errors, time limits, support, and proof flows. |
| MKT-12 | Light visual theme | Launch | All four product surfaces use the approved white/light visual system; dark mode is not part of the launch contract. |

## 4. Customer App / Web

### 4.1 Account, identity, and preferences

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| CUS-01 | Phone OTP sign-in | Launch | Customers request and verify a time-limited OTP with abuse, attempt, and rate controls. |
| CUS-02 | Secure persistent session | Launch | Sessions rotate safely, expire predictably, and restore the customer's authorized state after reconnect or app resume. |
| CUS-03 | Optional profile completion | Launch | Customers may add their name and optional email without blocking essential shopping. |
| CUS-04 | Language selection | Launch | Customers can choose English or Hindi and keep that preference across sessions. |
| CUS-05 | Notification preferences | Launch | Customers control permitted order, promotion, and support notification channels where policy allows. |
| CUS-06 | Consent and privacy controls | Launch | Required consents are versioned; optional permissions can be refused without hiding reasonable alternatives. |
| CUS-07 | Account help and recovery | Launch | Customers can recover access and reach support without exposing sensitive identity details. |

### 4.2 Location and addresses

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| CUS-08 | Optional device location | Launch | Customers may grant location permission for faster discovery, but permission is never mandatory. |
| CUS-09 | Manual address search | Launch | Customers can find or enter an address when location permission is denied or inaccurate. |
| CUS-10 | Saved addresses | Launch | Customers can create, edit, select, and remove saved addresses; the MVP default limit is four and remains configurable. |
| CUS-11 | Map-pin adjustment | Launch | Customers can correct the delivery point while still providing a textual address and landmark. |
| CUS-12 | Landmark and instructions | Launch | Addresses may include safe delivery instructions and landmarks visible only to authorized actors at the correct fulfilment stage. |
| CUS-13 | Serviceability validation | Launch | The product explains whether the address is served and which stores and fulfilment methods remain eligible. |

### 4.3 Discovery and search

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| CUS-14 | Nearby eligible-store feed | Launch | Customers see eligible stores with name, category, distance, hours, rating, minimum, fee, and fulfilment estimate. |
| CUS-15 | Store, product, brand, and category search | Launch | Search works across the published eligible catalogue without mixing unavailable zones into actionable results. |
| CUS-16 | Misspelling and local-language matching | Launch | Common misspellings, synonyms, Hindi terms, and transliteration can return relevant results. |
| CUS-17 | Recent searches | Launch | Customers can reuse recent searches with privacy-safe storage and deletion behaviour. |
| CUS-18 | Discovery filters | Launch | Filters include category, pickup/delivery, open now, delivery fee, rating, specialty attributes, and preferred stores. |
| CUS-19 | Ranked eligible results | Launch | Available and relevant vendors rank ahead of ineligible or unavailable results; sponsored ranking is not mixed in. |
| CUS-20 | Favourite stores | Launch | Customers can add or remove stores from a personal favourites list. |
| CUS-21 | Preferred store | Launch | Customers can mark one store as preferred and find it quickly when it is eligible. |
| CUS-22 | Request a shop | Launch | Customers can nominate a nearby store for the vendor-onboarding pipeline. |

### 4.4 Storefront and catalogue

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| CUS-23 | Dedicated store page | Launch | Each store has its own name, images, description, hours, policies, rating, offers, fulfilment choices, and catalogue. |
| CUS-24 | Category browsing | Launch | Customers browse a store's products through understandable categories and search. |
| CUS-25 | Product detail | Launch | Product pages show name, image, brand, unit, price, availability state, relevant tax/fee information, and substitution behaviour. |
| CUS-26 | Packaged products | Launch | Fixed-pack products use explicit quantity, unit, and integer minor-unit pricing. |
| CUS-27 | Variable-weight products | Launch | Loose produce can show an estimated weight/price range followed by a controlled final-weight adjustment. |
| CUS-28 | Availability freshness | Launch | Customers see when product availability was last confirmed and receive isolated recovery when a line becomes stale. |
| CUS-29 | Store reviews | Launch | Customers can read eligible store reviews and ratings without losing the identity of the reviewed vendor. |

### 4.5 Cart and checkout

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| CUS-30 | Vendor-grouped cart | Launch | Cart lines are visibly grouped by vendor location with separate subtotals, minimums, preferences, method, fee, and promise. |
| CUS-31 | Cross-store add decision | Launch | Adding from another store creates or joins a separate vendor group and clearly explains the additional order, fee, and delivery implications. |
| CUS-32 | Configurable store-group limit | Launch | The server enforces the active maximum, defaulting to three groups, with recovery that preserves existing groups. |
| CUS-33 | Per-store fulfilment selection | Launch | Customers select pickup, vendor delivery, or platform delivery independently where the vendor and zone support them. |
| CUS-34 | Per-line substitution preference | Launch | Customers choose no substitution, a permitted alternative rule, or explicit contact for changes. |
| CUS-35 | Customer notes | Launch | Customers add safe store or handoff notes subject to content and privacy controls. |
| CUS-36 | Cart validation | Launch | Price, availability, minimum, hours, address, group limit, and fulfilment eligibility are rechecked before quoting. |
| CUS-37 | Multi-store quote | Launch | Each group receives an independent quote and promise; one blocked group does not hide the state of valid groups. |
| CUS-38 | Quote expiry | Launch | Customers see when a quote expires and can refresh it without accidental duplicate orders. |
| CUS-39 | Combined checkout summary | Launch | The final screen shows every vendor group, individual amount, delivery/pickup plan, and the combined authorization amount. |
| CUS-40 | Prepaid UPI | Launch | Customers can pay using the selected provider's supported UPI flow. |
| CUS-41 | Card payment | Launch | Customers can pay using supported cards through a provider-hosted or tokenized secure flow. |
| CUS-42 | Supported wallets | Launch | Approved wallet methods appear only when available for the order and customer. |
| CUS-43 | Idempotent order placement | Launch | Repeated taps, retries, or reconnects produce one checkout result and never duplicate a charge or child order. |
| CUS-44 | Payment-unknown recovery | Launch | A provider timeout displays a pending state while webhook and reconciliation workers resolve the real result. |
| CUS-45 | Independent child-order creation | Launch | Successful placement returns the checkout group and every vendor-scoped child order with no sibling data leakage. |

### 4.6 Post-order control and fulfilment

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| CUS-46 | Group order overview | Launch | Customers see an overall checkout summary plus the current state of each child order. |
| CUS-47 | Vendor-order timeline | Launch | Each child order shows accepted, picking, decision needed, ready, assigned, picked up, arriving, completed, cancelled, or returned states as applicable. |
| CUS-48 | Server-owned countdowns | Launch | Response and decision deadlines derive from server timestamps and recover correctly after pause or reconnect. |
| CUS-49 | Substitution decision | Launch | Customers approve or reject a proposed replacement with clear quantity, price, and deadline effects. |
| CUS-50 | Variable-weight approval | Launch | Material final-weight or price changes follow the customer's recorded rule or explicit approval. |
| CUS-51 | Pickup flow | Launch | Customers receive ready instructions and complete pickup with a server-validated OTP or approved alternative proof. |
| CUS-52 | Vendor self-delivery tracking | Launch | Customers see vendor-controlled delivery status and the applicable proof and support path. |
| CUS-53 | Platform delivery tracking | Launch | Customers see assignment and delivery progress without access to internal partner-risk data. |
| CUS-54 | Live map tracking | Later | Where privacy, device, and operational controls pass, customers may see a bounded live partner location during the active delivery window. |
| CUS-55 | Separate delivery expectations | Launch | Multiple vendor orders remain separate deliveries unless safe consolidation is explicitly confirmed. |
| CUS-56 | Delivery OTP | Launch | The customer provides a fresh server-validated OTP for delivery completion by default. |
| CUS-57 | Cancellation preview | Launch | Before cancellation, customers see affected child orders, fulfilment/custody state, refund expectation, and any permitted charge. |
| CUS-58 | Post-custody cancellation handling | Launch | Cancellation after partner pickup becomes a controlled return instead of silently ending the order. |
| CUS-59 | Partial refund visibility | Launch | Refunds and adjustments show the affected vendor order, amount, reason, method, and progress. |
| CUS-60 | Receipts | Launch | Customers receive itemized receipts that preserve vendor, fee, adjustment, refund, and payment allocation details. |

### 4.7 Retention, support, and feedback

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| CUS-61 | Order history | Launch | Customers can review past checkout groups and child orders with receipts and support references. |
| CUS-62 | Reorder | Launch | Customers can recreate a past basket, then resolve current price, availability, vendor, and serviceability changes. |
| CUS-63 | Structured support | Launch | Customers select the smallest affected order or fulfilment, issue category, and evidence, then receive a case reference and expected response time. |
| CUS-64 | Support case tracking | Launch | Customers see current owner-facing status, required response, participant-visible messages, outcome, and reopen/escalation eligibility. |
| CUS-65 | Protected communication | Launch | Order communication uses in-app messaging or approved masked contact without revealing private phone numbers. |
| CUS-66 | Vendor rating and review | Launch | Customers rate the correct vendor order after completion, subject to moderation and abuse rules. |
| CUS-67 | Notification centre | Launch | Order, decision, refund, support, and account notifications remain available in one accessible history. |
| CUS-68 | Loyalty rewards | Later | Approved rewards can recognize repeat behaviour without changing historical order economics. |
| CUS-69 | Recurring baskets | Later | Customers can schedule or quickly trigger recurring baskets after current availability and pricing validation. |
| CUS-70 | Shared shopping lists | Later | Authorized household members can collaborate on a list before checkout ownership is established. |

## 5. Vendor Portal

### 5.1 Onboarding, store, and staff

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| VEN-01 | Vendor application and invitation | Launch | A vendor can enter through a lead, invitation, or approved application path. |
| VEN-02 | Business and payout profile | Launch | Owners provide business identity, bank/payout details, category, contacts, and required declarations. |
| VEN-03 | Document upload and review status | Launch | Licences and verification files show pending, approved, rejected, expiring, grace, and reverification states. |
| VEN-04 | Store-location management | Launch | A vendor manages one or more authorized locations without crossing another vendor's data boundary. |
| VEN-05 | Store profile | Launch | Owners manage approved name, description, images, contact policy, and storefront information. |
| VEN-06 | Hours and closures | Launch | Stores configure regular hours, holidays, and temporary closures used by discovery and checkout. |
| VEN-07 | Service zones | Launch | Authorized zones or radii determine eligible addresses and fulfilment options. |
| VEN-08 | Minimum order and preparation time | Launch | Vendor-specific minimums and realistic preparation estimates feed customer quotes. |
| VEN-09 | Fulfilment modes | Launch | Vendors enable approved pickup, self-delivery, or platform delivery modes by location. |
| VEN-10 | Staff invitations | Launch | Owners invite staff by approved identity channel and assign location-scoped roles. |
| VEN-11 | Vendor roles and permissions | Launch | Owner, manager, and picker capabilities follow least privilege and leave attributable activity. |
| VEN-12 | Onboarding test order | Launch | Publication may require a successful operational test before the storefront becomes live. |

### 5.2 Catalogue, pricing, and availability

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| VEN-13 | Catalogue creation | Launch | Vendors create products with category, brand, description, image, unit, price, tax, and availability fields. |
| VEN-14 | Product editing | Launch | Authorized staff update products while current orders preserve immutable product and price snapshots. |
| VEN-15 | CSV catalogue import | Launch | Vendors download a template, upload rows, fix row-level errors, preview, and explicitly commit valid changes. |
| VEN-16 | Bulk catalogue operations | Launch | Authorized staff update availability and supported fields without unsafe cross-store changes. |
| VEN-17 | Variable-weight configuration | Launch | Vendors define base unit, expected variance, estimate behaviour, and permitted final-weight handling. |
| VEN-18 | Substitution suggestions | Launch | Vendors define appropriate alternatives without bypassing the customer's substitution preference. |
| VEN-19 | Stock-status management | Launch | Vendors mark in stock, low confidence, or unavailable and expose freshness to customer flows. |
| VEN-20 | Inventory soft holds | Launch | Checkout can create expiring provisional holds; the cart itself never guarantees reservation. |
| VEN-21 | Acceptance-time stock commitment | Launch | Accepting an order commits the applicable counted inventory atomically or rejects the conflicting acceptance. |
| VEN-22 | Catalogue moderation feedback | Launch | Restricted or invalid products show actionable moderation reasons and correction/review paths. |
| VEN-23 | POS/inventory integration | Later | Approved connectors synchronize catalogue or stock through idempotent, observable provider adapters. |

### 5.3 Order operations

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| VEN-24 | Real-time new-order alerts | Launch | Assigned devices receive push/audible alerts with fallback escalation and a visible server deadline. |
| VEN-25 | Order queue dashboard | Launch | Staff see new, decision-required, picking, ready, handoff, exception, and completed work ordered by urgency. |
| VEN-26 | Accept order | Launch | Authorized staff accept only a valid placed order before deadline, committing stock and preparation expectations. |
| VEN-27 | Impact-aware decline | Launch | Decline requires preview, standardized reason, customer/financial impact, and confirmation. |
| VEN-28 | Server-driven timeout | Launch | Missing the response deadline affects only that child order, releases its resources, and notifies the right actors. |
| VEN-29 | Picking checklist | Launch | Staff resolve every line as found, adjusted, removed, or substitution proposed. |
| VEN-30 | Weight entry | Launch | Staff enter final weight and price within policy, triggering customer approval when required. |
| VEN-31 | Substitution proposal | Launch | Staff send a concrete replacement with quantity, price, reason, and decision deadline. |
| VEN-32 | Customer-decision tracking | Launch | The order shows whether the customer approved, rejected, or timed out and the exact next instruction. |
| VEN-33 | Package metadata | Launch | Staff record package count, handling needs, and condition before declaring readiness. |
| VEN-34 | Mark ready | Launch | The action succeeds only after all lines and required customer decisions are resolved. |
| VEN-35 | Customer pickup handoff | Launch | Staff validate pickup OTP or approved proof and close custody and fulfilment correctly. |
| VEN-36 | Delivery-partner handoff | Launch | Staff verify the correct assignment, proof, counts, and condition before server-confirmed custody begins. |
| VEN-37 | Vendor self-delivery | Launch | Authorized vendor staff can perform the approved delivery flow with status and proof controls. |
| VEN-38 | Controlled cancellation | Launch | Cancellation shows customer, inventory, fulfilment, partner, and financial impact and respects custody boundaries. |
| VEN-39 | Order timeline | Launch | Every state transition displays actor, time, reason, and current instruction to authorized vendor staff. |
| VEN-40 | Low-connectivity recovery | Launch | Active work, last confirmed state, drafts, and safe retries survive common mobile-network interruption. |

### 5.4 Communication, support, money, and insights

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| VEN-41 | Protected customer messaging | Launch | Vendors use approved templates, safe free text, or time-bounded masked calling; personal numbers remain hidden. |
| VEN-42 | Structured operational escalation | Launch | Reasons cover customer, payment, rider, package, timing, technical, safety, and admin problems. |
| VEN-43 | Persistent case instruction | Launch | The current support instruction remains visible on the affected order until resolution. |
| VEN-44 | Notification escalation settings | Launch | Owners select permitted devices and staff escalation order and can test push/SMS delivery. |
| VEN-45 | Sales dashboard | Launch | Vendors see orders, gross sales, acceptance, cancellation, preparation time, and trend summaries. |
| VEN-46 | Repeat-customer insights | Launch | Privacy-safe aggregate insights help vendors understand repeat demand without exporting private customer identities. |
| VEN-47 | Rating insights | Launch | Vendors see rating trends, eligible feedback, moderation outcomes, and dispute/support paths. |
| VEN-48 | Settlement ledger | Launch | Each order shows sale, platform fee, payment costs, refund/adjustment, tax, and payout status. |
| VEN-49 | Downloadable statements | Launch | Authorized vendor users export date- or payout-batch statements with stable references. |
| VEN-50 | Settlement disputes | Launch | Vendors challenge a specific ledger or payout line through a tracked finance case. |
| VEN-51 | Marketing tools | Later | Approved vendor campaigns and customer-retention tools operate within consent, ranking, and fee policies. |
| VEN-52 | Vendor-managed advertising | Later | Advertising may launch only after vendor-order economics and sponsored-ranking disclosure rules are approved. |

## 6. Delivery Partner App / Portal

### 6.1 Onboarding and availability

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| DLP-01 | Partner application | Launch | Prospective partners create an application for permitted service areas and vehicle types. |
| DLP-02 | Identity and document capture | Launch | Camera-first capture supports identity, driving/vehicle, bank, insurance, and other approved documents. |
| DLP-03 | Verification status | Launch | Partners see applied, pending, under review, approved, rejected, suspended, and inactive states with reasons. |
| DLP-04 | Expiry and reverification | Launch | Time-bound documents trigger reminders and capability changes under approved policy without stranding active custody. |
| DLP-05 | Training checklist | Launch | Partners complete required privacy, pickup, delivery, safety, and exception training. |
| DLP-06 | Emergency contact | Launch | Partners maintain an approved emergency contact with protected access. |
| DLP-07 | Bank and payout setup | Launch | Partners manage verified payout details through controlled change and review flows. |
| DLP-08 | Online/offline toggle | Launch | Only an eligible partner can go online; the screen explains any blocker. |
| DLP-09 | Active-zone selection | Launch | Partners choose among authorized service zones. |
| DLP-10 | Daily activity summary | Launch | The home screen shows trips, earnings, online time, and relevant device/data guidance. |

### 6.2 Offers and assignment

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| DLP-11 | Privacy-bounded job offer | Launch | Offers show approximate pickup/drop areas, distance, expected time, deadline, constraints, and expected earnings without premature customer detail. |
| DLP-12 | Accept or decline | Launch | Partners make a one-handed decision before the server deadline; safety or impracticality declines are not presented as automatic misconduct. |
| DLP-13 | Offer expiry | Launch | Expiry closes one immutable attempt and safely returns eligible work for reassignment. |
| DLP-14 | One active job | Launch | A partner cannot accept another job while an assignment or unresolved offline proof remains active. |
| DLP-15 | One active assignment per fulfilment | Launch | Concurrency controls prevent two partners from validly owning the same fulfilment. |
| DLP-16 | Assignment history | Launch | Every offer, expiry, decline, reassignment, actor, reason, wait effect, custody effect, and earning effect remains visible to authorized users. |
| DLP-17 | Manual dispatch | Launch | Operations can assign or reassign eligible partners with an attributable reason and preserved history. |
| DLP-18 | Batch assignment | Later | The platform may offer compatible work in batches after single-order dispatch reliability is proven. |
| DLP-19 | Automated route optimization | Later | Approved algorithms may improve offer and route planning without weakening partner choice or custody isolation. |

### 6.3 Active delivery and proof

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| DLP-20 | Resume active job | Launch | A persistent control returns the partner to the server-confirmed current step after navigation, interruption, or reconnect. |
| DLP-21 | Vendor navigation | Launch | Partners receive the exact vendor address, text/landmark fallback, and external-map handoff. |
| DLP-22 | Arrival at vendor | Launch | Trusted location or approved fallback records arrival and starts the applicable server wait policy. |
| DLP-23 | Vendor wait timer | Launch | Partners see elapsed wait, revised pickup estimate, compensation, thresholds, and allowed actions. |
| DLP-24 | Pickup QR/OTP | Launch | Partners scan or enter approved proof tied to the correct assignment and vendor order. |
| DLP-25 | Package count and condition agreement | Launch | Partner and vendor confirm counts, condition, fragile/cold handling, and exceptions before pickup. |
| DLP-26 | Server-confirmed custody | Launch | Custody begins only after the server accepts proof; local capture never displays false completion. |
| DLP-27 | Customer navigation | Launch | Exact customer address and permitted instructions appear only after custody begins. |
| DLP-28 | Masked customer contact | Launch | Partners contact customers through approved time-bounded channels without seeing personal phone numbers. |
| DLP-29 | Arrival at customer | Launch | The partner records arrival with the permitted location and fallback process. |
| DLP-30 | Delivery OTP | Launch | A fresh OTP is the default completion proof and includes expiry, replay, and attempt controls. |
| DLP-31 | Alternative proof | Gated | Photo, signature, or another proof appears only for approved scenarios with consent, retention, and support policy. |
| DLP-32 | Offline proof capture | Launch | Proof can be encrypted locally, tied to the assignment, and labelled pending until synchronization. |
| DLP-33 | Idempotent proof synchronization | Launch | Automatic and manual retries cannot complete the same handoff more than once. |
| DLP-34 | Offline proof escalation | Launch | Failed synchronization exposes a one-tap support path with safe diagnostics and a stable reference. |
| DLP-35 | Completion confirmation | Launch | The app shows delivered only after server confirmation, then releases the partner for new work. |

### 6.4 Exceptions, returns, and safety

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| DLP-36 | Guided vendor-delay flow | Launch | The partner receives clear wait, leave/reassign, compensation, and support choices. |
| DLP-37 | Missing or damaged package flow | Launch | The app records evidence and routes to retry, correction, cancellation, return, or support. |
| DLP-38 | Customer unreachable flow | Launch | Attempts, timers, safe contact, next instruction, and return eligibility are recorded. |
| DLP-39 | Wrong-address flow | Launch | Partners can report an incorrect address without unilaterally changing the delivery contract. |
| DLP-40 | Unsafe-location flow | Launch | Partners can stop safely and reach specialist support without being forced to complete. |
| DLP-41 | Return to origin | Launch | Authorized returns progress through destination, returning, receipt/count/condition proof, returned, and earning posting. |
| DLP-42 | Return-location fallback | Launch | Vendor closed/refusal, alternate safe point, perishables, damage, and proof-pending cases have explicit instructions. |
| DLP-43 | Persistent emergency action | Launch | Accident, medical emergency, threat, harassment, breakdown, and prohibited-goods concerns reach the correct emergency path. |
| DLP-44 | Location-sharing disclosure | Launch | Partners see when tracking is active, why, frequency/battery mode, offline buffering, and when sharing ends. |
| DLP-45 | Permission withdrawal handling | Launch | The app explains which capabilities stop and whether the active job may continue or must enter a safe-stop flow. |
| DLP-46 | Text and landmark navigation fallback | Launch | A map is never the only representation of the route. |
| DLP-47 | Integrity-review state | Launch | Suspicious signals create a neutral review with case reference and appeal; one signal does not automatically declare guilt. |

### 6.5 Earnings, performance, and support

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| DLP-48 | Offer earnings preview | Launch | Expected base, distance/time, known tip, wait/return policy, and constraints are visible before acceptance. |
| DLP-49 | Trip earnings breakdown | Launch | Completed work shows base, distance/time, waiting, return, incentive, tip, adjustment, and net amount. |
| DLP-50 | Daily and weekly rollups | Launch | Partners can reconcile individual trips with summarized earnings. |
| DLP-51 | Payout history | Launch | Payout batches show status, bank destination reference, amount, date, and failure state. |
| DLP-52 | Downloadable earnings statement | Launch | Partners export stable trip and payout references for the selected period. |
| DLP-53 | Line-level earning dispute | Launch | Missing trip, distance, wait/return pay, tip, incentive, failure, or adjustment disputes attach to the exact line. |
| DLP-54 | Performance transparency | Launch | Completed trips, pickup timing, and feedback are explained with coaching and dispute paths before restriction. |
| DLP-55 | Partner support | Launch | Partners can reach operational support without abandoning the active-job context. |
| DLP-56 | Restriction appeal | Launch | Capability restrictions show reason, evidence basis, review date, effect, and appeal status. |

## 7. Admin Console and operational control plane

### 7.1 Access, dashboard, and work management

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| ADM-01 | Role-based admin access | Launch | Every screen, record, and action checks a named capability and tenant/scope boundary. |
| ADM-02 | Admin role summary | Launch | Staff can see their own permissions and receive a safe access-denied explanation. |
| ADM-03 | Separation of duties | Launch | A proposer cannot approve their own protected refund, payout, restriction, policy, fee, or incident action. |
| ADM-04 | Risk-ranked dashboard | Launch | Safety, ledger, live-order, compliance, and routine work appear in consistent severity order. |
| ADM-05 | Queue ownership and SLA | Launch | Each operational item has an owner/team, age, severity, response deadline, and next action. |
| ADM-06 | Scoped search | Launch | Staff find checkout groups, orders, assignments, vendors, partners, payments, cases, and public references only within permission. |

### 7.2 Vendor and partner network management

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| ADM-07 | Vendor lead and pipeline | Launch | Requested, invited, applied, pending, review, test-order, approved, live, paused, and rejected stages are managed visibly. |
| ADM-08 | Vendor document review | Launch | Reviewers inspect required documents, expiry, evidence, notes, replacement, grace, outcome, and appeal. |
| ADM-09 | Vendor publication | Launch | Authorized staff publish, pause, unpublish, or restore a storefront with impact preview and reason. |
| ADM-10 | Vendor service configuration | Launch | Staff manage approved zones, category, fees, commission, fulfilment model, and import method. |
| ADM-11 | Partner application pipeline | Launch | Applied, documents pending, under review, approved, suspended, rejected, and inactive states are managed. |
| ADM-12 | Partner document review | Launch | Identity, vehicle, insurance, bank, expiry, reverification, and evidence follow an auditable lifecycle. |
| ADM-13 | Partner zone and vehicle eligibility | Launch | Authorized staff control permitted service zones and compatible vehicle types. |
| ADM-14 | Capability-specific restriction | Launch | Restrictions name exactly what is blocked and preserve safe handling of active orders or custody. |
| ADM-15 | Appeals and manual exceptions | Launch | Time-limited exceptions and appeals have evidence, owner, expiry/review date, outcome, and history. |

### 7.3 Catalogue and marketplace configuration

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| ADM-16 | Cross-vendor catalogue moderation | Launch | Staff review prohibited, restricted, miscategorized, or policy-violating items without silently editing vendor history. |
| ADM-17 | Category taxonomy | Launch | Authorized staff maintain marketplace categories and attributes through versioned, validated changes. |
| ADM-18 | Service-zone editor | Launch | Zones support radius, pin-code, or polygon definitions with affected-store/address preview. |
| ADM-19 | Delivery-fee configuration | Launch | Base, included distance, rate, thresholds, rounding, and maximum radius are versioned and previewable. |
| ADM-20 | Vendor-fee and commission configuration | Launch | Per-completed-order fees and approved commission rules have scope, effective time, author, and approval. |
| ADM-21 | Payout and earning policy configuration | Launch | Partner earnings and payout rules are versioned and never recalculate historical work silently. |
| ADM-22 | Operational timer configuration | Launch | Response, decision, wait, proof, and recovery deadlines are server-owned and versioned. |
| ADM-23 | Configuration validation | Launch | Invalid overlaps, missing dependencies, unsafe values, and failed test examples block activation. |
| ADM-24 | Maker-checker activation | Launch | Material configuration changes require a different authorized approver. |
| ADM-25 | Scheduled activation and rollback | Launch | Approved versions activate at a defined time; rollback creates a new version rather than rewriting history. |

### 7.4 Live orders, dispatch, custody, and incidents

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| ADM-26 | Checkout-group monitor | Launch | Staff see combined customer context while child orders remain visually and operationally isolated. |
| ADM-27 | Live order monitor | Launch | Filters include vendor, state, exception, time-in-state, fulfilment, custody, and settlement risk. |
| ADM-28 | Immutable order timeline | Launch | Authorized staff inspect every state change, actor, time, reason, correlation, and evidence reference. |
| ADM-29 | Manual partner assignment | Launch | Operations assign or reassign an eligible partner with impact, reason, and preserved attempt history. |
| ADM-30 | Order intervention preview | Launch | Cancel, refund, reassign, return, and other actions show customer, vendor, partner, inventory, and money effects first. |
| ADM-31 | Protected intervention approval | Launch | High-risk or high-value actions wait for an independent authorized decision. |
| ADM-32 | Custody-aware operations | Launch | No intervention can silently end or lose an active package-custody obligation. |
| ADM-33 | Incident kill switches | Launch | Staff can pause a scoped vendor, category, zone, fulfilment mode, payment method, integration, promotion, payout, or new grouped checkout. |
| ADM-34 | Incident impact preview | Launch | Controls show affected new work, existing obligations, owner, reason, expiry/review, and recovery checklist. |
| ADM-35 | Reversible incident recovery | Launch | Controls expire or are rolled back explicitly without cancelling existing work or rewriting ledger history. |

### 7.5 Support, trust, finance, and audit

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| ADM-36 | Structured support cases | Launch | Cases attach to the smallest affected order, assignment, payment, ledger line, vendor, partner, or account. |
| ADM-37 | SLA-ranked support queue | Launch | Category, risk, age, owner, response deadline, current instruction, and next action drive prioritization. |
| ADM-38 | Safe evidence viewer | Launch | Access-controlled evidence displays classification, source, retention, and permitted viewers. |
| ADM-39 | Internal and participant-visible messages | Launch | Staff separate private operational notes from messages that customers, vendors, or partners may see. |
| ADM-40 | Resolution templates | Launch | Controlled refunds, credits, communication, restriction, return, and closure actions use versioned templates. |
| ADM-41 | Case merge, reopen, and escalation | Launch | Duplicate cases merge without losing history; eligible outcomes can be reopened or escalated. |
| ADM-42 | Trust and safety review | Launch | Signals open evidence-based review rather than directly applying irreversible punishment. |
| ADM-43 | Linked-risk investigation | Launch | Authorized specialists inspect relevant accounts, devices, orders, signals, prior decisions, and evidence quality. |
| ADM-44 | Restriction review and appeal | Launch | Temporary or lasting restrictions have policy basis, scope, reason, review date, impact, and appeal. |
| ADM-45 | Payment reconciliation queue | Launch | Unknown, missing, mismatched, duplicated, failed, or unmatched provider outcomes become owned work. |
| ADM-46 | Refund reconciliation queue | Launch | Pending, failed, duplicated-risk, or mismatched refunds retain provider, allocation, retry, and approval context. |
| ADM-47 | Ledger integrity queue | Launch | Unbalanced or unexpected postings block closure and can only be corrected with reversal/adjustment entries. |
| ADM-48 | Vendor settlement queue | Launch | Expected and actual vendor amounts reconcile per order and provider statement. |
| ADM-49 | Partner earning and payout queue | Launch | Trip earnings and payout failures reconcile to immutable work and ledger references. |
| ADM-50 | Idempotent financial correction | Launch | Safe retries, reversals, and adjustments replace direct mutation or force-balance controls. |
| ADM-51 | Searchable audit log | Launch | Sensitive actions record actor, capability, target, before/after, reason, time, request, and approval reference. |
| ADM-52 | Read-only audit access | Launch | Audit history cannot be edited through the product and is permission-filtered for reporting or investigation. |

### 7.6 Reporting

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| ADM-53 | Marketplace dashboard | Launch | Authorized staff see GMV, completed orders, take rate, active supply/demand, and repeat rate. |
| ADM-54 | Vendor health reporting | Launch | Acceptance, cancellation, preparation, rating, fulfilment, support, and repeat-demand indicators are visible. |
| ADM-55 | Delivery operations reporting | Launch | Offer, acceptance, pickup, waiting, completion, return, safety, and payout measures are available by scope. |
| ADM-56 | Customer funnel reporting | Launch | Address eligibility, discovery, search, cart, fee exposure, checkout, and repeat behaviour are measured with privacy controls. |
| ADM-57 | Finance reporting | Launch | Revenue, fees, refunds, settlements, earnings, payouts, mismatches, and contribution are reconciled. |
| ADM-58 | Exportable reports | Launch | Role-scoped exports retain filters, generation actor, time, data classification, and expiry. |

## 8. Order, inventory, fulfilment, and financial engine

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| ENG-01 | Canonical state machines | Launch | Checkout, vendor order, reservation, assignment, custody, payment, refund, settlement, and case transitions use explicit allowed states. |
| ENG-02 | Attributable transition records | Launch | Every transition stores actor, reason, time, aggregate version, correlation, causation, and required evidence. |
| ENG-03 | Optimistic conflict protection | Launch | Stale edits return a recoverable conflict instead of overwriting newer state. |
| ENG-04 | Reservation lifecycle | Launch | Inventory progresses through no reservation, soft hold, provisional placement, committed acceptance, release, or expiry. |
| ENG-05 | Last-unit concurrency protection | Launch | Competing customers cannot both commit the final counted unit. |
| ENG-06 | Quote snapshots | Launch | Orders retain the product, price, tax, fee, promise, policy, and customer-preference facts accepted at checkout. |
| ENG-07 | Payment allocation by child order | Launch | The authorized amount is allocated explicitly across vendor orders for independent capture, refund, and reconciliation. |
| ENG-08 | Append-only double-entry ledger | Launch | Vendor, partner, customer, platform, tax, refund, and payout movements balance per currency and are never overwritten. |
| ENG-09 | Independent settlement | Launch | Each child order can settle, refund, or remain under review without corrupting siblings. |
| ENG-10 | Transactional outbox | Launch | Business state and follow-up events commit together; consumers are idempotent and tolerate duplicate delivery. |
| ENG-11 | Idempotent provider webhooks | Launch | Duplicate or reordered provider events cannot duplicate money or state transitions. |
| ENG-12 | Deadline and scheduled-job engine | Launch | Vendor response, customer decision, hold expiry, wait, proof, refund, payout, and review timers are durable and retryable. |
| ENG-13 | Notification orchestration | Launch | Domain events produce actor-appropriate in-app, push, SMS, or provider fallback attempts with delivery history. |
| ENG-14 | Return and custody closure | Launch | Returns close physical custody independently from later refund, earning, settlement, or dispute resolution. |
| ENG-15 | Reconciliation workers | Launch | Provider statements and internal orders, payments, refunds, settlements, earnings, and payouts are compared continuously. |

## 9. Notifications and communications

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| COM-01 | In-app notification history | Launch | Each actor can review relevant actionable and informational notifications. |
| COM-02 | Push notifications | Launch | Supported devices receive time-sensitive order, assignment, decision, and support updates. |
| COM-03 | SMS fallback | Launch | Approved critical alerts may use SMS when push acknowledgement or delivery fails. |
| COM-04 | Notification deduplication | Launch | Retries and duplicate events do not create misleading repeated actions. |
| COM-05 | Deep links to safe context | Launch | Notifications open the exact authorized order, assignment, decision, or case state. |
| COM-06 | Template-first messaging | Launch | Common customer/vendor/partner communications use localized, approved templates. |
| COM-07 | Auditable delivery attempts | Launch | Channel, provider reference, attempt, result, and retry state remain observable. |
| COM-08 | Privacy-safe masked calling | Launch | Approved active-order cases can use time-bounded masked contact without recording call content by default. |

## 10. Security, privacy, trust, and compliance

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| SEC-01 | Least-privilege authorization | Launch | Customer ownership, vendor membership, active partner assignment, and admin capability are checked on every operation. |
| SEC-02 | Cross-tenant isolation | Launch | One customer, vendor, or partner cannot read or mutate another party's protected resources. |
| SEC-03 | Stage-gated personal data | Launch | Exact customer address and contact access appear only to actors who need them at the current fulfilment stage. |
| SEC-04 | Encryption in transit and at rest | Launch | Sensitive application, provider, database, object, and local-offline data use approved encryption. |
| SEC-05 | Secret and credential management | Launch | Credentials stay outside source and logs, rotate under policy, and use scoped service identities. |
| SEC-06 | OTP and session abuse protection | Launch | Rate, attempt, device, replay, session rotation, and suspicious-activity controls are observable. |
| SEC-07 | Webhook authenticity | Launch | Provider callbacks require signature, timestamp/replay, payload, and idempotency validation. |
| SEC-08 | Upload protection | Launch | Documents and evidence are type/size checked, malware-scanned where required, classified, and access controlled. |
| SEC-09 | Log and event redaction | Launch | OTPs, bank data, unnecessary addresses, private documents, and future health data do not enter general telemetry. |
| SEC-10 | Consent records | Launch | Consent purpose, version, actor, time, and withdrawal status are retained where required. |
| SEC-11 | Retention and deletion engine | Launch | Data classes follow approved retention, legal hold, deletion, and proof-recovery policy. |
| SEC-12 | Device and location integrity signals | Launch | Mock GPS, replayed proof, impossible movement, compromised device, or sharing patterns inform review without automatic guilt. |
| SEC-13 | Maker-checker controls | Launch | Protected money, restriction, configuration, and incident actions require independent approval at configured thresholds. |
| SEC-14 | Appeal and human-review paths | Launch | Material automated or staff-assisted decisions expose reason, evidence basis, review state, and appeal where policy requires. |
| SEC-15 | Pharmacy data isolation | Gated | Prescription and health information use separate access, storage, audit, retention, and event boundaries. |

## 11. Accessibility, localization, responsive design, and resilience

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| UX-01 | Responsive customer experience | Launch | Critical customer journeys work from 360 px mobile width through supported desktop layouts. |
| UX-02 | Low-end Android operational support | Launch | Vendor and partner critical tasks remain usable on modest hardware and standard mobile networks. |
| UX-03 | Keyboard operation | Launch | All critical web actions are reachable, visible, ordered, and completable by keyboard. |
| UX-04 | Screen-reader semantics | Launch | Structure, labels, status changes, errors, dialogs, timers, and proof states have meaningful announcements. |
| UX-05 | 200% zoom and reflow | Launch | Critical flows remain readable and operable without two-dimensional scrolling at supported widths. |
| UX-06 | Accessible time limits | Launch | Users receive clear deadlines, warnings, and permitted extensions or support alternatives. |
| UX-07 | Non-colour status communication | Launch | State and severity use text/icon/structure in addition to colour. |
| UX-08 | English/Hindi expansion tolerance | Launch | Layouts handle translated strings without truncating critical information or actions. |
| UX-09 | Loading, empty, error, stale, and success states | Launch | Every core screen defines actionable non-happy states rather than blank or ambiguous UI. |
| UX-10 | Reconnect-safe active work | Launch | Customers, vendors, and partners restore server-confirmed state after connection loss. |
| UX-11 | Reduced motion | Launch | Motion communicates feedback and respects the user's reduced-motion preference. |
| UX-12 | Text alternative to maps | Launch | Addresses, landmarks, instructions, and support remain available when maps fail or are inaccessible. |

## 12. Platform operations and engineering readiness

| ID | Feature | Status | Finished behaviour |
|---|---|---|---|
| OPS-01 | Health and readiness checks | Launch | Services expose dependency-aware health without leaking protected configuration. |
| OPS-02 | Structured logs | Launch | Requests, jobs, providers, transitions, and failures share stable correlation identifiers and redaction. |
| OPS-03 | Distributed tracing | Launch | Critical checkout, fulfilment, payment, and support flows can be followed across modules and workers. |
| OPS-04 | Business and technical metrics | Launch | Latency, errors, queues, locks, provider outcomes, state ageing, and business invariants are measurable. |
| OPS-05 | Actionable alerting | Launch | Alerts have severity, owner, runbook, affected scope, and safe first response. |
| OPS-06 | Durable job processing | Launch | Retries use backoff and idempotency; poison work reaches a visible dead-letter/recovery path. |
| OPS-07 | Database migrations | Launch | Changes follow expand, compatible reader/writer, scoped rollout, and later contraction. |
| OPS-08 | Feature flags | Launch | Risky behaviour rolls out by internal user, vendor, category, zone, or cohort without rewriting history. |
| OPS-09 | Configuration validation | Launch | Startup and activation fail safely when required configuration or policy dependencies are invalid. |
| OPS-10 | Non-production environments | Launch | Development, test, staging, and production use isolated data and provider credentials. |
| OPS-11 | Automated test pipeline | Launch | Unit, property, integration, contract, API, UI, end-to-end, security, resilience, and performance gates run as applicable. |
| OPS-12 | Backup and point-in-time recovery | Launch | Transactional data and object references follow approved RPO/RTO and restore procedures. |
| OPS-13 | Restore drills | Launch | The team proves recovery in a non-production environment and records evidence before launch. |
| OPS-14 | Safe rollback | Launch | Code, flag, and configuration rollback preserve accepted orders, custody, events, and ledger history. |
| OPS-15 | Operational runbooks | Launch | Checkout, payment, dispatch, proof, return, queue, provider, security, and reconciliation failures have owned procedures. |
| OPS-16 | Capacity and performance targets | Launch | Supported traffic meets agreed response-time and throughput targets under representative multi-store and dispatch load. |

## 13. External integrations

| ID | Integration | Status | Finished behaviour |
|---|---|---|---|
| INT-01 | OTP provider | Launch | Provider-neutral adapter supports request, verification outcome, timeout, error, and abuse telemetry. |
| INT-02 | Payment provider | Launch | Authorization, capture, refund, webhook, unknown result, and reconciliation are supported through a verified adapter. |
| INT-03 | Payout provider | Launch | Vendor and partner payouts expose batch, item, failure, retry, statement, and reconciliation behaviour. |
| INT-04 | Maps/geocoding/routing | Launch | Address search, coordinates, distance, route estimates, and map handoff degrade to text and manual review. |
| INT-05 | Push notification provider | Launch | Device registration, delivery attempt, invalid token, fallback, and removal are observable. |
| INT-06 | SMS provider | Launch | Critical fallback templates, delivery status, cost, retry, and opt-out rules are controlled. |
| INT-07 | Object storage | Launch | Product images, verification documents, evidence, and approved proof use scoped signed access and lifecycle rules. |
| INT-08 | POS/inventory connectors | Later | Vendor systems integrate through isolated, idempotent import/sync adapters after core catalogue operations stabilize. |

## 14. Later product expansion

These capabilities belong to the intended roadmap but do not block initial production-MVP readiness.

| ID | Feature | Status | Dependency before release |
|---|---|---|---|
| FUT-01 | Customer live delivery map | Later | Privacy, partner-device, location-frequency, battery, support, and safety policy proven. |
| FUT-02 | Batch delivery assignment | Later | Single-order assignment, waiting, custody, and earnings accuracy proven. |
| FUT-03 | Automated route optimization | Later | Reliable routing data, partner choice, service constraints, and exception handling proven. |
| FUT-04 | Cross-store route consolidation | Later | Pickup reliability, package separation, custody, ETA, fee allocation, and customer communication proven. |
| FUT-05 | Loyalty rewards | Later | Reward economics, expiry, refund, abuse, accounting, and disclosure policy approved. |
| FUT-06 | Recurring baskets | Later | Availability refresh, customer confirmation, payment authorization, skip, and cancellation rules approved. |
| FUT-07 | Shared shopping lists | Later | Household authorization, edit conflicts, privacy, and checkout ownership defined. |
| FUT-08 | Vendor POS/inventory integrations | Later | Provider contracts, sync conflict ownership, freshness, reconciliation, and support model approved. |
| FUT-09 | Richer vendor marketing | Later | Consent, frequency, targeting, opt-out, fairness, and measurement controls approved. |
| FUT-10 | More store categories | Later | Category-specific compliance, catalogue, fulfilment, support, and economics pass. |
| FUT-11 | B2B ordering | Later | Buyer identity, pricing, tax, credit/payment, quantity, fulfilment, and invoicing model approved. |
| FUT-12 | Vendor advertising | Later | Sponsored disclosure, ranking fairness, billing, refunds, moderation, and reporting approved. |

## 15. Gated capabilities

| ID | Feature | Status | Required gate |
|---|---|---|---|
| GAT-01 | Cash on delivery | Gated | Cash custody, partner/vendor collection, change, failed delivery, fraud, refund, reconciliation, insurance, and payout policy. It remains hidden until approval. |
| GAT-02 | Pharmacy ordering | Gated | Jurisdiction-specific legal review, verified licences, approved categories, prescription handling, pharmacist review, privacy, retention, substitution, delivery, and audit controls. |
| GAT-03 | Prescription upload | Gated | Separate protected storage, access, consent, malware scanning, retention, deletion, and human-review workflow. |
| GAT-04 | Prescription-item fulfilment | Gated | Licensed human approval; no automatic prescription substitution; minimum necessary delivery data. |
| GAT-05 | Alternative delivery proof | Gated | Consent, acceptable scenarios, evidence access, fraud, retention, appeal, and support policy. |

## 16. Explicitly excluded product behaviour

The finished product described by the current strategy does **not** include the following unless a formal scope decision changes the authoritative documents.

| ID | Excluded behaviour | Reason |
|---|---|---|
| EXC-01 | Platform-owned inventory or dark stores | The product is a vendor-first marketplace for named independent stores. |
| EXC-02 | Hidden or interchangeable seller identity | Customers intentionally choose a vendor location, and orders remain vendor scoped. |
| EXC-03 | Guaranteed 10-minute delivery | Promises must reflect real vendor preparation and local fulfilment conditions. |
| EXC-04 | One order spanning multiple vendors | A checkout may group orders, but every child order belongs to one vendor location. |
| EXC-05 | Automatic cross-store consolidation at launch | Routing, custody, timing, and fee allocation must be proven first. |
| EXC-06 | Automatic route optimization at launch | Manual or simple dispatch is the launch baseline. |
| EXC-07 | Full POS or accounting replacement | Integrations may exchange data, but the product is not the vendor's complete back-office suite. |
| EXC-08 | Citywide launch before zone economics work | Expansion follows evidence from dense, controlled service areas. |
| EXC-09 | Sponsored ranking at launch | Eligible and relevant customer results are not silently reordered by advertising. |
| EXC-10 | Silent substitution | Every replacement follows the customer's recorded rule or explicit decision. |
| EXC-11 | Cart-level guaranteed reservation | Reservation begins only under the documented checkout/acceptance lifecycle. |
| EXC-12 | Direct database intervention from the admin product | Operational correction uses controlled commands, approvals, reversals, and audit. |
| EXC-13 | Editing or deleting financial history | Corrections use append-only reversals and adjustments. |
| EXC-14 | Irreversible punishment from one automated risk signal | Signals create review; attributable human/policy decisions and appeals control material restrictions. |
| EXC-15 | Exposure of prescription or medical details to delivery partners | Partners receive only the minimum fulfilment information. |

## 17. When the product may be called ready

The production MVP is ready only when all **Launch** features required by the selected launch operating model are implemented and the following conditions hold:

1. The launch neighbourhood, vendor cohort, categories, support hours, and operational owners are named.
2. Client platform, backend framework, hosting, payment, payout, maps, notification, and storage decisions are approved and contract-tested.
3. Customer, vendor, delivery-partner, and admin critical journeys work end to end for the enabled fulfilment modes.
4. Multi-store checkout preserves vendor-order, inventory, fulfilment, payment, refund, support, and settlement isolation.
5. Duplicate, timeout, reconnect, partial failure, cancellation, post-pickup return, and provider-unknown paths pass automated and operational tests.
6. Money conservation, idempotency, ledger balance, reconciliation, and maker-checker controls pass under concurrency and retry.
7. Cross-customer, cross-vendor, sibling-order, inactive-assignment, and incorrect-admin-role access attempts are denied and audited.
8. English and Hindi, keyboard and screen-reader use, 200% zoom, 360 px width, low-end device, slow network, and reconnect paths pass for every critical role task.
9. Metrics, alerts, dashboards, queue ownership, incident controls, and runbooks are exercised with realistic synthetic scenarios.
10. Backup restoration and release rollback are rehearsed without rewriting accepted order, custody, event, or ledger history.
11. Privacy purpose, viewer, consent, retention, deletion, proof, document, and location rules are approved for every launched data class.
12. Product, engineering, operations, finance, security/privacy, legal/compliance, and support owners sign the applicable production gates.

Features marked **Later** do not block the initial production MVP. Features marked **Gated** must remain unavailable until their named approvals and controls pass. Features marked **Excluded** must not appear accidentally through configuration, provider behaviour, or implementation shortcuts.
