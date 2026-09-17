# All-feature connected repair register

**Snapshot:** 7 September 2026. **Coverage:** 354 canonical feature IDs and 101 canonical phase steps.

Companion to the [step-by-step repair plan](connected-marketplace-repair-plan.md). Required behaviors below are copied from [FEATURES.md](../../FEATURES.md); phase mappings, owners and inherited claims come from [feature-matrix.json](../feature-matrix.json). This snapshot does not recertify that matrix.

Entries began **NOT_REVERIFIED in this repair audit**. Individual repair checkpoints below record bounded component evidence; none is full connected acceptance. Listed historical tests remain evidence candidates, not proof of both platforms. Expand the plan's per-feature contract with exact routes, commands, permissions and tests before coding. Connection targets below are planned workflow responsibilities, not assertions of implemented screens. Link each affected feature to its own actual task; shared/backend features need consumers and operational evidence, not invented screens.

**Scope:** 309 Launch, 23 Later, 7 Gated, 15 Excluded. Launch requires separate PWA/native acceptance where applicable. Deferred/gated/excluded entries are retained without activating them.

## Workflow packs

- [R0](connected-marketplace-repair-plan.md#r0) — Reproducible environment and evidence baseline.
- [R1](connected-marketplace-repair-plan.md#r1) — Identity, enrolment, sessions and resource bootstrap.
- [R2](connected-marketplace-repair-plan.md#r2) — Shared contracts, routing and cross-role synchronization.
- [R3](connected-marketplace-repair-plan.md#r3) — Admin-created network, onboarding and publication.
- [R4](connected-marketplace-repair-plan.md#r4) — Catalogue, media, CSV, inventory and moderation.
- [R5](connected-marketplace-repair-plan.md#r5) — Customer location, discovery, storefront and cart.
- [R6](connected-marketplace-repair-plan.md#r6) — Quotes, checkout, payment and inventory correctness.
- [R7](connected-marketplace-repair-plan.md#r7) — Vendor fulfilment and customer decisions.
- [R8](connected-marketplace-repair-plan.md#r8) — Partner assignment, custody, delivery and offline recovery.
- [R9](connected-marketplace-repair-plan.md#r9) — Receipts, money, settlement, payouts and reconciliation.
- [R10](connected-marketplace-repair-plan.md#r10) — Support, communication, trust, configuration and incidents.
- [R11](connected-marketplace-repair-plan.md#r11) — Eight-client UX, accessibility, localization and native parity.
- [R12](connected-marketplace-repair-plan.md#r12) — Connected acceptance, controlled staging and release gates.

## Marketplace

### MKT-01 — Named local-store marketplace

- **Required behavior:** Customers always know which vendor location supplies each item. The platform does not hide sellers behind a shared anonymous catalogue.
- **Scope / owner / canonical steps:** Launch; platform; 5.1, 6.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3) → [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account; Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback; Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-discovery.controller.spec.ts](../../apps/api/src/customer-discovery.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-discovery.ts](../../database/scripts/verify-customer-discovery.ts); [database/scripts/verify-vendor-network.ts](../../database/scripts/verify-vendor-network.ts)

### MKT-02 — Vendor-owned storefront identity

- **Required behavior:** Each vendor controls its profile, catalogue, prices, availability, hours, preparation time, service area, and approved fulfilment modes.
- **Scope / owner / canonical steps:** Launch; platform; 5.1, 6.5.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `unverified`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3) → [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account; Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback; Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-catalogue.controller.spec.ts](../../apps/api/src/customer-catalogue.controller.spec.ts); [database/scripts/verify-vendor-network.ts](../../database/scripts/verify-vendor-network.ts)

### MKT-03 — Address-based eligibility

- **Required behavior:** Store discovery, products, promises, fees, and fulfilment choices are calculated for the customer's selected address and active service zone.
- **Scope / owner / canonical steps:** Launch; platform; 6.1, 6.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-addresses.controller.spec.ts](../../apps/api/src/customer-addresses.controller.spec.ts); [apps/api/src/customer-discovery.controller.spec.ts](../../apps/api/src/customer-discovery.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-addresses.ts](../../database/scripts/verify-customer-addresses.ts); [database/scripts/verify-customer-discovery.ts](../../database/scripts/verify-customer-discovery.ts)

### MKT-04 — Multi-store shopping

- **Required behavior:** One cart may contain separate groups from multiple vendor locations, subject to the configured group limit.
- **Scope / owner / canonical steps:** Launch; platform; 6.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-cart.controller.spec.ts](../../apps/api/src/customer-cart.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-cart.ts](../../database/scripts/verify-customer-cart.ts)

### MKT-05 — Grouped checkout

- **Required behavior:** One customer checkout creates a checkout group containing exactly one independent child order per vendor location.
- **Scope / owner / canonical steps:** Launch; platform; 7.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/grouped-checkout.controller.spec.ts](../../apps/api/src/grouped-checkout.controller.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [e2e/cross-role-journey.spec.ts](../../e2e/cross-role-journey.spec.ts)

### MKT-06 — Vendor-order isolation

- **Required behavior:** Acceptance, cancellation, fulfilment, support, refund, and settlement decisions affect only the selected child order unless a separately confirmed group action is valid.
- **Scope / owner / canonical steps:** Launch; platform; 7.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [e2e/cross-role-journey.spec.ts](../../e2e/cross-role-journey.spec.ts)

### MKT-07 — Independent fulfilment promises

- **Required behavior:** Every vendor order has its own preparation estimate, method, fee, delivery or pickup window, assignment, proof, and outcome.
- **Scope / owner / canonical steps:** Launch; platform; 7.7, 8.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6) → [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions; Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views; Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### MKT-08 — Transparent pricing

- **Required behavior:** Customers see store-level item totals, fees, discounts, adjustments, authorization buffers, and the combined amount before payment.
- **Scope / owner / canonical steps:** Launch; platform; 7.1, 7.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/grouped-checkout.controller.spec.ts](../../apps/api/src/grouped-checkout.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/src/checkout-pricing.spec.ts](../../database/src/checkout-pricing.spec.ts)

### MKT-09 — Honest availability

- **Required behavior:** Availability freshness, store hours, preparation estimates, delivery windows, and exceptions are shown without an unsupported instant-delivery promise.
- **Scope / owner / canonical steps:** Launch; platform; 5.7, 6.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4) → [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability; Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation; Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-freshness-moderation.controller.spec.ts](../../apps/api/src/catalogue-freshness-moderation.controller.spec.ts); [apps/api/src/customer-catalogue.controller.spec.ts](../../apps/api/src/customer-catalogue.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-catalogue-freshness-moderation.ts](../../database/scripts/verify-catalogue-freshness-moderation.ts)

### MKT-10 — Versioned operating policies

- **Required behavior:** Fees, commissions, deadlines, limits, service rules, and incident controls retain the exact policy version used for each order.
- **Scope / owner / canonical steps:** Launch; platform; 3.7, 11.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts); [database/src/versioned-configuration.spec.ts](../../database/src/versioned-configuration.spec.ts)

### MKT-11 — English and Hindi

- **Required behavior:** Critical journeys and operational content work in both languages, including validation, errors, time limits, support, and proof flows.
- **Scope / owner / canonical steps:** Launch; platform; 12.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/locale.controller.spec.ts](../../apps/api/src/locale.controller.spec.ts); [packages/i18n/src/runtime.spec.ts](../../packages/i18n/src/runtime.spec.ts)

### MKT-12 — Light visual theme

- **Required behavior:** All four product surfaces use the approved white/light visual system; dark mode is not part of the launch contract.
- **Scope / owner / canonical steps:** Launch; platform; 12.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [packages/ui/src/accessibility.spec.ts](../../packages/ui/src/accessibility.spec.ts)

## Customer

### CUS-01 — Phone OTP sign-in

- **Repair checkpoint:** [Batch 01](repair-batch-01-evidence.md): transactional enrolment/OTP/session path and PWA attestation `VERIFIED_COMPONENT`; Android caller updated/typechecked. PostgreSQL concurrency, real browser/device and provider acceptance pending.

- **Required behavior:** Customers request and verify a time-limited OTP with abuse, attempt, and rate controls.
- **Scope / owner / canonical steps:** Launch; customer-surface; 4.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/otp.controller.spec.ts](../../apps/api/src/otp.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-otp-identity.ts](../../database/scripts/verify-otp-identity.ts); [database/src/otp-identity.spec.ts](../../database/src/otp-identity.spec.ts); [e2e/auth-gates.spec.ts](../../e2e/auth-gates.spec.ts)

### CUS-02 — Secure persistent session

- **Repair checkpoint:** [Batch 01](repair-batch-01-evidence.md): denial vs expiry, origin/CSRF policy, rotation-outage preservation, safe return and sign-out failure `VERIFIED_COMPONENT`. Cross-tab/distributed refresh and device restart remain open.

- **Required behavior:** Sessions rotate safely, expire predictably, and restore the customer's authorized state after reconnect or app resume.
- **Scope / owner / canonical steps:** Launch; customer-surface; 4.2.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `true`, Android `partial`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-app/tests/session-manager.spec.ts](../../apps/customer-app/tests/session-manager.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-identity-sessions.ts](../../database/scripts/verify-identity-sessions.ts); [e2e/auth-gates.spec.ts](../../e2e/auth-gates.spec.ts); [packages/pwa-auth/src/index.spec.ts](../../packages/pwa-auth/src/index.spec.ts)

### CUS-03 — Optional profile completion

- **Repair checkpoint:** [Batch 01](repair-batch-01-evidence.md): PWA login no longer waits on optional settings; settings retry implemented/typechecked. Interactive browser and native optional-profile parity remain unverified.

- **Required behavior:** Customers may add their name and optional email without blocking essential shopping.
- **Scope / owner / canonical steps:** Launch; customer-surface; 4.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts)

### CUS-04 — Language selection

- **Required behavior:** Customers can choose English or Hindi and keep that preference across sessions.
- **Scope / owner / canonical steps:** Launch; customer-surface; 4.5, 12.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/locale.controller.spec.ts](../../apps/api/src/locale.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts); [packages/i18n/src/runtime.spec.ts](../../packages/i18n/src/runtime.spec.ts)

### CUS-05 — Notification preferences

- **Required behavior:** Customers control permitted order, promotion, and support notification channels where policy allows.
- **Scope / owner / canonical steps:** Launch; customer-surface; 4.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts)

### CUS-06 — Consent and privacy controls

- **Required behavior:** Required consents are versioned; optional permissions can be refused without hiding reasonable alternatives.
- **Scope / owner / canonical steps:** Launch; customer-surface; 4.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts)

### CUS-07 — Account help and recovery

- **Required behavior:** Customers can recover access and reach support without exposing sensitive identity details.
- **Scope / owner / canonical steps:** Launch; customer-surface; 4.2.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-identity-sessions.ts](../../database/scripts/verify-identity-sessions.ts); [packages/pwa-auth/src/index.spec.ts](../../packages/pwa-auth/src/index.spec.ts)

### CUS-08 — Optional device location

- **Required behavior:** Customers may grant location permission for faster discovery, but permission is never mandatory.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-addresses.controller.spec.ts](../../apps/api/src/customer-addresses.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-addresses.ts](../../database/scripts/verify-customer-addresses.ts)

### CUS-09 — Manual address search

- **Required behavior:** Customers can find or enter an address when location permission is denied or inaccurate.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.1.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `partial`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-addresses.controller.spec.ts](../../apps/api/src/customer-addresses.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-addresses.ts](../../database/scripts/verify-customer-addresses.ts)

### CUS-10 — Saved addresses

- **Required behavior:** Customers can create, edit, select, and remove saved addresses; the MVP default limit is four and remains configurable.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-addresses.controller.spec.ts](../../apps/api/src/customer-addresses.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-addresses.ts](../../database/scripts/verify-customer-addresses.ts)

### CUS-11 — Map-pin adjustment

- **Required behavior:** Customers can correct the delivery point while still providing a textual address and landmark.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.1.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-addresses.controller.spec.ts](../../apps/api/src/customer-addresses.controller.spec.ts); [database/scripts/verify-customer-addresses.ts](../../database/scripts/verify-customer-addresses.ts)

### CUS-12 — Landmark and instructions

- **Required behavior:** Addresses may include safe delivery instructions and landmarks visible only to authorized actors at the correct fulfilment stage.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-addresses.controller.spec.ts](../../apps/api/src/customer-addresses.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-addresses.ts](../../database/scripts/verify-customer-addresses.ts)

### CUS-13 — Serviceability validation

- **Required behavior:** The product explains whether the address is served and which stores and fulfilment methods remain eligible.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.1, 6.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-addresses.controller.spec.ts](../../apps/api/src/customer-addresses.controller.spec.ts); [apps/api/src/customer-discovery.controller.spec.ts](../../apps/api/src/customer-discovery.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-addresses.ts](../../database/scripts/verify-customer-addresses.ts); [database/scripts/verify-customer-discovery.ts](../../database/scripts/verify-customer-discovery.ts)

### CUS-14 — Nearby eligible-store feed

- **Required behavior:** Customers see eligible stores with name, category, distance, hours, rating, minimum, fee, and fulfilment estimate.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-discovery.controller.spec.ts](../../apps/api/src/customer-discovery.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-discovery.ts](../../database/scripts/verify-customer-discovery.ts)

### CUS-15 — Store, product, brand, and category search

- **Required behavior:** Search works across the published eligible catalogue without mixing unavailable zones into actionable results.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-discovery.controller.spec.ts](../../apps/api/src/customer-discovery.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-16 — Misspelling and local-language matching

- **Required behavior:** Common misspellings, synonyms, Hindi terms, and transliteration can return relevant results.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.3.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-discovery.controller.spec.ts](../../apps/api/src/customer-discovery.controller.spec.ts)

### CUS-17 — Recent searches

- **Required behavior:** Customers can reuse recent searches with privacy-safe storage and deletion behaviour.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-discovery.controller.spec.ts](../../apps/api/src/customer-discovery.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-18 — Discovery filters

- **Required behavior:** Filters include category, pickup/delivery, open now, delivery fee, rating, specialty attributes, and preferred stores.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-discovery.controller.spec.ts](../../apps/api/src/customer-discovery.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-19 — Ranked eligible results

- **Required behavior:** Available and relevant vendors rank ahead of ineligible or unavailable results; sponsored ranking is not mixed in.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.2, 6.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-discovery.controller.spec.ts](../../apps/api/src/customer-discovery.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-discovery.ts](../../database/scripts/verify-customer-discovery.ts)

### CUS-20 — Favourite stores

- **Required behavior:** Customers can add or remove stores from a personal favourites list.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-21 — Preferred store

- **Required behavior:** Customers can mark one store as preferred and find it quickly when it is eligible.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-22 — Request a shop

- **Required behavior:** Customers can nominate a nearby store for the vendor-onboarding pipeline.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.4.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts)

### CUS-23 — Dedicated store page

- **Required behavior:** Each store has its own name, images, description, hours, policies, rating, offers, fulfilment choices, and catalogue.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-catalogue.controller.spec.ts](../../apps/api/src/customer-catalogue.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-24 — Category browsing

- **Required behavior:** Customers browse a store's products through understandable categories and search.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-catalogue.controller.spec.ts](../../apps/api/src/customer-catalogue.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-25 — Product detail

- **Required behavior:** Product pages show name, image, brand, unit, price, availability state, relevant tax/fee information, and substitution behaviour.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-catalogue.controller.spec.ts](../../apps/api/src/customer-catalogue.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-26 — Packaged products

- **Required behavior:** Fixed-pack products use explicit quantity, unit, and integer minor-unit pricing.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-catalogue.controller.spec.ts](../../apps/api/src/customer-catalogue.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-27 — Variable-weight products

- **Required behavior:** Loose produce can show an estimated weight/price range followed by a controlled final-weight adjustment.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.5, 8.3.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5) → [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline; Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options; Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-catalogue.controller.spec.ts](../../apps/api/src/customer-catalogue.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### CUS-28 — Availability freshness

- **Required behavior:** Customers see when product availability was last confirmed and receive isolated recovery when a line becomes stale.
- **Scope / owner / canonical steps:** Launch; customer-surface; 5.7, 6.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4) → [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability; Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation; Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-freshness-moderation.controller.spec.ts](../../apps/api/src/catalogue-freshness-moderation.controller.spec.ts); [apps/api/src/customer-catalogue.controller.spec.ts](../../apps/api/src/customer-catalogue.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-catalogue-freshness-moderation.ts](../../database/scripts/verify-catalogue-freshness-moderation.ts)

### CUS-29 — Store reviews

- **Required behavior:** Customers can read eligible store reviews and ratings without losing the identity of the reviewed vendor.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.7.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts)

### CUS-30 — Vendor-grouped cart

- **Required behavior:** Cart lines are visibly grouped by vendor location with separate subtotals, minimums, preferences, method, fee, and promise.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-cart.controller.spec.ts](../../apps/api/src/customer-cart.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-cart.ts](../../database/scripts/verify-customer-cart.ts)

### CUS-31 — Cross-store add decision

- **Required behavior:** Adding from another store creates or joins a separate vendor group and clearly explains the additional order, fee, and delivery implications.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-cart.controller.spec.ts](../../apps/api/src/customer-cart.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-cart.ts](../../database/scripts/verify-customer-cart.ts)

### CUS-32 — Configurable store-group limit

- **Required behavior:** The server enforces the active maximum, defaulting to three groups, with recovery that preserves existing groups.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.6, 11.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [apps/api/src/customer-cart.controller.spec.ts](../../apps/api/src/customer-cart.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts); [database/scripts/verify-customer-cart.ts](../../database/scripts/verify-customer-cart.ts)

### CUS-33 — Per-store fulfilment selection

- **Required behavior:** Customers select pickup, vendor delivery, or platform delivery independently where the vendor and zone support them.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-cart.controller.spec.ts](../../apps/api/src/customer-cart.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-cart.ts](../../database/scripts/verify-customer-cart.ts)

### CUS-34 — Per-line substitution preference

- **Required behavior:** Customers choose no substitution, a permitted alternative rule, or explicit contact for changes.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-cart.controller.spec.ts](../../apps/api/src/customer-cart.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-cart.ts](../../database/scripts/verify-customer-cart.ts)

### CUS-35 — Customer notes

- **Required behavior:** Customers add safe store or handoff notes subject to content and privacy controls.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-cart.controller.spec.ts](../../apps/api/src/customer-cart.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-cart.ts](../../database/scripts/verify-customer-cart.ts)

### CUS-36 — Cart validation

- **Required behavior:** Price, availability, minimum, hours, address, group limit, and fulfilment eligibility are rechecked before quoting.
- **Scope / owner / canonical steps:** Launch; customer-surface; 6.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-customer-cart.ts](../../database/scripts/verify-customer-cart.ts)

### CUS-37 — Multi-store quote

- **Required behavior:** Each group receives an independent quote and promise; one blocked group does not hide the state of valid groups.
- **Scope / owner / canonical steps:** Launch; customer-surface; 7.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/src/checkout-pricing.spec.ts](../../database/src/checkout-pricing.spec.ts)

### CUS-38 — Quote expiry

- **Required behavior:** Customers see when a quote expires and can refresh it without accidental duplicate orders.
- **Scope / owner / canonical steps:** Launch; customer-surface; 7.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/src/checkout-pricing.spec.ts](../../database/src/checkout-pricing.spec.ts)

### CUS-39 — Combined checkout summary

- **Required behavior:** The final screen shows every vendor group, individual amount, delivery/pickup plan, and the combined authorization amount.
- **Scope / owner / canonical steps:** Launch; customer-surface; 7.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/grouped-checkout.controller.spec.ts](../../apps/api/src/grouped-checkout.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-40 — Prepaid UPI

- **Required behavior:** Customers can pay using the selected provider's supported UPI flow.
- **Scope / owner / canonical steps:** Launch; customer-surface; 7.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts)

### CUS-41 — Card payment

- **Required behavior:** Customers can pay using supported cards through a provider-hosted or tokenized secure flow.
- **Scope / owner / canonical steps:** Launch; customer-surface; 7.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts)

### CUS-42 — Supported wallets

- **Required behavior:** Approved wallet methods appear only when available for the order and customer.
- **Scope / owner / canonical steps:** Launch; customer-surface; 7.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts)

### CUS-43 — Idempotent order placement

- **Required behavior:** Repeated taps, retries, or reconnects produce one checkout result and never duplicate a charge or child order.
- **Scope / owner / canonical steps:** Launch; customer-surface; 3.3, 7.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2) → [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence; Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation; Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/grouped-checkout.controller.spec.ts](../../apps/api/src/grouped-checkout.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/scripts/verify-reference-module.ts](../../database/scripts/verify-reference-module.ts); [database/src/idempotency.spec.ts](../../database/src/idempotency.spec.ts)

### CUS-44 — Payment-unknown recovery

- **Required behavior:** A provider timeout displays a pending state while webhook and reconciliation workers resolve the real result.
- **Scope / owner / canonical steps:** Launch; customer-surface; 7.4, 7.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts)

### CUS-45 — Independent child-order creation

- **Required behavior:** Successful placement returns the checkout group and every vendor-scoped child order with no sibling data leakage.
- **Scope / owner / canonical steps:** Launch; customer-surface; 7.5, 7.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/api/src/grouped-checkout.controller.spec.ts](../../apps/api/src/grouped-checkout.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts)

### CUS-46 — Group order overview

- **Required behavior:** Customers see an overall checkout summary plus the current state of each child order.
- **Scope / owner / canonical steps:** Launch; customer-surface; 7.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-47 — Vendor-order timeline

- **Required behavior:** Each child order shows accepted, picking, decision needed, ready, assigned, picked up, arriving, completed, cancelled, or returned states as applicable.
- **Scope / owner / canonical steps:** Launch; customer-surface; 7.7, 8.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6) → [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions; Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views; Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-48 — Server-owned countdowns

- **Required behavior:** Response and decision deadlines derive from server timestamps and recover correctly after pause or reconnect.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### CUS-49 — Substitution decision

- **Required behavior:** Customers approve or reject a proposed replacement with clear quantity, price, and deadline effects.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### CUS-50 — Variable-weight approval

- **Required behavior:** Material final-weight or price changes follow the customer's recorded rule or explicit approval.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### CUS-51 — Pickup flow

- **Required behavior:** Customers receive ready instructions and complete pickup with a server-validated OTP or approved alternative proof.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### CUS-52 — Vendor self-delivery tracking

- **Required behavior:** Customers see vendor-controlled delivery status and the applicable proof and support path.
- **Scope / owner / canonical steps:** Launch; customer-surface; 9.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### CUS-53 — Platform delivery tracking

- **Required behavior:** Customers see assignment and delivery progress without access to internal partner-risk data.
- **Scope / owner / canonical steps:** Launch; customer-surface; 9.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### CUS-54 — Live map tracking

- **Required behavior:** Where privacy, device, and operational controls pass, customers may see a bounded live partner location during the active delivery window.
- **Scope / owner / canonical steps:** Later; customer-surface; 14.2.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### CUS-55 — Separate delivery expectations

- **Required behavior:** Multiple vendor orders remain separate deliveries unless safe consolidation is explicitly confirmed.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.5, 9.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7) → [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor; Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects; Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### CUS-56 — Delivery OTP

- **Required behavior:** The customer provides a fresh server-validated OTP for delivery completion by default.
- **Scope / owner / canonical steps:** Launch; customer-surface; 9.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### CUS-57 — Cancellation preview

- **Required behavior:** Before cancellation, customers see affected child orders, fulfilment/custody state, refund expectation, and any permitted charge.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.2, 10.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7) → [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor; Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects; Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/money-lifecycle.controller.spec.ts](../../apps/api/src/money-lifecycle.controller.spec.ts); [apps/api/src/vendor-fulfilment.controller.spec.ts](../../apps/api/src/vendor-fulfilment.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### CUS-58 — Post-custody cancellation handling

- **Required behavior:** Cancellation after partner pickup becomes a controlled return instead of silently ending the order.
- **Scope / owner / canonical steps:** Launch; customer-surface; 9.9.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### CUS-59 — Partial refund visibility

- **Required behavior:** Refunds and adjustments show the affected vendor order, amount, reason, method, and progress.
- **Scope / owner / canonical steps:** Launch; customer-surface; 10.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/money-lifecycle.controller.spec.ts](../../apps/api/src/money-lifecycle.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### CUS-60 — Receipts

- **Required behavior:** Customers receive itemized receipts that preserve vendor, fee, adjustment, refund, and payment allocation details.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.7, 10.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7) → [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor; Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects; Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/complete-money-lifecycle.controller.spec.ts](../../apps/api/src/complete-money-lifecycle.controller.spec.ts); [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### CUS-61 — Order history

- **Required behavior:** Customers can review past checkout groups and child orders with receipts and support references.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-62 — Reorder

- **Required behavior:** Customers can recreate a past basket, then resolve current price, availability, vendor, and serviceability changes.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-63 — Structured support

- **Required behavior:** Customers select the smallest affected order or fulfilment, issue category, and evidence, then receive a case reference and expected response time.
- **Scope / owner / canonical steps:** Launch; customer-surface; 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### CUS-64 — Support case tracking

- **Required behavior:** Customers see current owner-facing status, required response, participant-visible messages, outcome, and reopen/escalation eligibility.
- **Scope / owner / canonical steps:** Launch; customer-surface; 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### CUS-65 — Protected communication

- **Required behavior:** Order communication uses in-app messaging or approved masked contact without revealing private phone numbers.
- **Scope / owner / canonical steps:** Launch; customer-surface; 11.3.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### CUS-66 — Vendor rating and review

- **Required behavior:** Customers rate the correct vendor order after completion, subject to moderation and abuse rules.
- **Scope / owner / canonical steps:** Launch; customer-surface; 8.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts)

### CUS-67 — Notification centre

- **Required behavior:** Order, decision, refund, support, and account notifications remain available in one accessible history.
- **Scope / owner / canonical steps:** Launch; customer-surface; 4.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts)

### CUS-68 — Loyalty rewards

- **Required behavior:** Approved rewards can recognize repeat behaviour without changing historical order economics.
- **Scope / owner / canonical steps:** Later; customer-surface; 14.1.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### CUS-69 — Recurring baskets

- **Required behavior:** Customers can schedule or quickly trigger recurring baskets after current availability and pricing validation.
- **Scope / owner / canonical steps:** Later; customer-surface; 14.1.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### CUS-70 — Shared shopping lists

- **Required behavior:** Authorized household members can collaborate on a list before checkout ownership is established.
- **Scope / owner / canonical steps:** Later; customer-surface; 14.1.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

## Vendor

### VEN-01 — Vendor application and invitation

- **Required behavior:** A vendor can enter through a lead, invitation, or approved application path.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/vendor-onboarding.controller.spec.ts](../../apps/api/src/vendor-onboarding.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-onboarding.ts](../../database/scripts/verify-vendor-onboarding.ts); [database/src/protected-object-storage.spec.ts](../../database/src/protected-object-storage.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### VEN-02 — Business and payout profile

- **Required behavior:** Owners provide business identity, bank/payout details, category, contacts, and required declarations.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/vendor-onboarding.controller.spec.ts](../../apps/api/src/vendor-onboarding.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-onboarding.ts](../../database/scripts/verify-vendor-onboarding.ts); [database/src/protected-object-storage.spec.ts](../../database/src/protected-object-storage.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### VEN-03 — Document upload and review status

- **Required behavior:** Licences and verification files show pending, approved, rejected, expiring, grace, and reverification states.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.2, 5.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/admin-onboarding.controller.spec.ts](../../apps/api/src/admin-onboarding.controller.spec.ts); [apps/api/src/vendor-onboarding.controller.spec.ts](../../apps/api/src/vendor-onboarding.controller.spec.ts); [apps/api/src/vendor-publication.controller.spec.ts](../../apps/api/src/vendor-publication.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-onboarding.ts](../../database/scripts/verify-vendor-onboarding.ts); [database/scripts/verify-vendor-publication.ts](../../database/scripts/verify-vendor-publication.ts); [database/src/protected-object-storage.spec.ts](../../database/src/protected-object-storage.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### VEN-04 — Store-location management

- **Required behavior:** A vendor manages one or more authorized locations without crossing another vendor's data boundary.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-network.ts](../../database/scripts/verify-vendor-network.ts)

### VEN-05 — Store profile

- **Required behavior:** Owners manage approved name, description, images, contact policy, and storefront information.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-network.ts](../../database/scripts/verify-vendor-network.ts)

### VEN-06 — Hours and closures

- **Required behavior:** Stores configure regular hours, holidays, and temporary closures used by discovery and checkout.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-network.ts](../../database/scripts/verify-vendor-network.ts)

### VEN-07 — Service zones

- **Required behavior:** Authorized zones or radii determine eligible addresses and fulfilment options.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-network.ts](../../database/scripts/verify-vendor-network.ts)

### VEN-08 — Minimum order and preparation time

- **Required behavior:** Vendor-specific minimums and realistic preparation estimates feed customer quotes.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-network.ts](../../database/scripts/verify-vendor-network.ts)

### VEN-09 — Fulfilment modes

- **Required behavior:** Vendors enable approved pickup, self-delivery, or platform delivery modes by location.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-network.ts](../../database/scripts/verify-vendor-network.ts)

### VEN-10 — Staff invitations

- **Required behavior:** Owners invite staff by approved identity channel and assign location-scoped roles.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/vendor-staff.controller.spec.ts](../../apps/api/src/vendor-staff.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-staff.ts](../../database/scripts/verify-vendor-staff.ts)

### VEN-11 — Vendor roles and permissions

- **Required behavior:** Owner, manager, and picker capabilities follow least privilege and leave attributable activity.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 4.3, 5.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/admin-access.controller.spec.ts](../../apps/api/src/admin-access.controller.spec.ts); [apps/api/src/vendor-staff.controller.spec.ts](../../apps/api/src/vendor-staff.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-identity-access.ts](../../database/scripts/verify-identity-access.ts); [database/scripts/verify-vendor-staff.ts](../../database/scripts/verify-vendor-staff.ts); [database/src/admin-onboarding.spec.ts](../../database/src/admin-onboarding.spec.ts)

### VEN-12 — Onboarding test order

- **Required behavior:** Publication may require a successful operational test before the storefront becomes live.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.3.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### VEN-13 — Catalogue creation

- **Required behavior:** Vendors create products with category, brand, description, image, unit, price, tax, and availability fields.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-products.controller.spec.ts](../../apps/api/src/catalogue-products.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-catalogue-products.ts](../../database/scripts/verify-catalogue-products.ts); [database/src/protected-object-storage.spec.ts](../../database/src/protected-object-storage.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### VEN-14 — Product editing

- **Required behavior:** Authorized staff update products while current orders preserve immutable product and price snapshots.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-products.controller.spec.ts](../../apps/api/src/catalogue-products.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-catalogue-products.ts](../../database/scripts/verify-catalogue-products.ts); [database/src/protected-object-storage.spec.ts](../../database/src/protected-object-storage.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### VEN-15 — CSV catalogue import

- **Required behavior:** Vendors download a template, upload rows, fix row-level errors, preview, and explicitly commit valid changes.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-import.controller.spec.ts](../../apps/api/src/catalogue-import.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts)

### VEN-16 — Bulk catalogue operations

- **Required behavior:** Authorized staff update availability and supported fields without unsafe cross-store changes.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-import.controller.spec.ts](../../apps/api/src/catalogue-import.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts)

### VEN-17 — Variable-weight configuration

- **Required behavior:** Vendors define base unit, expected variance, estimate behaviour, and permitted final-weight handling.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-products.controller.spec.ts](../../apps/api/src/catalogue-products.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-catalogue-products.ts](../../database/scripts/verify-catalogue-products.ts); [database/src/protected-object-storage.spec.ts](../../database/src/protected-object-storage.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### VEN-18 — Substitution suggestions

- **Required behavior:** Vendors define appropriate alternatives without bypassing the customer's substitution preference.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-products.controller.spec.ts](../../apps/api/src/catalogue-products.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-catalogue-products.ts](../../database/scripts/verify-catalogue-products.ts); [database/src/protected-object-storage.spec.ts](../../database/src/protected-object-storage.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### VEN-19 — Stock-status management

- **Required behavior:** Vendors mark in stock, low confidence, or unavailable and expose freshness to customer flows.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-freshness-moderation.controller.spec.ts](../../apps/api/src/catalogue-freshness-moderation.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-catalogue-freshness-moderation.ts](../../database/scripts/verify-catalogue-freshness-moderation.ts)

### VEN-20 — Inventory soft holds

- **Required behavior:** Checkout can create expiring provisional holds; the cart itself never guarantees reservation.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 7.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/vendor-inventory.controller.spec.ts](../../apps/api/src/vendor-inventory.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-inventory-reservations.ts](../../database/scripts/verify-inventory-reservations.ts)

### VEN-21 — Acceptance-time stock commitment

- **Required behavior:** Accepting an order commits the applicable counted inventory atomically or rejects the conflicting acceptance.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 7.2, 8.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6) → [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions; Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views; Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/vendor-fulfilment.controller.spec.ts](../../apps/api/src/vendor-fulfilment.controller.spec.ts); [apps/api/src/vendor-inventory.controller.spec.ts](../../apps/api/src/vendor-inventory.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-inventory-reservations.ts](../../database/scripts/verify-inventory-reservations.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-22 — Catalogue moderation feedback

- **Required behavior:** Restricted or invalid products show actionable moderation reasons and correction/review paths.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 5.7.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-freshness-moderation.controller.spec.ts](../../apps/api/src/catalogue-freshness-moderation.controller.spec.ts); [database/scripts/verify-catalogue-freshness-moderation.ts](../../database/scripts/verify-catalogue-freshness-moderation.ts)

### VEN-23 — POS/inventory integration

- **Required behavior:** Approved connectors synchronize catalogue or stock through idempotent, observable provider adapters.
- **Scope / owner / canonical steps:** Later; vendor-surface; 14.3.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### VEN-24 — Real-time new-order alerts

- **Required behavior:** Assigned devices receive push/audible alerts with fallback escalation and a visible server deadline.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-25 — Order queue dashboard

- **Required behavior:** Staff see new, decision-required, picking, ready, handoff, exception, and completed work ordered by urgency.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-26 — Accept order

- **Required behavior:** Authorized staff accept only a valid placed order before deadline, committing stock and preparation expectations.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/vendor-fulfilment.controller.spec.ts](../../apps/api/src/vendor-fulfilment.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-27 — Impact-aware decline

- **Required behavior:** Decline requires preview, standardized reason, customer/financial impact, and confirmation.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/vendor-fulfilment.controller.spec.ts](../../apps/api/src/vendor-fulfilment.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-28 — Server-driven timeout

- **Required behavior:** Missing the response deadline affects only that child order, releases its resources, and notifies the right actors.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-29 — Picking checklist

- **Required behavior:** Staff resolve every line as found, adjusted, removed, or substitution proposed.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-30 — Weight entry

- **Required behavior:** Staff enter final weight and price within policy, triggering customer approval when required.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-31 — Substitution proposal

- **Required behavior:** Staff send a concrete replacement with quantity, price, reason, and decision deadline.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-32 — Customer-decision tracking

- **Required behavior:** The order shows whether the customer approved, rejected, or timed out and the exact next instruction.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-33 — Package metadata

- **Required behavior:** Staff record package count, handling needs, and condition before declaring readiness.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-34 — Mark ready

- **Required behavior:** The action succeeds only after all lines and required customer decisions are resolved.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-35 — Customer pickup handoff

- **Required behavior:** Staff validate pickup OTP or approved proof and close custody and fulfilment correctly.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-36 — Delivery-partner handoff

- **Required behavior:** Staff verify the correct assignment, proof, counts, and condition before server-confirmed custody begins.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 9.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-wait-policy.controller.spec.ts](../../apps/api/src/partner-wait-policy.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-partner-wait-policy.ts](../../database/scripts/verify-partner-wait-policy.ts)

### VEN-37 — Vendor self-delivery

- **Required behavior:** Authorized vendor staff can perform the approved delivery flow with status and proof controls.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 9.6.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### VEN-38 — Controlled cancellation

- **Required behavior:** Cancellation shows customer, inventory, fulfilment, partner, and financial impact and respects custody boundaries.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.2, 10.2.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7) → [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor; Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects; Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/money-lifecycle.controller.spec.ts](../../apps/api/src/money-lifecycle.controller.spec.ts); [apps/api/src/vendor-fulfilment.controller.spec.ts](../../apps/api/src/vendor-fulfilment.controller.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-39 — Order timeline

- **Required behavior:** Every state transition displays actor, time, reason, and current instruction to authorized vendor staff.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.7.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `partial`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-order-controls.spec.ts](../../apps/api/src/customer-order-controls.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts)

### VEN-40 — Low-connectivity recovery

- **Required behavior:** Active work, last confirmed state, drafts, and safe retries survive common mobile-network interruption.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 8.3, 12.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R7](connected-marketplace-repair-plan.md#r7) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor order/pick/decision/pack/handoff; customer decision/timeline/pickup/history/review; admin monitor; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Vendor transition → customer decision → ready/handoff → independent child fulfilment and money effects; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-vendor-fulfilment.ts](../../database/scripts/verify-vendor-fulfilment.ts)

### VEN-41 — Protected customer messaging

- **Required behavior:** Vendors use approved templates, safe free text, or time-bounded masked calling; personal numbers remain hidden.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 11.3.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### VEN-42 — Structured operational escalation

- **Required behavior:** Reasons cover customer, payment, rider, package, timing, technical, safety, and admin problems.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 11.3.
- **Inherited claim, not reverified:** `ui_only`; PWA `ui_only`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### VEN-43 — Persistent case instruction

- **Required behavior:** The current support instruction remains visible on the affected order until resolution.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### VEN-44 — Notification escalation settings

- **Required behavior:** Owners select permitted devices and staff escalation order and can test push/SMS delivery.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 4.5.
- **Inherited claim, not reverified:** `ui_only`; PWA `ui_only`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts)

### VEN-45 — Sales dashboard

- **Required behavior:** Vendors see orders, gross sales, acceptance, cancellation, preparation time, and trend summaries.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 11.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts)

### VEN-46 — Repeat-customer insights

- **Required behavior:** Privacy-safe aggregate insights help vendors understand repeat demand without exporting private customer identities.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 11.8.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

### VEN-47 — Rating insights

- **Required behavior:** Vendors see rating trends, eligible feedback, moderation outcomes, and dispute/support paths.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 11.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts); [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts)

### VEN-48 — Settlement ledger

- **Required behavior:** Each order shows sale, platform fee, payment costs, refund/adjustment, tax, and payout status.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 10.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### VEN-49 — Downloadable statements

- **Required behavior:** Authorized vendor users export date- or payout-batch statements with stable references.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 10.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/vendor-pwa/app/vendor-panels.spec.ts](../../apps/vendor-pwa/app/vendor-panels.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### VEN-50 — Settlement disputes

- **Required behavior:** Vendors challenge a specific ledger or payout line through a tracked finance case.
- **Scope / owner / canonical steps:** Launch; vendor-surface; 10.6.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/complete-money-lifecycle.controller.spec.ts](../../apps/api/src/complete-money-lifecycle.controller.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### VEN-51 — Marketing tools

- **Required behavior:** Approved vendor campaigns and customer-retention tools operate within consent, ranking, and fee policies.
- **Scope / owner / canonical steps:** Later; vendor-surface; 14.3.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### VEN-52 — Vendor-managed advertising

- **Required behavior:** Advertising may launch only after vendor-order economics and sponsored-ranking disclosure rules are approved.
- **Scope / owner / canonical steps:** Later; vendor-surface; 14.3.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

## Delivery partner

### DLP-01 — Partner application

- **Required behavior:** Prospective partners create an application for permitted service areas and vehicle types.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-lifecycle.controller.spec.ts](../../apps/api/src/partner-lifecycle.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-02 — Identity and document capture

- **Required behavior:** Camera-first capture supports identity, driving/vehicle, bank, insurance, and other approved documents.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-lifecycle.controller.spec.ts](../../apps/api/src/partner-lifecycle.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-03 — Verification status

- **Required behavior:** Partners see applied, pending, under review, approved, rejected, suspended, and inactive states with reasons.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-lifecycle.controller.spec.ts](../../apps/api/src/partner-lifecycle.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-04 — Expiry and reverification

- **Required behavior:** Time-bound documents trigger reminders and capability changes under approved policy without stranding active custody.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-lifecycle.controller.spec.ts](../../apps/api/src/partner-lifecycle.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-05 — Training checklist

- **Required behavior:** Partners complete required privacy, pickup, delivery, safety, and exception training.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.1.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `ui_only`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-lifecycle.controller.spec.ts](../../apps/api/src/partner-lifecycle.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-06 — Emergency contact

- **Required behavior:** Partners maintain an approved emergency contact with protected access.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-lifecycle.controller.spec.ts](../../apps/api/src/partner-lifecycle.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-07 — Bank and payout setup

- **Required behavior:** Partners manage verified payout details through controlled change and review flows.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.1, 10.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3) → [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account; Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback; Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-lifecycle.controller.spec.ts](../../apps/api/src/partner-lifecycle.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-08 — Online/offline toggle

- **Required behavior:** Only an eligible partner can go online; the screen explains any blocker.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-availability.controller.spec.ts](../../apps/api/src/partner-availability.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-availability.ts](../../database/scripts/verify-partner-availability.ts)

### DLP-09 — Active-zone selection

- **Required behavior:** Partners choose among authorized service zones.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-availability.controller.spec.ts](../../apps/api/src/partner-availability.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-availability.ts](../../database/scripts/verify-partner-availability.ts)

### DLP-10 — Daily activity summary

- **Required behavior:** The home screen shows trips, earnings, online time, and relevant device/data guidance.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-availability.controller.spec.ts](../../apps/api/src/partner-availability.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-availability.ts](../../database/scripts/verify-partner-availability.ts)

### DLP-11 — Privacy-bounded job offer

- **Required behavior:** Offers show approximate pickup/drop areas, distance, expected time, deadline, constraints, and expected earnings without premature customer detail.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/assignment-custody.controller.spec.ts](../../apps/api/src/assignment-custody.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-12 — Accept or decline

- **Required behavior:** Partners make a one-handed decision before the server deadline; safety or impracticality declines are not presented as automatic misconduct.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/assignment-custody.controller.spec.ts](../../apps/api/src/assignment-custody.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-13 — Offer expiry

- **Required behavior:** Expiry closes one immutable attempt and safely returns eligible work for reassignment.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/assignment-custody.controller.spec.ts](../../apps/api/src/assignment-custody.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-14 — One active job

- **Repair checkpoint:** [Batch 01](repair-batch-01-evidence.md): unknown/failed/stale proof queue blocks new work; proof eligibility `VERIFIED_COMPONENT`. Effective 404 cause, server concurrency and Android behavior not reverified.

- **Required behavior:** A partner cannot accept another job while an assignment or unresolved offline proof remains active.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/assignment-custody.controller.spec.ts](../../apps/api/src/assignment-custody.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-15 — One active assignment per fulfilment

- **Required behavior:** Concurrency controls prevent two partners from validly owning the same fulfilment.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/assignment-custody.controller.spec.ts](../../apps/api/src/assignment-custody.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-16 — Assignment history

- **Required behavior:** Every offer, expiry, decline, reassignment, actor, reason, wait effect, custody effect, and earning effect remains visible to authorized users.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/assignment-custody.controller.spec.ts](../../apps/api/src/assignment-custody.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-17 — Manual dispatch

- **Required behavior:** Operations can assign or reassign eligible partners with an attributable reason and preserved history.
- **Scope / owner / canonical steps:** Launch; partner-surface; 11.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### DLP-18 — Batch assignment

- **Required behavior:** The platform may offer compatible work in batches after single-order dispatch reliability is proven.
- **Scope / owner / canonical steps:** Later; partner-surface; 14.2.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### DLP-19 — Automated route optimization

- **Required behavior:** Approved algorithms may improve offer and route planning without weakening partner choice or custody isolation.
- **Scope / owner / canonical steps:** Later; partner-surface; 14.2.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### DLP-20 — Resume active job

- **Required behavior:** A persistent control returns the partner to the server-confirmed current step after navigation, interruption, or reconnect.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-21 — Vendor navigation

- **Required behavior:** Partners receive the exact vendor address, text/landmark fallback, and external-map handoff.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-22 — Arrival at vendor

- **Required behavior:** Trusted location or approved fallback records arrival and starts the applicable server wait policy.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-23 — Vendor wait timer

- **Required behavior:** Partners see elapsed wait, revised pickup estimate, compensation, thresholds, and allowed actions.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-wait-policy.controller.spec.ts](../../apps/api/src/partner-wait-policy.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-wait-policy.ts](../../database/scripts/verify-partner-wait-policy.ts)

### DLP-24 — Pickup QR/OTP

- **Required behavior:** Partners scan or enter approved proof tied to the correct assignment and vendor order.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-wait-policy.controller.spec.ts](../../apps/api/src/partner-wait-policy.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-wait-policy.ts](../../database/scripts/verify-partner-wait-policy.ts)

### DLP-25 — Package count and condition agreement

- **Required behavior:** Partner and vendor confirm counts, condition, fragile/cold handling, and exceptions before pickup.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-wait-policy.controller.spec.ts](../../apps/api/src/partner-wait-policy.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-wait-policy.ts](../../database/scripts/verify-partner-wait-policy.ts)

### DLP-26 — Server-confirmed custody

- **Required behavior:** Custody begins only after the server accepts proof; local capture never displays false completion.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/partner-wait-policy.controller.spec.ts](../../apps/api/src/partner-wait-policy.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-wait-policy.ts](../../database/scripts/verify-partner-wait-policy.ts)

### DLP-27 — Customer navigation

- **Required behavior:** Exact customer address and permitted instructions appear only after custody begins.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-28 — Protected customer contact

- **Required behavior:** Backend participant messages and support protect personal phone numbers; masked calling is deferred under COM-08.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.6, 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-29 — Arrival at customer

- **Required behavior:** The partner records arrival with the permitted location and fallback process.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-30 — Delivery OTP

- **Required behavior:** A fresh OTP is the default completion proof and includes expiry, replay, and attempt controls.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-31 — Alternative proof

- **Required behavior:** Photo, signature, or another proof appears only for approved scenarios with consent, retention, and support policy.
- **Scope / owner / canonical steps:** Gated; partner-surface; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `gated`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Keep server capability and UI disabled until named legal/financial/safety/operational approval; then define implementation and activation tests.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** [apps/api/src/gated-capabilities.controller.spec.ts](../../apps/api/src/gated-capabilities.controller.spec.ts)

### DLP-32 — Offline proof capture

- **Required behavior:** Proof can be encrypted locally, tied to the assignment, and labelled pending until synchronization.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-33 — Idempotent proof synchronization

- **Required behavior:** Automatic and manual retries cannot complete the same handoff more than once.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-34 — Offline proof escalation

- **Required behavior:** Failed synchronization exposes a one-tap support path with safe diagnostics and a stable reference.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-35 — Completion confirmation

- **Required behavior:** The app shows delivered only after server confirmation, then releases the partner for new work.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-36 — Guided vendor-delay flow

- **Required behavior:** The partner receives clear wait, leave/reassign, compensation, and support choices.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-37 — Missing or damaged package flow

- **Required behavior:** The app records evidence and routes to retry, correction, cancellation, return, or support.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-38 — Customer unreachable flow

- **Required behavior:** Attempts, timers, safe contact, next instruction, and return eligibility are recorded.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-39 — Wrong-address flow

- **Required behavior:** Partners can report an incorrect address without unilaterally changing the delivery contract.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-40 — Unsafe-location flow

- **Required behavior:** Partners can stop safely and reach specialist support without being forced to complete.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `false/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-41 — Return to origin

- **Required behavior:** Authorized returns progress through destination, returning, receipt/count/condition proof, returned, and earning posting.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.9.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-42 — Return-location fallback

- **Required behavior:** Vendor closed/refusal, alternate safe point, perishables, damage, and proof-pending cases have explicit instructions.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.9.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### DLP-43 — Persistent emergency action

- **Required behavior:** Accident, medical emergency, threat, harassment, breakdown, and prohibited-goods concerns reach the correct emergency path.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-44 — Location-sharing disclosure

- **Required behavior:** Partners see when tracking is active, why, frequency/battery mode, offline buffering, and when sharing ends.
- **Scope / owner / canonical steps:** Launch; partner-surface; 4.5, 9.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R8](connected-marketplace-repair-plan.md#r8) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-45 — Permission withdrawal handling

- **Required behavior:** The app explains which capabilities stop and whether the active job may continue or must enter a safe-stop flow.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-46 — Text and landmark navigation fallback

- **Required behavior:** A map is never the only representation of the route.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### DLP-47 — Integrity-review state

- **Required behavior:** Suspicious signals create a neutral review with case reference and appeal; one signal does not automatically declare guilt.
- **Scope / owner / canonical steps:** Launch; partner-surface; 11.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### DLP-48 — Offer earnings preview

- **Required behavior:** Expected base, distance/time, known tip, wait/return policy, and constraints are visible before acceptance.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.10.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-49 — Trip earnings breakdown

- **Required behavior:** Completed work shows base, distance/time, waiting, return, incentive, tip, adjustment, and net amount.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.10.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-50 — Daily and weekly rollups

- **Required behavior:** Partners can reconcile individual trips with summarized earnings.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.10.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-51 — Payout history

- **Required behavior:** Payout batches show status, bank destination reference, amount, date, and failure state.
- **Scope / owner / canonical steps:** Launch; partner-surface; 10.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### DLP-52 — Downloadable earnings statement

- **Required behavior:** Partners export stable trip and payout references for the selected period.
- **Scope / owner / canonical steps:** Launch; partner-surface; 10.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### DLP-53 — Line-level earning dispute

- **Required behavior:** Missing trip, distance, wait/return pay, tip, incentive, failure, or adjustment disputes attach to the exact line.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.10, 10.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/complete-money-lifecycle.controller.spec.ts](../../apps/api/src/complete-money-lifecycle.controller.spec.ts); [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-54 — Performance transparency

- **Required behavior:** Completed trips, pickup timing, and feedback are explained with coaching and dispute paths before restriction.
- **Scope / owner / canonical steps:** Launch; partner-surface; 9.10.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### DLP-55 — Partner support

- **Required behavior:** Partners can reach operational support without abandoning the active-job context.
- **Scope / owner / canonical steps:** Launch; partner-surface; 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### DLP-56 — Restriction appeal

- **Required behavior:** Capability restrictions show reason, evidence basis, review date, effect, and appeal status.
- **Scope / owner / canonical steps:** Launch; partner-surface; 11.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/partner-pwa/app/partner-panels.spec.ts](../../apps/partner-pwa/app/partner-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

## Admin

### ADM-01 — Role-based admin access

- **Required behavior:** Every screen, record, and action checks a named capability and tenant/scope boundary.
- **Scope / owner / canonical steps:** Launch; admin-surface; 4.3, 11.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-access.controller.spec.ts](../../apps/api/src/admin-access.controller.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts); [database/scripts/verify-identity-access.ts](../../database/scripts/verify-identity-access.ts); [database/src/admin-onboarding.spec.ts](../../database/src/admin-onboarding.spec.ts)

### ADM-02 — Admin role summary

- **Required behavior:** Staff can see their own permissions and receive a safe access-denied explanation.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

### ADM-03 — Separation of duties

- **Required behavior:** A proposer cannot approve their own protected refund, payout, restriction, policy, fee, or incident action.
- **Scope / owner / canonical steps:** Launch; admin-surface; 4.3, 11.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-access.controller.spec.ts](../../apps/api/src/admin-access.controller.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts); [database/scripts/verify-identity-access.ts](../../database/scripts/verify-identity-access.ts); [database/src/admin-onboarding.spec.ts](../../database/src/admin-onboarding.spec.ts)

### ADM-04 — Risk-ranked dashboard

- **Required behavior:** Safety, ledger, live-order, compliance, and routine work appear in consistent severity order.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

### ADM-05 — Queue ownership and SLA

- **Required behavior:** Each operational item has an owner/team, age, severity, response deadline, and next action.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

### ADM-06 — Scoped search

- **Required behavior:** Staff find checkout groups, orders, assignments, vendors, partners, payments, cases, and public references only within permission.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

### ADM-07 — Vendor lead and pipeline

- **Required behavior:** Requested, invited, applied, pending, review, test-order, approved, live, paused, and rejected stages are managed visibly.
- **Scope / owner / canonical steps:** Launch; admin-surface; 5.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-onboarding.controller.spec.ts](../../apps/api/src/admin-onboarding.controller.spec.ts); [apps/api/src/vendor-publication.controller.spec.ts](../../apps/api/src/vendor-publication.controller.spec.ts); [database/scripts/verify-vendor-publication.ts](../../database/scripts/verify-vendor-publication.ts)

### ADM-08 — Vendor document review

- **Required behavior:** Reviewers inspect required documents, expiry, evidence, notes, replacement, grace, outcome, and appeal.
- **Scope / owner / canonical steps:** Launch; admin-surface; 5.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-onboarding.controller.spec.ts](../../apps/api/src/admin-onboarding.controller.spec.ts); [apps/api/src/vendor-publication.controller.spec.ts](../../apps/api/src/vendor-publication.controller.spec.ts); [database/scripts/verify-vendor-publication.ts](../../database/scripts/verify-vendor-publication.ts)

### ADM-09 — Vendor publication

- **Required behavior:** Authorized staff publish, pause, unpublish, or restore a storefront with impact preview and reason.
- **Scope / owner / canonical steps:** Launch; admin-surface; 5.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-onboarding.controller.spec.ts](../../apps/api/src/admin-onboarding.controller.spec.ts); [apps/api/src/vendor-publication.controller.spec.ts](../../apps/api/src/vendor-publication.controller.spec.ts); [database/scripts/verify-vendor-publication.ts](../../database/scripts/verify-vendor-publication.ts)

### ADM-10 — Vendor service configuration

- **Required behavior:** Staff manage approved zones, category, fees, commission, fulfilment model, and import method.
- **Scope / owner / canonical steps:** Launch; admin-surface; 5.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-onboarding.controller.spec.ts](../../apps/api/src/admin-onboarding.controller.spec.ts); [apps/api/src/vendor-publication.controller.spec.ts](../../apps/api/src/vendor-publication.controller.spec.ts); [database/scripts/verify-vendor-publication.ts](../../database/scripts/verify-vendor-publication.ts)

### ADM-11 — Partner application pipeline

- **Required behavior:** Applied, documents pending, under review, approved, suspended, rejected, and inactive states are managed.
- **Scope / owner / canonical steps:** Launch; admin-surface; 9.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/partner-lifecycle.controller.spec.ts](../../apps/api/src/partner-lifecycle.controller.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### ADM-12 — Partner document review

- **Required behavior:** Identity, vehicle, insurance, bank, expiry, reverification, and evidence follow an auditable lifecycle.
- **Scope / owner / canonical steps:** Launch; admin-surface; 9.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/partner-lifecycle.controller.spec.ts](../../apps/api/src/partner-lifecycle.controller.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### ADM-13 — Partner zone and vehicle eligibility

- **Required behavior:** Authorized staff control permitted service zones and compatible vehicle types.
- **Scope / owner / canonical steps:** Launch; admin-surface; 9.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R3](connected-marketplace-repair-plan.md#r3). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Admin Onboarding/Vendors/Partners/Access; vendor Onboarding/Store; partner Application/Account.
- **Synchronization contract:** Invitation/submission → role activation/review → publication/eligibility → discovery/offers/feedback.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/partner-lifecycle.controller.spec.ts](../../apps/api/src/partner-lifecycle.controller.spec.ts); [database/scripts/verify-partner-lifecycle.ts](../../database/scripts/verify-partner-lifecycle.ts)

### ADM-14 — Capability-specific restriction

- **Required behavior:** Restrictions name exactly what is blocked and preserve safe handling of active orders or custody.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.4.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-15 — Appeals and manual exceptions

- **Required behavior:** Time-limited exceptions and appeals have evidence, owner, expiry/review date, outcome, and history.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-16 — Cross-vendor catalogue moderation

- **Required behavior:** Staff review prohibited, restricted, miscategorized, or policy-violating items without silently editing vendor history.
- **Scope / owner / canonical steps:** Launch; admin-surface; 5.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/catalogue-freshness-moderation.controller.spec.ts](../../apps/api/src/catalogue-freshness-moderation.controller.spec.ts); [database/scripts/verify-catalogue-freshness-moderation.ts](../../database/scripts/verify-catalogue-freshness-moderation.ts)

### ADM-17 — Category taxonomy

- **Required behavior:** Authorized staff maintain marketplace categories and attributes through versioned, validated changes.
- **Scope / owner / canonical steps:** Launch; admin-surface; 5.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/catalogue-products.controller.spec.ts](../../apps/api/src/catalogue-products.controller.spec.ts); [database/scripts/verify-catalogue-products.ts](../../database/scripts/verify-catalogue-products.ts); [database/src/protected-object-storage.spec.ts](../../database/src/protected-object-storage.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### ADM-18 — Service-zone editor

- **Required behavior:** Zones support radius, pin-code, or polygon definitions with affected-store/address preview.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.6.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `ui_only`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts)

### ADM-19 — Delivery-fee configuration

- **Required behavior:** Base, included distance, rate, thresholds, rounding, and maximum radius are versioned and previewable.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts)

### ADM-20 — Vendor-fee and commission configuration

- **Required behavior:** Per-completed-order fees and approved commission rules have scope, effective time, author, and approval.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts)

### ADM-21 — Payout and earning policy configuration

- **Required behavior:** Partner earnings and payout rules are versioned and never recalculate historical work silently.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts)

### ADM-22 — Operational timer configuration

- **Required behavior:** Response, decision, wait, proof, and recovery deadlines are server-owned and versioned.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts)

### ADM-23 — Configuration validation

- **Required behavior:** Invalid overlaps, missing dependencies, unsafe values, and failed test examples block activation.
- **Scope / owner / canonical steps:** Launch; admin-surface; 3.7, 11.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts); [database/src/versioned-configuration.spec.ts](../../database/src/versioned-configuration.spec.ts)

### ADM-24 — Maker-checker activation

- **Required behavior:** Material configuration changes require a different authorized approver.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts)

### ADM-25 — Scheduled activation and rollback

- **Required behavior:** Approved versions activate at a defined time; rollback creates a new version rather than rewriting history.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts)

### ADM-26 — Checkout-group monitor

- **Required behavior:** Staff see combined customer context while child orders remain visually and operationally isolated.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-27 — Live order monitor

- **Required behavior:** Filters include vendor, state, exception, time-in-state, fulfilment, custody, and settlement risk.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-28 — Immutable order timeline

- **Required behavior:** Authorized staff inspect every state change, actor, time, reason, correlation, and evidence reference.
- **Scope / owner / canonical steps:** Launch; admin-surface; 3.4, 11.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2) → [R8](connected-marketplace-repair-plan.md#r8) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence; Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation; Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts); [database/src/aggregate-versioning.spec.ts](../../database/src/aggregate-versioning.spec.ts)

### ADM-29 — Manual partner assignment

- **Required behavior:** Operations assign or reassign an eligible partner with impact, reason, and preserved attempt history.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-30 — Order intervention preview

- **Required behavior:** Cancel, refund, reassign, return, and other actions show customer, vendor, partner, inventory, and money effects first.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-31 — Protected intervention approval

- **Required behavior:** High-risk or high-value actions wait for an independent authorized decision.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-32 — Custody-aware operations

- **Required behavior:** No intervention can silently end or lose an active package-custody obligation.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-33 — Incident kill switches

- **Required behavior:** Staff can pause a scoped vendor, category, zone, fulfilment mode, payment method, integration, promotion, payout, or new grouped checkout.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-34 — Incident impact preview

- **Required behavior:** Controls show affected new work, existing obligations, owner, reason, expiry/review, and recovery checklist.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-35 — Reversible incident recovery

- **Required behavior:** Controls expire or are rolled back explicitly without cancelling existing work or rewriting ledger history.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-36 — Structured support cases

- **Required behavior:** Cases attach to the smallest affected order, assignment, payment, ledger line, vendor, partner, or account.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-37 — SLA-ranked support queue

- **Required behavior:** Category, risk, age, owner, response deadline, current instruction, and next action drive prioritization.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-38 — Safe evidence viewer

- **Required behavior:** Access-controlled evidence displays classification, source, retention, and permitted viewers.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-39 — Internal and participant-visible messages

- **Required behavior:** Staff separate private operational notes from messages that customers, vendors, or partners may see.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-40 — Resolution templates

- **Required behavior:** Controlled refunds, credits, communication, restriction, return, and closure actions use versioned templates.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-41 — Case merge, reopen, and escalation

- **Required behavior:** Duplicate cases merge without losing history; eligible outcomes can be reopened or escalated.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-42 — Trust and safety review

- **Required behavior:** Signals open evidence-based review rather than directly applying irreversible punishment.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-43 — Linked-risk investigation

- **Required behavior:** Authorized specialists inspect relevant accounts, devices, orders, signals, prior decisions, and evidence quality.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-44 — Restriction review and appeal

- **Required behavior:** Temporary or lasting restrictions have policy basis, scope, reason, review date, impact, and appeal.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-45 — Payment reconciliation queue

- **Required behavior:** Unknown, missing, mismatched, duplicated, failed, or unmatched provider outcomes become owned work.
- **Scope / owner / canonical steps:** Launch; admin-surface; 10.5, 11.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/money-lifecycle-reads.spec.ts](../../apps/api/src/money-lifecycle-reads.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### ADM-46 — Refund reconciliation queue

- **Required behavior:** Pending, failed, duplicated-risk, or mismatched refunds retain provider, allocation, retry, and approval context.
- **Scope / owner / canonical steps:** Launch; admin-surface; 10.2, 11.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/money-lifecycle-reads.spec.ts](../../apps/api/src/money-lifecycle-reads.spec.ts); [apps/api/src/money-lifecycle.controller.spec.ts](../../apps/api/src/money-lifecycle.controller.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### ADM-47 — Ledger integrity queue

- **Required behavior:** Unbalanced or unexpected postings block closure and can only be corrected with reversal/adjustment entries.
- **Scope / owner / canonical steps:** Launch; admin-surface; 10.7, 11.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/money-lifecycle-reads.spec.ts](../../apps/api/src/money-lifecycle-reads.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### ADM-48 — Vendor settlement queue

- **Required behavior:** Expected and actual vendor amounts reconcile per order and provider statement.
- **Scope / owner / canonical steps:** Launch; admin-surface; 10.3, 11.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/money-lifecycle-reads.spec.ts](../../apps/api/src/money-lifecycle-reads.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### ADM-49 — Partner earning and payout queue

- **Required behavior:** Trip earnings and payout failures reconcile to immutable work and ledger references.
- **Scope / owner / canonical steps:** Launch; admin-surface; 10.4, 11.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/money-lifecycle-reads.spec.ts](../../apps/api/src/money-lifecycle-reads.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### ADM-50 — Idempotent financial correction

- **Required behavior:** Safe retries, reversals, and adjustments replace direct mutation or force-balance controls.
- **Scope / owner / canonical steps:** Launch; admin-surface; 10.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/complete-money-lifecycle.controller.spec.ts](../../apps/api/src/complete-money-lifecycle.controller.spec.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### ADM-51 — Searchable audit log

- **Required behavior:** Sensitive actions record actor, capability, target, before/after, reason, time, request, and approval reference.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.9.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-52 — Read-only audit access

- **Required behavior:** Audit history cannot be edited through the product and is permission-filtered for reporting or investigation.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.9.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### ADM-53 — Marketplace dashboard

- **Required behavior:** Authorized staff see GMV, completed orders, take rate, active supply/demand, and repeat rate.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

### ADM-54 — Vendor health reporting

- **Required behavior:** Acceptance, cancellation, preparation, rating, fulfilment, support, and repeat-demand indicators are visible.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

### ADM-55 — Delivery operations reporting

- **Required behavior:** Offer, acceptance, pickup, waiting, completion, return, safety, and payout measures are available by scope.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

### ADM-56 — Customer funnel reporting

- **Required behavior:** Address eligibility, discovery, search, cart, fee exposure, checkout, and repeat behaviour are measured with privacy controls.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

### ADM-57 — Finance reporting

- **Required behavior:** Revenue, fees, refunds, settlements, earnings, payouts, mismatches, and contribution are reconciled.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

### ADM-58 — Exportable reports

- **Required behavior:** Role-scoped exports retain filters, generation actor, time, data classification, and expiry.
- **Scope / owner / canonical steps:** Launch; admin-surface; 11.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/admin-pwa/app/admin-panels.spec.ts](../../apps/admin-pwa/app/admin-panels.spec.ts); [apps/api/src/admin-control-plane.controller.spec.ts](../../apps/api/src/admin-control-plane.controller.spec.ts)

## Domain engines

### ENG-01 — Canonical state machines

- **Required behavior:** Checkout, vendor order, reservation, assignment, custody, payment, refund, settlement, and case transitions use explicit allowed states.
- **Scope / owner / canonical steps:** Launch; platform; 3.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/src/aggregate-versioning.spec.ts](../../database/src/aggregate-versioning.spec.ts)

### ENG-02 — Attributable transition records

- **Required behavior:** Every transition stores actor, reason, time, aggregate version, correlation, causation, and required evidence.
- **Scope / owner / canonical steps:** Launch; platform; 3.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/src/aggregate-versioning.spec.ts](../../database/src/aggregate-versioning.spec.ts)

### ENG-03 — Optimistic conflict protection

- **Required behavior:** Stale edits return a recoverable conflict instead of overwriting newer state.
- **Scope / owner / canonical steps:** Launch; platform; 3.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/src/aggregate-versioning.spec.ts](../../database/src/aggregate-versioning.spec.ts)

### ENG-04 — Reservation lifecycle

- **Required behavior:** Inventory progresses through no reservation, soft hold, provisional placement, committed acceptance, release, or expiry.
- **Scope / owner / canonical steps:** Launch; platform; 7.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/vendor-inventory.controller.spec.ts](../../apps/api/src/vendor-inventory.controller.spec.ts); [database/scripts/verify-inventory-reservations.ts](../../database/scripts/verify-inventory-reservations.ts)

### ENG-05 — Last-unit concurrency protection

- **Required behavior:** Competing customers cannot both commit the final counted unit.
- **Scope / owner / canonical steps:** Launch; platform; 7.2, 7.8.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/vendor-inventory.controller.spec.ts](../../apps/api/src/vendor-inventory.controller.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/scripts/verify-inventory-reservations.ts](../../database/scripts/verify-inventory-reservations.ts)

### ENG-06 — Quote snapshots

- **Required behavior:** Orders retain the product, price, tax, fee, promise, policy, and customer-preference facts accepted at checkout.
- **Scope / owner / canonical steps:** Launch; platform; 7.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/src/checkout-pricing.spec.ts](../../database/src/checkout-pricing.spec.ts)

### ENG-07 — Payment allocation by child order

- **Required behavior:** Captured payment is allocated across vendor orders for independent refunds, settlement eligibility and reconciliation; repeated partial captures are not assumed.
- **Scope / owner / canonical steps:** Launch; platform; 7.5, 10.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6) → [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions; Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views; Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/grouped-checkout.controller.spec.ts](../../apps/api/src/grouped-checkout.controller.spec.ts); [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts); [database/src/money-policy.spec.ts](../../database/src/money-policy.spec.ts)

### ENG-08 — Append-only double-entry ledger

- **Required behavior:** Vendor, partner, customer, platform, tax, refund, and payout movements balance per currency and are never overwritten.
- **Scope / owner / canonical steps:** Launch; platform; 10.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts); [database/src/money-policy.spec.ts](../../database/src/money-policy.spec.ts)

### ENG-09 — Independent settlement

- **Required behavior:** Each child order can settle, refund, or remain under review without corrupting siblings.
- **Scope / owner / canonical steps:** Launch; platform; 10.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### ENG-10 — Transactional outbox

- **Required behavior:** Business state and follow-up events commit together; consumers are idempotent and tolerate duplicate delivery.
- **Scope / owner / canonical steps:** Launch; platform; 3.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-local-notifications.ts](../../database/scripts/verify-local-notifications.ts); [database/scripts/verify-messaging-lifecycle.ts](../../database/scripts/verify-messaging-lifecycle.ts); [database/src/transactional-messaging.spec.ts](../../database/src/transactional-messaging.spec.ts)

### ENG-11 — Idempotent provider webhooks

- **Required behavior:** Duplicate or reordered provider events cannot duplicate money or state transitions.
- **Scope / owner / canonical steps:** Launch; platform; 3.3, 7.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2) → [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence; Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation; Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/scripts/verify-reference-module.ts](../../database/scripts/verify-reference-module.ts); [database/src/idempotency.spec.ts](../../database/src/idempotency.spec.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts)

### ENG-12 — Deadline and scheduled-job engine

- **Required behavior:** Vendor response, customer decision, hold expiry, wait, proof, refund, payout, and review timers are durable and retryable.
- **Scope / owner / canonical steps:** Launch; platform; 3.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-jobs-lifecycle.ts](../../database/scripts/verify-jobs-lifecycle.ts); [database/src/durable-jobs.spec.ts](../../database/src/durable-jobs.spec.ts)

### ENG-13 — Notification orchestration

- **Required behavior:** Domain events produce actor-appropriate in-app, push, SMS, or provider fallback attempts with delivery history.
- **Scope / owner / canonical steps:** Launch; platform; 3.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-local-notifications.ts](../../database/scripts/verify-local-notifications.ts); [database/scripts/verify-messaging-lifecycle.ts](../../database/scripts/verify-messaging-lifecycle.ts); [database/src/transactional-messaging.spec.ts](../../database/src/transactional-messaging.spec.ts)

### ENG-14 — Return and custody closure

- **Required behavior:** Returns close physical custody independently from later refund, earning, settlement, or dispute resolution.
- **Scope / owner / canonical steps:** Launch; platform; 9.9.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-assignment-custody.ts](../../database/scripts/verify-assignment-custody.ts)

### ENG-15 — Reconciliation workers

- **Required behavior:** Provider statements and internal orders, payments, refunds, settlements, earnings, and payouts are compared continuously.
- **Scope / owner / canonical steps:** Launch; platform; 10.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

## Communication

### COM-01 — In-app notification history

- **Required behavior:** Each actor can review relevant actionable and informational notifications.
- **Scope / owner / canonical steps:** Launch; platform; 4.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [apps/customer-pwa/app/customer-panels.spec.ts](../../apps/customer-pwa/app/customer-panels.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts)

### COM-02 — Push notifications

- **Required behavior:** Supported devices receive time-sensitive order, assignment, decision, and support updates.
- **Scope / owner / canonical steps:** Launch; platform; 4.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts)

### COM-03 — SMS fallback

- **Required behavior:** Approved critical alerts may use SMS when push acknowledgement or delivery fails.
- **Scope / owner / canonical steps:** Launch; platform; 4.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts)

### COM-04 — Notification deduplication

- **Required behavior:** Retries and duplicate events do not create misleading repeated actions.
- **Scope / owner / canonical steps:** Launch; platform; 3.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/false/true`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-local-notifications.ts](../../database/scripts/verify-local-notifications.ts); [database/scripts/verify-messaging-lifecycle.ts](../../database/scripts/verify-messaging-lifecycle.ts); [database/src/transactional-messaging.spec.ts](../../database/src/transactional-messaging.spec.ts)

### COM-05 — Deep links to safe context

- **Required behavior:** Notifications open the exact authorized order, assignment, decision, or case state.
- **Scope / owner / canonical steps:** Launch; platform; 4.5.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts)

### COM-06 — Template-first messaging

- **Required behavior:** Common customer/vendor/partner communications use localized, approved templates.
- **Scope / owner / canonical steps:** Launch; platform; 12.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/locale.controller.spec.ts](../../apps/api/src/locale.controller.spec.ts); [packages/i18n/src/runtime.spec.ts](../../packages/i18n/src/runtime.spec.ts)

### COM-07 — Auditable delivery attempts

- **Required behavior:** Channel, provider reference, attempt, result, and retry state remain observable.
- **Scope / owner / canonical steps:** Launch; platform; 3.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/false/true`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-local-notifications.ts](../../database/scripts/verify-local-notifications.ts); [database/scripts/verify-messaging-lifecycle.ts](../../database/scripts/verify-messaging-lifecycle.ts); [database/src/transactional-messaging.spec.ts](../../database/src/transactional-messaging.spec.ts)

### COM-08 — Privacy-safe masked calling

- **Required behavior:** Approved active-order cases can use time-bounded masked contact without recording call content by default.
- **Scope / owner / canonical steps:** Later; platform; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

## Security and privacy

### SEC-01 — Least-privilege authorization

- **Required behavior:** Customer ownership, vendor membership, active partner assignment, and admin capability are checked on every operation.
- **Scope / owner / canonical steps:** Launch; platform; 4.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/authorization.guard.spec.ts](../../apps/api/src/authorization.guard.spec.ts); [apps/api/src/cross-role-denial.spec.ts](../../apps/api/src/cross-role-denial.spec.ts); [e2e/auth-gates.spec.ts](../../e2e/auth-gates.spec.ts)

### SEC-02 — Cross-tenant isolation

- **Required behavior:** One customer, vendor, or partner cannot read or mutate another party's protected resources.
- **Scope / owner / canonical steps:** Launch; platform; 4.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/cross-role-denial.spec.ts](../../apps/api/src/cross-role-denial.spec.ts); [database/scripts/verify-identity-access.ts](../../database/scripts/verify-identity-access.ts); [e2e/auth-gates.spec.ts](../../e2e/auth-gates.spec.ts)

### SEC-03 — Stage-gated personal data

- **Required behavior:** Exact customer address and contact access appear only to actors who need them at the current fulfilment stage.
- **Scope / owner / canonical steps:** Launch; platform; 4.4, 9.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/authorization.guard.spec.ts](../../apps/api/src/authorization.guard.spec.ts); [apps/api/src/cross-role-denial.spec.ts](../../apps/api/src/cross-role-denial.spec.ts); [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### SEC-04 — Encryption in transit and at rest

- **Required behavior:** Sensitive application, provider, database, object, and local-offline data use approved encryption.
- **Scope / owner / canonical steps:** Launch; platform; 0.3, 12.1.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `false`, Android `false`; domain/API/worker `true/false/false`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0) → [R12](connected-marketplace-repair-plan.md#r12). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states; QA/release/operations evidence and in-app availability states; activation only after approval.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build; Cross-role tests + provider/security/recovery/load evidence → explicit decision; synthetic pass is not production approval.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/cors.spec.ts](../../apps/api/src/cors.spec.ts); [apps/api/src/runtime-config.spec.ts](../../apps/api/src/runtime-config.spec.ts); [database/src/runtime-config.spec.ts](../../database/src/runtime-config.spec.ts); [tooling/scripts/scan-secrets.mjs](../../tooling/scripts/scan-secrets.mjs)

### SEC-05 — Secret and credential management

- **Required behavior:** Credentials stay outside source and logs, rotate under policy, and use scoped service identities.
- **Scope / owner / canonical steps:** Launch; platform; 0.4, 2.2.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts); [database/src/runtime-config.spec.ts](../../database/src/runtime-config.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts); [tooling/scripts/scan-secrets.mjs](../../tooling/scripts/scan-secrets.mjs)

### SEC-06 — OTP and session abuse protection

- **Repair checkpoint:** [Batch 01](repair-batch-01-evidence.md): customer completion cannot regrant revoked/expired access or replay consumed-code tokens; boundary tests pass. Broader abuse, load, provider and observability acceptance remain open.

- **Required behavior:** Rate, attempt, device, replay, session rotation, and suspicious-activity controls are observable.
- **Scope / owner / canonical steps:** Launch; platform; 4.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/otp.controller.spec.ts](../../apps/api/src/otp.controller.spec.ts); [database/scripts/verify-otp-identity.ts](../../database/scripts/verify-otp-identity.ts); [database/src/otp-identity.spec.ts](../../database/src/otp-identity.spec.ts)

### SEC-07 — Webhook authenticity

- **Required behavior:** Provider callbacks require signature, timestamp/replay, payload, and idempotency validation.
- **Scope / owner / canonical steps:** Launch; platform; 7.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts)

### SEC-08 — Upload protection

- **Required behavior:** Documents and evidence are type/size checked, malware-scanned where required, classified, and access controlled.
- **Scope / owner / canonical steps:** Launch; platform; 5.5, 12.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R4](connected-marketplace-repair-plan.md#r4) → [R12](connected-marketplace-repair-plan.md#r12). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability; QA/release/operations evidence and in-app availability states; activation only after approval.
- **Synchronization contract:** Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation; Cross-role tests + provider/security/recovery/load evidence → explicit decision; synthetic pass is not production approval.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-products.controller.spec.ts](../../apps/api/src/catalogue-products.controller.spec.ts); [apps/api/src/cors.spec.ts](../../apps/api/src/cors.spec.ts); [database/scripts/verify-catalogue-products.ts](../../database/scripts/verify-catalogue-products.ts); [database/src/protected-object-storage.spec.ts](../../database/src/protected-object-storage.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts); [tooling/scripts/scan-secrets.mjs](../../tooling/scripts/scan-secrets.mjs)

### SEC-09 — Log and event redaction

- **Required behavior:** OTPs, bank data, unnecessary addresses, private documents, and future health data do not enter general telemetry.
- **Scope / owner / canonical steps:** Launch; platform; 3.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/request-context-storage.spec.ts](../../apps/api/src/request-context-storage.spec.ts); [packages/domain-types/src/redaction.spec.ts](../../packages/domain-types/src/redaction.spec.ts); [packages/domain-types/src/request-context.spec.ts](../../packages/domain-types/src/request-context.spec.ts)

### SEC-10 — Consent records

- **Required behavior:** Consent purpose, version, actor, time, and withdrawal status are retained where required.
- **Scope / owner / canonical steps:** Launch; platform; 4.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts)

### SEC-11 — Retention and deletion engine

- **Required behavior:** Data classes follow approved retention, legal hold, deletion, and proof-recovery policy.
- **Scope / owner / canonical steps:** Launch; platform; 4.5, 12.1.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11) → [R12](connected-marketplace-repair-plan.md#r12). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states; QA/release/operations evidence and in-app availability states; activation only after approval.
- **Synchronization contract:** Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state; Cross-role tests + provider/security/recovery/load evidence → explicit decision; synthetic pass is not production approval.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/cors.spec.ts](../../apps/api/src/cors.spec.ts); [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts); [tooling/scripts/scan-secrets.mjs](../../tooling/scripts/scan-secrets.mjs)

### SEC-12 — Device and location integrity signals

- **Required behavior:** Mock GPS, replayed proof, impossible movement, compromised device, or sharing patterns inform review without automatic guilt.
- **Scope / owner / canonical steps:** Launch; platform; 9.4.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R8](connected-marketplace-repair-plan.md#r8). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Partner Work/Active/proofs/emergency/return; vendor handoff; customer tracking; admin dispatch/incidents.
- **Synchronization contract:** Offer → assignment → verified custody → delivery/return → order timeline/earnings; privacy bounded by stage.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/src/partner-field-ops.spec.ts](../../database/src/partner-field-ops.spec.ts)

### SEC-13 — Maker-checker controls

- **Required behavior:** Protected money, restriction, configuration, and incident actions require independent approval at configured thresholds.
- **Scope / owner / canonical steps:** Launch; platform; 10.6, 11.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R9](connected-marketplace-repair-plan.md#r9) → [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/complete-money-lifecycle.controller.spec.ts](../../apps/api/src/complete-money-lifecycle.controller.spec.ts); [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts); [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts)

### SEC-14 — Appeal and human-review paths

- **Required behavior:** Material automated or staff-assisted decisions expose reason, evidence basis, review state, and appeal where policy requires.
- **Scope / owner / canonical steps:** Launch; platform; 11.4.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R10](connected-marketplace-repair-plan.md#r10). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit.
- **Synchronization contract:** Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-admin-control-plane.ts](../../database/scripts/verify-admin-control-plane.ts)

### SEC-15 — Pharmacy data isolation

- **Required behavior:** Prescription and health information use separate access, storage, audit, retention, and event boundaries.
- **Scope / owner / canonical steps:** Gated; platform; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `gated`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Keep server capability and UI disabled until named legal/financial/safety/operational approval; then define implementation and activation tests.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** [apps/api/src/gated-capabilities.controller.spec.ts](../../apps/api/src/gated-capabilities.controller.spec.ts)

## Experience

### UX-01 — Responsive customer experience

- **Required behavior:** Critical customer journeys work from 360 px mobile width through supported desktop layouts.
- **Scope / owner / canonical steps:** Launch; design-system; 12.2.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `true`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [packages/ui/src/accessibility.spec.ts](../../packages/ui/src/accessibility.spec.ts)

### UX-02 — Low-end Android operational support

- **Required behavior:** Vendor and partner critical tasks remain usable on modest hardware and standard mobile networks.
- **Scope / owner / canonical steps:** Launch; design-system; 12.4.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `false`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### UX-03 — Keyboard operation

- **Required behavior:** All critical web actions are reachable, visible, ordered, and completable by keyboard.
- **Scope / owner / canonical steps:** Launch; design-system; 12.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [packages/ui/src/accessibility.spec.ts](../../packages/ui/src/accessibility.spec.ts)

### UX-04 — Screen-reader semantics

- **Required behavior:** Structure, labels, status changes, errors, dialogs, timers, and proof states have meaningful announcements.
- **Scope / owner / canonical steps:** Launch; design-system; 12.2.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `true`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [packages/ui/src/accessibility.spec.ts](../../packages/ui/src/accessibility.spec.ts)

### UX-05 — 200% zoom and reflow

- **Required behavior:** Critical flows remain readable and operable without two-dimensional scrolling at supported widths.
- **Scope / owner / canonical steps:** Launch; design-system; 12.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [packages/ui/src/accessibility.spec.ts](../../packages/ui/src/accessibility.spec.ts)

### UX-06 — Accessible time limits

- **Required behavior:** Users receive clear deadlines, warnings, and permitted extensions or support alternatives.
- **Scope / owner / canonical steps:** Launch; design-system; 12.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [packages/ui/src/accessibility.spec.ts](../../packages/ui/src/accessibility.spec.ts)

### UX-07 — Non-colour status communication

- **Required behavior:** State and severity use text/icon/structure in addition to colour.
- **Scope / owner / canonical steps:** Launch; design-system; 12.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [packages/ui/src/accessibility.spec.ts](../../packages/ui/src/accessibility.spec.ts)

### UX-08 — English/Hindi expansion tolerance

- **Required behavior:** Layouts handle translated strings without truncating critical information or actions.
- **Scope / owner / canonical steps:** Launch; design-system; 12.3.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/locale.controller.spec.ts](../../apps/api/src/locale.controller.spec.ts); [packages/i18n/src/runtime.spec.ts](../../packages/i18n/src/runtime.spec.ts)

### UX-09 — Loading, empty, error, stale, and success states

- **Required behavior:** Every core screen defines actionable non-happy states rather than blank or ambiguous UI.
- **Scope / owner / canonical steps:** Launch; design-system; 12.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [packages/ui/src/accessibility.spec.ts](../../packages/ui/src/accessibility.spec.ts)

### UX-10 — Reconnect-safe active work

- **Required behavior:** Customers, vendors, and partners restore server-confirmed state after connection loss.
- **Scope / owner / canonical steps:** Launch; design-system; 12.4.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `unverified`, Android `unverified`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### UX-11 — Reduced motion

- **Required behavior:** Motion communicates feedback and respects the user's reduced-motion preference.
- **Scope / owner / canonical steps:** Launch; design-system; 12.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `true`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [packages/ui/src/accessibility.spec.ts](../../packages/ui/src/accessibility.spec.ts)

### UX-12 — Text alternative to maps

- **Required behavior:** Addresses, landmarks, instructions, and support remain available when maps fail or are inaccessible.
- **Scope / owner / canonical steps:** Launch; design-system; 12.2.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `true`, Android `unverified`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [packages/ui/src/accessibility.spec.ts](../../packages/ui/src/accessibility.spec.ts)

## Operations

### OPS-01 — Health and readiness checks

- **Required behavior:** Services expose dependency-aware health without leaking protected configuration.
- **Scope / owner / canonical steps:** Launch; platform; 2.3.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/scripts/health-smoke.mjs](../../apps/api/scripts/health-smoke.mjs); [apps/api/src/health.controller.spec.ts](../../apps/api/src/health.controller.spec.ts)

### OPS-02 — Structured logs

- **Required behavior:** Requests, jobs, providers, transitions, and failures share stable correlation identifiers and redaction.
- **Scope / owner / canonical steps:** Launch; platform; 2.3, 3.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0) → [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states; Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build; Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/scripts/health-smoke.mjs](../../apps/api/scripts/health-smoke.mjs); [apps/api/src/health.controller.spec.ts](../../apps/api/src/health.controller.spec.ts); [apps/api/src/request-context-storage.spec.ts](../../apps/api/src/request-context-storage.spec.ts); [packages/domain-types/src/redaction.spec.ts](../../packages/domain-types/src/redaction.spec.ts); [packages/domain-types/src/request-context.spec.ts](../../packages/domain-types/src/request-context.spec.ts)

### OPS-03 — Distributed tracing

- **Required behavior:** Critical checkout, fulfilment, payment, and support flows can be followed across modules and workers.
- **Scope / owner / canonical steps:** Launch; platform; 3.2.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `false/true/false`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/request-context-storage.spec.ts](../../apps/api/src/request-context-storage.spec.ts); [packages/domain-types/src/redaction.spec.ts](../../packages/domain-types/src/redaction.spec.ts); [packages/domain-types/src/request-context.spec.ts](../../packages/domain-types/src/request-context.spec.ts)

### OPS-04 — Business and technical metrics

- **Required behavior:** Latency, errors, queues, locks, provider outcomes, state ageing, and business invariants are measurable.
- **Scope / owner / canonical steps:** Launch; platform; 3.6, 12.6.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/false/true`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2) → [R12](connected-marketplace-repair-plan.md#r12). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence; QA/release/operations evidence and in-app availability states; activation only after approval.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation; Cross-role tests + provider/security/recovery/load evidence → explicit decision; synthetic pass is not production approval.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-jobs-lifecycle.ts](../../database/scripts/verify-jobs-lifecycle.ts); [database/src/durable-jobs.spec.ts](../../database/src/durable-jobs.spec.ts); [tooling/scripts/load-smoke.mjs](../../tooling/scripts/load-smoke.mjs)

### OPS-05 — Actionable alerting

- **Required behavior:** Alerts have severity, owner, runbook, affected scope, and safe first response.
- **Scope / owner / canonical steps:** Launch; platform; 12.7.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R12](connected-marketplace-repair-plan.md#r12). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** QA/release/operations evidence and in-app availability states; activation only after approval.
- **Synchronization contract:** Cross-role tests + provider/security/recovery/load evidence → explicit decision; synthetic pass is not production approval.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-launch-readiness.ts](../../database/scripts/verify-launch-readiness.ts)

### OPS-06 — Durable job processing

- **Required behavior:** Retries use backoff and idempotency; poison work reaches a visible dead-letter/recovery path.
- **Scope / owner / canonical steps:** Launch; platform; 3.6.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/false/true`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-jobs-lifecycle.ts](../../database/scripts/verify-jobs-lifecycle.ts); [database/src/durable-jobs.spec.ts](../../database/src/durable-jobs.spec.ts)

### OPS-07 — Database migrations

- **Required behavior:** Changes follow expand, compatible reader/writer, scoped rollout, and later contraction.
- **Scope / owner / canonical steps:** Launch; platform; 2.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/false/false`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-lifecycle.ts](../../database/scripts/verify-lifecycle.ts)

### OPS-08 — Feature flags

- **Required behavior:** Risky behaviour rolls out by internal user, vendor, category, zone, or cohort without rewriting history.
- **Scope / owner / canonical steps:** Launch; platform; 3.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts); [database/src/versioned-configuration.spec.ts](../../database/src/versioned-configuration.spec.ts)

### OPS-09 — Configuration validation

- **Required behavior:** Startup and activation fail safely when required configuration or policy dependencies are invalid.
- **Scope / owner / canonical steps:** Launch; platform; 3.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R2](connected-marketplace-repair-plan.md#r2). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Shared client/error/navigation primitives and affected role tasks; admin operational evidence.
- **Synchronization contract:** Versioned command/transaction/outbox → deduplicated consumer → authorized projection invalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/configuration.controller.spec.ts](../../apps/api/src/configuration.controller.spec.ts); [database/scripts/verify-configuration-lifecycle.ts](../../database/scripts/verify-configuration-lifecycle.ts); [database/src/versioned-configuration.spec.ts](../../database/src/versioned-configuration.spec.ts)

### OPS-10 — Non-production environments

- **Required behavior:** Development, test, staging, and production use isolated data and provider credentials.
- **Scope / owner / canonical steps:** Launch; platform; 2.6.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [tooling/scripts/verify-online-test-deployment.mjs](../../tooling/scripts/verify-online-test-deployment.mjs)

### OPS-11 — Automated test pipeline

- **Required behavior:** Unit, property, integration, contract, API, UI, end-to-end, security, resilience, and performance gates run as applicable.
- **Scope / owner / canonical steps:** Launch; platform; 2.5.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [tooling/scripts/verify-ci-workflow.mjs](../../tooling/scripts/verify-ci-workflow.mjs)

### OPS-12 — Backup and point-in-time recovery

- **Required behavior:** Transactional data and object references follow approved RPO/RTO and restore procedures.
- **Scope / owner / canonical steps:** Launch; platform; 12.7.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R12](connected-marketplace-repair-plan.md#r12). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** QA/release/operations evidence and in-app availability states; activation only after approval.
- **Synchronization contract:** Cross-role tests + provider/security/recovery/load evidence → explicit decision; synthetic pass is not production approval.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-launch-readiness.ts](../../database/scripts/verify-launch-readiness.ts)

### OPS-13 — Restore drills

- **Required behavior:** The team proves recovery in a non-production environment and records evidence before launch.
- **Scope / owner / canonical steps:** Launch; platform; 12.7.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R12](connected-marketplace-repair-plan.md#r12). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** QA/release/operations evidence and in-app availability states; activation only after approval.
- **Synchronization contract:** Cross-role tests + provider/security/recovery/load evidence → explicit decision; synthetic pass is not production approval.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-launch-readiness.ts](../../database/scripts/verify-launch-readiness.ts)

### OPS-14 — Safe rollback

- **Required behavior:** Code, flag, and configuration rollback preserve accepted orders, custody, events, and ledger history.
- **Scope / owner / canonical steps:** Launch; platform; 2.6, 12.7.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0) → [R12](connected-marketplace-repair-plan.md#r12). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states; QA/release/operations evidence and in-app availability states; activation only after approval.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build; Cross-role tests + provider/security/recovery/load evidence → explicit decision; synthetic pass is not production approval.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-launch-readiness.ts](../../database/scripts/verify-launch-readiness.ts); [tooling/scripts/verify-online-test-deployment.mjs](../../tooling/scripts/verify-online-test-deployment.mjs)

### OPS-15 — Operational runbooks

- **Required behavior:** Checkout, payment, dispatch, proof, return, queue, provider, security, and reconciliation failures have owned procedures.
- **Scope / owner / canonical steps:** Launch; platform; 12.7.
- **Inherited claim, not reverified:** `partial_workflow`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R12](connected-marketplace-repair-plan.md#r12). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** QA/release/operations evidence and in-app availability states; activation only after approval.
- **Synchronization contract:** Cross-role tests + provider/security/recovery/load evidence → explicit decision; synthetic pass is not production approval.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-launch-readiness.ts](../../database/scripts/verify-launch-readiness.ts)

### OPS-16 — Capacity and performance targets

- **Required behavior:** Supported traffic meets agreed response-time and throughput targets under representative multi-store and dispatch load.
- **Scope / owner / canonical steps:** Launch; platform; 12.6.
- **Inherited claim, not reverified:** `not_started`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation sequence:** [R12](connected-marketplace-repair-plan.md#r12). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** QA/release/operations evidence and in-app availability states; activation only after approval.
- **Synchronization contract:** Cross-role tests + provider/security/recovery/load evidence → explicit decision; synthetic pass is not production approval.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [tooling/scripts/load-smoke.mjs](../../tooling/scripts/load-smoke.mjs)

## Integrations

### INT-01 — OTP provider

- **Required behavior:** Provider-neutral adapter supports request, verification outcome, timeout, error, and abuse telemetry.
- **Scope / owner / canonical steps:** Launch; platform; 0.4, 4.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0) → [R1](connected-marketplace-repair-plan.md#r1). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states; Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build; Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/otp.controller.spec.ts](../../apps/api/src/otp.controller.spec.ts); [database/scripts/verify-otp-identity.ts](../../database/scripts/verify-otp-identity.ts); [database/src/otp-identity.spec.ts](../../database/src/otp-identity.spec.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts); [database/src/runtime-config.spec.ts](../../database/src/runtime-config.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### INT-02 — Payment provider

- **Required behavior:** Authorization, capture, refund, webhook, unknown result, and reconciliation are supported through a verified adapter.
- **Scope / owner / canonical steps:** Launch; platform; 0.4, 7.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `unverified`, Android `unverified`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0) → [R6](connected-marketplace-repair-plan.md#r6). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states; Customer Checkout/payment recovery/group overview; vendor paid-order queue; admin payment/hold exceptions.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build; Durable checkout/payment attempt → verified money state → child orders/inventory → scoped customer/vendor/admin views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-grouped-checkout.ts](../../database/scripts/verify-grouped-checkout.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts); [database/src/runtime-config.spec.ts](../../database/src/runtime-config.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### INT-03 — Payout provider

- **Required behavior:** Vendor and partner payouts expose batch, item, failure, retry, statement, and reconciliation behaviour.
- **Scope / owner / canonical steps:** Launch; platform; 0.4, 10.4.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0) → [R9](connected-marketplace-repair-plan.md#r9). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states; Customer cancellation/refund/receipt; vendor Money/statements/disputes; partner Earnings/payouts; admin Finance.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build; Child allocation + immutable ledger → refund/settlement/earnings → provider reconciliation → authorized money views.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [database/scripts/verify-money-lifecycle.ts](../../database/scripts/verify-money-lifecycle.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts); [database/src/runtime-config.spec.ts](../../database/src/runtime-config.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### INT-04 — Maps/geocoding/routing

- **Required behavior:** Address search, coordinates, distance, route estimates, and map handoff degrade to text and manual review.
- **Scope / owner / canonical steps:** Launch; platform; 0.4, 6.1.
- **Inherited claim, not reverified:** `backend_only`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0) → [R5](connected-marketplace-repair-plan.md#r5). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states; Customer addresses/location, Home/Categories/Stores/Search/detail/favourites/cart; admin shop-request pipeline.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build; Selected address + eligible named store + current product → server cart; address/supply changes invalidate options.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-addresses.controller.spec.ts](../../apps/api/src/customer-addresses.controller.spec.ts); [database/scripts/verify-customer-addresses.ts](../../database/scripts/verify-customer-addresses.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts); [database/src/runtime-config.spec.ts](../../database/src/runtime-config.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### INT-05 — Push notification provider

- **Required behavior:** Device registration, delivery attempt, invalid token, fallback, and removal are observable.
- **Scope / owner / canonical steps:** Launch; platform; 0.4, 4.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0) → [R1](connected-marketplace-repair-plan.md#r1) → [R10](connected-marketplace-repair-plan.md#r10) → [R11](connected-marketplace-repair-plan.md#r11). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states; Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection; Participant Support/Notifications; admin queues/Support/Trust/Finance/Zones/Incidents/Reports/Audit; Every applicable role task, shared tokens/semantics, EN/HI, native route/back/restart/offline states.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build; Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes; Scoped case/policy/incident/message → audited worker delivery → participant instructions and affected workflows; Equivalent business behavior across platforms; design does not change authorization/money/proof/state.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/customer-preferences.controller.spec.ts](../../apps/api/src/customer-preferences.controller.spec.ts); [apps/api/src/notifications.controller.spec.ts](../../apps/api/src/notifications.controller.spec.ts); [database/scripts/verify-identity-preferences.ts](../../database/scripts/verify-identity-preferences.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts); [database/src/runtime-config.spec.ts](../../database/src/runtime-config.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### INT-06 — SMS provider

- **Required behavior:** Critical fallback templates, delivery status, cost, retry, and opt-out rules are controlled.
- **Scope / owner / canonical steps:** Launch; platform; 0.4, 4.1.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/true`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0) → [R1](connected-marketplace-repair-plan.md#r1). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states; Login/invite/setup; Account/sessions/privacy; authorized location/assignment selection.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build; Verified identity → permitted membership → session/resource bootstrap; revocation invalidates affected scopes.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/otp.controller.spec.ts](../../apps/api/src/otp.controller.spec.ts); [database/scripts/verify-otp-identity.ts](../../database/scripts/verify-otp-identity.ts); [database/src/otp-identity.spec.ts](../../database/src/otp-identity.spec.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts); [database/src/runtime-config.spec.ts](../../database/src/runtime-config.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### INT-07 — Object storage

- **Required behavior:** Product images, verification documents, evidence, and approved proof use scoped signed access and lifecycle rules.
- **Scope / owner / canonical steps:** Launch; platform; 0.4, 5.5.
- **Inherited claim, not reverified:** `complete_local_synthetic`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation sequence:** [R0](connected-marketplace-repair-plan.md#r0) → [R4](connected-marketplace-repair-plan.md#r4). Apply R11 inside the slice and R12 before acceptance.
- **Frontend connection targets:** Developer preflight and in-app service states; Vendor Catalogue/product/stock/import; admin Catalogue/moderation; customer store/product/cart availability.
- **Synchronization contract:** API/DB/queue/worker and eight clients share declared environment/build; Product/stock/media version → moderation/publication → discovery/detail → cart/quote revalidation.
- **Acceptance:** Demonstrate the required behavior through its actual entry, persisted API outcome and affected role projection on each applicable client. Add denied-actor, stale/retry/reconnect and duplicate-effect checks; bind specific G01–G13 scenarios. Record exact commands/IDs/versions and separate PWA/Android evidence, not only a source-text assertion.
- **Existing evidence candidates:** [apps/api/src/catalogue-products.controller.spec.ts](../../apps/api/src/catalogue-products.controller.spec.ts); [database/scripts/verify-catalogue-products.ts](../../database/scripts/verify-catalogue-products.ts); [database/src/protected-object-storage.spec.ts](../../database/src/protected-object-storage.spec.ts); [database/src/provider-ports.spec.ts](../../database/src/provider-ports.spec.ts); [database/src/runtime-config.spec.ts](../../database/src/runtime-config.spec.ts); [database/src/supabase-protected-object-storage.spec.ts](../../database/src/supabase-protected-object-storage.spec.ts)

### INT-08 — POS/inventory connectors

- **Required behavior:** Vendor systems integrate through isolated, idempotent import/sync adapters after core catalogue operations stabilize.
- **Scope / owner / canonical steps:** Later; platform; 14.3.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

## Later capabilities

### FUT-01 — Customer live delivery map

- **Required behavior:** Privacy, partner-device, location-frequency, battery, support, and safety policy proven.
- **Scope / owner / canonical steps:** Later; later-scope; 14.2.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-02 — Batch delivery assignment

- **Required behavior:** Single-order assignment, waiting, custody, and earnings accuracy proven.
- **Scope / owner / canonical steps:** Later; later-scope; 14.2.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-03 — Automated route optimization

- **Required behavior:** Reliable routing data, partner choice, service constraints, and exception handling proven.
- **Scope / owner / canonical steps:** Later; later-scope; 14.2.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-04 — Cross-store route consolidation

- **Required behavior:** Pickup reliability, package separation, custody, ETA, fee allocation, and customer communication proven.
- **Scope / owner / canonical steps:** Later; later-scope; 14.2.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-05 — Loyalty rewards

- **Required behavior:** Reward economics, expiry, refund, abuse, accounting, and disclosure policy approved.
- **Scope / owner / canonical steps:** Later; later-scope; 14.1.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-06 — Recurring baskets

- **Required behavior:** Availability refresh, customer confirmation, payment authorization, skip, and cancellation rules approved.
- **Scope / owner / canonical steps:** Later; later-scope; 14.1.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-07 — Shared shopping lists

- **Required behavior:** Household authorization, edit conflicts, privacy, and checkout ownership defined.
- **Scope / owner / canonical steps:** Later; later-scope; 14.1.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-08 — Vendor POS/inventory integrations

- **Required behavior:** Provider contracts, sync conflict ownership, freshness, reconciliation, and support model approved.
- **Scope / owner / canonical steps:** Later; later-scope; 14.3.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-09 — Richer vendor marketing

- **Required behavior:** Consent, frequency, targeting, opt-out, fairness, and measurement controls approved.
- **Scope / owner / canonical steps:** Later; later-scope; 14.3.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-10 — More store categories

- **Required behavior:** Category-specific compliance, catalogue, fulfilment, support, and economics pass.
- **Scope / owner / canonical steps:** Later; later-scope; 14.4.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-11 — B2B ordering

- **Required behavior:** Buyer identity, pricing, tax, credit/payment, quantity, fulfilment, and invoicing model approved.
- **Scope / owner / canonical steps:** Later; later-scope; 14.4.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### FUT-12 — Vendor advertising

- **Required behavior:** Sponsored disclosure, ranking fairness, billing, refunds, moderation, and reporting approved.
- **Scope / owner / canonical steps:** Later; later-scope; 14.3.
- **Inherited claim, not reverified:** `later`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not activate in launch. Create a separate scoped slice after the launch loop is verified.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

## Gated capabilities

### GAT-01 — Cash on delivery

- **Required behavior:** Cash custody, partner/vendor collection, change, failed delivery, fraud, refund, reconciliation, insurance, and payout policy. It remains hidden until approval.
- **Scope / owner / canonical steps:** Gated; gated-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `gated`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation/exposure rule:** Keep server capability and UI disabled until named legal/financial/safety/operational approval; then define implementation and activation tests.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** [apps/api/src/gated-capabilities.controller.spec.ts](../../apps/api/src/gated-capabilities.controller.spec.ts)

### GAT-02 — Pharmacy ordering

- **Required behavior:** Jurisdiction-specific legal review, verified licences, approved categories, prescription handling, pharmacist review, privacy, retention, substitution, delivery, and audit controls.
- **Scope / owner / canonical steps:** Gated; gated-scope; 14.5.
- **Inherited claim, not reverified:** `gated`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation/exposure rule:** Keep server capability and UI disabled until named legal/financial/safety/operational approval; then define implementation and activation tests.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** [apps/api/src/gated-capabilities.controller.spec.ts](../../apps/api/src/gated-capabilities.controller.spec.ts)

### GAT-03 — Prescription upload

- **Required behavior:** Separate protected storage, access, consent, malware scanning, retention, deletion, and human-review workflow.
- **Scope / owner / canonical steps:** Gated; gated-scope; 14.5.
- **Inherited claim, not reverified:** `gated`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation/exposure rule:** Keep server capability and UI disabled until named legal/financial/safety/operational approval; then define implementation and activation tests.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** [apps/api/src/gated-capabilities.controller.spec.ts](../../apps/api/src/gated-capabilities.controller.spec.ts)

### GAT-04 — Prescription-item fulfilment

- **Required behavior:** Licensed human approval; no automatic prescription substitution; minimum necessary delivery data.
- **Scope / owner / canonical steps:** Gated; gated-scope; 14.5.
- **Inherited claim, not reverified:** `gated`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation/exposure rule:** Keep server capability and UI disabled until named legal/financial/safety/operational approval; then define implementation and activation tests.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** [apps/api/src/gated-capabilities.controller.spec.ts](../../apps/api/src/gated-capabilities.controller.spec.ts)

### GAT-05 — Alternative delivery proof

- **Required behavior:** Consent, acceptable scenarios, evidence access, fraud, retention, appeal, and support policy.
- **Scope / owner / canonical steps:** Gated; gated-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `gated`; PWA `false`, Android `false`; domain/API/worker `true/true/false`.
- **Implementation/exposure rule:** Keep server capability and UI disabled until named legal/financial/safety/operational approval; then define implementation and activation tests.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** [apps/api/src/gated-capabilities.controller.spec.ts](../../apps/api/src/gated-capabilities.controller.spec.ts)

## Excluded capabilities

### EXC-01 — Platform-owned inventory or dark stores

- **Required behavior / exclusion rationale:** The product is a vendor-first marketplace for named independent stores.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-02 — Hidden or interchangeable seller identity

- **Required behavior / exclusion rationale:** Customers intentionally choose a vendor location, and orders remain vendor scoped.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-03 — Guaranteed 10-minute delivery

- **Required behavior / exclusion rationale:** Promises must reflect real vendor preparation and local fulfilment conditions.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-04 — One order spanning multiple vendors

- **Required behavior / exclusion rationale:** A checkout may group orders, but every child order belongs to one vendor location.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-05 — Automatic cross-store consolidation at launch

- **Required behavior / exclusion rationale:** Routing, custody, timing, and fee allocation must be proven first.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-06 — Automatic route optimization at launch

- **Required behavior / exclusion rationale:** Manual or simple dispatch is the launch baseline.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-07 — Full POS or accounting replacement

- **Required behavior / exclusion rationale:** Integrations may exchange data, but the product is not the vendor's complete back-office suite.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-08 — Citywide launch before zone economics work

- **Required behavior / exclusion rationale:** Expansion follows evidence from dense, controlled service areas.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-09 — Sponsored ranking at launch

- **Required behavior / exclusion rationale:** Eligible and relevant customer results are not silently reordered by advertising.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-10 — Silent substitution

- **Required behavior / exclusion rationale:** Every replacement follows the customer's recorded rule or explicit decision.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-11 — Cart-level guaranteed reservation

- **Required behavior / exclusion rationale:** Reservation begins only under the documented checkout/acceptance lifecycle.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-12 — Direct database intervention from the admin product

- **Required behavior / exclusion rationale:** Operational correction uses controlled commands, approvals, reversals, and audit.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-13 — Editing or deleting financial history

- **Required behavior / exclusion rationale:** Corrections use append-only reversals and adjustments.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-14 — Irreversible punishment from one automated risk signal

- **Required behavior / exclusion rationale:** Signals create review; attributable human/policy decisions and appeals control material restrictions.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

### EXC-15 — Exposure of prescription or medical details to delivery partners

- **Required behavior / exclusion rationale:** Partners receive only the minimum fulfilment information.
- **Scope / owner / canonical steps:** Excluded; excluded-scope; no launch step mapped; preserve gate.
- **Inherited claim, not reverified:** `excluded`; PWA `false`, Android `false`; domain/API/worker `false/false/false`.
- **Implementation/exposure rule:** Do not implement this excluded behavior. Add negative regression guards in applicable APIs, clients, jobs and admin commands.
- **Cross-role acceptance:** Prove no client, deep link, flag, admin shortcut or worker can bypass this scope boundary; absence of a screen alone is insufficient.
- **Existing evidence candidates:** None recorded; create executable tests for this behavior and its scope gate.

## Canonical phase-step coverage index

All 101 canonical steps are retained, not marked completed. Unmapped governance/manual-pilot/release steps require non-code evidence from their canonical exit gate. Phase 14 remains later/gated.

| Step | Responsibility | Feature IDs recorded | Repair workflow |
|---|---|---|---|
| 0.1 | Establish decision ownership | Process/governance evidence; inspect canonical gate | [R0](connected-marketplace-repair-plan.md#r0) |
| 0.2 | Select launch neighbourhood and cohort | Process/governance evidence; inspect canonical gate | [R0](connected-marketplace-repair-plan.md#r0) |
| 0.3 | Lock client, backend, and hosting direction | SEC-04 | [R0](connected-marketplace-repair-plan.md#r0) |
| 0.4 | Lock providers and financial policy | SEC-05, INT-01, INT-02, INT-03, INT-04, INT-05, INT-06, INT-07 | [R0](connected-marketplace-repair-plan.md#r0) |
| 0.5 | Lock privacy, support, compliance, and recovery policy | Process/governance evidence; inspect canonical gate | [R0](connected-marketplace-repair-plan.md#r0) |
| 1.1 | Prepare the manual operating kit | Process/governance evidence; inspect canonical gate | [R0](connected-marketplace-repair-plan.md#r0) |
| 1.2 | Recruit and verify pilot participants | Process/governance evidence; inspect canonical gate | [R0](connected-marketplace-repair-plan.md#r0) |
| 1.3 | Run end-to-end manual orders | Process/governance evidence; inspect canonical gate | [R0](connected-marketplace-repair-plan.md#r0) |
| 1.4 | Measure results and exceptions | Process/governance evidence; inspect canonical gate | [R0](connected-marketplace-repair-plan.md#r0) |
| 1.5 | Make the build/no-build decision | Process/governance evidence; inspect canonical gate | [R0](connected-marketplace-repair-plan.md#r0) |
| 2.1 | Scaffold the approved repository structure | Process/governance evidence; inspect canonical gate | [R0](connected-marketplace-repair-plan.md#r0) |
| 2.2 | Add code-quality and contribution controls | SEC-05 | [R0](connected-marketplace-repair-plan.md#r0) |
| 2.3 | Create application and worker entry points | OPS-01, OPS-02 | [R0](connected-marketplace-repair-plan.md#r0) |
| 2.4 | Establish database migration and seed flow | OPS-07 | [R0](connected-marketplace-repair-plan.md#r0) |
| 2.5 | Create CI pipeline | OPS-11 | [R0](connected-marketplace-repair-plan.md#r0) |
| 2.6 | Deploy a non-production skeleton | OPS-10, OPS-14 | [R0](connected-marketplace-repair-plan.md#r0) |
| 3.1 | Define shared identifiers, money, time, quantities, and errors | Process/governance evidence; inspect canonical gate | [R2](connected-marketplace-repair-plan.md#r2) |
| 3.2 | Implement request context and correlation | SEC-09, OPS-02, OPS-03 | [R2](connected-marketplace-repair-plan.md#r2) |
| 3.3 | Implement idempotent command handling | CUS-43, ENG-11 | [R2](connected-marketplace-repair-plan.md#r2) |
| 3.4 | Implement aggregate versioning and transition records | ADM-28, ENG-01, ENG-02, ENG-03 | [R2](connected-marketplace-repair-plan.md#r2) |
| 3.5 | Implement transactional outbox and inbox | ENG-10, ENG-13, COM-04, COM-07 | [R2](connected-marketplace-repair-plan.md#r2) |
| 3.6 | Implement scheduler and job framework | ENG-12, OPS-04, OPS-06 | [R2](connected-marketplace-repair-plan.md#r2) |
| 3.7 | Implement configuration and feature-flag foundation | MKT-10, ADM-23, OPS-08, OPS-09 | [R2](connected-marketplace-repair-plan.md#r2) |
| 4.1 | Build OTP request and verification | CUS-01, SEC-06, INT-01, INT-06 | [R1](connected-marketplace-repair-plan.md#r1) |
| 4.2 | Build sessions and devices | CUS-02, CUS-07 | [R1](connected-marketplace-repair-plan.md#r1) |
| 4.3 | Build roles, capabilities, and memberships | VEN-11, ADM-01, ADM-03 | [R1](connected-marketplace-repair-plan.md#r1) |
| 4.4 | Add authorization enforcement | SEC-01, SEC-03 | [R1](connected-marketplace-repair-plan.md#r1) |
| 4.5 | Add profile, consent, language, and notification preferences | CUS-03, CUS-04, CUS-05, CUS-06, CUS-67, VEN-44, DLP-44, COM-01, COM-02, COM-03, COM-05, SEC-10, SEC-11, INT-05 | [R1](connected-marketplace-repair-plan.md#r1), [R10](connected-marketplace-repair-plan.md#r10), [R11](connected-marketplace-repair-plan.md#r11) |
| 4.6 | Prove isolation | SEC-02 | [R1](connected-marketplace-repair-plan.md#r1) |
| 5.1 | Build vendor and location domain | MKT-01, MKT-02, VEN-04, VEN-05, VEN-06, VEN-07, VEN-08, VEN-09 | [R3](connected-marketplace-repair-plan.md#r3) |
| 5.2 | Build vendor onboarding workflow | VEN-01, VEN-02, VEN-03 | [R3](connected-marketplace-repair-plan.md#r3) |
| 5.3 | Build admin vendor pipeline | VEN-03, VEN-12, ADM-07, ADM-08, ADM-09, ADM-10 | [R3](connected-marketplace-repair-plan.md#r3) |
| 5.4 | Build vendor staff and settings | VEN-10, VEN-11 | [R3](connected-marketplace-repair-plan.md#r3) |
| 5.5 | Build catalogue product management | VEN-13, VEN-14, VEN-17, VEN-18, ADM-17, SEC-08, INT-07 | [R4](connected-marketplace-repair-plan.md#r4) |
| 5.6 | Build CSV import | VEN-15, VEN-16 | [R4](connected-marketplace-repair-plan.md#r4) |
| 5.7 | Build availability freshness and moderation | MKT-09, CUS-28, VEN-19, VEN-22, ADM-16 | [R4](connected-marketplace-repair-plan.md#r4) |
| 6.1 | Build customer address management | MKT-03, CUS-08, CUS-09, CUS-10, CUS-11, CUS-12, CUS-13, INT-04 | [R5](connected-marketplace-repair-plan.md#r5) |
| 6.2 | Build eligible store discovery | MKT-01, MKT-03, CUS-13, CUS-14, CUS-19 | [R5](connected-marketplace-repair-plan.md#r5) |
| 6.3 | Build search and filters | CUS-15, CUS-16, CUS-17, CUS-18, CUS-19 | [R5](connected-marketplace-repair-plan.md#r5) |
| 6.4 | Build favourites, preferred store, and shop request | CUS-20, CUS-21, CUS-22 | [R5](connected-marketplace-repair-plan.md#r5) |
| 6.5 | Build storefront and product browsing | MKT-02, MKT-09, CUS-23, CUS-24, CUS-25, CUS-26, CUS-27, CUS-28 | [R5](connected-marketplace-repair-plan.md#r5) |
| 6.6 | Build vendor-grouped cart | MKT-04, CUS-30, CUS-31, CUS-32, CUS-33, CUS-34, CUS-35 | [R5](connected-marketplace-repair-plan.md#r5) |
| 6.7 | Build cart validation and recovery | CUS-36 | [R5](connected-marketplace-repair-plan.md#r5) |
| 7.1 | Implement pricing and policy evaluation | MKT-08 | [R6](connected-marketplace-repair-plan.md#r6) |
| 7.2 | Implement inventory soft holds | VEN-20, VEN-21, ENG-04, ENG-05 | [R6](connected-marketplace-repair-plan.md#r6) |
| 7.3 | Implement quote creation | CUS-37, CUS-38, ENG-06 | [R6](connected-marketplace-repair-plan.md#r6) |
| 7.4 | Implement payment adapter and webhook intake | CUS-40, CUS-41, CUS-42, CUS-44, ENG-11, SEC-07, INT-02 | [R6](connected-marketplace-repair-plan.md#r6) |
| 7.5 | Implement checkout transaction | MKT-05, CUS-43, CUS-45, ENG-07 | [R6](connected-marketplace-repair-plan.md#r6) |
| 7.6 | Build customer checkout UI | MKT-08, CUS-39 | [R6](connected-marketplace-repair-plan.md#r6) |
| 7.7 | Build group and child-order projections | MKT-06, MKT-07, CUS-45, CUS-46, CUS-47 | [R6](connected-marketplace-repair-plan.md#r6) |
| 7.8 | Prove checkout invariants | CUS-44, ENG-05 | [R6](connected-marketplace-repair-plan.md#r6) |
| 8.1 | Build vendor alert and response deadline | CUS-48, VEN-24, VEN-25, VEN-28 | [R7](connected-marketplace-repair-plan.md#r7) |
| 8.2 | Build accept and decline | CUS-57, VEN-21, VEN-26, VEN-27, VEN-38 | [R7](connected-marketplace-repair-plan.md#r7) |
| 8.3 | Build picking workflow | CUS-27, VEN-29, VEN-30, VEN-40 | [R7](connected-marketplace-repair-plan.md#r7) |
| 8.4 | Build customer decision requests | CUS-49, CUS-50, VEN-31, VEN-32 | [R7](connected-marketplace-repair-plan.md#r7) |
| 8.5 | Build package and ready state | MKT-07, CUS-55, VEN-33, VEN-34 | [R7](connected-marketplace-repair-plan.md#r7) |
| 8.6 | Build customer pickup | CUS-51, VEN-35 | [R7](connected-marketplace-repair-plan.md#r7) |
| 8.7 | Build order history, receipt, reorder, rating, and support entry | CUS-29, CUS-47, CUS-60, CUS-61, CUS-62, CUS-66, VEN-39 | [R7](connected-marketplace-repair-plan.md#r7) |
| 9.1 | Build partner onboarding and eligibility | DLP-01, DLP-02, DLP-03, DLP-04, DLP-05, DLP-06, DLP-07, ADM-11, ADM-12, ADM-13 | [R3](connected-marketplace-repair-plan.md#r3) |
| 9.2 | Build availability and offer eligibility | DLP-08, DLP-09, DLP-10 | [R8](connected-marketplace-repair-plan.md#r8) |
| 9.3 | Build immutable offer attempts | DLP-11, DLP-12, DLP-13, DLP-14, DLP-15, DLP-16 | [R8](connected-marketplace-repair-plan.md#r8) |
| 9.4 | Build active-job navigation and arrival | DLP-20, DLP-21, DLP-22, DLP-44, DLP-45, DLP-46, SEC-03, SEC-12 | [R8](connected-marketplace-repair-plan.md#r8) |
| 9.5 | Build waiting and pickup proof | VEN-36, DLP-23, DLP-24, DLP-25, DLP-26 | [R8](connected-marketplace-repair-plan.md#r8) |
| 9.6 | Build customer delivery | CUS-52, CUS-53, CUS-55, CUS-56, VEN-37, DLP-27, DLP-28, DLP-29, DLP-30, DLP-35 | [R8](connected-marketplace-repair-plan.md#r8) |
| 9.7 | Build offline proof recovery | DLP-32, DLP-33, DLP-34 | [R8](connected-marketplace-repair-plan.md#r8) |
| 9.8 | Build guided exceptions and safety | DLP-36, DLP-37, DLP-38, DLP-39, DLP-40, DLP-43 | [R8](connected-marketplace-repair-plan.md#r8) |
| 9.9 | Build return to origin | CUS-58, DLP-41, DLP-42, ENG-14 | [R8](connected-marketplace-repair-plan.md#r8) |
| 9.10 | Build earnings and disputes UI | DLP-48, DLP-49, DLP-50, DLP-53, DLP-54 | [R9](connected-marketplace-repair-plan.md#r9) |
| 10.1 | Build ledger accounts and posting engine | ENG-07, ENG-08 | [R9](connected-marketplace-repair-plan.md#r9) |
| 10.2 | Build authorization, capture, void, and refund lifecycle | CUS-57, CUS-59, VEN-38, ADM-46 | [R9](connected-marketplace-repair-plan.md#r9) |
| 10.3 | Build vendor fees and settlements | VEN-48, VEN-49, ADM-48, ENG-09 | [R9](connected-marketplace-repair-plan.md#r9) |
| 10.4 | Build partner earnings and payouts | DLP-07, DLP-51, DLP-52, ADM-49, INT-03 | [R9](connected-marketplace-repair-plan.md#r9) |
| 10.5 | Build provider-statement reconciliation | ADM-45, ENG-15 | [R9](connected-marketplace-repair-plan.md#r9) |
| 10.6 | Build financial correction workflow | CUS-60, VEN-50, DLP-53, ADM-50, SEC-13 | [R9](connected-marketplace-repair-plan.md#r9) |
| 10.7 | Prove money conservation | ADM-47 | [R9](connected-marketplace-repair-plan.md#r9) |
| 11.1 | Build role-scoped admin dashboard | ADM-01, ADM-02, ADM-03, ADM-04, ADM-05, ADM-06 | [R10](connected-marketplace-repair-plan.md#r10) |
| 11.2 | Build live order monitor and intervention | DLP-17, ADM-26, ADM-27, ADM-28, ADM-29, ADM-30, ADM-31, ADM-32 | [R8](connected-marketplace-repair-plan.md#r8), [R10](connected-marketplace-repair-plan.md#r10) |
| 11.3 | Build support case lifecycle | CUS-63, CUS-64, CUS-65, VEN-41, VEN-42, VEN-43, DLP-28, DLP-55, ADM-36, ADM-37, ADM-38, ADM-39, ADM-40, ADM-41 | [R10](connected-marketplace-repair-plan.md#r10) |
| 11.4 | Build trust and safety review | DLP-47, DLP-56, ADM-14, ADM-15, ADM-42, ADM-43, ADM-44, SEC-14 | [R10](connected-marketplace-repair-plan.md#r10) |
| 11.5 | Build finance queues | ADM-45, ADM-46, ADM-47, ADM-48, ADM-49 | [R9](connected-marketplace-repair-plan.md#r9), [R10](connected-marketplace-repair-plan.md#r10) |
| 11.6 | Build configuration approval and publication | MKT-10, CUS-32, ADM-18, ADM-19, ADM-20, ADM-21, ADM-22, ADM-23, ADM-24, ADM-25, SEC-13 | [R10](connected-marketplace-repair-plan.md#r10) |
| 11.7 | Build incident controls | ADM-33, ADM-34, ADM-35 | [R10](connected-marketplace-repair-plan.md#r10) |
| 11.8 | Build reporting and exports | VEN-45, VEN-46, VEN-47, ADM-53, ADM-54, ADM-55, ADM-56, ADM-57, ADM-58 | [R10](connected-marketplace-repair-plan.md#r10) |
| 11.9 | Build searchable audit interface | ADM-51, ADM-52 | [R10](connected-marketplace-repair-plan.md#r10) |
| 12.1 | Run security and privacy review | SEC-04, SEC-08, SEC-11 | [R12](connected-marketplace-repair-plan.md#r12) |
| 12.2 | Complete accessibility review | MKT-12, UX-01, UX-03, UX-04, UX-05, UX-06, UX-07, UX-09, UX-11, UX-12 | [R11](connected-marketplace-repair-plan.md#r11) |
| 12.3 | Complete English/Hindi localization | MKT-11, CUS-04, COM-06, UX-08 | [R11](connected-marketplace-repair-plan.md#r11) |
| 12.4 | Test low-end devices and poor networks | VEN-40, UX-02, UX-10 | [R11](connected-marketplace-repair-plan.md#r11) |
| 12.5 | Run resilience drills | Process/governance evidence; inspect canonical gate | [R12](connected-marketplace-repair-plan.md#r12) |
| 12.6 | Run performance and concurrency tests | OPS-04, OPS-16 | [R12](connected-marketplace-repair-plan.md#r12) |
| 12.7 | Complete operational readiness | OPS-05, OPS-12, OPS-13, OPS-14, OPS-15 | [R12](connected-marketplace-repair-plan.md#r12) |
| 13.1 | Prepare production | Process/governance evidence; inspect canonical gate | [R12](connected-marketplace-repair-plan.md#r12) |
| 13.2 | Launch internally | Process/governance evidence; inspect canonical gate | [R12](connected-marketplace-repair-plan.md#r12) |
| 13.3 | Launch the pilot cohort | Process/governance evidence; inspect canonical gate | [R12](connected-marketplace-repair-plan.md#r12) |
| 13.4 | Expand gradually | Process/governance evidence; inspect canonical gate | [R12](connected-marketplace-repair-plan.md#r12) |
| 13.5 | Declare production MVP ready | Process/governance evidence; inspect canonical gate | [R12](connected-marketplace-repair-plan.md#r12) |
| 14.1 | Customer retention | CUS-68, CUS-69, CUS-70, FUT-05, FUT-06, FUT-07 | Later/gated review; no launch activation |
| 14.2 | Delivery intelligence | CUS-54, DLP-18, DLP-19, FUT-01, FUT-02, FUT-03, FUT-04 | Later/gated review; no launch activation |
| 14.3 | Vendor integrations and growth | VEN-23, VEN-51, VEN-52, INT-08, FUT-08, FUT-09, FUT-12 | Later/gated review; no launch activation |
| 14.4 | Marketplace expansion | FUT-10, FUT-11 | Later/gated review; no launch activation |
| 14.5 | Pharmacy, only through the gated program | GAT-02, GAT-03, GAT-04 | Later/gated review; no launch activation |
