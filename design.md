# Design — Neighbourhood Store Marketplace

**Status:** Proposed product design (information architecture, navigation, and screen-by-screen specification)
**Product stage:** Validation / pre-implementation — no visual UI kit or production build exists yet
**Related documents:** [README](README.md) · [Product Requirements Document](prd.md) · [Architecture](architecture.md) · [AI Rules and Boundaries](rules.md)

## 1. Purpose and scope

This document turns the functional requirements in `prd.md` and the state machines in `architecture.md` into concrete pages, navigation, components, and interaction states for the four product surfaces: Customer App/Web, Vendor Portal, Delivery Partner App/Portal, and Admin Console. The customer experience uses a **local-store quick-commerce UI**: fast to scan and shop, inspired by the interaction speed of Indian quick-commerce apps, while keeping named local vendors rather than anonymous dark-store inventory.

It is a structural and interaction specification, not a visual design system. It defines *what screens exist, what they contain, and how they behave* so a designer can produce wireframes/mockups and an engineer can scope components with a shared vocabulary. Colours, spacing, and pixel layouts are intentionally left open (see Section 12).

Nothing here overrides `rules.md`. In particular: one vendor per cart, distance-based delivery fees shown before commitment, per-completed-order vendor fees, no owned inventory, no 10-minute promise, and disabled pharmacy/COD flows unless explicitly enabled later. The approved MVP design is prepaid-only.

## 2. Design principles → design implications

| Product principle (PRD/README) | What it means for screens |
|---|---|
| Vendor first | Every store has a named, branded storefront (logo, banner, description). The vendor's identity is never hidden behind a generic "shop" tile. |
| Transparent economics | Delivery fee, platform fee (vendor-side), and any adjustment are shown as a line-item breakdown *before* the action that commits money. |
| Honest fulfilment | Status labels reflect real state only — no countdown timers or ETAs the system cannot guarantee. Stock/availability badges are truthful ("Vendor confirms availability" rather than a fake in-stock claim for variable-weight items). |
| Customer control | Substitution preference is a first-class control at cart/checkout. The safe MVP default is "No substitutions"; customers may explicitly change it for the order or an item, and any vendor-proposed change still requires approve/reject confirmation. |
| Accessible operations | Vendor and delivery screens use large tap targets, at most 1–2 primary actions per screen, minimal text entry, and work after a dropped connection. |
| Trust by design | Verification badges (vendor "Verified", partner "ID verified"), masked contact by default, and an admin audit trail visible wherever an override happened. |
| Light-first clarity | Every surface uses a white or light-neutral foundation with dark readable text. Customer shopping uses a lively quick-commerce retail palette; operational surfaces use restrained semantic colour. The product has no dark theme, dark-mode toggle, or dark-only screen. |

## 3. Customer interaction references — and marketplace boundaries

The customer flow combines two useful reference models. Mercato contributes location-first discovery, named independent-store storefronts, pickup/scheduling, and reorder. Blinkit and Zepto contribute the functional rhythm familiar to Indian quick-commerce customers: a compact location header, persistent search, category-first browsing, dense product shelves, one-tap `Add`, inline quantity changes, a persistent cart entry point, and a short progressive checkout.

These are interaction references, not a request to copy brand styling, proprietary layouts, promotional language, delivery promises, or dark-store economics. This product adapts speed-of-shopping patterns to a vendor-first marketplace:

- **Named vendor before anonymous inventory.** Every product price, result, recommendation, cart, and order identifies the fulfilling local store. No screen implies that the platform owns the stock.
- **Single-vendor cart.** Product-dense discovery may span eligible vendors, but the active cart belongs to one vendor location. Adding from another vendor requires an explicit replace-cart decision.
- **Honest fulfilment instead of a minutes promise.** The header and product surfaces show the latest vendor-backed preparation or arrival window. They never show a fixed quick-delivery claim that operations cannot guarantee.
- **Transparent distance-based fees.** Home and storefront surfaces may show an estimate or “from” amount; cart and checkout show the applicable distance basis and authoritative quote before payment.
- **Explicit customer control.** “No substitutions” remains the default, variable-weight uncertainty is visible before add-to-cart, and every material change follows the customer-decision flow.
- **Trust remains inspectable.** Fast `Add` controls never remove access to the store profile, unit basis, product detail, return/substitution policy, or vendor verification state.
- **Operational surfaces remain purpose-built.** Blinkit/Zepto-style shopping density applies only to Customer App/Web. Vendor, partner, and Admin surfaces follow the task and state-machine needs in `architecture.md`.

## 4. Personas and primary jobs

| Persona | Primary job on this product |
|---|---|
| Customer | Find a specific trusted local shop fast, see true prices and fees, order with confidence, track and receive the order. |
| Vendor owner/staff | See and act on new orders in seconds, keep the catalogue accurate, understand what they earned. |
| Delivery partner | Decide whether a job is worth accepting, get to pickup/drop-off without friction, prove handoff, see earnings. |
| Admin/ops | Approve trustworthy vendors and partners, watch live orders, resolve exceptions, and produce an audited trail. |

### 4.1 User journey storyboards

#### Customer: recognition → certainty → control → reassurance → closure

| Moment | Customer does | Intended feeling | Design response |
|---|---|---|---|
| First 5 seconds | Sets location or returns Home | "This helps me buy from shops I know" | Relationship-first Home, real storefront identity, preferred store prominence, no anonymous catalogue-first presentation |
| Chooses a store | Checks whether the vendor can serve them | Recognition and practical confidence | Trust-first storefront followed by open/slot, fulfilment, distance, minimum, and fee information |
| Builds and checks out | Selects items, substitutions, fulfilment, and payment | Price certainty and control | Estimated fee in cart, progressive checkout, explicit substitutions, authoritative quote, no hidden blocker |
| Waits and receives | Follows preparation/delivery and handles changes | Reassurance without false promises | Latest confirmed state, honest estimate, action-required interruption, protected contact, safe transaction recovery |
| Completes and returns | Rates, resolves issues, or reorders | Closure and a stronger local relationship | Receipt/support path, verified review, gratitude without promotional clutter, preferred-store/reorder shortcut |

#### Vendor: urgency → control → handoff confidence → money confidence

| Moment | Vendor does | Intended feeling | Design response |
|---|---|---|---|
| New demand | Receives an order during store work | Urgency without panic | Loud but legible alert, clear response time, one primary accept/decline decision |
| Fulfilment | Picks, weighs, and substitutes | Control and visibility | Urgency-ranked queue, progressive checklist, explicit blocked/customer-decision state |
| Handoff | Gives the package to customer/rider | Proof and finality | OTP/QR confirmation, package count, server-confirmed state, clear exception recovery |
| Settlement | Reviews what the order earned | Trust in the platform | Per-order breakdown, estimated versus settled distinction, payout status, dispute path |
| Long-term use | Sees repeat customers and store performance | Evidence that local loyalty is growing | Repeat-customer signal and useful service metrics, not vanity dashboards or pressure to buy placement |

#### Delivery partner: agency → safety → certainty → payout confidence

| Moment | Partner does | Intended feeling | Design response |
|---|---|---|---|
| Offer | Decides whether a trip is worthwhile | Agency and informed choice | Pay → effort → risk hierarchy, approximate locations, transparent return/handling constraints, non-punitive decline |
| Pickup and route | Travels and collects the package | Orientation and safety | One active job, exact data only at approved stage, persistent Support/Emergency, usable light map/list fallback |
| Handoff | Proves delivery under good or poor connectivity | Certainty without duplicate work | OTP/proof guidance, encrypted offline queue, last confirmed state, server-only success |
| Earnings | Checks trip and payout | Confidence that promised pay is honoured | Trip-level breakdown, adjustment reason, settled/estimated labels, payout reference and dispute path |

#### Admin: triage → controlled intervention → accountable closure

| Moment | Admin does | Intended feeling | Design response |
|---|---|---|---|
| Starts shift | Reviews marketplace health | Immediate orientation | Shared risk ranking: safety → money → live order → compliance → routine work |
| Investigates | Opens an exception and evidence | Context without information overload | Chronological timeline, actor/reason visibility, relevant evidence, role-gated details |
| Intervenes | Cancels, refunds, reassigns, suspends, or changes a rule | Deliberate control | Impact preview, reason, confirmation, second approval where required |
| Closes | Confirms outcome and future traceability | Audit confidence | Effective state, customer/vendor/partner impact, reference ID, immutable audit entry |

Across the five-year relationship, the product should make customers more confident choosing local shops, vendors more confident serving digital orders, partners more confident about safety and pay, and admins more confident that interventions are explainable. Short-term conversion must not erode that trust.

## 5. Surface map

```text
Neighbourhood Store Marketplace
├── Customer App / Web            (public storefronts + authenticated shopping)
├── Vendor Portal                 (authenticated, per-store operations)
├── Delivery Partner App/Portal   (authenticated, per-partner field tool)
└── Admin Console                 (authenticated, role-gated back office)
```

All four surfaces call the same Marketplace API (`architecture.md` §4) but each has its own navigation shell, because their tasks, devices, and network conditions differ.

## 6. Navigation model per surface

| Surface | Primary shell | Rationale |
|---|---|---|
| Customer App/Web | Bottom tab bar on mobile (Home, Categories, Orders, My Stores, Account); the same destinations become a top nav bar on desktop web. Search remains a persistent action in the Home/store/category header instead of consuming a navigation tab. A cart pill/bar appears globally when non-empty, and an active-order banner links directly to tracking. | Familiar quick-commerce access to search, categories, inline add, and cart reduces shopping effort; named-store context and active-order status remain one tap away. |
| Vendor Portal | Mobile uses Orders, Catalogue, Store, Payouts, and More navigation; tablet/desktop expands this into a left sidebar. A persistent order-alert indicator remains visible on every screen. | Many vendors will operate entirely from inexpensive Android phones. Orders remain the default destination without making other modules difficult to reach. |
| Delivery Partner App/Portal | Single-focus shell with Home (availability + offers), Earnings, and Profile. An active assignment takes visual priority and stays persistently resumable, but Support, Emergency, and essential account controls remain reachable. | A partner completes one job at a time, but the interface must never trap them or block access to safety and support tools. |
| Admin Console | Left sidebar with modules (Vendors, Delivery Partners, Orders, Catalogue & Moderation, Zones & Fees, Support & Disputes, Reporting, Audit Log) | Desktop-first, dense, permission-gated per module per `architecture.md` §6.4. |

### 6.1 Primary hierarchy across surfaces

```text
CUSTOMER                         VENDOR
location / relationship         expiring new order
        ↓                                ↓
order feasibility               rider/customer/blocking issue
        ↓                                ↓
catalogue / checkout            routine picking and handoff

DELIVERY PARTNER                ADMIN
expected payout                 safety / security incident
        ↓                                ↓
total effort                    payment / ledger mismatch
        ↓                                ↓
safety / unusual constraints    live-order exception
        ↓                                ↓
accept or decline               compliance / routine operations
```

Every primary screen must make its first, second, and third priorities visually distinguishable through type, spacing, position, and action prominence. Metrics, secondary policies, and historical context must not compete with the next task.

## 7. Customer App / Web

### 7.1 Onboarding & sign-in
- **Purpose:** get a shopper to a usable session with minimal friction.
- **Elements:** phone number entry, OTP input (auto-read where supported), optional name/email completion, language selection.
- **States:** OTP sent / expired / rate-limited (per `rules.md` OTP abuse limits) / verified.
- **Notes:** browsing and building a cart do not require sign-in. Phone verification is requested when the customer proceeds to checkout. The cart survives an expired OTP, failed verification attempt, or accidental navigation away.

### 7.2 Location & address
- **Purpose:** establish "where am I shopping" — the anchor for all discovery.
- **Elements:** "use current location" (permission optional), manual pin-code/address search, map-pin fine adjustment, saved-address list, delivery instructions field.
- **States:** no permission granted (manual entry works fully), address outside any service zone (clear message + "request a shop" CTA), address confirmed.

### 7.3 Home / discovery
- **Purpose:** the default landing screen once a location is set.
- **Hierarchy:** Home is adaptive rather than one fixed marketplace grid.
- **First-time customer:** location/address → concise neighbourhood-store proposition with one real storefront image → search by shop/item/category → launched categories → nearby stores. The first screen must make "buy from a local shop you trust" unmistakable before showing a large result set.
  - The mobile first viewport uses a compact location header, prominent search, horizontally scrollable illustrated category shortcuts, and immediately visible store/product recommendations. It feels fast and familiar without promising a fixed delivery time.
  - **Returning customer with a preferred store:** location/address → preferred store with open/next-slot state and a primary "Shop again" action → recent order/reorder shortcut → search → nearby discovery.
  - **Returning customer without a preferred store:** location/address → search → recently used stores → nearby stores, with a quiet prompt to mark one store as preferred after a successful order.
- **Elements:** location bar (tap to change), search bar, launched-category shortcuts (Vegetables, Kirana, Bakery, etc.), preferred-store feature when applicable, "Stores near you" results (name, logo, distance, open/closed, next slot, delivery fee from, rating or "New", min order), and recent orders where relevant. Pharmacy is hidden until compliance approval and launch enablement; category-demand research uses the generic "Request a shop/category" flow instead.
- **States:** zero eligible stores in area (empty state + "request a shop"), all stores closed (still listed, marked closed with next-open time), loading skeleton for slow networks.

### 7.4 Search & filters
- **Purpose:** find a shop, product, or category directly.
- **Elements:** search field with local-language synonym support, filter chips (category, delivery/pickup, open now, delivery fee, rating, dietary/specialty attributes, preferred stores only), result list mixing matching stores and matching products-within-stores.
- **States:** no results (suggest removing filters, matches Mercato's "couldn't find any stores" empty-state pattern), partial match with a "did you mean" suggestion.

### 7.5 Store profile (storefront page)
- **Purpose:** the named-vendor page — the emotional core of "buy from your trusted shop."
- **Hierarchy:**
  1. **Trust:** one dominant real storefront photograph, store name, verification state, rating or "New", favourite control, and "set as preferred store." Do not combine a large banner, logo, badges, and text into a competing collage.
  2. **Order feasibility:** open/closed or next-slot state, pickup/delivery eligibility, distance, minimum order, and estimated delivery fee. A customer should know whether and how the shop can serve them before browsing products.
  3. **Shopping:** search-within-store, category navigation, and catalogue. The primary shopping action remains visible as the customer scrolls.
- **Elements:** storefront photograph, logo or clean name-based fallback, store name, verification, rating or "New", distance, hours (with "closes in Xh" or "opens at Y"), minimum order, delivery fee summary, pickup/delivery toggle, category tabs, search-within-store, favourite/heart toggle, and "set as preferred store" action. Substitution, return, and other detailed policies live in a secondary disclosure sheet rather than the primary header. A vendor can publish without professional brand assets: the fallback uses its verified name, category treatment, and an admin-assisted storefront photo.
- **States:** closed-but-browsable; if the vendor accepts scheduled orders, customers can build a cart and choose the next slot. Otherwise show "notify me when open" and prevent order placement, not browsing. A paused/unpublished store reached by direct link shows a graceful "temporarily unavailable" state.

### 7.6 Category & product browse
- **Purpose:** shop a store's catalogue.
- **Elements:** category rail, product grid/list toggle, product card (image, name, unit/weight, price, offer badge, quantity stepper, availability state), sticky "View cart" bar once items are added.
- **States:** out-of-stock (dimmed, "Notify when available"), variable-weight items marked "~₹X per kg, final weight confirmed by vendor."

### 7.7 Product detail
- **Purpose:** full information before adding a quantity-sensitive or variable-weight item.
- **Elements:** image, description, unit basis, price, permitted weight variance (for loose items), substitution note for this item, quantity stepper, add-to-cart.
- **States:** for packaged items this can be a bottom sheet instead of a full page to keep the flow fast.

### 7.8 Cart
- **Purpose:** review a single store's order before checkout.
- **Elements:** store header (locked to one vendor, with a warning before switching stores clears or replaces the current cart per PRD §7.1), line items with editable quantity, item-level substitution preference, an order-level substitution control defaulted to **No substitutions**, promo code field, subtotal, and an estimated fulfilment cost. Customers may change the order default to **Best match**, **Contact me**, or **Vendor may replace within ₹X**, then override individual items. The interface states that no replacement is allowed unless the customer deliberately changes this control. Once an address and delivery mode are known, show store-to-customer distance, estimated delivery fee, the distance-pricing basis, pickup cost of ₹0 where applicable, and "final fee confirmed at checkout" until a valid quote exists. The outer delivery cap is 40 route km, but a vendor's configured zone, serviceability, and available delivery-partner capacity may make the actual eligible radius smaller.
- **States:** empty cart, attempted store switch while another vendor's cart exists (confirm replace or return to current cart), and an item becoming unavailable while the cart was idle (flagged inline and requiring acknowledgement before checkout).

### 7.9 Checkout
- **Purpose:** confirm fulfilment method, pay, and place the order.
- **Decision sequence:** checkout is one progressive mobile-friendly page ordered as fulfilment method → address or pickup point and slot → substitution rules → payment → final review. Each section shows a compact completed summary after resolution and remains directly editable.
- **Primary action:** a sticky total and contextual action always name the next required step: "Choose address," "Select a slot," "Choose payment," or finally "Place order." Activating it scrolls/focuses the first incomplete or invalid section. Never show an unexplained disabled action.
- **Elements:** delivery address or pickup point, pickup/delivery toggle, fulfilment timing, full fee breakdown (items, delivery fee with route distance and pricing basis, taxes, tip — optional, promo discount, total), prepaid payment method (UPI, cards, supported wallets), order notes, and a single "Place order" action that reflects the server-issued expiring quote (`architecture.md` §11.1). COD does not appear in the MVP. For the pilot, the delivery quote is **₹15 base + ₹8 for each route kilometre after the first 2 km**, up to a 40 route-km outer cap; the displayed quote must show route distance, included distance, per-km rate, and total. At 5 km the fee is ₹39; at 40 km it is ₹319. The formula version remains configurable and is stored with every order rather than silently recalculating historical charges.
- **Timing:** vendors configure ASAP and/or scheduled fulfilment independently for pickup and delivery. ASAP shows the earliest honest preparation/arrival window. Scheduled fulfilment uses 60-minute windows by default, subject to vendor/category configuration and capacity. Closed stores may accept a future window without implying immediate service.
- **States:** quote expired (auto-refresh with a visible "prices updated" notice — never silently re-charge), payment failed (retry without re-entering the whole cart), address outside the vendor's current service zone (blocks placement with a clear reason), and incomplete/invalid sections (show the problem inline and move focus to the first one). The sticky total remains visible while the customer resolves blockers.
- **Transactional recovery states:**

  | State | What the customer sees | Permitted action |
  |---|---|---|
  | Submitting | Locked order summary, progress label, and protection against duplicate taps | Wait or safely leave; no second submit |
  | Payment provider opened | Clear return-to-app expectation and retained checkout context | Complete/cancel in provider |
  | Payment pending or unknown | "Checking payment" with last-checked time and automatic reconciliation | Refresh status or contact support; never "Pay again" |
  | Payment authorized, order confirmation delayed | Confirmation that payment is safe while the order is being recovered | View status; support after a defined delay |
  | Failed with verified no-charge outcome | Specific failure reason where available and unchanged cart/quote context | Retry payment or choose another method |
  | Duplicate request recovered | Existing order confirmation rather than a second order | Open the existing order |
  | Manual review required | Case/reference number, expected response window, and protected order/payment state | Contact support; no duplicate payment |

  A customer returning from UPI, a browser interruption, or a reopened app resumes the authoritative transaction state. Provider UI alone never determines the final message.

### 7.10 Order tracking
- **Purpose:** show real, current status without over-promising.
- **Elements:** status stepper mapped to the order state machine (see Section 11 for the full mapping), vendor contact (masked/protected channel), estimated ready/arrival window framed as an estimate, pickup/delivery OTP prominently displayed when relevant, and cancel-order action while still eligible. Status tracking is always available; continuous rider location appears only when platform delivery, partner consent, privacy policy, and technical reliability allow it, with a last-updated time and status-only fallback.
- **States:** `AWAITING_CUSTOMER_DECISION` interrupts tracking with the substitution modal (7.11) rather than silently continuing.

### 7.11 Substitution / customer-decision modal
- **Purpose:** the customer approves, rejects, or requests contact for a vendor-proposed change.
- **Elements:** what changed (item, weight, price delta), the customer's saved preference reminder, three actions (approve / reject / "call me instead"), updated total preview.
- **States:** decision window expiring (countdown consistent with the SLA in `prd.md` §8), decision already made by a previous notification tap (idempotent — reopening shows the recorded choice, not a second prompt).

### 7.12 Order history & reorder
- **Purpose:** revisit past orders, matching the one-tap-reorder pattern.
- **Elements:** order list with store, date, total, status; order detail with receipt; "Reorder" button that rebuilds a cart from the same vendor with current prices/availability (never the old snapshot).
- **States:** reorder is allowed for the next available slot when a closed vendor accepts scheduled orders. It is blocked if the vendor is unpublished or accepts neither immediate nor scheduled orders, with a clear explanation and optional substitute-store suggestions.

### 7.13 Favourites / My Stores
- **Purpose:** the loyalty surface — "shop where you already trust."
- **Elements:** grid of favourited stores, one marked "Preferred" (drives Home's pinned card), quick reorder-from-favourite shortcut.

### 7.14 Profile & settings
- **Purpose:** account, addresses, payment methods, notification and language preferences, consent management.
- **Elements:** saved addresses (edit/delete), saved payment methods, notification toggles, language, help/legal links, delete-account/request-data entry point (routes to policy, not an AI-invented flow — see `rules.md` §9).

### 7.15 Support / help & issue reporting
- **Purpose:** self-serve first, human escalation second.
- **Elements:** order-linked issue categories (late, missing, damaged, wrong item, quality), photo attachment, resolution status, chat/ticket thread.

### 7.16 Ratings & review
- **Purpose:** post-completion feedback that feeds vendor health (`prd.md` §7.3).
- **Elements:** verified-order star rating, optional item-level tags, optional text, and report/moderation controls; prompt only after `COMPLETED`. New vendors show "New" instead of an unstable score until the configured minimum number of eligible reviews is reached.

### 7.17 Notifications centre
- **Purpose:** in-app record of every push/SMS the order lifecycle generated.
- **Elements:** chronological list, tap-through to the relevant order/decision screen.

### 7.18 "Request a shop"
- **Purpose:** capture demand outside current coverage, feeding the vendor pipeline in Admin.
- **Elements:** shop name/area free text, category, optional contact consent.

## 8. Vendor Portal

### 8.1 Onboarding wizard
- **Purpose:** get a store from "invited" to "live" with minimum typing, on a phone browser.
- **Elements:** a resumable sequence: create store → verify owner/business → set address, hours, and fulfilment → add the first catalogue items → configure payout → complete a test order → go live. Licence and identity upload are camera-first; every step explains whether it blocks review, payout, or publication.
- **States:** incomplete/resumable, documents pending, under review, rejected-with-actionable-reason, approved-awaiting-first-catalogue, test-order required, and ready to publish.

### 8.2 Home / order queue dashboard
- **Purpose:** the screen a vendor lives in during store hours.
- **Hierarchy:** this is an urgency-ranked action queue, not a chronological archive. New orders nearest response-SLA expiry appear first, followed by a rider waiting at the shop, customer-decision exceptions, other blocked/delayed orders, routine picking, and ready orders. Each row names the next required action and shows meaningful time remaining or elapsed. State filters remain available without overriding urgency by default.
- **Elements:** new-order alert banner (largest element when present), urgency-ranked active-order list, state filters (New, Preparing, Ready, Awaiting customer), and a secondary today's summary (orders, sales, acceptance rate). On mobile this is the post-login default and uses large one-handed actions rather than a compressed desktop table.
- **States:** offline/temporarily-closed toggle clearly visible and one tap to set.

### 8.3 New order alert
- **Purpose:** force a fast accept/decline within the configured SLA.
- **Elements:** full-width modal/screen with items, customer notes, prep-time selector, Accept / Decline-with-reason, visible countdown to auto-cancel.
- **States:** SLA missed → auto-cancel, logged to vendor health per `prd.md` §8; combined push + SMS escalation per `architecture.md` §6.2.

### 8.4 Order detail & picking
- **Purpose:** work through a single order's pick list.
- **Elements:** checklist of items, per-item "unavailable / substitute / confirm weight" actions, running total, "Mark ready" / "Hand to delivery partner" primary action.
- **States:** waiting on a customer decision (order paused, clearly labelled, cannot be marked ready until resolved).

### 8.5 Substitution / weight-entry
- **Purpose:** propose the change that then goes to the customer-decision modal (7.11).
- **Elements:** substitute product picker within the vendor's own catalogue, final-weight numeric entry with the permitted variance shown, price recalculation preview, message-template picker ("Please approve this substitute").

### 8.6 Catalogue list
- **Purpose:** manage what's sellable.
- **Elements:** searchable/filterable product table, bulk availability toggle, low-stock flags, category grouping.

### 8.7 Add/edit product
- **Purpose:** single-product CRUD.
- **Elements:** name, category, brand, description, image upload, unit, base price, tax, stock status, variable-weight toggle + variance %, substitution suggestions.

### 8.8 CSV import
- **Purpose:** bulk catalogue creation for vendors who won't type each item.
- **Elements:** template download, upload, row-level validation report, per-row error correction before commit.

### 8.9 Store settings
- **Purpose:** the operating parameters that drive discovery and fulfilment eligibility.
- **Elements:** hours, holiday/temporary-closure control, service radius/zone map, minimum order, prep-time/lead-time, delivery fee rule reference (platform-calculated, vendor cannot silently override per `prd.md` §8), delivery mode (self-delivery / platform pilot / pickup only).

### 8.10 Staff & roles
- **Purpose:** least-privilege multi-user access for one store.
- **Elements:** staff list (owner/manager/picker), invite by phone, per-role permission summary, activity log entry point.

### 8.11 Insights dashboard
- **Purpose:** "is this working for my shop."
- **Elements:** orders, gross sales, net payout estimate, acceptance rate, cancellation rate, average prep time, rating trend, repeat-customer rate.

### 8.12 Settlement ledger
- **Purpose:** trust in the money.
- **Elements:** per-order line (sale, commission/platform fee, payment fees, refunds/adjustments, tax, payout status), downloadable statement, filter by date/payout batch.

### 8.13 Customer messaging
- **Purpose:** protected, template-first communication.
- **Elements:** a support-visible thread per order, approved template shortcuts, optional free text, delivery/read state, and a masked-call escalation for approved active-order reasons. Personal numbers are never displayed. Masked-call access expires after the order/support window; the event is auditable without recording call content by default.

### 8.14 Notifications & escalation settings
- **Purpose:** control how loudly the vendor is alerted.
- **Elements:** push/SMS toggles per event type, per-staff routing.

## 9. Delivery Partner App/Portal

### 9.1 Onboarding & documents
- **Purpose:** identity, vehicle, bank, and insurance verification before a partner can go online.
- **Elements:** camera-first document capture (ID, driving/vehicle doc, bank, insurance), service-area and vehicle-type selection, emergency contact, short in-app training checklist (pickup etiquette, customer privacy, safety, cash handling if enabled).
- **States:** applied → documents pending → under review → approved / rejected-with-reason, matching `prd.md` §7.4.

### 9.2 Account status
- **Purpose:** show why a partner can or cannot go online right now.
- **Elements:** current state, missing items, expiry reminders for time-bound documents, suspended-state reason if applicable.

### 9.3 Home / availability
- **Purpose:** the default screen when idle.
- **Elements:** large online/offline toggle, active-zone selector, today's summary (trips, earnings so far, online time), battery/data-use tip.

### 9.4 Job offer card
- **Purpose:** a fast accept/decline decision with only the information needed to decide.
- **Hierarchy:** expected payout is the visual anchor; total estimated time and distance are second; safety, return, package, handling, and vehicle constraints are third. Approximate pickup/drop-off and distance breakdowns sit inside an expandable "Trip details" area rather than competing with the decision summary.
- **Elements:** expected pay (+known tip if any), estimated total distance/time, pickup-by deadline, expected vendor wait where known, prominent unsafe-area/return/heavy/fragile/vehicle-mismatch warnings, and expandable approximate pickup/drop-off areas with partner-to-vendor and vendor-to-customer distances. Accept / Decline remain fixed, one-handed actions; declining an unsafe or impractical offer is never penalised.
- **States:** offer auto-expires after a short configurable window and reissues to the pool.

### 9.5 Active job flow (full-screen, one state at a time)
- **Purpose:** the field workflow, screen-per-state to match the assignment machine in `architecture.md` §10.
- **Elements per state:**
  - `ASSIGNED → navigating to vendor`: exact vendor address, in-app "open in maps" handoff.
  - `AT_VENDOR`: pickup confirmation entry point (9.6).
  - `PICKED_UP → EN_ROUTE_TO_CUSTOMER`: now-revealed customer address and any handling notes, masked customer contact, "open in maps."
  - `ARRIVED`: delivery confirmation entry point (9.7).
- **Notes:** the active job and last confirmed state are cached locally so a dropped connection does not erase progress, per `architecture.md` §6.3.
- **Navigation and safety:** an active job prevents accepting another job but does not block navigation. A persistent "Resume active job" control returns to the current step, while Support, Emergency, and essential Profile controls remain available at all times.

### 9.6 Pickup confirmation
- **Elements:** QR/barcode scanner or manual OTP entry, item count and package count checklist, vendor handoff note field.
- **States:** scanning/validating, invalid or expired proof, camera permission unavailable (manual entry remains available), proof saved offline, synchronizing, server-confirmed pickup, and support review. A locally saved proof does not display server-confirmed success.

### 9.7 Delivery confirmation
- **Elements:** customer OTP entry (default proof), photo/signature only where policy explicitly allows, "Mark delivered" action.
- **States:** validating, invalid/expired OTP, approved alternative-proof consent, proof saved offline, synchronizing, server-confirmed delivery, rejected proof, and support review.

### 9.7.1 Offline proof recovery

- Proof awaiting upload is encrypted locally, tied to the active assignment, and labelled "Proof saved, waiting to sync" with the last retry time.
- The assignment remains active and another job cannot be accepted until the server confirms the proof or support resolves the exception.
- Automatic retry is idempotent. Repeated taps or reconnections cannot produce multiple state transitions.
- After the configured retry threshold, the app exposes a one-tap support escalation with the assignment/reference ID and safe diagnostic metadata.
- Sensitive local proof is removed after verified server synchronization or according to the approved expiry/recovery policy.
- The partner may leave the handoff location after following the approved offline-proof checklist; the UI must not imply that server confirmation has occurred.

### 9.8 Exception flows
- **Purpose:** guided, non-dead-end paths for the messy real-world cases.
- **Elements:** dedicated screens for vendor delay, missing package, damaged order, customer unreachable, wrong address, unsafe location — each ending in a clear next state (retry, return, cancel-with-reason, escalate to support) without exposing more customer contact detail than necessary.

### 9.9 Earnings & payouts
- **Purpose:** trust in pay.
- **Elements:** trip-level breakdown (base, distance/time, incentive, tip, adjustment, cash collected if enabled, net), daily/weekly rollups, payout history, bank details, downloadable statement.

### 9.10 Profile, training & support
- **Elements:** profile/vehicle info, performance metrics shown transparently (completed trips, on-time pickup, feedback) with a coaching/dispute path before any restriction, one-tap support and emergency assistance.

## 10. Admin Console

### 10.1 Login & role-based access
- **Purpose:** gate every module by role; every admin action is attributable.
- **Elements:** authenticated login, role/permission summary visible to the admin themselves.

### 10.2 Dashboard / overview
- **Purpose:** the first screen — a pulse check, not a rabbit hole.
- **Hierarchy:** use a shared risk order across admin roles: safety/security incidents → payment or ledger mismatches → ageing live-order exceptions → vendor/partner compliance blockers → routine pipeline work. Permissions determine which items an admin may open or act on, but not the meaning of severity.
- **Elements:** a risk-ranked action queue, ageing active orders, vendor/partner pipeline counts, and top alerts. Today's GMV and other summary metrics remain secondary so operational problems cannot be visually buried by dashboard cards.

### 10.3 Vendor pipeline
- **Purpose:** move a vendor lead through the stages defined in `prd.md` §7.3.
- **Elements:** kanban or filterable list across requested → invited → applied → documents pending → under review → test order → approved → live / paused / rejected; owner assignment; onboarding checklist.

### 10.4 Vendor detail & document review
- **Elements:** business profile, locations, licences with verification status and expiry, immutable reviewer notes, service-zone map editor, fee/commission config, publish/pause/unpublish action (reason required, logged). High-impact suspension, fee, or payout changes show an impact preview and enter a pending-approval state when policy requires a second approver.

### 10.5 Delivery partner review
- **Elements:** mirrors 10.3/10.4 for the partner pipeline (applied → documents pending → under review → approved/suspended/rejected/inactive), document verification, zone/vehicle assignment.

### 10.6 Catalogue & moderation
- **Elements:** cross-vendor product review queue, prohibited-item flags, bulk category taxonomy tools.

### 10.7 Live order monitor
- **Purpose:** operational awareness across the whole marketplace in real time.
- **Elements:** filterable table (vendor, state, exception flag, time-in-state), drill-in to order detail, manual-intervention actions gated by permission and always logged.

### 10.8 Order detail & intervention
- **Elements:** full order timeline (every state transition with actor, timestamp, reason — `architecture.md` §9), payment/ledger snapshot, and available intervention actions (cancel, refund, reassign). Every intervention shows the customer/vendor/partner and financial impact, requires a reason and confirmation, and enters pending approval above the configured risk or value threshold.

### 10.9 Support & dispute tools
- **Elements:** case queue, evidence viewer (photos, messages), resolution actions (refund, partial refund, credit), customer/vendor/partner profile lookup, fraud flags, blocklist management.

### 10.10 Zones, fees & commission configuration
- **Elements:** service-zone editor (radius/pin-code/polygon), delivery-fee formula parameters (base, included distance, per-km rate, thresholds, rounding, maximum radius), vendor per-completed-order fee configuration, affected-zone/order preview, effective date, and a "this changes a live business rule" confirmation. Material changes require a second approver; historical orders are never recalculated (`rules.md` §8).

### 10.11 Reporting
- **Elements:** city/zone/vendor/category dashboards (GMV, completed orders, take rate, active vendors/customers, repeat rate, fulfilment time, cancellations, refunds), vendor health score view, exportable reports with role-based access.

### 10.12 Audit log
- **Elements:** searchable, filterable, read-only record of every sensitive action (actor, action, target, before/after, reason, timestamp) — the UI surface for the audit module in `architecture.md` §7.

## 11. Order status → UI status chip mapping

| State machine value (`architecture.md` §9–10) | Customer-facing label | Vendor-facing label | Delivery-facing label |
|---|---|---|---|
| PLACED | Order placed | New order | — |
| ACCEPTED | Vendor confirmed | Accepted | — |
| PICKING | Being prepared | Picking | — |
| AWAITING_CUSTOMER_DECISION | Needs your approval | Waiting on customer | — |
| READY (delivery) | Ready for dispatch | Ready for rider | Collect from vendor |
| READY (customer pickup) | Ready for pickup | Awaiting customer | — |
| OUT_FOR_DELIVERY | On the way | Handed to rider | En route to customer |
| PICKED_UP (customer pickup path) | Picked up | Collected | — |
| DELIVERED | Delivered | Delivered | Delivered |
| COMPLETED | Order complete | Completed | Completed |
| CANCELLED / EXPIRED | Cancelled | Cancelled | Cancelled |

Delivery-assignment sub-states (OFFERED, ASSIGNED, AT_VENDOR, EN_ROUTE_TO_CUSTOMER, ARRIVED, DELIVERY_FAILED, RETURN_REQUIRED) are surfaced only inside the Delivery Partner active-job flow (9.5) and, in simplified form, inside customer order tracking (7.10) — the customer never sees internal assignment vocabulary like "OFFERED."

## 12. Shared components (structural inventory, not a visual kit)

| Component | Used in | Notes |
|---|---|---|
| Store card | Customer discovery, search | Name, logo, distance, open state, fee-from, rating, favourite toggle. |
| Product card | Category browse, cart | Image, unit basis, price, availability, quantity stepper. |
| Order card / row | Customer history, vendor queue, admin monitor | Same underlying status chip vocabulary (Section 11) rendered per audience. |
| Status stepper | Customer tracking | Linear progression with a distinct "needs your input" branch state. |
| Decision modal | Customer substitution approval | Never auto-dismisses; requires an explicit tap. |
| Fee breakdown block | Cart, checkout, vendor settlement | Same line-item pattern reused so the "transparent economics" principle is visually consistent. Cart may show an estimate; checkout shows the expiring server quote; settlement shows final posted amounts. |
| Reason-required action | Admin/vendor overrides, cancellations | Any state-changing action outside normal flow opens a reason field before it can submit. |
| Empty state | Every list screen | Explains why it's empty and offers the next best action (never a dead end). |
| Offline/low-connectivity banner | Vendor Portal, Delivery app | Shows cached data explicitly as "last updated at…" rather than pretending it's live. |

### 12.1 Card and container policy

- Use a card when the entire object is independently selectable or actionable: a store, product, order summary, or delivery offer.
- Customer store/product cards use one clear tap target, visible price/status information, and no decorative icon bubble or nested card.
- Vendor order queues, picking lists, settlement ledgers, and messages use flat priority rows or lists with dividers. Do not wrap every row and section in separate raised containers.
- Admin monitoring, reporting, audit, vendor pipelines, and configuration use tables, split panes, flat sections, and restrained summary bands. Metrics do not each require a card.
- Forms use headings, field groups, spacing, and dividers on the page surface. Do not place every form section inside a rounded card.
- Cards never contain another full card. A compact embedded line item is a row, not a second card.
- Shadows are reserved for floating layers such as menus, sheets, and modals. Persistent page hierarchy relies on typography, whitespace, alignment, borders, and light-neutral section changes.
- Do not use the same large radius on every component. Interactive cards, fields, chips, sheets, and media each use the approved radius token for their function.
- Avoid icon-in-coloured-circle decoration, symmetric three-card feature grids, coloured left-border cards, decorative gradients, blobs, and ornamental empty-state illustrations that do not help the task.

### 12.2 Quick-commerce-inspired customer direction

The customer App/Web should borrow the **speed and shopping clarity** of Blinkit/Zepto-style quick-commerce experiences, not their brand identity, dark-store business model, delivery claims, illustrations, copy, or exact layouts. These products lead with broad daily-needs discovery and rapid add-to-cart behaviour; Neighbourhood instead leads with the customer’s trusted named local vendor and an honest, distance-based fulfilment quote. Blinkit presents grocery and daily-essential shopping as a broad hyper-local catalogue, while Zepto foregrounds category-based grocery discovery. [Blinkit FAQ](https://blinkit.com/faq) · [Zepto](https://www.zepto.com/)

- **First screen:** the first mobile viewport is a retail surface, not an editorial landing page: compact sticky location header → wide warm-yellow search field → one horizontally scrollable category rail → preferred-store shortcut or nearby-vendor shelf. Do not place a large proposition/hero ahead of shopping once a location is known.
- **Category shortcuts:** use image-led, colourful light-background category tiles for high-frequency needs such as Vegetables, Fruits, Dairy, Staples, Snacks, Personal care, and Home care. Each tile is a 72–88 px square on mobile with a short label below or over a quiet image treatment. Use real product imagery or simple ownable category art, never Blinkit/Zepto mascots, illustrations, copy, or exact tile compositions.
- **Retail rhythm:** use short, scannable section names (“Buy again”, “Fresh today”, “From Rao Family Kirana”), compact product cards, visible price and unit, and an immediate `Add` button. Avoid long explanatory copy between shelves. The first 5 seconds should answer: where am I ordering, what do I need, and which shop is supplying it?
- **Store-first feed:** organise results as named vendor sections, not one anonymous cross-store product grid. A section can show a vendor header, delivery-from/distance, and a horizontally scrollable row of its popular products. Opening a product always identifies its vendor before it is added.
- **Fast add:** product cards show image, name, unit, price, availability, and a high-contrast compact `Add` control. Adding changes it to an inline quantity stepper, gives a brief 120–220 ms confirmation, and exposes a sticky cart bar. A cart may only contain one vendor; adding from another vendor invokes the existing replace-cart confirmation before changing state.
- **Cart visibility:** show a bright sticky bottom cart bar as soon as the cart is non-empty. It contains only item count, vendor name, current total, and `View cart`; delivery breakdown belongs in cart/checkout. The customer should always have one-tap return to the cart, but the bar must not hide product controls or system navigation.
- **Store identity stays visible:** every discovery card and product section includes a named vendor, not a generic fulfilment hub. Use a small real storefront photo or vendor mark where available, plus a “Verified local vendor” treatment when applicable.
- **Offer treatment:** use warm-yellow for shopping calls to action, coral for genuine limited offers, and pale mint for trusted/preferred-vendor signals. Price reductions, bundles, and category highlights must be truthful, time-bounded, and attributable. Never use fake urgency, misleading crossed-out prices, fabricated stock/discount counters, or a false “minutes” promise.
- **Mobile density:** customer cards can be more compact and visual than operational portals, but buttons retain a 48 px minimum target and text/price never fall below the typography tokens. Vendor, partner, and admin portals remain task-first and do not adopt promotional customer tiles. Desktop expands shelves from two to four product cards while retaining their horizontal, vendor-scoped grouping rather than turning the page into an anonymous catalogue grid.

### 12.3 Visual direction: white/light theme only

All customer, vendor, delivery-partner, and admin surfaces use a white/light visual system. A dark theme is not part of the product.

- **Page foundation:** white or warm off-white backgrounds; light neutral sections may separate dense operational areas without turning the interface dark.
- **Surfaces:** white cards, tables, sheets, menus, and modals with subtle borders or restrained shadows. Avoid large dark panels, black navigation shells, and dark full-screen states.
- **Text:** near-black or dark charcoal for primary text, medium neutral grey for secondary text, and accessible muted text. Never use pale grey text that fails contrast requirements.
- **Customer primary accent:** bright mango yellow is used for customer `Add`, cart, search focus, and shopping prompts, paired with near-black text. It may cover compact controls and the sticky cart bar, never an entire page background.
- **Operational primary accent:** evergreen remains the primary action colour for vendor, delivery-partner, and Admin workflows, where safety and action clarity matter more than retail energy.
- **Semantic colour:** green for success, amber for warnings, red for errors/destructive actions, and blue for neutral information. Always pair colour with text or an icon.
- **Imagery:** vendor and product photographs may contain any natural colours, but text must not be placed directly on busy imagery. Use a separate white information area or a light protective treatment.
- **Forms and navigation:** inputs, tabs, bottom bars, sidebars, and top bars remain white or light neutral with visible boundaries and focus states.
- **No dark mode:** do not implement a dark-mode toggle, automatic OS dark-mode conversion, or a separate dark token set. High-contrast accessibility must be achieved within the light theme.
- **Consistency:** the same light foundation applies during onboarding, checkout, maps, active deliveries, errors, loading, empty states, admin monitoring, and print/download previews.

#### Admin Console extended-shift treatment

- Use the warm off-white `Canvas` token for the page background and pure-white `Surface` for tables, drawers, forms, and focused work areas. Do not introduce dark navigation, dark monitoring panels, or an alternate dark mode.
- Primary text remains charcoal, secondary text remains contrast-compliant, and table/section boundaries use visible neutral borders rather than heavy shadows.
- Safety, money, live-order, and compliance states may use restrained light semantic tints, but every state also includes a label and icon. Large saturated status backgrounds are prohibited.
- Dense tables retain 44 px minimum interactive rows, sticky headers, visible keyboard focus, and an optional comfortable-density setting. Density changes spacing only, never colour contrast or text size below the approved tokens.
- Selected rows and active filters use the evergreen tint plus a non-colour indicator. Alternating row treatment, when needed for long tables, uses a very light neutral difference that remains visible under common display and brightness conditions.
- Extended-shift testing covers glare at high brightness, low-brightness readability, colour-vision deficiencies, 200% zoom, and prolonged scanning of live-order and ledger tables.

#### Signature imagery: real neighbourhood commerce

- Documentary photography of real storefronts, shop owners/staff, produce, shelves, packing, and customer-ready orders is the primary visual material.
- Vendor identity remains more prominent than the platform identity on storefront and reorder surfaces. The platform provides a consistent frame; it does not make every shop look identical.
- Photography uses natural or soft neutral light, truthful colour, uncluttered framing, and consistent crop ratios. Do not over-saturate produce, erase normal shop context, or imitate dark-store advertising.
- Avoid generic stock images, staged "perfect supermarket" scenes, fake AI shopkeepers, and decorative lifestyle photos unrelated to the named vendor.
- Text, prices, status, and primary actions sit on separate white/light surfaces rather than directly on photographs.
- Vendor onboarding includes a simple camera-first capture guide for storefront, owner/team (optional with consent), and representative products. Admin-assisted capture remains available.
- When usable photography is unavailable, use the verified vendor name, category treatment, and neutral light placeholder. Do not fabricate a storefront image.
- Product images prioritize recognition and unit/size accuracy over promotional styling; variable-weight produce may use vendor/category reference imagery clearly labelled when not item-specific.

#### Motion policy: feedback, not decoration

- Use motion only to explain a state change, preserve spatial continuity, or confirm a completed action.
- Approved uses: adding an item to cart, completing/collapsing a checkout section, progressing an order/assignment state, confirming pickup/delivery, opening a sheet/menu, and reconnecting/retrying after network loss.
- Typical feedback transitions complete in 120–220 ms; larger sheet/page transitions complete within 200–300 ms. Do not delay task completion to finish an animation.
- Animate `transform` and `opacity` where practical. Do not animate layout dimensions, position, or large shadows in ways that cause jank on low-end devices.
- Loading indicators communicate real waiting; they are not decorative looping animation. Skeletons match the shape and hierarchy of the content they replace.
- Success feedback remains visible/readable without relying on animation and never blocks the next task.
- Respect `prefers-reduced-motion`: replace movement with immediate state change, colour/label confirmation, and appropriate live-region announcements.
- Avoid autoplay carousels, parallax, decorative entrance sequences, pulsing promotional elements, confetti, and ornamental motion in operational portals.

#### Typography tokens

- **Display/vendor identity:** Anek variable family for customer-facing store names, major page headings, and restrained brand moments. Load only the script subsets required by approved launch languages.
- **Body/operational:** the appropriate Noto Sans script family for body copy, controls, forms, tables, ledgers, vendor operations, delivery operations, and Admin. Language switching must not produce a material hierarchy change.
- **Fallback:** a tested sans-serif fallback stack may prevent invisible text while web fonts load, but the approved fonts are the intended rendered design. Use `font-display: swap` and avoid layout shift through compatible metrics where possible.

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| Display | 36/42 desktop; 30/36 mobile | 650–700 | Customer Home proposition or rare major brand moment |
| H1 | 30/36 desktop; 26/32 mobile | 650–700 | One page title |
| H2 | 24/30 desktop; 22/28 mobile | 600–650 | Major section |
| H3 | 20/26 | 600 | Subsection, panel, or task group |
| Body | 16/24 | 400 | Default readable content |
| Body strong | 16/24 | 600 | Important value or short emphasis |
| Label | 14/20 | 500–600 | Visible form labels, table headers, chips |
| Caption | 12/16 | 500 | Timestamps and supplemental metadata only; never essential action text |
| Money/status number | 16–28 as context requires | 600–700 | Totals, payout, rider offer, SLA; use tabular numerals |

- Use sentence case for headings, buttons, tabs, and table headers. Avoid all-caps labels except short regulated abbreviations.
- Do not add letter spacing to lowercase body or control text. Long vendor/product names wrap or truncate according to the component contract without shrinking below the token.
- Prices, distances, times, quantities, order IDs, and ledger columns use tabular numerals and locale-correct INR formatting.
- Heading hierarchy follows document order and accessible semantics; visual size does not replace correct `h1`–`h3` structure.
- A screen uses one dominant heading. Operational screens may use compact H1/H2 tokens but never reduce body/action legibility to increase density.

#### Light-theme colour tokens

The values below are the starting token contract and must be contrast-tested in final component combinations. Do not scatter raw colour values through screens.

| Token | Proposed value | Use |
|---|---:|---|
| Canvas | `#F7F7F2` | Warm off-white page background |
| Surface | `#FFFFFF` | Cards, tables, fields, sheets, navigation |
| Surface subtle | `#F0F3EF` | Selected rows, grouped operational areas, skeleton base |
| Text primary | `#18221C` | Headings and body text |
| Text secondary | `#58635B` | Supporting text that still meets required contrast |
| Border | `#D8DED9` | Fields, dividers, tables, card boundaries |
| Customer mango | `#FFD84D` | Customer add controls, cart bar, search focus, shopping prompts |
| Customer mango pressed | `#E8BE27` | Customer control pressed state |
| On customer mango | `#18221C` | Text/icons on customer shopping controls |
| Customer coral tint | `#FFE5DC` | Truthful offer or seasonal category treatment |
| Primary evergreen | `#1F6B45` | Vendor/partner/admin primary actions, verified state, selected controls |
| Primary hover/pressed | `#155438` | Operational pointer/pressed state |
| On primary | `#FFFFFF` | Text/icons on primary evergreen |
| Primary tint | `#E8F3EC` | Preferred-vendor and quiet operational selection |
| Success | `#247A4A` | Confirmed positive state; always paired with label/icon |
| Warning | `#8A5700` | Time/risk warning; pair with pale amber surface |
| Danger | `#B42318` | Error/destructive state; pair with explicit language |
| Information | `#245E9B` | Neutral informational status and help |
| Visited link | `#5F4B69` | Distinguish visited informational links without changing action buttons |

- Mango covers customer shopping actions and evergreen covers operational actions; neither covers large page backgrounds. White/light neutral remains dominant everywhere.
- Vendor photography and products provide visual variety; the platform palette does not recolour or over-brand each vendor.
- Status colours are semantic and never replace text, icon shape, or position. Primary evergreen and success green require distinct labels/icons when both appear together.
- Disabled controls use a light neutral surface, readable neutral label, and disabled semantics; do not communicate disabled state through low opacity alone.
- Focus indicators use a high-contrast light-theme ring distinct from both the primary button fill and error border.
- Maps use an approved light map style. Route, pickup, drop-off, and service-zone encodings remain distinguishable without relying on red/green alone.
- Dark themes, black navigation surfaces, neon greens, purple/blue gradients, and large saturated colour fields are outside the approved direction.

#### Spacing, radius, elevation, and density tokens

**Spacing scale:** `4, 8, 12, 16, 24, 32, 48, 64` px. Use 4 px for icon/text micro-gaps, 8/12 px inside compact controls, 16/24 px for component padding and related groups, and 32/48/64 px for page sections. Avoid arbitrary values unless a documented optical correction requires one.

| Token | Value | Use |
|---|---:|---|
| Radius small | 6 px | Chips, compact tags, small controls |
| Radius control | 8 px | Fields, buttons, priority rows |
| Radius card | 12 px | Independently interactive store/product/order/offer cards |
| Radius sheet | 16 px | Mobile sheets and large floating layers |
| Elevation 0 | No shadow; border/divider as needed | Page sections, tables, rows, forms |
| Elevation 1 | Subtle short shadow | Sticky navigation/action bars only when separation is needed |
| Elevation 2 | Restrained floating shadow | Menus, popovers, sheets, modals |

- Nested radius follows `inner radius ≈ outer radius - gap`; do not repeat the same bubbly radius at every level.
- Customer shopping uses comfortable density: 48 px minimum controls, 16–24 px card padding, and clear separation between vendor identity, feasibility, and catalogue.
- Vendor and partner field work uses 48–56 px primary controls, generous separation around destructive/safety actions, and bottom-reachable actions on mobile.
- Admin uses compact-accessible density: 44 px minimum interactive rows/controls, denser non-interactive metadata, sticky table headers, and optional comfortable density for accessibility preference. It must not use tiny text to fit more columns.
- Responsive page gutters: 16 px on narrow mobile, 24 px on tablet, and 32 px on desktop, with a maximum readable width appropriate to each surface. Dense admin workspaces may use the full available width after navigation.

#### Icon and component-state rules

- Use one simple outlined icon family with consistent stroke and optical size. Filled variants may indicate a selected navigation state; ornamental mixed icon styles are prohibited.
- Standard icons render at 20 or 24 px inside a minimum 44 px target. Icon-only actions require an accessible name and tooltip on pointer devices.
- Every interactive component defines default, hover (where available), focus-visible, pressed, selected, disabled, loading, error, and success/confirmed states.
- Primary buttons use evergreen fill and explicit action labels. Secondary buttons use a light surface/border. Tertiary actions use text treatment. Destructive actions never borrow the primary green treatment.
- A page has one primary action per current decision context. Sticky actions may change label as the next required decision changes.
- Fields keep visible labels above or beside the input; placeholders show examples only. Validation appears near the field and in an accessible summary when multiple errors exist.
- Chips represent compact filters/status/choices, not general navigation or decorative categories. Selected state is visible beyond colour alone.
- Long vendor/product names use defined wrapping or two-line truncation; prices, status, and primary actions never disappear because a name is long.

### 12.4 Interaction state contract

Every core screen must design the states below. A shared component supplies visual consistency, but each screen owns its message, next action, and whether stale data remains actionable.

| Screen/feature | Loading | Empty / no result | Error / permission | Success | Stale / partial |
|---|---|---|---|---|---|
| Customer location & discovery | Preserve location shell; store-shaped skeletons | Explain coverage and offer "Request a shop/category" | Manual address after permission denial; retry service error | Confirm selected location without blocking modal | Show last-known results with timestamp; disable eligibility claims until refreshed |
| Customer search & filters | Preserve query and filter chips; result skeletons | Name active filters and offer clear/remove actions | Keep query; retry without clearing filters | Results announce count and current sort | Label incomplete results and allow refresh |
| Storefront & catalogue | Preserve vendor identity; product-shaped skeletons | Explain closed/empty category and offer another category or notification | Vendor unavailable, failed catalogue, or restricted access gets a specific next step | Added item confirms quantity and exposes cart | Show timestamp; adding items requires current server validation |
| Cart | Keep item rows and total placeholders stable | Warm empty state with return-to-store action | Flag affected line, preserve unaffected items, and focus first blocker | Quantity/substitution change confirms inline | Prices/stock labelled outdated; checkout requires revalidation |
| Checkout & payment | Use the transactional recovery states in 7.9 | Not applicable; return to cart if no eligible lines remain | Inline validation, verified no-charge failure, pending/unknown protection, or support review | Open existing confirmed order exactly once | Quote changes show old/new amounts and require acknowledgement |
| Order tracking & customer decision | Preserve latest confirmed state | Not applicable for a valid order link | Explain unavailable tracking/contact and preserve support access | Announce the confirmed state or recorded decision | Show last-updated time; never advance status optimistically |
| Customer history, favourites & notifications | List-shaped skeletons with stable navigation | First-use copy plus Shop/Find stores action; filtered empties offer clear filters | Retry while retaining filters/date range | Mutation confirmation with Undo where safe | Read-only last-known content with timestamp |
| Customer support & ratings | Preserve order context while loading | Explain no open case/eligible review and link to order history | Upload/send failure retains draft and evidence | Case/review reference and expected next step | Draft remains local; submitted status comes from server |
| Vendor onboarding | Step skeleton and saved-progress indicator | Resume at first incomplete step | Actionable rejection/permission reason without losing uploads | Name completed step and next publication blocker | Clearly distinguish local draft from server-saved progress |
| Vendor order queue & picking | Keep urgency order stable; row/checklist skeletons | "No orders need action" plus store availability state | Retry/recover per action; never silently revert | Confirm server state and move row to its new priority | Cached queue is labelled; state-changing actions require connectivity or an approved idempotent queue |
| Vendor catalogue & settings | Table/list skeletons; keep current filters | First product action or no-results correction | Retain edited values and identify failed fields | Saved state with timestamp; Undo low-risk availability where safe | Read-only by default; explicitly queue only low-risk availability changes |
| Vendor insights, settlements & messages | Preserve date/filter shell | Explain no completed orders/payout/message yet | Permission/provider errors show owner and next step | Export/message confirmation and reference | Label provisional totals and last reconciliation time |
| Partner onboarding & availability | Step/eligibility skeleton | Explain missing requirements | Actionable document/permission/suspension reason | Confirm eligibility or online state | Prevent going online if eligibility cannot be verified |
| Partner offer & active job | Preserve active assignment shell; time-sensitive live update | "No offers" with online/zone state | Keep current assignment and expose retry/support | Server-confirmed transition with clear next step | Show last confirmed state; use 9.7.1 for queued proof |
| Partner earnings & payouts | Preserve period and total placeholders | Explain no completed trips/payout yet | Keep period selection and show payout support path | Payout/export confirmation and reference | Label estimated versus settled earnings |
| Admin queues, reports & audit | Preserve filters/columns; row skeletons | Distinguish no incidents from no filter matches | Permission denial names required role; query failure retains filters | Mutation/export confirmation with audit/reference ID | Read-only snapshot with generated/last-refreshed time |
| Admin intervention & configuration | Load authoritative before/after state before enabling action | Not applicable | Conflict, second-approval, validation, or provider failure preserves the proposed action safely | Show effective state, actor, time, and audit ID | Mutations disabled until authoritative state refreshes |

Cross-surface rules:

- Stale content is readable with a visible timestamp. It is read-only unless a specific low-risk, idempotent offline action is approved in this document.
- Empty states explain why the area is empty, provide context, and offer one useful primary action. "No items found" alone is not acceptable.
- Recoverable errors preserve user input, filters, scroll context, and safe uploaded drafts wherever possible.
- Permission errors do not masquerade as empty data. They state that access is unavailable and provide the appropriate support/admin path.
- Successful money, order, assignment, document, and admin actions display a server reference or audit identifier where one exists.
- Destructive actions show impact before confirmation; high-risk actions also show pending second approval when required.
- Assistive technology receives status updates through appropriate live regions without moving focus unexpectedly.

## 13. Accessibility and localization

- Launch with English plus the pilot neighbourhood's primary local language, selectable at onboarding and in Profile settings; INR formatting throughout. The exact local language is chosen from the pilot area and applies consistently to customer, vendor, delivery-partner, and Admin surfaces.
- Translation is task-complete, not decorative: core ordering, fulfilment, payout, safety, support, consent, and error flows must be available in both launch languages. New languages require translated operational copy, language-appropriate Noto Sans script assets, 30% expansion testing, and support-content review before release.
- Minimum 44×44 px tap targets across all surfaces, with extra spacing for destructive or safety-critical vendor and delivery actions.
- Body text is at least 16 px; essential text and controls meet WCAG AA contrast against the light background.
- Screen-reader labels on every icon-only control (favourite heart, status chips, OTP fields).
- Text must not depend on colour alone for status meaning (pair every status chip with a label, not just a colour).
- Keyboard navigation and visible focus states on customer web and the Admin Console; focus indicators must remain clear on every white/light surface.
- Customer, vendor, delivery-partner, and admin web/PWA surfaces support equivalent keyboard and switch-control operation for every core task; touch remains optimized but is not the only input method.
- OTP inputs support paste and platform autofill; form errors are placed beside the affected field and announced to assistive technology.
- Motion respects reduced-motion preferences, and layouts tolerate at least 30% text expansion for translated labels without clipping controls.

### 13.1 Responsive layout contract

Use content-driven breakpoints, starting with these test widths: compact mobile 360–479 px, large mobile 480–767 px, tablet 768–1023 px, desktop 1024–1439 px, and wide desktop 1440 px+. Every core flow must also be tested at 200% zoom and with 30% longer translated labels.

| Surface / workflow | Mobile | Tablet | Desktop / wide |
|---|---|---|---|
| Customer Home & search | One vertical hierarchy; horizontally scrollable categories only when every item remains reachable; preferred/reorder feature above nearby results; one store per row on compact mobile | Two-column store results with persistent location/search | Three or four result columns within a max-width content area; relationship/reorder area remains visually dominant rather than becoming another grid row |
| Storefront catalogue | Trust and feasibility header followed by sticky search/category control; one product row or two compact columns according to image/label length; sticky cart action above bottom nav | Two/three catalogue columns; category rail may become a side list | Persistent category/navigation column where useful, three/four product columns, cart access in top shell; do not stretch text/media beyond defined widths |
| Cart & checkout | One progressive column; sticky bottom total/contextual action respects keyboard and safe area | Main decision column plus collapsible order summary | Two-column layout with decision flow left and sticky order/fee summary right; tab/focus order follows the visual sequence |
| Order tracking | Current state/action first; compact timeline; light map only when available, useful, and privacy-approved | Status/timeline beside optional map or fulfilment detail | Timeline/detail and optional map use a balanced split; support/receipt remain secondary |
| Vendor order queue | Urgency-ranked vertical rows; bottom-reachable actions; one order detail at a time | Queue/detail split when width allows; otherwise preserve mobile navigation | Persistent urgency queue beside selected order/picking detail; metrics occupy a secondary band, not card mosaic |
| Vendor picking | Full-screen progressive checklist with sticky next/ready action; long orders support category grouping and progress | Checklist plus order/change summary | Two-pane checklist and change/financial summary; customer-decision block interrupts the relevant item rather than the full layout |
| Vendor catalogue/settings/ledger | Priority rows and dedicated edit screens; essential columns only; exports available without forcing a wide table | Adaptive table with detail sheet | Table/list with sticky headers, filters, column controls, and side-panel editing; no horizontal page scroll |
| Partner offer | One glanceable pay → effort → risk composition with fixed Accept/Decline | Same hierarchy with optional light route preview beside details | Centred bounded offer; additional width does not reveal private details or turn it into a dashboard |
| Partner active job | One state at a time; bottom action safe area; light map/list toggle; persistent Support/Emergency; landscape preserves action and next instruction | Map and instruction split if it remains one-task focused | Larger map/detail split for dispatch desk use, while the partner PWA remains mobile-first |
| Partner earnings/profile | Period summary followed by flat trip rows; filter sheet | Two-column summary and trip list | Bounded readable ledger with trip detail panel |
| Admin dashboard/queues | Emergency tablet/mobile access shows risk-ranked priority rows and essential interventions only; complex configuration warns that desktop is recommended but does not create a dead end | Collapsible sidebar, priority table/list, detail drawer | Persistent sidebar; risk queue/table plus detail side panel; full-width operational workspace after navigation |
| Admin tables, audit, reports | Essential columns become labelled priority rows; filters in a sheet; exports remain available | Adaptive columns with horizontal region scroll only inside an explicitly labelled table container | Sticky headers, column controls, filter bar, saved views where approved, and detail side panel; no nested cards |
| Zone editor / address map | Search and structured address/zone list remain primary; map is a light-style optional editing aid | Map/list split with resizable emphasis | Map and structured zone data split; all map-created geometry has an equivalent named list/field representation |

Cross-responsive rules:

- Bottom navigation and sticky actions use `env(safe-area-inset-*)`; no important control sits behind device UI.
- No page-level horizontal scroll at 360 px. Wide tables may scroll inside a labelled, keyboard-accessible region with visible affordance.
- Navigation, cart, alerts, and active-order indicators share a chrome budget: one bottom navigation, one contextual sticky action, and at most one compact live-status banner.
- Virtual keyboards must not cover the focused field, validation, or sticky action. Do not autofocus on mobile unless the user explicitly opened a focused task such as Search.
- Maps never become the only way to read or edit an address, route step, or service zone.
- Images use explicit aspect ratios and responsive sources to prevent layout shift; crops preserve storefront recognition rather than decorative composition.
- Responsive changes never reorder the accessible reading/focus sequence into a different meaning than the visual order.

### 13.2 Accessible time limits

- Every timer states why time is limited, when it expires in local time, what happens at expiry, and whether more time is available. Do not rely on a rapidly changing visual countdown alone.
- Announce meaningful thresholds through a polite live region rather than every second. Use calm visual warnings before the final threshold; do not use flashing or panic animation.
- **Customer substitutions/price decisions:** warn before expiry and offer a one-tap extension when vendor/order policy can safely hold the order. If extension is unavailable, explain the configured fallback (skip item, keep original where possible, contact/support, or cancellation) before expiry.
- **Vendor order acceptance:** show received time, remaining response window, and one primary accept/decline action; escalate through push/SMS according to policy. If the SLA expires, show that the order was safely expired/cancelled and provide the next operational step. Do not present a non-functional extension.
- **Partner job offers:** announce the offer and expiry once, keep Accept/Decline reachable, and clearly show when another partner has received or accepted it. Expiry returns to the available state without penalty or error language.
- Focus never jumps when a warning appears. Screen-reader and switch-control users retain access to the same decision and recovery actions.
- Testing covers slow reading, screen readers, switch/keyboard navigation, background/foreground transitions, interrupted notifications, and device clocks that differ from server time.

### 13.3 Equivalent interaction and assistive technology

- Each surface exposes a logical landmark structure, one page heading, predictable navigation order, visible focus, skip links where repeated navigation exists, and focus restoration after sheets/modals close.
- Dynamic order, offer, customer-decision, payment, synchronization, and admin-approval updates use appropriate live regions. Do not repeatedly announce timers, map movement, or background refresh noise.
- QR/barcode scanning always has a manual order/OTP entry path. Camera document capture has file upload and save/resume alternatives. Denied permissions explain how to continue.
- Current location is optional. Address, service zone, pickup, and route tasks provide searchable text/list/form alternatives; map pins and polygons are not the sole representation.
- Drag-and-drop catalogue, pipeline, zone, or priority interactions also provide buttons/menus and keyboard commands with the same result.
- Gesture actions such as swipe-to-delete or pull-to-refresh have visible button alternatives. No critical action relies on long press, precision dragging, colour, vibration, sound, or motion alone.
- OTP controls support paste/autofill and a single-field accessible representation where possible; individual visual boxes must not create a broken screen-reader sequence.
- Error summaries link/focus the affected field or item. Successful submission announces the outcome and reference without unexpectedly moving the user away from their current context.
- At 200% zoom/reflow, required content and actions remain available without two-dimensional page scrolling, except explicitly bounded data tables/maps with an equivalent list representation.
- Accessibility acceptance testing covers screen reader + keyboard/switch flows for: customer checkout and substitution, vendor accept/pick/handoff, partner offer/pickup/delivery proof, and admin refund/configuration approval.

## 14. Low-end-device and offline-tolerant patterns (Vendor Portal, Delivery Partner app)

- Optimistic UI is allowed for low-risk actions (e.g., toggling item availability) but must show a clear retry state if the server rejects it — never a silent revert (`architecture.md` §6.2).
- The active delivery job and its last confirmed state persist locally so a dropped connection mid-delivery does not lose context (`architecture.md` §6.3).
- Image-heavy screens (catalogue, product photos) load progressively and degrade gracefully on slow networks.
- Every state-changing action from these two surfaces uses an idempotent submit, so a duplicate tap from a slow network cannot double-accept an order or double-confirm a delivery.

## 15. Notifications and messaging design

- The in-app notification centre records every material order event. Push is reserved for actions or milestones the user needs to notice: decision required, accepted, ready, out for delivery, delivered, cancelled, or payment problem.
- SMS is used for OTPs, critical payment/customer-decision events, and escalation when a vendor new-order alert remains unacknowledged. Repeated events are grouped so retries do not create notification spam.
- Users can control non-critical notifications; safety, security, payment, and active-order messages remain mandatory where policy requires them.
- Vendor↔customer messaging is template-first with a support-visible log — free text is available but templates reduce response time for common cases (substitution approval, delay notice).

## 16. Explicit design non-goals for this MVP

Matching `README.md` and `rules.md` anti-goals, this design intentionally does **not** include:

- A multi-store/multi-vendor cart or split-fulfilment checkout UI.
- Any UI implying owned inventory or a platform "dark store."
- A 10-minute or other fixed fast-delivery promise anywhere in copy or UI.
- Automated route-optimisation visuals (manual/simple dispatch only, per `architecture.md` §25).
- A pharmacy ordering flow or customer-visible pharmacy category. No pharmacy tile, prescription upload, product listing, or checkout path appears until compliance sign-off and explicit launch enablement.
- Advertising, sponsored ranking, or pay-to-win placement in discovery or search.
- Native-app-specific interactions (e.g., deep OS-level background location UI) beyond what a responsive web/PWA can express, until a native app is justified by evidence.

## 17. Open design decisions requiring product input

No unresolved design decisions remain for the current MVP UI. Future changes to pricing, service zones, languages, COD, pharmacy, or delivery operations require a new product and design review before they appear in the interface.

### 17.1 Resolved during design review

| Decision | Resolution |
|---|---|
| Fulfilment timing | Vendors may enable ASAP, scheduled 60-minute windows, or both, separately for pickup and delivery. Only available/capacity-backed promises appear to customers. |
| Map UI dependency | Design a provider-neutral light map experience behind the architecture's maps adapter. Address/list/form alternatives, states, attribution space, and map behaviour are specified before selecting a paid provider. |
| Vendor–customer contact | Use template-first in-app messaging with optional free text and masked calling for approved active-order escalation. Personal numbers remain hidden; access expires and communication events are auditable. |
| MVP payment mode | Prepaid only: UPI, cards, and supported wallets. COD remains hidden until a separate cash-handling, reconciliation, safety, and dispute policy is approved. |
| Substitution default | Default every new order to **No substitutions**. Customers may explicitly choose best match, contact me, or vendor replacement within a stated price limit at order or item level; vendors never replace silently. |
| Admin extended-shift theme | Use a warm off-white canvas with white work surfaces, charcoal text, visible neutral borders, and restrained light semantic tints. Dark navigation, dark monitoring panels, and dark mode remain prohibited. |
| Launch languages | Launch in English plus the pilot neighbourhood's primary local language. Both languages cover core customer, vendor, partner, and Admin tasks and are tested for script rendering and text expansion before release. |
| Pilot delivery fee and radius | Quote ₹15 base plus ₹8 per route kilometre after the first 2 km, up to a 40 route-km outer cap. Show distance, pricing basis, and total before payment; actual eligibility may be smaller due to vendor zones, serviceability, and partner capacity. |

## 18. How this maps to the build sequence

Per `architecture.md` §27, screens should be built in the same order as the backend slices, not all at once:

1. **Pilot:** no production UI — manual order forms and a shared dispatch board substitute for Sections 7–10.
2. **Foundation + Order core:** 7.1–7.10 (customer auth through tracking), 8.2–8.4 (vendor queue and picking), minimal 10.3–10.4 (vendor approval) so a real vendor can go live.
3. **Fulfilment:** 9.1–9.7 (delivery partner onboarding through delivery confirmation), 7.11 (substitution modal), 10.5 (partner review).
4. **Money:** 8.12 (settlement ledger), 9.9 (partner earnings), fee breakdown consistency across 7.9/8.12.
5. **Operations:** 10.7–10.12 (monitor, intervention, support, reporting, audit), 8.9–8.11 (fuller vendor self-service), 7.12–7.18 (retention features: reorder, favourites, ratings, notifications centre).

Each slice should ship a complete, supportable set of screens for its scope rather than a partial screen from every surface at once.

## 19. Design review handoff

### 19.1 What already exists

- This document defines the four portal information architecture, navigation, core workflows, responsive layouts, interaction states, accessibility contract, and light-only visual tokens.
- `prd.md` defines the marketplace scope and operational requirements; `architecture.md` defines domain boundaries, authoritative state, quoting, and integrations; `rules.md` defines AI, safety, and product boundaries.
- No production component library, mockups, or application UI exists yet. The gstack mockup generator was unavailable during this review, so implementation begins from this written design contract.

### 19.2 Explicitly not in scope

- Dark mode, dark navigation, or dark monitoring screens. The product remains light themed across every portal.
- A multi-vendor cart, dark-store inventory, a fixed fast-delivery promise, sponsored placement, or automated route-optimisation visuals.
- COD, pharmacy ordering, or a customer-visible pharmacy category until their separately defined risk, compliance, reconciliation, and support policies are approved.
- A guarantee that every vendor can deliver to the 40 km outer cap. A vendor's zone, route serviceability, and available partner capacity determine actual eligibility.

### 19.3 Implementation tasks

- [ ] **T1 (P1, human: ~1 day / CC: ~30 min)** — Customer checkout — implement the server-backed fee quote with route distance, included kilometres, per-kilometre rate, expiry, and no duplicate payment path.
  - Surfaced by: Pass 2 and D30 payment recovery and delivery-fee decision.
  - Files: checkout UI, quote API client, pricing configuration, payment recovery tests.
  - Verify: a 5 km quote displays ₹39; a 40 km quote displays ₹319; unavailable routes block checkout with a clear reason.
- [ ] **T2 (P1, human: ~1 day / CC: ~45 min)** — Shared UI foundations — implement the white/light tokens, Anek/Noto typography, component states, focus styles, and role-based density before portal screens.
  - Surfaced by: Passes 4–6 design-system and accessibility decisions.
  - Files: global design tokens, font loader, shared controls, visual regression fixtures.
  - Verify: no dark surface is rendered; primary text and controls meet contrast and 44 px target requirements.
- [ ] **T3 (P1, human: ~1–2 days / CC: ~1 h)** — Accessibility and responsive acceptance suite — cover checkout, vendor fulfilment, partner proof, and admin intervention on mobile, keyboard, screen-reader, low-network, and 200% zoom paths.
  - Surfaced by: Pass 6 responsive and equivalent-interaction decisions.
  - Files: end-to-end tests, accessibility tests, responsive fixtures, offline queue tests.
  - Verify: every critical task has a keyboard/list/form alternative to maps, cameras, QR scanning, and touch-only gestures.
- [ ] **T4 (P2, human: ~1 day / CC: ~30 min)** — Localisation foundation — support English plus the pilot area's primary language for all core customer, vendor, partner, and Admin workflows.
  - Surfaced by: D29 launch-language decision.
  - Files: translation catalogues, locale formatter, font subsets, language QA checklist.
  - Verify: 30% longer translations, script rendering, prices, timers, and error flows fit without clipping.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | Not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | Not run |
| Eng Review | `/plan-eng-review` | Architecture & tests | 0 | Required | Not run |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | Score: 7/10 → 10/10; 27 decisions added |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | Not run |

**CROSS-MODEL:** Independent design review identified the hierarchy, recovery-state, visual-token, responsive, and accessibility gaps addressed in this plan.

**VERDICT:** Design review cleared. An engineering review is required before implementation.

NO UNRESOLVED DECISIONS
