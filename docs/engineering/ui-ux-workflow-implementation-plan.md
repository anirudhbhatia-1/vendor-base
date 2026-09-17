# Connected UI/UX implementation plan

**Date:** 6 September 2026
**Status:** Customer shell/entry/account implementation in progress; initial desktop/mobile browser checks completed; full role/device audit pending
**Authority:** PRD, FEATURES, workflow, architecture, design, phases and D-15. This plan changes interaction implementation, not business policy or production authority.

## 1. Review evidence and limits

**Implemented repair checkpoint — 7 September 2026:** [Batch 01](repair-batch-01-evidence.md) connects customer OTP enrolment and login recovery, preserves the requested return page, and adds explicit partner proof-check failure states. No new visual redesign was performed. Backend/BFF/policy tests and typechecks are not full authenticated browser or native acceptance.

**Repair execution update — 7 September 2026:** Follow the [connected marketplace repair plan](connected-marketplace-repair-plan.md) for startup, identity, API wiring and cross-role workflow repair, and its [all-feature register](connected-marketplace-feature-register.md) for every canonical feature and phase-step mapping. This UI/UX plan remains the design companion. Its earlier checkpoints are bounded evidence, not acceptance of the complete eight-client product. No new redesign should conceal a broken API, missing role enrolment, unverified payment/proof or incomplete native task.

The customer URL initially returned connection refused. Subsequent local browser checks are recorded in section 9. They do not establish full contrast/accessibility compliance, authenticated journey success or Android device verification.

| Finding | Evidence | Impact / required correction |
|---|---|---|
| Existing visual foundation is worth retaining | packages/ui-tokens/src/tokens.css | Mango, evergreen, light surfaces, Anek Devanagari/Noto Sans, spacing and focus tokens already exist. Consolidate usage instead of introducing another design system. |
| Separate customer PWA routes already exist | apps/customer-pwa/app/**/page.tsx; customer-chrome.tsx | Preserve routes and improve their behavior. File presence is not feature completion. |
| Operational Android navigation is local component switching | apps/vendor-app/App.tsx; apps/partner-app/App.tsx; apps/admin-app/App.tsx | Replace string-based screen switching with real route stacks, deep links and native back behavior. Preserve domain logic during migration. |
| Android checkout is a quote utility, not a complete purchase | apps/customer-app/native-pages.tsx, NativeCheckoutPage | Replace “Validate basket and quote” with automatic validation, group review, hosted payment, pending recovery and result screens. |
| Generic native resource cards omit task-specific interactions | apps/customer-app/native-pages.tsx, resource page | Notifications, sessions, support and privacy need their own detail/actions, not interchangeable row rendering. |
| Address setup exposes coordinates | apps/customer-pwa/app/address-setup.tsx; customer-app/native-pages.tsx | Normal shoppers should enter an address or choose a pin; coordinate input is an internal diagnostic fallback, not the primary flow. |
| Cart dock can appear during checkout | customer-chrome.tsx, BasketDock hides only on /cart | Checkout gets one contextual action bar, not a competing global basket action. Verify actual overlap visually. |
| Header address state needs recovery/isolation review | customer-chrome.tsx, AddressContext | Empty/error states disappear; session change reload does not itself establish clearing prior-account addresses. Test logout/account switch and give visible select/retry behavior. |
| Design metadata is stale | design.md header | It still describes pre-implementation/no UI kit. Updated to distinguish existing components from verified UX. |

## 2. Experience direction

**Customer:** a compact local-market shopping interface. The distinctive component is a named-store strip repeated consistently on product shelves, basket groups and child-order cards: store identity → availability/promise → customer action. It makes seller ownership immediately recognizable without decorative marketing banners.

**Vendor:** an urgency-ranked workbench: new orders and blocked decisions before sales charts. **Partner:** one active job and one safe next action. **Admin:** an exception queue and evidence-based case workspace; summary metrics never replace actionable work.

Retain the approved light theme. Use existing tokens: white #FFFFFF surfaces, #F7F7F2 canvas, #18221C primary text, #58635B secondary text, #FFD84D mango customer emphasis, #1F6B45 evergreen operational actions. Semantic danger/warning remain reserved for actual states. Use dark text on mango. Contrast must be measured, not inferred from color names.

Use Anek Devanagari sparingly for headings and Noto Sans/Devanagari for body, forms and operational data. Verify font loading/licensing and native availability. Use tabular numerals for prices/timers. Body 16px-equivalent, restrained headings, existing 4/8/12/16/24/32 spacing, 44px web and 48dp native operational target design goals. Do not equate CSS pixels and dp mechanically. Device text scaling must remain enabled.

Customer mobile: compact location header, persistent search entry, 5 primary tabs maximum, cart accessible globally outside checkout. Desktop: horizontal navigation, bounded content width, product grid and stable basket summary. Operational desktop: sidebar + list/detail work area. Mobile operations: task list → full-screen detail, not horizontally scrolling desktop tables.

## 3. Route and task ownership

Routes below are target responsibilities, not claims they already exist. Adapt exact path spelling to established contracts and preserve redirects for old links. PWA and Android share resource identifiers and behavior, not identical layout code.

| Role | Primary navigation | Dedicated stacks/details |
|---|---|---|
| Customer | Home, Categories, Stores, Orders, Account; Search in header; global Cart | Store, product, search results/filters, favourites, addresses, cart, checkout/payment return, child-order detail/track/receipt, decisions, cancellation/refund, support cases/conversation, notifications, sessions/privacy |
| Vendor | Orders, Catalogue, Store, Money, More | Invitation/onboarding, location selector, order pick/decision/packing/handoff, product create/edit/media, CSV upload/preview/errors/commit, staff, hours/closures/zones, statements/payout/dispute, support |
| Partner | Work, Earnings, Account; persistent active-job entry | Invitation/application/documents/training, offer, vendor navigation/arrival/wait/pickup, customer navigation/arrival/delivery, return, offline proof queue, emergency/support, earnings detail/payout/dispute |
| Admin | Work queue; grouped sidebar for Network, Catalogue, Orders/Dispatch, Support/Trust, Finance, Configuration, Reports/Audit | Vendor/partner invitation/review, publication evidence, order/assignment detail, case conversation, finance exception, approval detail, policy preview/activation, document review, scoped audit |

Admin mobile uses a short bottom navigation plus a grouped More menu; finance and configuration actions still require full impact/approval screens. Permissions determine available commands, not merely hidden navigation.

## 4. Screen-to-feature-to-workflow map

Every feature in each range must be expanded into its own evidence row before its slice closes. A range is planning coverage, not automatic certification.

| Screen family | Feature IDs | Workflow / phase | Required connection and exit behavior |
|---|---|---|---|
| Identity, account, session/privacy | CUS-01–07, SEC-01–06/10–11 | Workflow 4; Phase 4 | Real auth boundary, identity-scoped state, recoverable login/invitation, revoke/export/deletion status; no exposed bearer-token setup controls |
| Address/location | CUS-08–13 | Workflow 6.1; Phase 6.1 | Address API + map/geocode + serviceability; selecting address revalidates discovery/cart/quote, not silent line removal |
| Home/search/stores/favourites | CUS-14–24 | Workflow 6.1–6.2; Phase 6.2–6.5 | Paginated eligible live data, filters retained in navigation, no fake stock/rating/ETA, actionable coverage/empty states |
| Product and basket | CUS-25–38 | Workflow 6.2–6.4; Phase 6.5–6.7/7 | Vendor identity, pack/weight basis, safe default substitution, server cart, deterministic guest merge and line-level conflict resolution |
| Checkout/payment | CUS-39–45, ENG-03–11 | Workflow 6.4–6.5; Phase 7 | Automatic quote; durable attempt before provider; hosted checkout; signed confirmation and pending recovery; idempotency retained |
| Orders/decisions/refunds/receipt | CUS-46–62 | Workflow 6.6–6.8/10–11; Phases 8–10 | Child timeline, clear action required, weight cap/top-up, proof stage, cancellation preview, refund progress and versioned receipt |
| Support/notifications | CUS-63–67, COM-01–07, ADM-36–41 | Workflow 11–14; Phase 11 | Backend conversation, scoped private evidence, internal-note isolation, read state and authorized deep links |
| Vendor onboarding/catalogue | VEN-01–22, ADM-07–10/16–17 | Workflow 5.2/7; Phase 5 | Draft/review/rejected/published states, internal test gate, image processing, persisted product edit and CSV review |
| Vendor fulfilment/money | VEN-24–50 | Workflow 7; Phases 8/10 | Accept → pick → resolve → pack → handoff, count/proof validation, statements and linked disputes |
| Partner eligibility/jobs/proof | DLP-01–17/20–30/32–47 | Workflow 5.3/8; Phase 9 | Backend eligibility/assignment, bounded data disclosure, one next action, custody, timers, offline sync and safe return |
| Partner earnings | DLP-48–56 | Workflow 8; Phases 9–10 | Offer amount versus posted/paid amount, attributable adjustments and line-level disputes |
| Admin operating controls | ADM-01–58, SEC-13–14 | Workflow 12; Phase 11 | Scope, queue ownership/SLA, impact preview, maker-checker, exception evidence, audit references and safe recovery |

CUS-54/COM-08 and other Later/Gated/Excluded features do not become launch obligations. Non-screen ENG/SEC/OPS features map to observable states/tests, not invented settings screens.

## 5. Detailed interaction contracts

### Customer discovery → basket

1. Guest chooses area/address manually or grants location. Explain why permission helps; denial leaves an equivalent manual path. No arbitrary Jaipur coordinate fallback.
2. Home shows selected area, search, categories, named eligible shops and relevant repeat purchases. Do not show buy-again for guests or manufacture promotions/reviews.
3. Product card shows vendor, title, image, unit, price basis, availability and Add/quantity. Product detail provides weight range, ingredients/attributes where applicable, substitutions and policies.
4. Adding a second store preserves basket and explains separate order/delivery implications without blocking every tap with a modal.
5. Basket groups show item edits, minimum, method/window, notes and substitution choices. Any unserviceable/changed item gets a local explanation with remove/change/retry actions; valid groups remain visible.

### Checkout → payment recovery

Address → per-store fulfilment → substitutions/weight maximum → customer-facing total → one Pay action. Quote refresh is automatic when inputs change; refreshed totals are clearly announced. Preserve input and cart state on errors.

One sticky checkout summary/action replaces the global cart dock. Show payment processing/unknown as a dedicated recoverable state with the existing attempt reference. Do not offer a new payment while the previous outcome is unresolved. App restart and deep link reload query server state. Provider callback success is not fulfillment success.

### Vendor preparation → customer decisions

New-order list shows age/deadline and blockers. Order detail is a pick list, not a general dashboard. Each line resolves as picked, removed or proposed substitution/weight. Customer sees before/after quantity, price difference, cap, deadline and approve/reject. Vendor sees pending decisions and cannot advance packing improperly. Packing records count/handling; handoff requires proof. Preserve server-confirmed state during retries.

### Partner custody → delivery

Offer hierarchy: earnings, effort/approximate areas, constraints, deadline, accept/decline. No exact customer address before custody. Active job uses stage-specific actions: navigate → arrive → wait/pickup → navigate → arrive → proof. Emergency/support remains reachable without losing work. Offline proof says “Saved on this device; waiting to sync,” never “Delivered.” Reassignment/returns preserve responsibility and earnings evidence.

### Admin intervention → closure

Queue item identifies affected object, severity, age, owner and next action. Detail joins timeline, participant information, evidence, scoped commands and finance consequences. Protected actions use preview → reason → independent approval where required → execution result. Internal notes are visibly separated from “Send to customer/vendor/partner.” Bulk actions never bypass per-resource authorization or sibling isolation.

## 6. Universal component/state contract

Each screen specification records entry route/deep link, allowed actors, required data, API command/query, state/version, primary action, secondary actions, validation, success destination, events and downstream consumer.

Every screen handles loading, empty, offline, stale, permission denied, validation error, recoverable service failure, pending mutation and success. Use local skeletons matching layout; preserve safe drafts and filters. An expired session redirects to login and returns to the original safe destination. Clear account-specific caches on logout/switch; never show another person's address/order during restore.

Design shared primitives in packages/ui and ui-tokens: StoreIdentity, ProductCard, QuantityControl, MoneySummary, AddressPicker, StatusTimeline, DecisionCard, ResourceList, EmptyState, ErrorRecovery, MutationButton, Confirmation/ImpactPanel and accessible upload status. Keep domain validation in API/services, not these components. Native equivalents share semantics/tokens, not DOM/CSS.

Only optimistically show reversible presentation changes; proof, payment, inventory commitment and approval require server acknowledgement. Disable duplicate mutation while pending and retain idempotency keys across uncertain retries. Financial errors stay visible instead of disappearing in short toasts.

## 7. Implementation sequence and acceptance

Each slice delivers contracts/backend dependencies, PWA, Android and behavior tests together. Existing business phases remain canonical; these UX slice names do not renumber them.

| Slice | Work and files | Acceptance before moving on |
|---|---|---|
| UX-0 Evidence baseline | Route inventory for apps/*; existing tests; screenshots once local apps run; feature matrix | Every current route classified: working/partial/placeholder/unverified. Record environment and screenshots; do not mutate feature completion based on source alone. |
| UX-1 Tokens and navigation | packages/ui-tokens, packages/ui; four role shells; native router migration | Correct active state/back/deep links; no clipped dock/content; role access unchanged; no duplicate theme system. |
| UX-2 Identity and location | Auth/session/address screens; client contracts and relevant API services | Guest/manual location, login return, account switch, address selection and denied permission work on both customer clients. |
| UX-3 Supply and publication | Admin/vendor onboarding, catalogue/media/CSV/staff screens | Admin-created access → persisted product → approved public discovery without redeploy, plus rejection/correction paths. |
| UX-4 Shopping | Customer home/categories/stores/search/detail/favourites/cart | Retained filters, pagination, current prices, group limits, deterministic guest merge and changed-address recovery. |
| UX-5 Checkout | checkout-panel, native checkout and payment-return routes; payment contracts | D-15 payment flow, duplicate tap, cancelled provider UI, unknown/late webhook, expired quote and last-unit race. |
| UX-6 Fulfilment | Vendor order/pick/pack and partner active-job routes; customer decisions/tracking | Cross-role updates, substitution refusal, weight top-up refusal, OTP, custody, safe return and offline proof. |
| UX-7 After-sales/operations | Receipts/refunds/support/notifications; all money/admin workspaces | Scoped conversation/evidence, no internal-note leakage, accurate receipt/refund/payout states and maker-checker. |
| UX-8 Release validation | Playwright, native tests/Maestro/device, accessibility and load suites | Golden path and failure cases in approved staging; measured usability/accessibility; no unverified feature marked complete. |

Prioritize P0 wrong charges/data leakage/false completion; P1 blocked core tasks/navigation; P2 confusing recovery/accessibility; P3 visual refinements. If a required API is missing, implement it under the owning phase or record a blocker—never substitute a fake UI.

## 8. Verification checklist

- PWA: 360, 390, 768 and 1440px widths, keyboard, focus order/return, screen-reader labels/announcements, zoom/reflow, reduced motion, contrast, sticky elements and virtual keyboard.
- Android: actual router/deep links, hardware back, process death, permission changes, safe areas, system text scaling, low-end device performance and intermittent network.
- WCAG 2.1 AA target: verify relevant criteria with automated and manual checks; design targets alone do not establish conformance.
- Test every critical role flow in English and Hindi, including errors and dates/money. Never truncate amounts, deadlines or primary actions.
- Use test fixtures only in isolated environments; do not send real OTP, activate providers or move money without authorized setup.
- Trace every Launch feature to its applicable screen/worker and behavior test. Native and PWA results remain separate fields.
- Record commands/results and visual evidence. Re-run existing tests to catch navigation/contract regressions. A screenshot is not proof of API persistence.

## 9. Progress and scope boundary

The initial pass delivered the source critique and connected implementation specification. Preserve existing work and request approval for new authority, material business decisions or destructive changes.

### Customer PWA checkpoint — 6 September 2026

UX-0/UX-1/UX-2 are **in progress**, not accepted across both platforms.

- Basket action dock is suppressed on cart and checkout (including nested routes), leaving those screens in control of their primary action.
- Protected client screens distinguish confirmed unauthenticated responses from service/network failures. Only 401 redirects; other failures retain the route and offer retry. Login redirects preserve query parameters in the return URL.
- Header address loading clears previous data, invalidates stale requests on account changes/unmount, and exposes loading, empty, retry and selection-error states. Address changes refresh the shared context rather than silently failing.
- Address-manager selection/deletion catches errors, disables actions while pending, and broadcasts successful changes; deletion asks for confirmation. Newly saved/selected addresses broadcast the same event used by discovery and the cart.
- Login uses customer-facing wording and provides a Continue browsing escape route. Existing tokens and visual identity are retained, following the frontend-design review rather than adding a separate theme.

Verification: customer PWA TypeScript and changed-file ESLint passed. `node --import tsx --test app/*.spec.ts` passed 42 tests (31 existing source-contract assertions, seven BFF behavior tests, four shell-policy/request-scope behavior tests). These are not 42 end-to-end shopping tests. Local Next dev was started on 127.0.0.1:3100; browser screenshot/accessibility inspection verified the guest header, address-to-login return path, revised login copy and Continue browsing navigation.

Remaining evidence: mounted-component outage/account-switch/mutation tests, mobile-width screenshots, keyboard and screen-reader audit, authenticated persisted address/checkout flows, Android parity, and cross-role staging acceptance. Manual coordinate entry remains a usability gap pending map/search integration. No real OTP, payment, remote database migration, or production release was performed in this checkpoint.

### Entry, navigation and account redesign — 6 September 2026

- Replaced the generic first-visit empty-state box with a responsive location welcome: named-shop context, a clear location action with pending/error feedback, and a visible saved-address sign-in alternative. No invented product, stock, promotion or delivery promises. Manual guest geocoding remains unfinished; signing in is not a substitute for accepting CUS-09.
- Customer desktop navigation now sits above content; phones keep bottom navigation. Shared shell DOM places navigation before main content, and tab selection follows the closest nested/related route. Footer clearance prevents its content sitting underneath fixed mobile navigation.
- Customer PWA Account is now an eight-destination task hub. Profile/preferences moved to `/account/preferences`; its existing API-connected forms and sign-out were preserved. Account-related pages have a return link. Settings no longer label an authenticated customer as being on step two of sign-in.
- Android Account task links now precede the access panel, with descriptions and shared color/spacing tokens. Android tabs use shared tokens. This is presentation work only; native authentication/resource-flow gaps remain open.
- Customer header controls wrap deliberately at narrow widths and language buttons meet the shared 44px target. Repeated introductory copy is omitted on small phones so location actions remain prominent.

Verification: 46 customer tests passed using `tsx --tsconfig tsconfig.test.json --test app/*.spec.ts`, including four new rendered-component tests for navigation ownership, DOM order, task destinations and location choices. JSX test configuration now uses the automatic React runtime. Customer PWA and Android typechecks and changed-file lint passed. Browser inspection at 1440×900 and 360×800 verified responsive entry/navigation and scrolled mobile footer/action clearance. These screenshots cover the guest entry, not authenticated account data or purchase completion.

Next: manual location/geocoder integration, authenticated account/address recovery tests, full customer detail/checkout review, operational role workspaces and Android routing migration. UX-0 through UX-8 remain open until their listed acceptance checks pass; this checkpoint is not a full redesign or production-readiness claim.

### Vendor task workspace — 7 September 2026

- Catalogue now separates Products (`/catalogue`), Stock and reservations (`/catalogue/inventory`), and CSV import (`/catalogue/imports`). Store separates Settings (`/store`), Delivery areas and closures (`/store/service-area`), and Staff and access (`/store/staff`). Existing panel API calls and authorization remain intact.
- Added section navigation with an explicit active task. The existing Orders, Catalogue, Store, Payouts and More destinations remain valid, including nested active states. Insights/support cases now have `/more/insights`; Orders opens directly to fulfilment with a visible link to those cases instead of rendering charts first.
- Added a vendor-only desktop sidebar at 1000px and above. Smaller screens keep the existing primary bottom navigation and wrapping section links. Layout uses shared tokens, with no new palette or theme.
- Keyed task content by location and view so switching stores remounts the panel rather than reusing prior-location drafts. Browser storage failure no longer prevents selecting a location. Sign-out now has pending/error feedback.

Verification: vendor TypeScript and changed-file ESLint passed; all 30 vendor tests passed (existing mixed source-contract/utility checks plus three new navigation-map behavior tests). Local Next dev started on 3101. Browser navigation to `/catalogue/inventory` reached the protected sign-in page; the page reports Supabase environment configuration is absent. Authenticated sidebar visuals, multi-location mutation isolation, data persistence and responsive operational flows are **not verified**. No credentials were entered, authentication bypassed, or business records changed. Vendor Android navigation remains unchanged and this slice is not accepted as cross-platform complete.

### Partner active delivery and alerts — 7 September 2026

- Added `/active`, showing one selected assignment with its navigation, proof and field-support controls. Multiple assignments remain selectable rather than stacked as competing full workflows. Work shows a summary; the persistent Resume action points to the active-delivery page from other sections.
- Added `/alerts`, with automatic loading, explicit failure/retry and genuine empty-state handling. Account links connect Profile, Alerts and Application; navigation retains the owning Work/Account state. Existing earnings, application and profile panels remain in place.
- Corrected the arrived-job branch so an open emergency hold cannot still present delivery proof submission. Return/failure actions are omitted during the hold; the assignment command handler also refuses held-job mutations. Field safety/support remains reachable. These UI guards supplement, not replace, server authorization/state checks.
- Expired, missing or invalid offer deadlines disable acceptance. Acceptance rechecks the current deadline and held-proof count before sending. Sign-out has pending/error handling. Proof/OTP input is remounted on assignment-stage changes.

Verification: 32 partner tests passed, including two new policy behavior tests; one existing source assertion was updated to recognize the combined held-proof/expiry disabled condition. Partner TypeScript and changed-file lint passed. Authenticated browser flows, native parity, real provider/proof handling and operational safety acceptance remain unverified; no external assignment, delivery or payment was performed. Existing synthetic proof references and provider/runtime gaps remain open under the broader plan.

### Admin task navigation and operational pages — 7 September 2026

- Replaced the eleven-module scrolling navigation row with fourteen destinations grouped into Work, Network, Catalogue and service, Support and money, and Administration. Desktop uses a sidebar; smaller screens use an expandable module menu. Nested routes retain the correct active module without prefix collisions.
- Finance and refunds (`/finance`), Trust and safety (`/trust`), and Incidents (`/incidents`) now have dedicated pages. Support cases link to the related trust/finance workspaces rather than embedding all their controls. Existing API calls, permissions and independent refund approval requirements remain unchanged.
- A compact workspace status bar exposes action results with a live announcement and a pending-aware Refresh queues action. Sign-out now has pending and failure feedback. Shared design tokens and the existing visual identity are retained.

Verification: admin TypeScript, changed-file ESLint and the feature-matrix consistency check passed. All 19 admin tests passed: 17 existing source-contract checks and two new navigation-map behavior tests. This does not establish authenticated workflow persistence or visual accessibility. Authenticated responsive browser review, keyboard/screen-reader checks, Android parity, and end-to-end approval/refund tests remain outstanding. No provider calls, business-record mutations, database migrations or production deployment were performed.

### Vendor Android workspace integrity — 7 September 2026

- Removed hard-coded store identity, opening hours/status, delivery promises, staff count and zero-order summary. Unimplemented Store/Money tasks are explicitly described as unavailable on Android rather than rendered as live records.
- Location selection is reachable from every task. Account/location changes clear loaded catalogue, notifications and product drafts; captured request generations prevent old responses from repopulating the new workspace. Order content remounts for account/location changes. Delayed session restoration cannot overwrite a newer selection.
- Notifications now render in More with loading, empty and retry feedback. Catalogue has loading feedback; product mutations have an immediate duplicate-tap guard and pending state. Empty price/stock fields no longer silently become zero. Product inputs have accessibility labels, and main workspace controls target 48dp minimum height.

Verification: vendor Android TypeScript and changed-file ESLint passed; eight tests passed (six existing storage behavior tests and two request-scope behavior tests). No device rendering, mounted-component race test or authenticated persistence test was performed. This is a bounded integrity/presentation pass, not native routing completion: string-based task switching, native auth lifecycle gaps, location picker integration, product-edit/media/CSV parity and Store/Money screens remain open. No external data was modified.
