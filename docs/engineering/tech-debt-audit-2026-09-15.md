# Technical debt audit — 15 September 2026

**Scope:** the whole repository — dead code, duplicated logic, unused components, unnecessary complexity. **Method:** measured, not read: `jscpd` (token-level clones, tests and migrations excluded), `knip` (unused files, exports, dependencies), a reference scan of every `database/src` export, and targeted counts of repeated helpers; then each candidate was opened and classified. Numbers below are from those runs; anything I could not measure is marked as such.

**What this is not:** a list of things to do this week. Nine field defects came out of one order walked end to end (batch 09); most of this debt is the *cause* of that class of defect, and the prioritisation is by how much of it each item would prevent.

## The shape of the code

| Area | Source lines | Note |
|---|---|---|
| `database/src` | 32,990 in 72 files | domain services, raw SQL through `pg` |
| `database/scripts` | 16,489 in 46 files | the connected verifier ladder |
| `database/migrations` | 8,671 in 158 files | paired SQL, 78 applied |
| `apps/api` | 12,177 | 33 NestJS controllers |
| Four PWAs | 20,574 | customer 8,065 · vendor 4,779 · admin 4,602 · partner 3,128 |
| Four Expo apps | 4,954 | 700–1,700 each; see the Android note in batch 09 |
| `packages/*` | 6,175 | contracts 2,372 · ui 1,852 · domain-types 1,372 · pwa-auth 414 |
| `tooling` | 3,332 | 15 repository controls |

`jscpd`: 455 files, 76,806 lines, **2,971 duplicated (3.9 %) in 137 clones**. That figure undercounts the real duplication, which is mostly *structural* — the same helper re-declared with small differences — and does not clone token-for-token. `knip`: 15 unused exports, 4 tracked log files, one spec nobody runs; its 17 "unused files" are the Expo apps' entry points, which it cannot see, and are false positives.

## Findings

Scored per the framework: **Impact** (slows the team) and **Risk** (what happens if left) 1–5; **Effort** 1–5; Priority = (Impact + Risk) × (6 − Effort).

### 1. Every controller re-declares its request parsing and its error translation — priority 32

`object()` is declared 18 times, `uuid()` 18, `stringField()` 13, `translate()`/`map()` 24 times across `apps/api/src/*.controller.ts` — **717 lines** of near-identical helpers, each free to drift. They did: batch 07 found 28 conflict sites whose translators all collapsed to `VERSION_CONFLICT`; B09-07 found the domain's command-reference check wider than the schema's, in two modules, because each carried its own copy. This is the single largest source of the "refusal that cannot explain itself" class.

*Fix:* one `apps/api/src/request-fields.ts` (`object`, `string`, `integer`, `uuid`, `optionalString`, `boolean`, `strings`, `date`) and one `domain-error-translation.ts` mapping domain error classes to stable codes in a table the error-contract control can read. Impact 4 · Risk 4 · Effort 2.

### 2. Two client error-message maps, and they have diverged — priority 30

`packages/contracts/src/client.ts` and `packages/pwa-auth/src/index.ts` each carry a `CODE_MESSAGES`. The comment in `pwa-auth` says it *mirrors* the contracts client so the two request paths cannot disagree. They disagree now: **twelve codes** added in batches 07–09 (`ORDER_STATE_CONFLICT`, `PICKING_INCOMPLETE`, all the `PICKUP_OTP_*` and `DELIVERY_OTP_*`, `PARTNER_NOT_PRESENT` …) exist only in `pwa-auth`. The customer PWA, which uses the contracts client, renders its generic fallback for every one of them. The server already sends a `message_key`; the clients should render the locale bundle and keep no map at all.

*Fix:* delete both maps; render `message_key` through the existing `/locale/bundle`. Impact 3 · Risk 3 · Effort 1.

### 3. Customer BFF: cookie and CSRF handling written twice — priority 30

`apps/customer-pwa/app/api/session/route.ts` and `api/backend/[...path]/route.ts` share 71 cloned lines — the session-cookie and double-submit token logic. Two copies of auth code is one copy too many; a fix to one is a vulnerability in the other. Impact 2 · Risk 4 · Effort 1.

### 4. Sign-in, token storage and the auth proxy exist once per app — priority 24

Four `SignInPanel.tsx` (451, 307, 263 cloned lines between pairs), four `App.tsx`, four PWA `login/page.tsx`, four `proxy.ts`, three `authenticated-api.ts`, three `token-storage-core.ts` — and the three token-storage cores have **three different hashes**. That is security-sensitive code (SecureStore handling, session refresh, CSRF) drifting in three directions with a spec in only one of them.

*Fix:* `packages/pwa-auth` already exists for the browser side and is only partly used; extend it, and add a `packages/app-auth` for Expo, so each app owns a config object and nothing else. Impact 4 · Risk 4 · Effort 3.

### 5. `vendor-fulfilment.ts` is 3,007 lines and one class — priority 21

Accept/decline, picking, substitution and weight decisions, ready, three pickup-code issuers, handover, inventory settlement, customer history, receipt, ratings, support cases, tracking, vendor insights, and two listing queries whose 40-line `LEFT JOIN LATERAL` blocks are copied verbatim. Every field defect this month in this area needed a 3,000-line read to place. Impact 4 · Risk 3 · Effort 3.

*Fix:* split by actor and concern — `vendor-order-transitions`, `order-handover` (all three code issuers + `completePickup` + `requireCollectorPresent`), `customer-order-views`, `vendor-insights`; one `vendorOrderQuery(where)` for list and get.

### 6. Synthetic naming is baked into 55 schema constraints — priority 21

`assignment_event_command_shape`, `refund_operation_shape`, `SYNTH-ORDER-`, `SYNTH-PROOF-`, `SYNTH-CHECKOUT-`, `SYNTH-STMT-`, `SYNTH-PRODUCT-`, `SYNTH-POLICY-`, `SYNTH-EVIDENCE-` … every business reference in the database must start with `SYNTH-`, by CHECK constraint, in every environment including the one called production. Leaving synthetic mode is not a configuration change; it is ~55 corrective migrations and every reference generator. B09-07 was a first taste: a client that did not know the prefix rule produced a 500. Impact 3 · Risk 4 · Effort 3. *Decision needed:* this is release scope, not a refactor.

### 7. `database/schema.ts` is a second schema nobody uses — priority 20

1,637 lines of Drizzle declarations, imported by nothing but a control; the runtime is raw SQL through `pg` everywhere. `verify-static.ts` already records that it fell **78 tables** behind and ratchets it. `drizzle-orm` and `drizzle-kit` are dependencies for a file that does no work. Either it becomes the source that migrations are checked against, or it goes. `CLAUDE.md` names it the record of truth, so this is the operator's call. Impact 2 · Risk 3 · Effort 2 (to delete).

### 8. Twenty-four private transaction helpers; twenty `check()`s; thirty hand-typed scenario counts — priority 20

Every module in `database/src` declares its own `tx`/`transaction` (24 copies) though `database/src/client.ts` exists. Every verifier declares its own `check` (20), `rejects` (10), `context` (15). `verify-lifecycle.ts` records `vendor_fulfilment_scenarios: 70` and 29 other numbers that are typed by hand — I have bumped them by judgement all week; they measure nothing. Impact 3 · Risk 2 · Effort 2.

*Fix:* `database/src/transaction.ts`; `database/scripts/verify-support.ts`; count the `check` calls that ran instead of declaring a number.

### 9. Duplicated provisioning and six ways to grant a role — priority 24

`admin-onboarding.ts` has two near-identical partner-provisioning blocks (lines ~750 and ~1020); six modules insert into `role_assignments` and three of them take no lock — batch 02 found the duplicate-grant race that produced, and closed it with a unique index rather than by unifying the paths. The paths are still six. Impact 3 · Risk 3 · Effort 2.

### 10. The same logger and the same smoke harness in two places — priority 20

`apps/api/src/json-logger.ts` ↔ `apps/worker/src/json-logger.ts` (76 lines); `health-smoke.mjs` ↔ `worker-smoke.mjs` (47). One redaction rule fixed in one copy is a leak in the other. Impact 2 · Risk 2 · Effort 1.

### 11. Two finance stacks — priority 14

`money-lifecycle.ts` (1,100 lines, `/admin/finance`) and `complete-money-lifecycle.ts` (904, `/admin/finance/v2`), with `order-money-orchestrator.ts` between them. The admin console calls **both**: refunds and payments through v1, exceptions, corrections and payout jobs through v2. "v2" in a pre-launch codebase is an unfinished migration; two ways to raise a refund is a reconciliation problem waiting to happen. Impact 3 · Risk 4 · Effort 4. *Decision needed:* which one is the product.

### 12. Three catalogues of the same 354 features — priority 12

`FEATURES.md` (582 lines), `docs/feature-matrix.json` (8,322) and the feature register (3,975) describe the same capabilities three ways, with 107 Android claims marked `unverified` and 246 `false`. The matrix is the one a control reads; the other two are maintained by hand. Impact 2 · Risk 2 · Effort 3.

### 13. A test that never runs, logs in git, scaffolding kept alive by its own verifier — priority 15

- `tooling/scripts/preflight-supabase-development.spec.mjs` is not run by any script. It cannot fail.
- `.gstack/browse-*.log`, `browse-audit.jsonl`, `claude-available.json` are tracked.
- `database/src/reference-module.ts` is the Phase 3 kernel demonstrator; nothing but its own verifier and the seed call it (`reference_scenarios: 5` in the ladder).
- `database/src/provider-ports.ts` declares `EmailProvider`, `RouteProvider`, `GeocodingProvider`; nothing implements or injects them.

Impact 1 · Risk 2 · Effort 1.

### 14. Dead exports — priority 10

`knip` and the reference scan agree on the genuinely dead ones: `protectedObjectChecksum`, `ADMIN_PROVISIONED_REASON`, `customer-chrome.tsx: Button`, `browse-location.ts: writeBrowseLocation, clearBrowseLocation`, `offline-queue.ts: forget`, `address-setup.tsx: deviceCoordinates`, `display.ts: syntheticStorageLabel`, `customer-origin.ts: customerOrigin`, `tokens.ts: SUPABASE_AUTH`, `async-processing-health.ts: WORKER_STALE_AFTER_MS`, `request-context-hook.ts: REQUEST_ID_HEADER, TRACEPARENT_HEADER`, `json-logger.ts: JsonLogger`, `supabase-auth.service.ts: SupabaseAuthConfigurationError`, `customer-app/token-storage.ts: loadPersistedToken, persistToken`. The 155 unreferenced `database/src` exports are almost all *types* that form the package's public surface and are not debt. Impact 1 · Risk 1 · Effort 1.

### 15. Dependencies — not scored

`pnpm outdated` lists `next`, `react`, `@nestjs/*`, `fastify`, `bullmq`, `@supabase/supabase-js`, `expo`, `wrangler` behind their latest. I did not check whether any is a major or carries an advisory; that is a separate, quick pass with `pnpm audit`. `knip` flags `expo-updates` and `expo-system-ui` referenced by every `app.json` but listed by none, and `@neighbourhood-store/ui-tokens` listed by `packages/ui` and three apps without an import — probably true, probably harmless.

## Priority order

| # | Item | Priority | Effort |
|---|---|---|---|
| 1 | Controller helpers and error translation, once | 32 | 2 |
| 2 | Delete both client message maps; render `message_key` | 30 | 1 |
| 3 | Customer BFF cookie/CSRF, once | 30 | 1 |
| 4 | Sign-in / token storage / proxy shared across apps | 24 | 3 |
| 9 | One role-grant path; one partner-provisioning block | 24 | 2 |
| 5 | Split `vendor-fulfilment.ts`; one order query | 21 | 3 |
| 6 | `SYNTH-` prefixes in 55 constraints | 21 | 3 · decision |
| 7 | `schema.ts` — finish or remove | 20 | 2 · decision |
| 8 | Transaction and verifier helpers; real scenario counts | 20 | 2 |
| 10 | Logger and smoke harness, once | 20 | 1 |
| 13 | Unrun spec, tracked logs, demo module, unimplemented ports | 15 | 1 |
| 11 | Two finance stacks | 14 | 4 · decision |
| 12 | Three feature catalogues | 12 | 3 |
| 14 | Dead exports | 10 | 1 |

## Remediation, alongside feature work

**Phase A — a day, no decisions needed (items 2, 3, 10, 13, 14).** Delete the message maps and render `message_key`; fold the BFF routes' cookie/CSRF into one helper; one logger; wire or delete the unrun spec; untrack `.gstack`; remove the dead exports. Every step is covered by an existing gate; nothing here changes behaviour a user can see except the customer PWA finally showing the right sentence for twelve codes.

**Phase B — the API boundary (items 1, 8, 9).** One request-parsing module and one error-translation table across 33 controllers, with the error-contract control extended to read the table, so a new domain error cannot reach a client without a stable code. One transaction helper. One `verify-support.ts` and counted scenarios. One role-grant function that the other five paths call. This is the phase that removes the cause of most of batch 07 and B09-07.

**Phase C — the client boundary (item 4).** Shared auth for the four PWAs and four Expo apps. Do this before any Android work: three drifting copies of SecureStore handling is where the next security finding lives.

**Phase D — decisions (items 5, 6, 7, 11).** These need the operator: split the fulfilment module (mechanical but large); choose one finance stack; decide whether `schema.ts` is real; and, most important, decide when the `SYNTH-` prefixes come out of the schema — that is a release-scope question, and every day of synthetic-mode data on the production project makes the eventual migration longer.

**Item 12 last.** The catalogues only matter once the code they describe stops moving.

## Two things I would not touch

- The nine `repair-batch-*` evidence documents and `phase-conformance-audit.md` read as duplication of the changelog; they are not. They record what was proven and how, which git history does not.
- The 15 repository controls in `tooling/scripts` overlap in shape (each has a `--self-test`, each scans files). That is deliberate: each guards one class of regression and can be deleted alone. Merging them would save lines and lose that.
