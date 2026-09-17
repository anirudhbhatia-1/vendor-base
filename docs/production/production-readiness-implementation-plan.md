# Production Readiness and End-to-End Marketplace Implementation Plan

**Generated:** 28 August 2026  
**Scope:** all four PWAs, all four Android apps, API, worker, PostgreSQL/PostGIS and real-provider
integration  
**Current production authority:** none  
**Target:** a controlled Jaipur production canary followed by measured expansion  
**Companion controls:**
`docs/engineering/marketplace-completion-implementation-plan.md` and
`docs/production/test-to-production-replacement-register.md`

## 1. Decision and outcome

This plan turns the current local synthetic marketplace into a production-capable system. It does
not declare the current repository production ready. Production readiness is reached only after
real-provider sandbox evidence, production-shaped staging, security/privacy/compliance review,
restore and incident drills, and a reversible canary.

The required business outcome is:

1. An authorized admin creates a vendor or delivery-partner invitation.
2. The invited person activates their own account using verified contact ownership.
3. The person completes the applicable onboarding information and documents.
4. A different authorized admin reviews and approves the application.
5. Approval creates the correct role membership atomically.
6. A vendor configures a store, creates products, prices and inventory, and activates listings.
7. Only valid, active, available listings from published stores appear to eligible customers.
8. A customer can discover, buy and track an order end to end.
9. Vendor fulfilment, partner delivery, payment, settlement, payout, support and audit all close
   against the same authoritative order and ledger history.

### 1.1 Credential safety decision

“Admin creates credentials” must mean **admin creates a revocable invitation**, not that an admin
chooses, views or shares a password, OTP, access token or refresh token.

- Customers, vendors and partners use verified OTP/passwordless activation.
- Admins use phishing-resistant MFA/passkeys in production, with a separately governed recovery
  path.
- The admin sees invitation state (`PENDING`, `SENT`, `CLAIMED`, `EXPIRED`, `REVOKED`) and a masked
  contact reference, never a credential.
- The invited person proves ownership of the invited phone before claiming the invitation.
- OTPs, access tokens and refresh tokens are never persisted in plaintext or displayed to admins.
- Resend and revoke are rate limited, audited and idempotent.

## 2. Current-code audit

### 2.1 Foundations that should be retained

- NestJS/Fastify modular monolith with stateless API processes.
- PostgreSQL/PostGIS as the authoritative business store.
- Transactional state machines, optimistic versions and append-only evidence.
- PostgreSQL durable jobs and transactional outbox.
- Hash-only phone identity, OTP and session token storage.
- Rotating refresh-token families and replay detection.
- Capability-based authorization and scoped vendor/admin membership models.
- Vendor and partner approval transactions that can grant role access.
- Provider-neutral synthetic money and notification foundations.
- Four role-specific PWAs and four role-specific Android apps.

### 2.2 Blocking identity and provisioning gaps

- The admin PWA cannot create a complete vendor or partner invitation from a usable form.
- Vendor invitation APIs exist, but the UI is missing and invitation references are synthetic.
- Partner self-application exists, but no equivalent admin-created partner invitation lifecycle
  exists.
- Vendor leads can currently be approved without a claimed applicant, producing an ownerless vendor
  and location. Such a location must never be publishable in production.
- Vendor and partner PWA sign-in exists, but role/location/application bootstrap is incomplete.
- All Android apps still rely on manual tokens or static role context.
- PWA refresh tokens are not restored/rotated as a complete session lifecycle.
- Admin access management takes raw user/assignment UUIDs instead of searchable identities and
  bounded workflow context.

### 2.3 Blocking catalogue-to-customer gaps

- Vendor product creation persists a product, initial variant and price but does not create the
  matching inventory item required by customer discovery.
- Product activation is separate from listing-readiness validation.
- Storefront and search use nullable variant/price/inventory joins. An active product without an
  active variant can reach UUID parsing, while a product without a current price can be returned as
  incomplete.
- Vendor catalogue screens still request an entered location UUID and contain mixed synthetic/local
  controls.
- Image creation stores a synthetic object reference rather than performing a protected upload,
  scan, transform and publication flow.
- Catalogue moderation and prohibited/restricted-category enforcement are not a complete production
  workflow.
- Customer store and product pages are not complete production storefronts across PWA and Android.

### 2.4 Synthetic-only production blockers

The current system cannot accept real data. Production code and schema explicitly require
`SYNTH-*` values for phones, vendor/location names, addresses, product references/titles/SKUs,
images, imports, inventory, partner evidence, delivery proofs, checkout/order references, payments,
payouts, statements and administrative evidence.

Additional startup blockers include:

- only `synthetic` data mode is accepted;
- only the fake OTP adapter is accepted;
- only repository-local filesystem object storage is accepted;
- API and worker readiness always report `production_ready: false`;
- no `production` runtime environment exists;
- real secrets, telemetry, backups, ingress, deployment and provider callbacks are not configured.

Production enablement therefore requires forward migrations and adapter work. It is not an
environment-variable change.

### 2.5 Quality and UI blockers

- The repository quality command is currently red from formatting, two lint errors and integration
  readiness while PostgreSQL is stopped.
- There are 128 passing unit tests but no complete component, Playwright, Maestro or cross-role
  application test suite.
- Admin screens use manually pasted application/order/user IDs and several zero/static cards.
- Vendor, partner and customer workflows remain incomplete or presentational in both web and
  Android clients.
- English/Hindi, accessibility, offline/reconnect and permission-denial proof are incomplete.

## 3. Functional requirements

### 3.1 Admin

- Search users, vendors, locations, partners, orders, payments and cases without UUID prerequisites.
- Create, send, resend and revoke vendor/partner invitations.
- Track invitation delivery, claim, onboarding, review and activation state.
- Review documents through protected, time-limited access.
- Approve/reject/request changes with standardized reason and evidence.
- Enforce maker/checker separation for high-risk approval, finance, access and configuration.
- Create/manage store publication cases, service zones, catalogue moderation and operational holds.
- See every affected role, store and active obligation before revocation or suspension.

### 3.2 Vendor

- Sign in and automatically resolve accessible vendors/locations.
- Claim an invitation and complete business/location/payout/document onboarding.
- Configure store profile, hours, closures, fulfilment modes, service zones and minimum order.
- Create/edit/archive products, variants, prices, images, stock, weight rules and substitutions.
- Preview listing readiness and activate only valid listings.
- Receive orders, accept/decline, pick, resolve substitutions/weights, package and hand off.
- Read settlements, payouts, statements, disputes, notifications and support cases.

### 3.3 Delivery partner

- Sign in and claim an invitation or complete an approved application path.
- Maintain required identity, vehicle, zone, bank, training and safety records.
- Go online only while eligible.
- Receive/accept offers, restore the active assignment and complete custody proofs.
- Continue safely through poor network, returns and exceptions without false completion.
- Read earnings, payouts, statements, disputes, notices and support.

### 3.4 Customer

- Sign in, manage profile/preferences/sessions and recover access.
- Create real addresses with pin adjustment and serviceability.
- Discover only eligible published stores and orderable listings.
- View a full storefront and product detail with price, unit, weight, availability and policy.
- Use grouped cart/quote/checkout with an exact final price and no duplicate payment.
- Track vendor decisions, pickup/delivery, cancellation, refund, receipt, rating and support.

## 4. Secure invitation and activation design

### 4.1 State model

```text
Admin creates invitation
        |
        v
PENDING_SEND -> SENT -> CONTACT_VERIFIED -> CLAIMED -> ONBOARDING
     |          |             |               |
     |          +----------> EXPIRED           +-> REVOKED
     +---------------------> REVOKED

ONBOARDING -> SUBMITTED -> UNDER_REVIEW -> APPROVED -> ACTIVE
                    |              |             |
                    +-> CHANGES_REQUIRED         +-> SUSPENDED/REVOKED
                                   +-> REJECTED
```

Vendor activation additionally requires a publication case. Partner activation additionally
requires eligibility. Approval alone does not bypass missing compliance or readiness evidence.

### 4.2 Invitation data

Add forward migrations for:

```text
account_invitations
  invitation_id uuid primary key
  invitation_kind VENDOR_OWNER | DELIVERY_PARTNER
  phone_lookup_hash text
  masked_phone text
  onboarding_case_id uuid nullable
  state text
  version integer
  invited_by_user_id uuid
  claimed_by_user_id uuid nullable
  expires_at timestamptz
  sent_at/claimed_at/revoked_at timestamptz nullable
  reason_code text nullable
  request_id/correlation_id uuid

account_invitation_events (append only)
  event_id, invitation_id, version, event_type, actor, reason,
  request_id, correlation_id, occurred_at
```

Constraints:

- one active invitation per phone hash and invitation kind;
- claimed identity phone hash must equal invitation phone hash;
- expiration/revocation is terminal;
- no approval of an unclaimed invitation;
- no vendor publication without an active owner membership;
- no partner online state without active eligibility;
- invitation delivery never stores an OTP or bearer credential.

### 4.3 APIs

```text
POST   /admin/invitations/vendors
POST   /admin/invitations/partners
GET    /admin/invitations?kind=&state=&query=&cursor=
GET    /admin/invitations/:id
POST   /admin/invitations/:id/resend
POST   /admin/invitations/:id/revoke

GET    /auth/invitations/mine
POST   /auth/invitations/:id/claim

GET    /auth/context
GET    /vendor/context
GET    /partner/context
GET    /admin/context
```

All commands require idempotency keys and expected versions. Responses use runtime-validated shared
contracts. `GET /auth/context` returns actor, memberships, capabilities, onboarding blockers and the
default safe landing destination.

### 4.4 UI

Admin Vendors and Partners each receive separate routes:

```text
/vendors                 searchable queue
/vendors/new             create invitation
/vendors/invitations/:id invitation timeline
/vendors/applications/:id review
/vendors/:id             business and locations

/partners                searchable queue
/partners/new            create invitation
/partners/invitations/:id invitation timeline
/partners/applications/:id review
/partners/:id            eligibility and activity
```

The create form asks for the minimum approved contact and business/application seed data. It shows
delivery status and a resend/revoke action. It never displays an OTP, password or token.

## 5. Vendor product-to-customer design

### 5.1 Listing aggregate

Treat a customer-visible listing as an aggregate composed of:

- product identity and description;
- one or more active variants;
- exactly one current price per active variant;
- inventory/availability policy;
- approved product images;
- category/compliance/moderation state;
- vendor-location publication and serviceability state.

Create a transactional `create draft listing` command that writes the product, initial variant,
price and inventory item together. Alternatively, if the API retains separate commands, the product
must remain `DRAFT` until every dependent record exists. No partially created listing may appear to
customers.

Recommended lifecycle:

```text
DRAFT -> READY_FOR_REVIEW -> ACTIVE -> PAUSED -> ACTIVE
   |             |             |
   +-> ARCHIVED  +-> REJECTED   +-> SUSPENDED/ARCHIVED
```

### 5.2 Listing-readiness rules

Activation checks, in one server transaction:

- vendor and location active;
- location publication `PUBLISHED`;
- active owner/staff membership exists;
- category is enabled and item is not prohibited;
- title, description, unit, tax basis and weight policy valid;
- at least one active variant;
- every active variant has exactly one effective price;
- inventory item exists with an allowed availability state;
- required image has passed type/size/malware/quality checks;
- moderation has no open restricted/correction-required case.

Return a structured readiness response with blocking and warning codes. The vendor UI renders and
deep-links each blocker.

### 5.3 Customer visibility query

Customer search/storefront must use inner joins for required listing data and exclude incomplete
rows:

```text
active vendor/location
AND published location
AND eligible service zone for selected active address
AND ACTIVE listing
AND ACTIVE variant
AND exactly one effective price
AND orderable inventory state
AND no blocking moderation case
AND enabled category/policy version
```

Use keyset pagination instead of deep offsets. Cache only safe public projections and invalidate by
outbox events such as `listing.activated`, `price.changed`, `inventory.changed`,
`location.publication_changed` and `moderation.changed`.

### 5.4 APIs and routes

Vendor:

```text
GET    /vendor/context
GET    /vendor/locations/:locationId/listings?cursor=&state=&query=
POST   /vendor/locations/:locationId/listings
GET    /vendor/locations/:locationId/listings/:listingId
PUT    /vendor/locations/:locationId/listings/:listingId
POST   /vendor/locations/:locationId/listings/:listingId/readiness
POST   /vendor/locations/:locationId/listings/:listingId/activate
POST   /vendor/locations/:locationId/listings/:listingId/pause
POST   /vendor/locations/:locationId/listings/:listingId/archive
POST   /vendor/locations/:locationId/listings/:listingId/images/upload-grant
POST   /vendor/locations/:locationId/listings/:listingId/images/:imageId/commit
```

Customer:

```text
GET /customer/discovery/stores?addressId=&cursor=&filters=
GET /customer/discovery/stores/:locationId
GET /customer/discovery/stores/:locationId/products?cursor=&category=
GET /customer/discovery/stores/:locationId/products/:listingId
GET /customer/discovery/search?addressId=&query=&cursor=&filters=
```

Vendor PWA/Android receives separate catalogue list, create, edit, variant, price, inventory, images,
import and readiness pages. Customer PWA/Android receives separate store and product detail pages;
dashboard cards are not substitutes for these routes.

## 6. Target production architecture

```text
                 CDN/WAF/rate limiting
                         |
Four PWAs + four Android apps
                         |
                  HTTPS load balancer
                         |
             Stateless NestJS/Fastify API
                 |             |
                 |             +-- provider adapters
                 |                 OTP / payment / payout / maps
                 |                 storage / scan / push / email/SMS
                 |
       PostgreSQL/PostGIS HA primary
         |        |          |
         |        |          +-- read replicas/reporting
         |        +-- PgBouncer/connection control
         +-- backups + point-in-time recovery
                         |
             transactional outbox/jobs
                         |
              independently scaled workers
                         |
             metrics/logs/traces/alerts
```

### 6.1 Architectural decisions

- Keep the modular monolith for the first production launch.
- Scale API and worker processes horizontally; keep request state outside process memory.
- Preserve PostgreSQL as the source of truth and outbox as the event handoff.
- Keep PostgreSQL jobs initially, but benchmark queue age and lock contention. Introduce a managed
  broker only behind the outbox when measured thresholds require it.
- Use an external distributed rate limiter for OTP, login, checkout and admin abuse controls.
- Use private object storage, signed short-lived grants, malware scanning and image transformation.
- Use hosted/provider checkout or tokenization so card credentials never enter application servers.
- Separate production, staging, automated test and local accounts, databases, buckets, keys and
  telemetry projects.

### 6.2 Initial production service targets

These are launch assumptions to validate with load tests and pilot evidence:

| Measure | Initial target |
|---|---|
| API availability | 99.9% monthly, excluding approved maintenance |
| Read p95 | under 300 ms at API boundary, excluding external providers |
| Command p95 | under 600 ms at API boundary, excluding external providers |
| Checkout duplicate rate | zero duplicate authoritative checkouts/payments |
| Oldest ready high-priority job | under 30 seconds during normal operation |
| Recovery point objective | at most 5 minutes |
| Recovery time objective | at most 60 minutes |
| Critical alert acknowledgement | under 10 minutes during operating hours/on-call |

Load tests must cover at least 100,000 registered-account capacity, representative peak discovery,
checkout bursts, inventory contention, partner-offer bursts and notification/provider degradation.
The measured launch scope may be smaller; capacity evidence must include headroom and scaling steps.

## 7. Production-mode migration

### 7.1 Runtime configuration

Add typed environments and data modes:

```text
APP_ENV=local | test | staging | production
DATA_MODE=synthetic | real
OTP_ADAPTER=fake | <approved-real-adapter>
PAYMENT_ADAPTER=fake | <approved-real-adapter>
PAYOUT_ADAPTER=fake | <approved-real-adapter>
OBJECT_STORAGE_DRIVER=filesystem | <approved-private-object-adapter>
MAPS_ADAPTER=fake | <approved-real-adapter>
NOTIFICATION_ADAPTER=fake | <approved-real-adapter>
```

Production startup must fail when:

- `DATA_MODE` is not `real`;
- any fake adapter or scenario selector is enabled;
- a local filesystem path, fixture loader, universal test OTP or controllable clock is packaged;
- secrets are missing, placeholder-like or loaded from committed files;
- database TLS/identity/host allowlists fail;
- migration head, object bucket, callback URLs or telemetry destinations are unverified;
- the production policy set is unsigned/unapproved.

### 7.2 Forward-only schema transition

Never edit migrations `0000`–`0038`. Add paired forward migrations that:

1. replace `SYNTH-*` business-value constraints with bounded real-data constraints;
2. use opaque internal references instead of encoding environment in business IDs;
3. add `data_provenance` where production/test provenance must be explicit;
4. add invitation, listing-readiness, provider receipt and production policy records;
5. preserve all money, order, custody and audit history;
6. add negative production verifiers that fail if fixture namespaces exist;
7. provide expand/backfill/validate/contract steps for zero-downtime rollout.

Test environments continue requiring synthetic fixture builders at the application boundary.
Production requires real provenance and rejects fixture namespaces. Production data is never copied
to local development.

### 7.3 Provider adapter promotion

Every provider passes the same contract sequence:

```text
fake contract suite
  -> provider sandbox
  -> controlled company-account case
  -> production-shaped staging
  -> canary
  -> wider production
```

Required adapters: OTP, payment, payout/beneficiary, private object storage, malware scan, maps/
geocoding/routing, push, SMS/email and observability. Each needs timeout, idempotency, callback
signature, replay, unknown-result, reconciliation, quota, cost and failover behaviour.

## 8. Implementation workstreams

### Workstream 0 — Restore engineering truth

Tasks:

- Make formatting, lint, unit and integration checks green.
- Start/provision databases deterministically in integration commands.
- Validate all 39 existing migrations and connected verifiers.
- Reconcile `docs/feature-matrix.json` and production replacement register with current code.
- Add a production-readiness evidence index and accountable owners.

Exit: `pnpm check`, all eight builds, migration lifecycle and feature-matrix validation pass from a
clean checkout.

### Workstream 1 — Production-safe contracts and runtime

Tasks:

- Add runtime request/response/event schemas.
- Harden the shared client with secure UUIDs, abort/timeout, refresh rotation, idempotency,
  pagination and normalized errors.
- Add production runtime/data-mode configuration and fail-closed startup attestation.
- Introduce provider interfaces and keep fake adapters test-only.
- Add secret-manager, key-rotation and configuration-version interfaces.

Exit: production builds cannot start with synthetic configuration; staging builds pass provider
contract tests without UI-specific transport code.

### Workstream 2 — Identity, invitation and role bootstrap

Tasks:

- Implement the invitation schema, service, APIs, worker delivery and audit events.
- Implement vendor and partner creation/search/detail routes in admin PWA and Android.
- Bind claims to the verified invited phone hash.
- Remove the ownerless-vendor approval path.
- Add partner invitation-to-application lifecycle.
- Return role/location/application/assignment context after login.
- Implement PWA session restoration and Android secure storage.
- Require admin passkeys/MFA, short sessions and step-up for high-risk commands.
- Add joiner/mover/leaver, recovery, disable, revoke and session-termination workflows.

Exit: admins can invite but never see credentials; a vendor/partner activates their own account;
approval grants exactly one correct membership; revoked access fails immediately across all clients.

### Workstream 3 — Vendor and partner verification

Tasks:

- Replace synthetic references with approved minimum real fields and protected document records.
- Add requirement matrices by participant/category/zone.
- Implement private uploads, scanning, extraction/manual review, expiry, grace and appeals.
- Add reviewer queues with maker/checker and no self-review.
- Store provider verification receipts and decision provenance.
- Block new work/publication on expiry while safely completing accepted obligations.

Exit: approved evidence and policy versions are traceable; access is purpose-bound and expiring;
false/changed decisions can be appealed without rewriting history.

### Workstream 4 — Store publication and catalogue vertical slice

Tasks:

- Implement automatic vendor/location selection from membership.
- Complete store settings, hours, zones, fulfilment and publication readiness.
- Introduce draft listing aggregate and transactional product/variant/price/inventory creation.
- Add real image upload/scan/transform flow.
- Add product, variant, price, inventory, weight, substitution and import pages to both vendor
  clients.
- Correct customer discovery/storefront joins and add keyset pagination.
- Add customer store/product pages to both customer clients.
- Publish cache/search invalidation through replay-safe consumers.

Exit: an approved vendor creates a valid listing once and it appears to eligible customers in PWA
and Android; pause, stock-out, moderation or unpublication removes it within the agreed SLA.

### Workstream 5 — Customer checkout and real money

Tasks:

- Complete address/geocoding/serviceability.
- Complete grouped cart, quote expiry, final-price disclosure and idempotent checkout.
- Integrate approved payment provider through hosted/tokenized flows.
- Verify signed callbacks and reconcile unknown/duplicate/out-of-order events.
- Implement capture/void/refund and immutable balanced ledger postings.
- Implement approved fees, taxes, receipts, invoices and cancellation/refund policies.
- Complete customer payment/pending/failure/refund UI across PWA and Android.

Exit: controlled real-company payment cases pass authorization, capture, void, partial/full refund,
timeout, unknown and reconciliation without duplicate charge or ledger imbalance.

### Workstream 6 — Fulfilment, dispatch and payouts

Tasks:

- Complete vendor accept/decline, picking, weight/substitution decisions, package and handoff.
- Complete partner online/offer/accept, active-job restore, pickup, delivery, offline proof, return and
  safety exceptions.
- Complete customer live order timeline and protected delivery contact.
- Integrate maps/routing and approved proof/OTP mechanisms.
- Integrate beneficiary validation, settlement, payout, statement and reconciliation.
- Add operations queues for ageing, custody, payment, refund and payout exceptions.

Exit: pickup and delivery journeys close order, custody, customer payment, vendor settlement and
partner earning exactly once, including return and provider-outage scenarios.

### Workstream 7 — Complete all eight applications

Tasks:

- Replace manual tokens/UUIDs and static cards with context-derived API workflows.
- Give every major tab a separate route/screen and route-level loading/error/not-found boundaries.
- Complete English/Hindi, accessibility and low-bandwidth/offline states.
- Add notification inboxes and safe deep links.
- Implement Android permissions, background constraints and secure builds.
- Target the Google Play API level required at submission time; as of 31 August 2026, new apps and
  updates must target Android 16/API 36 or higher.
- Use public distribution for customer and the approved public/private distribution model for
  vendor, partner and admin apps.

Exit: critical role journeys work on PWA and Android without developer input, debug credentials or
hidden manual steps.

### Workstream 8 — Security, privacy and compliance

Tasks:

- Complete data inventory, purpose, notice/consent, retention, rights and deletion workflows.
- Conduct threat modeling for identity, tenant isolation, admin, payments, custody and providers.
- Add WAF, distributed rate limits, bot/OTP abuse, step-up auth and anomaly controls.
- Encrypt in transit and at rest; use managed keys/secrets and least-privilege service identities.
- Add dependency, secret, SAST, DAST, container, infrastructure and mobile security checks.
- Complete penetration testing and remediate all critical/high findings.
- Obtain qualified India legal/tax/privacy review. The checklist must include current DPDP rules,
  FSSAI e-commerce obligations, payment/merchant due diligence and CERT-In directions.
- Approve customer terms, privacy notice, refund policy and vendor/partner agreements in English and
  Hindi as required.

Exit: accountable Security, Privacy, Compliance, Finance and Legal owners approve evidence; no open
critical/high security issue or unresolved launch-blocking obligation remains.

### Workstream 9 — Production infrastructure and operations

Tasks:

- Select providers through ADRs covering region, SLA, support, cost, capacity and exit plan.
- Build infrastructure as code, private networks, TLS ingress and least-privilege deployment roles.
- Deploy HA PostgreSQL/PostGIS, connection pooling, backups and point-in-time recovery.
- Add separate worker pools, autoscaling and admission/backpressure controls.
- Implement metrics, logs, traces, dashboards, SLOs and alert/runbook ownership.
- Rehearse restore, failover, provider outage, stuck jobs, privacy incident, payment unknown and
  custody-risk incidents.
- Staff support/on-call for every hour in which new orders are accepted.

Exit: staging restore meets RPO/RTO; every critical alert reaches a staffed owner; load/soak tests
meet SLO and cost thresholds with launch headroom.

### Workstream 10 — Release evidence and canary

Tasks:

- Add component tests for all role screens and states.
- Add four PWA Playwright projects and four Android Maestro suites.
- Add cross-role scenarios using the same checkout/order IDs.
- Run provider sandbox and controlled real-company cases.
- Run production-shaped staging, migration, rollback, restore and reconciliation rehearsals.
- Define canary vendors, partners, customers, Jaipur zone, hours, stop thresholds and rollback.
- Reconcile all in-flight orders and money before/after rollback tests.
- Obtain explicit production approvals from accountable owners.

Exit: canary dashboard, on-call roster, rollback, support, reconciliation and sign-offs are complete.
Only then may bounded real users and transactions be enabled.

## 9. Required end-to-end tests

### 9.1 Provisioning

1. Admin invites vendor; delivery succeeds; vendor verifies same phone and claims.
2. Wrong-phone user cannot discover or claim the invitation.
3. Expired/revoked invitation cannot be reused.
4. Admin resend is deduplicated and rate limited.
5. Reviewer cannot approve their own created/claimed case where separation is required.
6. Approval creates vendor owner/location membership atomically.
7. Admin invites partner; approval creates partner role and eligibility atomically.
8. Revocation terminates active sessions and removes future work while protecting active custody.

### 9.2 Catalogue visibility

1. Draft/incomplete product is never customer visible.
2. Activation fails with explicit blocker when price, variant, image or inventory is missing.
3. Active complete listing appears only for eligible addresses and published locations.
4. Stock-out, pause, moderation and store unpublication remove visibility.
5. Price/version conflict never silently overwrites another update.
6. Image rejection never publishes the original file.
7. Customer never sees another vendor's products on a store page.

### 9.3 Commerce and operations

1. One-store pickup happy path.
2. Three-store checkout with one vendor decline and proportional payment resolution.
3. Payment timeout/unknown followed by reconciliation without duplicate authorization.
4. Variable-weight and substitution decision with deadline and price adjustment.
5. Partner offer expiry/reassignment.
6. Offline proof sync without local false completion.
7. Post-pickup return preserving custody and earnings.
8. Partial/full refund, vendor/partner statement and payout reconciliation.
9. Tenant isolation and wrong-role denial across every applicable endpoint.
10. Production startup rejects fake adapters, fixtures and synthetic data mode.

## 10. CI/CD and promotion gates

```text
format/lint/boundaries
  -> typecheck + runtime contracts
  -> unit/property/component
  -> migration lifecycle on isolated PostgreSQL/PostGIS
  -> module/API/provider-contract integration
  -> four PWA Playwright projects
  -> four Android builds + Maestro
  -> cross-role E2E
  -> security/privacy/secret/dependency/IaC checks
  -> immutable artifacts + SBOM + signing
  -> staging migration/deploy/smoke
  -> canary approval
  -> progressive rollout with automatic stop thresholds
```

No direct production deploy from a developer laptop. Every release uses reviewed immutable
artifacts, environment-specific configuration, least-privilege deployment identity and recorded
rollback evidence.

## 11. Delivery sequence

```text
Gate A: green repository and evidence governance
  -> Gate B: production runtime/contracts and provider interfaces
  -> Gate C: secure vendor/partner invitations and role bootstrap
  -> Gate D: vendor listing -> customer visibility vertical slice
  -> Gate E: checkout/payment/fulfilment/payout closure
  -> Gate F: eight-client parity, accessibility and localization
  -> Gate G: security/privacy/compliance/infrastructure approval
  -> Gate H: staging, controlled real cases and reversible Jaipur canary
```

Workstreams may run in parallel only after shared contracts and invariants are agreed. Identity,
catalogue visibility and money/custody invariants remain server/database enforced and cannot be
implemented as UI-only checks.

## 12. Production release definition

The system is production ready only when all conditions are true:

1. Admins can securely invite vendors and partners without seeing or creating credentials.
2. Vendor/partner activation, approval and membership creation are atomic and audited.
3. No ownerless vendor can publish and no ineligible partner can go online.
4. Vendors can create complete listings and eligible customers see them in both PWA and Android.
5. All eight critical client journeys work without manual tokens or UUIDs.
6. Real OTP, payment, payout, storage/scan, maps and notification adapters pass controlled evidence.
7. Production startup rejects all fake/synthetic/local-only mechanisms.
8. Order, payment, ledger, inventory and custody invariants pass concurrency and replay tests.
9. Cross-role Playwright and Maestro suites pass against production-shaped staging.
10. Load, soak, backup, restore, failover, provider-outage and incident drills meet approved targets.
11. Security/privacy/compliance/legal/tax findings and policies are approved for the launch scope.
12. Dashboards, alerts, runbooks, support/on-call, reconciliation and rollback are staffed.
13. A bounded Jaipur canary completes without crossing any stop threshold.
14. The production replacement register has no applicable row below `PRODUCTION_APPROVED` except an
    explicitly approved and safely disabled/excluded feature.

## 13. External standards and regulatory inputs

These are implementation inputs, not legal advice. Qualified reviewers must confirm applicability
and effective dates before launch.

- [MeitY — Digital Personal Data Protection Rules, 2025](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?hl=en-US)
- [FSSAI — Guidelines for operations of e-commerce food business operators](https://www.fssai.gov.in/upload/advisories/2018/02/5a968f14cc994189.pdf)
- [RBI — Payment Aggregator and Payment Gateway security/merchant-onboarding material](https://www.rbi.org.in/Scripts/PublicationReportDetails.aspx?ID=943&UrlPage=)
- [CERT-In — Cyber Security Directions under section 70B](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf)
- [Android Developers — Google Play target API requirements](https://developer.android.com/google/play/requirements/target-sdk)

