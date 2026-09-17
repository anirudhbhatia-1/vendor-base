# Phase conformance audit

**Started:** 6 September 2026
**Basis:** PRD, FEATURES, architecture, workflow, canonical phases.md and D-15
**Scope:** Sequential re-audit, not retrospective certification. No database/provider writes performed by this documentation audit.

## Evidence rules

- NOT_REVIEWED: no current audit conclusion.
- PARTIAL: some artifacts/behavior exist; exit gate not established.
- VERIFIED_LOCAL / VERIFIED_STAGING: every applicable step criterion passed in the named environment with recorded executable evidence.
- BLOCKED: specific external evidence/approval is missing; safe independent work may continue.

Keep scope status (Launch/Later/Gated) separate from implementation and verification status. Previous completion reports are leads to inspect, not evidence to inherit. Preserve canonical step numbers: Phase 5.4 is staff/settings, 5.6 CSV import; finance completion is Phase 10. Earlier conversations used different numbering.

## Phase 0 — first-pass governance audit

| Step | Status | Evidence inspected | Finding and closure requirement |
|---|---|---|---|
| 0.1 Decision ownership | PARTIAL | docs/decisions/register.md; D-13, D-14; implementation.md §3 | Register previously stopped at D-12. D-13/14 and D-15 now indexed; legacy decisions preserved. Revalidate accountable owners, overdue evidence and unresolved payout/production gates; an assigned role/date is not approval evidence. |
| 0.2 Geography/cohort | PARTIAL | docs/pilot/launch-zones.md; D-01; cohort and catalogue file inventory | Jaipur 302020/302021/302019 and Asia/Kolkata are recorded for synthetic testing. Real vendor participation, precise service polygons, support coverage and operating evidence are not established by fixtures. |
| 0.3 Stack/environments | PARTIAL | D-13/14; apps/*/package.json inventory; database/src/runtime-config.ts; apps/api/src/runtime-config.ts; infrastructure/*/env.example; infrastructure/online-test/compose.yaml | Eight role clients plus API/worker exist. D-15 synchronizes staging direction. **Corrected 6 Sep 2026 (run 2):** the runtime accepted the local-only fake adapters in every environment without any signal. Non-local environments now require an explicit `ALLOW_SYNTHETIC_PROVIDERS=synthetic-testing-only` acknowledgement or startup fails, so a deployed runtime can no longer present fake one-time passwords and filesystem storage as if they were the approved adapters. Approved MSG91/Razorpay/Supabase Storage adapters remain unimplemented; this control makes that visible rather than closing the gate. |
| 0.4 Providers/finance | PARTIAL | runtime configuration; decision register; D-15; database/src/runtime-config.ts; infrastructure/online-test/compose.yaml | Simulator foundation exists; staging provider conformance not demonstrated. Payout provider remains unresolved. **Defect found and corrected 6 Sep 2026 (run 2):** `PAYMENT_WEBHOOK_KEY`, `SESSION_TOKEN_HASH_KEY`, `OTP_HASH_KEY` and `OBJECT_STORAGE_GRANT_KEY` silently fell back to synthetic constants committed to this repository in *every* environment, and the `online-test` compose file injected none of them, so a deployed runtime would have verified payment webhooks and session tokens against publicly readable keys. See the run-2 finding below. Sandbox credentials, signed-webhook/unknown-result tests and approved financial examples are still outstanding. |
| 0.5 Privacy/operations/recovery | PARTIAL | decision register D-06–D-10; governance artifact inventory | Internal synthetic policies/targets exist. This pass has not validated production policy approval, staffing, retention execution or restore drills. Do not mark this gate passed from file presence. |

**Phase 0 conclusion:** implementation direction is reconciled, but staging/production gates remain open. Continue safe development/audit under D-15; do not invent missing operational approvals.

### Run 2 (6 September 2026) — executable re-audit of 0.3/0.4

The first pass recorded these steps as PARTIAL from document inspection. Reading the runtime loaders and the deployment artifacts turned that into a specific, reproducible defect.

**Finding P0-01 — committed secret material was reachable by deployed environments.** `loadSharedRuntimeConfig` and the API loader resolved every piece of private key material with `process.env.X ?? '<committed synthetic constant>'`, with no environment condition. `infrastructure/online-test/compose.yaml` passed only `APP_ENV`, `DATA_MODE`, `RELEASE_VERSION`, `API_HOST` and `API_PORT`, so an `online-test` deployment booted with the session-token, one-time-password and payment-webhook keys published in this repository. `infrastructure/supabase-dev/.env` and `infrastructure/supabase-production/.env` set no `PAYMENT_WEBHOOK_KEY` at all and therefore ran on the committed value. Both env.example files also shipped `replace-with-...` placeholders long enough to pass the only check that existed (a 32-character minimum). Root cause: the loaders encoded a local-development convenience as a global default, and no control asserted the difference between a developer machine and a reachable deployment.

**Correction.** `database/src/runtime-config.ts` now classifies `local`, `test` and `queue-compat` as the only environments permitted to fall back to committed material. `resolveSecretMaterial` requires every other environment to supply the value explicitly and rejects a committed default, an env.example placeholder and any value under the minimum length. `PROVIDER_CLEARING_ACCOUNT_REFERENCE` must likewise be named explicitly outside those environments. The API loader routes `OTP_HASH_KEY` and `SESSION_TOKEN_HASH_KEY` through the same policy and rejects one value reused for both digests. `resolveSyntheticProviderAcknowledgement` implements the D-15 fail-startup rule for the local-only adapters. The `online-test` compose file now injects each value with `${VAR:?...}`, and `verify-online-test-deployment.mjs` fails if any of them stops failing closed.

**Finding P0-02 — the deployment control contradicted the approved customer client target.** `pnpm lint` was already failing in the working tree before this run: `verify-online-test-deployment.mjs` required a Cloudflare Pages static export from all four PWAs, but the customer PWA had been moved to the D-15 Workers/OpenNext same-origin BFF, whose `app/api/**/route.ts` handlers a static export cannot serve. The control, not the application, was stale. It now requires the static export from vendor, partner and admin, and requires the customer PWA to be a non-exported build that still carries its session and backend-proxy BFF routes.

**Verification (local machine, Node 24.19.0, no database, queue or provider contacted).**

| Command | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm test:unit` | exit 0; 356 tests, 356 pass, 0 fail (340 before this run; 16 added) |
| `pnpm lint` | exit 0 (was exit 1 before this run, on P0-02) |
| `pnpm test:controls` | exit 0 |
| `pnpm format:check` | exit 0 |
| `pnpm security:secrets` | exit 0 |

New regression tests: `database/src/runtime-config.spec.ts` (9) and `apps/api/src/runtime-config.spec.ts` (7) cover the local fallback, the missing/reused/placeholder/short cases, the acknowledgement gate, the unimplemented-adapter message and a fully injected deployed configuration.

**Residual blockers.** These corrections make the unsafe combinations fail loudly; they do not implement any approved adapter. MSG91, Razorpay Test Mode, Mappls, FCM/Web Push and Supabase Storage remain unimplemented, so `ALLOW_SYNTHETIC_PROVIDERS=synthetic-testing-only` is currently the only way any non-local environment can start, and every such runtime is explicitly synthetic. The payout provider remains unselected. Status for 0.3 and 0.4 stays PARTIAL: the guardrail is verified, the provider integration is not.

**Operator action required.** `infrastructure/supabase-dev/.env` and `infrastructure/supabase-production/.env` already exist on this machine and will now fail startup until each gains `ALLOW_SYNTHETIC_PROVIDERS`, `PAYMENT_WEBHOOK_KEY` and `PROVIDER_CLEARING_ACCOUNT_REFERENCE`, and replaces any remaining `replace-with-...` placeholder. This is the intended effect of the fix, not a regression.

## Phase 1 — validation evidence audit

| Step | Status | Evidence and finding |
|---|---|---|
| 1.1 Manual kit | PARTIAL | docs/pilot/manual-kit contains catalogue, intake, confirmation, dispatch/proof, refunds and reconciliation templates. Full field/handoff inspection and exercised acceptance remain pending. |
| 1.2 Participants/training | PARTIAL | Fictional cohort, personas and readiness files exist. No actual recruitment/verification/training was established in this pass. |
| 1.3 Manual orders | PARTIAL | docs/pilot/build-decision/decision-record.md records eight desk scenarios and nine synthetic vendor-order rows, not real observed transactions. |
| 1.4 Measured outcomes | BLOCKED | docs/pilot/measurement/synthetic-baseline.md explicitly marks conversion, timing, support effort, profit and repeat orders NOT_OBSERVED. Real/consenting controlled observations and approved measurement are required. |
| 1.5 Build decision | PARTIAL | BUILD-01 permits historical limited foundation work; later owner implementation authority is recorded in D-15. Neither proves demand or positive economics. |

**Phase 1 conclusion:** synthetic rehearsal exists; market-validation exit gate is not met. Do not generate fictional results to close it. Further code audit can continue without claiming the business has been validated.

## Phase 2 — preliminary controls only

- Eight client manifests and API/worker manifests found. This proves scaffold presence, not usable workflows.
- `node tooling/scripts/check-boundaries.mjs`: PASS.
- `node tooling/scripts/verify-ci-workflow.mjs`: PASS (configuration controls only, not a remote CI run).
- `node tooling/scripts/verify-feature-matrix.mjs`: initial FAIL because COM-08 scope changed from Launch to Later; synchronized matrix then PASS for 354 catalogued capabilities. This checks traceability consistency, not whether 354 capabilities work.
- `node tooling/scripts/verify-feature-matrix.mjs --self-test`: PASS.
- No fresh full build, PostGIS migration exercise, Valkey readiness, remote CI execution or deployed skeleton verification in this audit yet.

**Phase 2 status:** PARTIAL preliminary inspection. Next: audit 2.1 directory/ownership map, then 2.2 all controls, 2.4 migrations, 2.5 executed CI evidence and 2.6 staging skeleton separately.

### Run 2 (6 September 2026) — step 2.3 startup and readiness

| Step | Status | Evidence and finding |
|---|---|---|
| 2.3 Entry points and readiness | PARTIAL | The API binary boots and serves `/health/live` and `/health/ready` on this machine with no database or queue running; liveness correctly stays `ok` while readiness reports `degraded` with per-dependency detail. **Defect P2-01, found and corrected:** readiness answered HTTP 200 in every case, including an unreachable database. `infrastructure/online-test/compose.yaml` judges container health with `fetch('/health/ready').then(r=>{if(!r.ok)process.exit(1)})`, and `tooling/scripts/online-test-health.mjs` and `load-smoke.mjs` read the same endpoint, so a deployed API with no database would have been reported healthy and kept in rotation. `apps/api/src/health.controller.ts` now sets 503 on the degraded and unreachable paths while returning the identical diagnostic body. Worker bootstrap, graceful shutdown and structured startup logging are not yet separately audited, so the step stays PARTIAL. |

**Observed evidence for 2.3.** `node dist/main.js` with `APP_ENV=test` and no local PostgreSQL: `/health/live` → HTTP 200 `{"status":"ok",...}`; `/health/ready` → HTTP 503 `{"status":"degraded","checks":{"process":"ready","database":"unavailable","queue":"unavailable"},"production_ready":false}` (HTTP 200 before the fix). Regression test `apps/api/src/health.controller.spec.ts` (2 tests) asserts liveness stays `ok` and readiness sets 503 against an unreachable database.

`pnpm --filter @neighbourhood-store/api test:integration` (`scripts/health-smoke.mjs`) remains **BLOCKED** on this machine: it requires the local PostgreSQL and Valkey stack (`pnpm db:test:up`), which is not running. It is an environmental dependency, not a code defect.

## Remaining audit queue

Phases 3–14: NOT_REVIEWED in this re-audit. Earlier tests/implementation do not become current phase-level certification. Work through every numbered step, tracing feature ID → role/API → persistence/worker → both clients → positive/negative acceptance tests. Record cross-phase dependency gaps without renumbering features or marking them done elsewhere.

## Run 3 (6 September 2026) — the connected ladder was red

Run 2 recorded `pnpm db:verify` as unrun. Podman is available on this machine, so run 3 executed it. It **failed**, and had been failing before any change in this session. `pnpm db:verify` is the command CI uses for its PostgreSQL/PostGIS gate, so the 265 capabilities marked `complete_local_synthetic` had no passing connected evidence behind them.

Two defects, each masking the next.

**Finding P3-01 — a control asserted a contract the schema had abandoned.** `verify-vendor-network.ts:94` required `createVendor({business_name: 'Sharma Kirana'})` to return `'SYNTH Sharma Kirana'`. Migration `0062_remove_synthetic_runtime_constraints` had already replaced `vendor_business_name_shape` with a length-only check, and `requireName` in `database/src/vendor-network.ts` strips the prefix and stores the name as typed. Implementation and schema agreed; the verifier did not, and it aborted the ladder at its second module. Same class as P0-02: the design moved and the control did not. The assertion now expects the name as typed, plus a new case proving a historical `SYNTH ` prefix normalizes away rather than accumulating. The doc comment above `requireName`, which described a prefix-on-write contract the function does not implement, was corrected.

**Finding P3-02 — migration 0062 could not be re-applied after its own rollback.** Its up migration issued nine unguarded `DROP CONSTRAINT` statements. Its down migration deliberately does not recreate the historical `*_shape` constraints (real records could already violate them). A down/up cycle therefore failed with `constraint "vendor_business_name_shape" of relation "vendors" does not exist`, breaking the rebuild-from-zero proof in `verify-lifecycle.ts` — exactly what phases.md step 2.4 requires. Every explicit drop is now `DROP CONSTRAINT IF EXISTS`; the `DO` block's generated drop is unchanged because it only names constraints it just found. This edits an already-applied migration, against the standing rule, because no corrective migration can repair a prior migration's own up-script; the resulting schema is identical on a fresh or already-migrated database.

**Result.** `pnpm db:verify` exit 0, 64 migrations, 27 verifier modules, 298 scenarios against real PostgreSQL/PostGIS, including forward migration, targeted rollback and rebuild-from-zero. Scenario counts per module are in `database.lifecycle.verified`.

### Run 3 — step traceability is now machine-checked

`docs/feature-matrix.json` had no phase or step field, so no capability could be tied to the plan and whole steps could go unreviewed while the matrix read as finished. Its `target_stage` field uses a different, historical numbering and is **not** a phase number.

Every capability now carries `phase_steps` naming the canonical steps that deliver it. `verify-feature-matrix.mjs` enforces that the array exists, that each value is a real `#### n.n` heading in phases.md, that a non-deferred capability names at least one step, and that every canonical step has a capability mapped to it unless it is declared process-only in `PROCESS_ONLY_STEPS` (governance, the concierge pilot, repository scaffolding, the shared primitive kernel, resilience drills and controlled launch). Six new self-test cases cover the parser and each rule.

The plan for this work said 78 steps. The parser counts **101**; that estimate was wrong and the number is now derived from phases.md rather than asserted.

First real run surfaced one inconsistency: `DLP-28` had no step. FEATURES.md scopes it as *Protected customer contact* at Launch, with only masked calling deferred under COM-08 — the matrix had drifted to the name *Masked customer contact*, which is what produced the wrong mapping. Corrected to steps 9.6 and 11.3. **The matrix `name` field is not validated against FEATURES.md; that drift is unaddressed and worth a later rule.**

`verified_by` — tying each capability to a named executable verifier rather than a self-asserted `evidence` boolean — is **not yet implemented**. Until it is, `evidence.tests: true` still means only that somebody wrote `true`.

## Run 4 (6 September 2026) — evidence claims tied to executable verifiers

`evidence` was a set of self-asserted flags: `evidence.tests: true` meant only that somebody wrote `true`. Every capability now also carries `verified_by`, a list of executable verifiers — a spec file, a connected `database/scripts/verify-*` module, or a control script. A design document does not qualify and the control rejects one.

`verified_by` was generated from verifiers that exist on disk, mapped per layer: canonical step → domain and API verifiers; role prefix → that role's client panel spec; shared client packages (`packages/ui`, `packages/i18n`, `packages/pwa-auth`) → the capabilities they cover; and an Android map that names the only Android test file in the repository.

**Finding P4-01 — the `evidence` schema was undocumented and mixed types.** Values ranged over `true`, `false`, `"partial"` and `"ui_only"` with no legend for the strings. `meta.evidence_legend` now documents every permitted value and the control rejects anything else.

**Finding P4-02 — 141 client evidence claims had no verifier.** Any layer claim that no verifier backs is now recorded as `unverified`: believed implemented, but nothing here demonstrates it. This preserves the claim while making the gap countable, and `unverified` cannot support a `complete_local_synthetic` status.

**Finding P4-03 — 20 completions rested on no verified client.** Seven (MKT-01/03/04/07/08/09/10) are product-level properties realized through the customer surfaces the customer panel spec renders, and are now credited to it. Thirteen (ENG-03/10/13/14, SEC-03/06/10/13, OPS-08/09/14, INT-01/02) are kernel mechanics, server-side privacy and financial controls, operational tooling and provider ports with no client surface of their own; they are now marked `client_applicability: "no_client"`. The customer-visible half of each already has its own CUS/VEN/DLP/ADM record.

**State after run 4.**

| Layer | Verified | Unverified |
|---|---|---|
| Android | 1 capability (CUS-02, `partial`, via `apps/customer-app/tests/session-manager.spec.ts`) | 107 |
| PWA | 228 | 15 |

40 capabilities name no verifier at all. **The single largest evidence gap in the project is Android: one test file, covering customer session management, against 108 capabilities that claim the layer.** Building that test infrastructure is the next task.

Seven new control self-tests cover the unbacked-test claim, a document offered as proof, a client claim backed only by a server verifier, `unverified` standing without a verifier, `unverified` failing to support completion, and an undocumented evidence value.

### Data loss during run 4 — recorded deliberately

`docs/feature-matrix.json` is **not tracked by git** (never added; it is not ignored). The first pass of the `verified_by` generator downgraded in place with no backup, and the distinction between `true`, `"partial"` and `"ui_only"` was destroyed for 141 layer values before the generator was made idempotent.

The pre-downgrade distribution, captured during the run, was: `android` — `true` 84, `"ui_only"` 17, `"partial"` 7, `false` 246; `pwa` — `true` 242, other positive values 7, `false` 105. Restoration since then sets a recovered layer to `true`, so at most seven previously `"partial"`/`"ui_only"` PWA records may now be recorded one step stronger than they were. Every restored value is backed by a verifier that exists, so none is unsupported — but the original precision is gone and cannot be recovered from this repository.

**This file should be committed.** A traceability record that no version control protects can be silently rewritten, which is exactly what happened.

## Run 5 (6 September 2026) — Android test infrastructure and a D-15 credential defect

Run 4 recorded one Android verifier against 108 capabilities claiming the layer. Building the test infrastructure exposed why there were no tests: for three of the four shells there was almost nothing correct to test.

**Finding P5-01 — vendor, partner and admin Android shells kept credentials in memory only.** `token-storage.ts` in each held the token in a module-level variable, so a sign-in did not survive a process restart. Each file carried the same comment: persistence "needs a native secure-storage dependency (`expo-secure-store`), which is a native build decision". **`expo-secure-store@56.0.4` was already a dependency of both the vendor and partner apps.** The stated blocker was stale; only the admin app genuinely lacked it. D-15 requires Android credentials to live in SecureStore, and three of four clients did not.

Corrected: `expo-secure-store` added to the admin app, and all three shells now persist through SecureStore with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, matching the customer app. The exported API (`loadPersistedToken`, `persistToken`, plus the vendor's location pair) is unchanged, so no caller moved.

**Finding P5-02 — the vendor shell leaked one account's store to the next.** `persistToken('')` ended the session but left the persisted vendor location behind, so the next person signing in on that device inherited the previous account's store until they noticed and retyped it. Signing out now clears the location with the token, and a regression test signs a second account in over the first to prove nothing is inherited.

**Why the split modules.** `expo-secure-store` cannot be imported under plain Node — it resolves native modules — so the first attempt at a test failed at import. Each app now separates `token-storage-core.ts`, which holds the behaviour and takes an injected backend, from `token-storage.ts`, which only binds it to SecureStore. This mirrors the separation the customer app already had between `session-manager.ts` and `token-storage.ts`, and it is what makes the behaviour testable without a device or an emulator.

**Test infrastructure.** `apps/vendor-app`, `apps/partner-app` and `apps/admin-app` now have a `test:unit` script (`node --import tsx --test tests/*.spec.ts`, the pattern the customer app already used) and are reached by `pnpm test:unit` and CI. 16 new tests cover: no session before first write, restore across a simulated process restart, keychain protection passed through on every write, deletion rather than an empty value on sign-out, and nothing inherited by the next account.

`pnpm test:unit`: 374 tests, 374 pass, 0 fail (358 before this run). `pnpm typecheck` exit 0.

**Finding P5-03 — the catalogue has no capability for non-customer session persistence.** FEATURES.md catalogues CUS-01 (phone OTP sign-in) and CUS-02 (secure persistent session) for the customer, and **nothing equivalent for vendor, partner or admin**, although all four shells have sign-in panels. The three new Android verifiers therefore have no capability to attach to and are deliberately left out of `verified_by`. Crediting them to SEC-05 would have been wrong: that capability is server-side env-var and secret handling, with `pwa` and `android` explicitly `false`. **The catalogue needs role session capabilities; until it has them, this work is invisible to the matrix.**

**Android state is unchanged at 107 unverified, and that is the honest number.** These tests verify credential storage, not screens. Every remaining Android claim needs a screen-level test: dedicated route renders and navigates, controls call the authorized API, loading/empty/error/stale/success/retry states, offline behaviour that never reports false success, English/Hindi, and no cross-account cached data. That is the bulk of the remaining Android work and it has not started.

## Run 6 (6 September 2026) — Supabase Storage adapter

D-15 approves Supabase Storage with public approved catalogue assets kept apart from private quarantined evidence. `LocalProtectedObjectStorage` was the only implementation, and it writes to the filesystem of whichever machine runs the process, so no deployment could store anything.

**Plan correction — `issueReadGrant` stays synchronous.** The plan for this work said it had to become `async` to return a Supabase signed URL, touching four call sites. Reading the callers showed that would be a regression. A grant is issued and consumed *inside* the API (`catalogue-products.ts:928`, `vendor-onboarding.ts:1459`), which then proxies the bytes and checks them against the checksum stored on the row. A signed URL hands the caller something forwardable that bypasses that check. The opaque HMAC grant is the stronger design, so the interface is unchanged and no call site moved.

**Shared policy, extracted first.** Two adapters that disagree about what they accept are a way in: a file the local adapter rejects but the remote one stores. `validateProtectedObjectInput`, `requireGrantKey`, `signReadGrant` and `openReadGrant` now hold that policy once, and `LocalProtectedObjectStorage` was rewired onto them with no behaviour change (its existing spec still passes). `SupabaseProtectedObjectStorage` uses the same helpers, and a parity test asserts both adapters refuse the same five inputs and cap grants at the same 300 seconds.

**Bucket separation.** Routing is by object-key prefix: `vendor-onboarding/` to the evidence bucket, `catalogue-images/` to the catalogue bucket. The constructor refuses a configuration where they are the same bucket, and so does `loadSharedRuntimeConfig`. Both buckets are private in this adapter — an approved catalogue image becomes publicly readable through a separate publication step, not by being written to a public bucket up front. Uploads use `upsert: false`, so a repeated key is refused rather than silently replacing evidence somebody has already reviewed.

**Driver selection, and a gate that finally splits.** `OBJECT_STORAGE_DRIVER` now accepts `filesystem` or `supabase`. The filesystem adapter is refused outside `local`/`test`/`queue-compat` unless the runtime is explicitly acknowledged as synthetic; the Supabase adapter is not gated, because it can genuinely back a deployment. That also separates two gates that run 2 had merged: object storage and the fake OTP adapter. The OTP gate now lives in the API loader on its own, is independently reachable, and has a test proving a remote runtime with real Supabase storage still refuses to start because MSG91 remains an open D-15 gate.

**Verification.** `database/src/supabase-protected-object-storage.spec.ts` — 15 tests: bucket routing keeps evidence out of the catalogue bucket, a shared-bucket configuration is refused, no overwrite of a reviewed object, round-trip through a grant, a bucket object swapped behind the application's back fails the checksum, a missing object reports not-found rather than a transport error, a grant signed with foreign key material is refused, an expired grant is refused, and deleting an absent object is the desired end state. Six new runtime-config tests cover driver selection and bucket configuration; one new API test covers the split OTP gate.

The adapter typechecks against the real `@supabase/supabase-js@2.58.0` client types — the declared interface had to be widened to `PromiseLike` because the client returns thenable builders rather than plain promises, which is how that mismatch surfaced.

**Residual blocker.** No Supabase Storage bucket has been provisioned and nothing was uploaded to a live project. This adapter is **VERIFIED_LOCAL against contract tests, not VERIFIED_STAGING**. Before it can be used: create the two buckets as private, confirm the service-role key reaches them, and run an upload/download/delete round-trip against the real project. Malware scanning is still the `scan_scenario` stub — a real scanner remains unimplemented, and the adapter refuses a `rejected` object before it reaches a bucket, which is the ordering D-15 requires but not a scanner.

### Run 6 addendum — an intermittent failure in the mandatory CI gate

Re-running `pnpm db:verify` after the storage refactor failed at `verify-reference-module.ts:116`, *Reference durable job did not complete its state transition* — a module the refactor does not touch. Re-running it unchanged passed. Not caused by this work, and not deterministic.

**Finding P6-01 — durable jobs were scheduled against one clock and claimed against another.** `scheduleDurableJob` stored `run_at` from a caller-supplied `Date`, and `reference-module.ts` passed `new Date()` — the **application process's** clock. The claim query filters on `run_at <= clock_timestamp()` — the **database's** clock. Under Podman the database runs in a Linux VM whose clock can sit behind the host's, so a job meant to run immediately was briefly unclaimable and the batch claimed nothing.

The workaround was already visible in `verify-jobs-lifecycle.ts`, which scheduled with `new Date(Date.now() - 1_000)`: a one-second backdate absorbing skew, tolerating less than a second of it. The reference module had no backdate, which is why that was the module that flaked.

**Correction.** `scheduleDurableJob` now accepts `run_at: Date | 'immediate'`. `'immediate'` inserts `COALESCE($10::timestamptz, clock_timestamp())`, so the database stamps the time and scheduling and claiming read one clock. A `Date` is still accepted and is now reserved for a genuine future time. The idempotency comparison skips `run_at` for an immediate job, since there is no caller-supplied value to compare. Both callers moved to `'immediate'`, and the one-second backdate is gone.

`verify-jobs-lifecycle.ts` gains a regression test asserting an immediate job is claimable the instant it is scheduled (`run_at <= clock_timestamp()` in the same statement), and — as the contrast that proves the claim window still works — that a job scheduled an hour ahead is withheld. Both live in their own queue scope. Two earlier attempts were wrong and are worth recording: leaving them in the shared scope made a later `batch_size: 1` claim the inspection job instead of its intended one, and cleaning them up with a `DELETE` hit an append-only guard trigger on `scheduled_jobs` — the schema refuses to let job history be removed, which is correct and meant isolation, not deletion, was the answer.

**This matters beyond the test.** Any deployment where the API and the database disagree slightly about the time had the same defect: a "run now" job briefly invisible to workers. NTP keeps production skew small, so it would have shown up as rare, unreproducible latency rather than a clean failure.

**Result.** `pnpm db:verify` exit 0: 64 migrations, 27 modules, 298 scenarios, with `job_scenarios` at 7 and `reference_scenarios` at 5.

**A flaky mandatory gate is its own finding.** `pnpm db:verify` blocks merge in CI. An intermittent failure there trains people to re-run until green, which is how a real regression gets waved through. Recorded against phase 2.5 and 3.6.

## Run 7 (6 September 2026) — step 2.1, scaffold the approved repository structure

Walked each of the five numbered requirements against the repository rather than against the completion report.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Application, package, database, infrastructure, test and runbook directories | Present. `tests/` holds no tests; that is now stated rather than implied. |
| 2 | Workspace/package manifests and lockfiles | `pnpm-workspace.yaml` covers `apps/*`, `database`, `packages/*`; `pnpm-lock.yaml` present and installs clean. |
| 3 | Pin supported runtime and package-manager versions | **Defect P7-01, corrected.** |
| 4 | Root scripts for build, lint, type-check, unit test, integration test, format check, development startup | All present and all exercised in this session. |
| 5 | Document what every top-level directory owns and may import | **Defect P7-02, corrected.** |

**Finding P7-01 — the version pins did not pin.** `.nvmrc`, `.node-version`, `engines` and the CI workflow all agree on Node 24.19.0 and pnpm 11.19.0, so this read as settled. It was not enforced: with a manifest requiring Node 18 on a Node 24 host, `pnpm install` printed `[WARN] Unsupported engine` and **exited 0**. A contributor on the wrong runtime gets a line they scroll past.

Corrected with `engineStrict: true`. The first attempt put it in a new `.npmrc` and changed nothing — this pnpm reads its settings from `pnpm-workspace.yaml`, where `allowBuilds` and `linkWorkspacePackages` already live, and silently ignores `engine-strict` in `.npmrc`. That file was deleted rather than left looking like a control. Re-tested in the same way: the mismatched manifest now fails with exit 1, and the repository still installs cleanly on the pinned versions.

**Finding P7-02 — the ownership map had stopped describing the repository.** Requirement 5 was the one nothing checked, and it had drifted in five directions:

- `packages/README.md` tabulated five of seven shared packages — `ui/` and `pwa-auth/` had no documented ownership or import rule, and both were credited as client-layer verifiers in run 4.
- Its prose said "other shared packages remain independent" while `check-boundaries.mjs` has allowed `ui → ui-tokens` all along. The enforced rule and the written rule disagreed; the enforcement was right.
- `e2e/` and `tooling/` had no README at all.
- `tests/README.md` claimed to own "PWA end-to-end journeys executed with Playwright". Playwright's `testDir` is `./e2e`. The directory documented content it does not hold, and the directory that holds it said nothing.
- `infrastructure/README.md` carried two claims that had stopped being true: "D-12 prohibits executing it", superseded by D-15, and "Valkey and the explicit Redis compatibility profile remain later local queue-foundation work" while `compose.yaml` provisions `valkey` and `valkey-test`, `VALKEY_URL` is a required setting, and `queue-compat` is a real environment.

All six documents were corrected, and `e2e/README.md` and `tooling/README.md` written. `tooling/README.md` records the rule that a control may import Node built-ins only: a control that depends on the code it judges can be made to pass by changing that code.

**The durable part is the control, not the prose.** `tooling/scripts/check-directory-ownership.mjs` fails when a top-level directory has no README, when a README does not state what it may import, when a shared package is missing from the ownership table, and when a README repeats a claim recorded as stale. It carries six self-tests and runs in `pnpm lint` and `pnpm test:controls`. Its first real run reproduced all ten defects found by hand, which is the check that it checks anything.

**Verification.** `pnpm test:controls`, `pnpm lint`, `pnpm format:check` exit 0. Exit-gate commands exercised end to end on this machine: `pnpm install` exit 0, `pnpm db:migrate` exit 0, `pnpm db:seed` exit 0 (7 fixtures, hash `0f96ba6b…`), `pnpm db:verify` exit 0 (64 migrations, 27 modules, 298 scenarios), `pnpm test:unit` 396 pass / 0 fail, `pnpm typecheck` exit 0.

**Step 2.1: VERIFIED_LOCAL.** All five requirements met with executable evidence. The Phase 2 exit gate stays open: it also depends on 2.5 executed CI evidence and 2.6 a staging skeleton that actually deploys, neither of which this step covers.

## Run 8 (6 September 2026) — step 2.2, code-quality and contribution controls

| # | Requirement | Verdict |
|---|---|---|
| 1 | Formatting, linting, strict type checking, import boundaries, test conventions | Met. `tsconfig.base.json` is genuinely strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `skipLibCheck: false`) and every one of the 17 workspace configs extends it. |
| 2 | Pull-request and issue templates | Met. `PULL_REQUEST_TEMPLATE.md`, two issue forms, `config.yml`, plus `dependabot.yml`. |
| 3 | Secret scanning and dependency/security checks | **Defect P8-01, corrected.** |
| 4 | Safe environment example with placeholders only | Met, with a caveat recorded below. |
| 5 | Local generated files and secrets ignored | Met, verified per file. |

**Requirement 5, checked rather than assumed.** `git check-ignore -v` confirms `.env`, `infrastructure/supabase-dev/.env`, `infrastructure/supabase-production/.env` and `infrastructure/online-test/release.env` are each ignored by a named rule, and `infrastructure/supabase-production/secrets/` likewise. The committed `prod-ca-2021.crt` is a public CA certificate, not a key, and is untracked anyway.

**Requirement 1, an override tested instead of trusted.** Four projects override the base's `skipLibCheck: false`. Running `tsc --skipLibCheck false` on each shows all four genuinely need it — the errors are inside third-party declarations (`expo-asset`, `@supabase/auth-js`), never in this repository's own code. The relaxation is earned. Two of the four carried no rationale at all, and the comment in the other two claimed Expo apps are "the only app kind that needs it" — which is wrong twice over: `database/` needs it for the same dependency, and `admin-app`, the same kind of app, compiles clean without it and does not set it. All four comments now say what was measured.

**Finding P8-01 — the secret scanner scanned for the wrong secrets.** It matched AWS access keys, GitHub tokens, Stripe keys, Google API keys and npm tokens. **This project uses none of those.** Feeding it realistic samples showed what it missed:

| Credential | Before |
|---|---|
| Supabase service-role JWT | missed |
| PostgreSQL URL with an inline password | missed |
| Razorpay key | missed |
| AWS access key | detected |

The service-role key bypasses every row-level rule in the database, and the pooler URL carries its password inline — those are the two highest-value secrets in the repository, and `pnpm security:secrets` passed regardless.

Added: JWT, Razorpay and MSG91 patterns, plus a connection-string check that flags a remote host whose password is neither a placeholder nor a loopback development credential. That distinction matters — every `env.example` here is written as a pooler URL with a `URL_ENCODED_…` placeholder, and `.env.example` carries a loopback URL with a synthetic password. Both must keep passing or the control gets switched off, so both are self-tested.

**It immediately caught my own work.** The first real run flagged `apps/api/src/runtime-config.spec.ts` and `database/src/runtime-config.spec.ts` — fixtures I wrote in run 2 using a remote pooler host with the password `secret`. The scanner was right; the fixtures now use an obvious placeholder. It then flagged its own new self-test fixtures, which is why they are assembled from parts rather than written out, matching the idiom the file already used for its GitHub-token fixture.

**Requirement 3, second half — the audit exception re-verified rather than inherited.** Both ignored advisories rest on one factual claim: that `image-size >= 2.0.3`, which the advisory names as patched, was unpublished. That claim is 20 days old and is the exception's own removal trigger. Checked: the newest published release is `2.0.2`, so the premise holds and the ignore stays justified. The document's review date and the re-verification are recorded, with the command to repeat it.

**Requirement 4 caveat.** `.env.example` is not strictly placeholders-only: `DATABASE_URL`, `PAYMENT_WEBHOOK_KEY` and `PROVIDER_CLEARING_ACCOUNT_REFERENCE` hold working local synthetic values. That is deliberate and now safe — since run 2 those exact values are refused outside `local`/`test`/`queue-compat`, so copying the file cannot produce a working deployment credential. Recorded rather than changed.

**Verification.** `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:controls`, `pnpm security:secrets` all exit 0; `pnpm test:unit` 396 pass / 0 fail. The scanner's self-test now covers six new cases, three that must detect and three that must not.

**Step 2.2: VERIFIED_LOCAL.**

## Run 9 (6 September 2026) — step 2.3 completed

Run 2 closed the readiness defect (P2-01) but left requirements 1, 2, 3 and 5 unaudited. This run finishes the step, exercising the processes rather than reading them.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Minimal client shells for the launch sequence | Met. `verify-client-entry-points.mjs` starts each PWA and asserts its served title, and checks the Android exports: `{"pwa_shells":4,"android_exports":4}`. |
| 2 | Backend bootstrap and dependency wiring | Met. The API boots its full provider graph and serves; confirmed again in this run. |
| 3 | Worker bootstrap and graceful shutdown | Met, with **defect P9-01 corrected**. |
| 4 | Liveness and readiness endpoints | Met in run 2 (P2-01: readiness now answers 503 when degraded). |
| 5 | Structured startup logs with environment and version, excluding secrets | Met, verified by canary. |

**Requirement 3, verified behaviourally.** The worker was booted against the running local stack and sent SIGTERM. It logged `worker.ready` with environment, data mode, version and queue names, processed a batch, then logged `worker.stopped` with the signal and completed its hooks in 134–164 ms. The process is terminated by the signal rather than exiting 0, which is Nest re-raising after the hooks have run and is correct — the shutdown work completes first.

The ordering in `onApplicationShutdown` is deliberate and right: set `#stopping`, close the BullMQ worker so active handlers finish, then queue events, then the queue, then the pools. Closing concurrently would strand a live handler on an ended pool.

**Finding P9-01 — the worker abandoned work the orchestrator had given it time to finish.** `closeQueuesWithin` waited a hard-coded 4 s for an in-flight handler, then logged `worker.shutdown.incomplete` and moved on. `infrastructure/online-test/compose.yaml` sets `stop_grace_period: 30s` for the same container. Any job between 4 s and 30 s was abandoned with 26 s of allowed drain time unused. Abandonment is safe — the job stays claimed until it stalls and is retried, and handlers are idempotent — but it is needless latency, needless load, and a retry that never had to happen.

The 4 s default was not arbitrary: a longer wait would hold up a watch-mode restart behind a hung job. So the fix is to make it configurable rather than simply larger. `WORKER_SHUTDOWN_GRACE_MS` now feeds `closeQueuesWithin`, validated as an integer from 1 000 to 120 000, defaulting to 4 000 so local development is unchanged. The online-test worker sets 25 000, under its own 30 s stop grace with room left for the pools to close after the queues drain. Five tests cover the default, the deployment value, and the three invalid shapes.

**Requirement 5, verified by canary rather than by reading.** Both processes were booted with distinctive canary values for `OTP_HASH_KEY`, `SESSION_TOKEN_HASH_KEY`, `OBJECT_STORAGE_GRANT_KEY`, `PAYMENT_WEBHOOK_KEY` and a database password, then searched for those exact strings. **No secret material appeared** — 47 worker lines, 324 API lines, clean. `api.started` carries environment, data mode, host, port, version and `production_ready: false`; `worker.ready` carries environment, data mode, version and queue names.

**Verification.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 401 pass / 0 fail (396 before this run).

**Step 2.3: VERIFIED_LOCAL.**

**Not covered.** Nothing here proves a job that takes longer than the grace is genuinely drained rather than merely waited on — that needs a deliberately slow handler and a timed shutdown, which belongs with the Phase 3.6 scheduler work. The 25 000 ms deployment value is reasoned from the stop grace, not measured against real job durations, because no deployment exists to measure.

## Run 10 (6 September 2026) — step 2.4, database migration and seed flow

| # | Requirement | Verdict |
|---|---|---|
| 1 | PostgreSQL and PostGIS for local/test | Met. `postgis/postgis:18-3.6` pinned by digest for both `database` and `database-test`; `0000_baseline.up.sql` activates the extension and `assertBaseline` refuses to seed without it. |
| 2 | Migration commands and a blank baseline | Met. The baseline is genuinely blank: the PostGIS extension and an empty `marketplace` schema with a comment. |
| 3 | Transaction-safe migration conventions | Met. Migrations run inside `inTransaction` under a migration lock, and no migration uses a statement that cannot run in one — no `CONCURRENTLY`, `VACUUM`, `CREATE DATABASE` or `ALTER SYSTEM` anywhere in the 64 files. `verify-static.ts` fails if up and down files are ever unpaired; all 64 are paired. |
| 4 | Deterministic synthetic seeds and fixture reset | Met, with **defect P10-01** on the documented path. |
| 5 | Prove migration forward, rollback where safe, and rebuild from zero | Met, and more thoroughly than expected. |

**Requirement 5 is stronger than the earlier note implied.** `verify-lifecycle.ts` does not merely revert to a couple of checkpoints: it reverts through sixteen targets ending at `0000_baseline`, migrating up again between each. Reverting through the baseline runs the down migration of every one of migrations 0001–0063 and re-applies all of them. That is a complete down/up cycle for the whole ledger, which is exactly why it caught migration 0062 in run 3, and it is followed by a rebuild from zero.

**Requirement 4 verified rather than observed once.** `pnpm db:seed` was run three times and produced the identical hash `0f96ba6bf50ce4ee…` each time, and it is idempotent — no reset needed between runs. The hash is genuinely derived, not a constant: `sha256` over the canonicalized fixture records, with `seedFixtures` re-reading the persisted rows and throwing `Persisted fixtures are not deterministic` if they disagree. Fixture rows are guarded at the schema level — `display_name LIKE 'SYNTH%'`, `synthetic_marker IS TRUE`, `payload @> {"synthetic": true}`.

**Finding P10-01 — the documented local path does not produce a usable system.** `pnpm db:seed` writes seven rows to `marketplace_test.fixture_records` and **touches the `marketplace` schema not at all**. It is a determinism harness, not an application seed. The application data comes from `db:seed:marketplace` and `db:seed:admin`.

`docs/engineering/local-entry-points.md` presented the setup as *migrate, status, seed* and stopped there. A developer following it gets a correctly migrated database with no vendor, no catalogue, no customer and no admin, starts the apps, and sees eight correct and entirely empty screens with nothing explaining why.

The knowledge already existed in the repository — `seed-marketplace.ts` opens by saying exactly this — but in a file header nobody on the documented path reads. Both `local-entry-points.md` and `database/README.md` now give the four-command sequence and say plainly what stopping after `db:seed` leaves behind.

This straddles requirement 4 and the Phase 2 exit gate, *"a clean checkout can install, migrate, seed, test, build, and start using documented commands"*. The commands existed; the documented ones did not reach a running marketplace.

**Idempotency checked, and the claim written to match.** `db:seed:marketplace` re-run against the local database left vendors, products and users unchanged at 3/18/14, exit 0. `db:seed:admin` was **not** run — it would add an account to the working local database — so the documentation credits it as idempotent by phone identity per its own contract rather than claiming a verification that did not happen.

**Verification.** `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm db:migrate` exit 0; `pnpm db:seed` exit 0 three times with a stable hash; `pnpm db:seed:marketplace` exit 0 and idempotent; `pnpm db:verify` exit 0 in run 8 covering 64 migrations, the full down/up cycle and rebuild from zero.

**Step 2.4: VERIFIED_LOCAL.**

**Not covered.** The empty-database claim rests on reading `seedFixtures`, not on rebuilding the local database to observe it — a rebuild would have destroyed the working data on this machine, and confirming a documentation gap is not worth that.

## Run 11 (6 September 2026) — step 2.5, CI pipeline

| # | Requirement | Verdict |
|---|---|---|
| 1 | Install dependencies from the lockfile | Met. `pnpm install --frozen-lockfile`. |
| 2 | Run format, lint, type, unit, migration, integration, build and security checks | Met, after **defect P11-01**. |
| 3 | Publish useful test reports without credentials or personal data | Met, verified by canary. |
| 4 | Block merge on mandatory failures | In-repo half met and tested; the other half is **BLOCKED**, see below. |
| 5 | Cache only safe reproducible artifacts | Met. The only cache is pnpm's store keyed on `pnpm-lock.yaml`; no build output is cached. |

**The step's headline finding is that none of this has ever run.** `origin/start` is at `e9a8b8a`, local `HEAD` is at `2b1383b`: **11 commits have never been pushed**, with **441 uncommitted files** on top of them, and the last fetch was 18 August. CI triggers on push to `main`/`start` and on pull requests, so no commit containing this work — the pre-existing uncommitted work or anything from this session — has produced a CI run. Everything below is configuration verified locally. **Step 2.5 has no executed evidence and cannot be closed without a push, which is out of scope here.**

**Finding P11-01 — the local gate and CI enforced different sets.** `pnpm build:online-test:pwas` ran in the root `check` aggregate and **never in CI**, so a broken PWA export could merge. In the other direction `pnpm db:verify` and `pnpm security:dependencies` ran in CI but not in `check`, so a local pass meant less than it appeared to. "It passes locally" and "it passes CI" meant different things in both directions.

Corrected on three fronts rather than by patching one list:

- CI gains an `online_test_build` step, reported into the evidence and the gate like every other check. Verified: the gate exits 1 when that outcome is `failure` **and** when it is absent, so adding a step without wiring its outcome cannot silently pass.
- `check` gains `pnpm db:verify` and `pnpm security:dependencies`, so both gates now enforce the same set.
- `verify-ci-workflow.mjs` now **derives** its requirement from the `check` script in `package.json` instead of repeating a hand-maintained list, and fails if any aggregate command is missing from the workflow. The old list had already drifted — it did not require `pnpm test:e2e`, which CI happens to run. Two self-tests cover the split and the missing-command case.

**Requirement 3 verified by canary, not by reading.** `ci-evidence.mjs write` was run with `SUPABASE_SERVICE_ROLE_KEY` and `OTP_HASH_KEY` set to canary values. The published `summary.json` contains only check ids, names, outcomes and run metadata; **neither canary appears**. The artifact upload is restricted to `summary.json` and `summary.md`, and the control rejects a wider upload path.

**Requirement 4, tested and half-blocked.** The gate was exercised directly: exit 0 when every outcome is `success`, exit 1 for a `failure` in each mandatory check, and exit 1 for `skipped` — which matters, because a mandatory step that never ran must not pass. What cannot be verified from here is whether GitHub branch protection actually *requires* this check before merge. That is a repository setting, not a file, and no evidence of it exists in the tree. **Recorded as BLOCKED: confirm branch protection on `main` requires the "Mandatory quality gate" job.**

**A false finding I nearly recorded.** My first gate test reported exit 1 for every case including all-success. The cause was my own shell: zsh does not word-split an unquoted variable, so `env $BASE` passed one enormous variable name and every outcome read as `unreported`. Re-run with proper inline assignments, the gate behaves correctly. Worth recording because the failing output looked exactly like a broken gate.

**Verification.** `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 401 pass / 0 fail; both CI controls pass their self-tests and their real runs.

**Step 2.5: PARTIAL.** Configuration is correct and now self-enforcing. Executed CI evidence and branch protection are both outstanding, and neither can be produced without pushing.

## Run 12 (6 September 2026) — step 2.6, non-production skeleton

Nothing is deployed and nothing was deployed by this run. The step's five requirements are about provisioning and deploying, so most of it is **BLOCKED** by design. What could be audited is whether the artifacts a deployment would use are correct — and one of them was not.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Provision isolated staging resources | BLOCKED. No compute provisioned; OCI Free Tier can still require card verification, which is the account owner's decision. |
| 2 | Inject secrets from the approved secret manager | Enforced in the Compose file since run 2, but **defect P12-01** meant the build itself pulled on-disk secrets in. Corrected. |
| 3 | Deploy clients, API and worker skeletons | BLOCKED. The Containerfile is sound: pinned base by `ARG`, corepack pinned to the same pnpm as `packageManager`, frozen-lockfile install, `pnpm deploy --prod` to prune, non-root `USER node`. |
| 4 | Run health and rollback checks | BLOCKED on execution; the procedure and scripts exist and are internally consistent. |
| 5 | Record deployment version and environment evidence | BLOCKED on execution; `online-test-health.mjs` records `releaseVersion`, `environment` and per-check results. |

**Finding P12-01 — the container build would have carried live credentials into the builder layer.** `.containerignore` listed `**/node_modules`, `**/dist` and `**/.next` — so the author knew the `**/` prefix — but wrote `.env`, `.env.*`, `*.pem` and `*.key` without it. Ignore patterns are matched against the whole path, so a bare `.env` excludes only the repository root one.

Proven rather than argued: a probe context was built with the repository's own `.containerignore` and the resulting layer listed

```
ctx/keep.txt
ctx/nested/.env      <- included
```

The Containerfile does `COPY . .` in the builder stage. `infrastructure/supabase-production/.env` and `infrastructure/supabase-dev/.env` — holding the Supabase service-role key and pooler passwords — sit exactly two levels down and would have been copied into every image build. They would not reach the runtime image, since only `/opt/release` is carried forward, but they would be in the build context, in the builder layer, and in the local build cache, and would ship with anything built with `--target builder`.

Corrected by adding `**/.env`, `**/.env.*`, `**/release.env`, `**/*.pem`, `**/*.key`, `**/secrets` and `**/.local-data`. Re-proven with the same probe: nested, deeper, `release.env` and `.key` files are all excluded now. `verify-online-test-deployment.mjs` fails if the `**/` variants are ever dropped, with a self-test covering both directions.

**Finding P12-02 — the deployment inventory named two superseded targets.** `provider-targets.json` recorded `objectStorage: "Cloudflare R2"` and `pwaAndCdn: "Cloudflare Pages"` for all four PWAs. D-15 approves **Supabase Storage** (implemented in run 6), and moves the customer PWA to **Workers/OpenNext** because a static export cannot serve its BFF routes — the same fact behind P0-02. Both corrected, with the superseded values preserved under `supersededTargets` rather than deleted, and both now asserted by the deployment control.

**Finding P12-03 — the runbook was paused on a decision that has been superseded.** `runbooks/online-test/README.md` opened with *"PAUSED: D-12 makes local company development the only active path… until an explicit superseding decision is recorded."* D-15 is that decision. Left as-is, the runbook waits forever on something that already happened.

It was **not** rewritten into an executable runbook. D-15 approves direction, not activation, and says so: credentials, accounts, operational approvals and deployed availability are not assumed, and spending is a separate gate. The banner now reads NOT AUTHORIZED TO EXECUTE, names D-15 as the superseding decision, and states what is genuinely outstanding — owner approval for provisioning and any card verification. Its R2 instructions were replaced with the Supabase two-bucket setup, and its secret-management step now lists the variables the runtime refuses to start without.

**Verification.** `pnpm lint`, `pnpm format:check`, `pnpm test:controls`, `pnpm security:secrets` exit 0; the deployment control passes its self-test and its real run.

**Step 2.6: BLOCKED.** The artifacts are now correct and self-enforcing. Provisioning, deployment, an executed health check and a rehearsed rollback all require owner approval and spending decisions that have not been made.

### Phase 2 exit gate

*"A clean checkout can install, migrate, seed, test, build, and start using documented commands. CI performs the same gates. Staging deploys and rolls back without manual database edits."*

Steps 2.1, 2.2, 2.3 and 2.4 are VERIFIED_LOCAL. The first sentence holds since run 10 corrected the documented seed sequence. The second is now true by construction — run 11 made the local aggregate and CI enforce the same set — but has never been observed, because nothing has been pushed. The third is untouched: nothing has been deployed. **Phase 2 remains open on 2.5 and 2.6, both blocked on actions outside this work: a push, branch protection, and provisioning approval.**

## Run 13 (6 September 2026) — step 3.1, shared kernel primitives

| # | Requirement | Verdict |
|---|---|---|
| 1 | Opaque UUID identifiers and non-secret public references | Met, tested empirically. |
| 2 | Integer minor-unit money and explicit currency | Met, with **defect P13-01** in an exported rounding helper. |
| 3 | UTC instants plus vendor timezone context | **Defect P13-02**, corrected. |
| 4 | Metres, grams, seconds, versioned deadlines | Met. Negative, fractional, `NaN` and `Infinity` inputs are all refused. |
| 5 | Stable error codes, localization keys, retryability, request IDs, field errors | **Defect P13-03**, corrected. |

**Requirement 1, measured over 3 000 generated identifiers.** Every one carried the correct version and variant nibbles, all were unique, `uuidV7Timestamp` round-tripped an injected instant, and a v4 UUID was rejected. Public references are checksummed: a single-character corruption is refused. Identifiers are **not** lexicographically monotonic within a millisecond — that is permitted by RFC 9562, which says `rand_a` MAY carry a counter rather than MUST, and randomness favours the opacity this requirement asks for. Not recorded as a defect.

**Requirement 2 is well built.** `createMinorUnitAmount` rejects anything that is not a safe integer, so floats and overflow both throw rather than silently losing paise, and `addMoney`/`subtractMoney` re-validate their result. Fee and commission maths uses **BigInt** with an explicit `roundHalfUp`, so a basis-point rate cannot introduce a fraction of a paisa.

**Finding P13-01 — the rounding helper is wrong for negative amounts.** `roundHalfUp(n, d)` is `(n * 2n + d) / (d * 2n)`, and BigInt division truncates toward zero, so the bias term that makes it correct for positives is wrong for negatives by a whole unit rather than at the tie: measured, `-1.4` returned `0` and `-1.6` returned `-1`.

Both callers guard their inputs with `safeInteger(..., 0)`, so nothing reaches it today and a negative item total would throw rather than round wrongly — the live behaviour is already fail-closed. But the helper is exported from the module that owns financial correctness, in a system that posts refunds and reversing entries. It now refuses negative numerators and non-positive denominators explicitly. Refusing rather than fixing is deliberate: **which way a refund rounds is a financial policy decision with an owner**, not something to settle inside a helper.

**Finding P13-02 — a fixed UTC offset was accepted as a time zone.** `createIanaTimeZone` validated by probing `Intl.DateTimeFormat`, and ECMA-402 accepts offset identifiers, so `+05:30` passed a function whose error message promises an IANA name. An offset carries no daylight-saving or historical rules, so a vendor stored with one would compute its own opening hours wrongly for half the year in any zone that observes DST — silently, and only in some months. India has no DST, which is exactly why this could sit unnoticed.

Offset-shaped values are now refused. Verified that real zones still pass, including the multi-part `America/Argentina/Buenos_Aires` and the alias `Asia/Calcutta`, so the fix does not over-reject.

**Finding P13-03 — every stable error code pointed at a localization key that did not exist.** The eleven `message_key` values in `errors.ts` were absent from `marketplace.locale_keys`. Meanwhile the registry held 324 keys, each translated into both `en` and `hi` with no gaps — so these were the only keys a client could ask for and fail to resolve, and every error response carried one.

The existing 12.3 coverage check asserts every *registered* key has both languages, which it does; it could never see a key the code references and nobody registered. Migration `0064_kernel_error_locale_keys` registers all eleven under the `error` namespace with audience `SHARED`, with English and Hindi copy following the register migration 0033 already established. `verify-launch-readiness.ts` now derives the required keys from `ERROR_DEFINITIONS` itself and fails if any is unregistered, so the loop between code and registry is closed.

**The Hindi copy needs a native-speaker review** at the phase 12.3 localization gate. It is consistent with the existing entries and was not machine-translated, but it was written here rather than by a translator.

**A false finding I nearly recorded.** I first reported the translation table as completely empty — zero rows, no languages — which would have made this a far larger defect. It was my own query: the columns are `language_code` and `translation`, not `language` and `translated_text`, and I had suppressed stderr, so a SQL error read as an empty result. The table is fully populated. Worth recording because suppressing stderr turned an error into a plausible-looking finding.

**Verification.** `pnpm db:verify` exit 0 — 65 migrations, 27 modules, 298 scenarios; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 415 pass / 0 fail (401 before this run). The eleven keys were confirmed resolvable in both languages against the running database after the migration applied.

**Step 3.1: VERIFIED_LOCAL.**

## Run 14 (7 September 2026) — step 3.2, request context and correlation

| # | Requirement | Verdict |
|---|---|---|
| 1 | Generate or validate request IDs | Met, tested against a running API. |
| 2 | Attach authenticated actor and trace context | Met. Well-formed W3C `traceparent`; the logger attaches actor id and kind. |
| 3 | Propagate correlation and causation into commands, events, jobs and provider calls | Met, asserted by the reference module. |
| 4 | Redact protected fields from logs | **Defect P14-01**, corrected. |
| 5 | Return request references safely to clients | Met, tested including a reflection attempt. |

**Requirements 1 and 5, exercised against a running API.** With no header, a request id is generated and returned. A valid UUIDv7 is echoed unchanged. A malformed one is **replaced, not echoed**, and the request is refused with `400 INVALID_ARGUMENT` carrying a structured field error. An `x-request-id` of `<script>alert(1)</script>` is not reflected anywhere in the response. `traceparent` matches the W3C form.

The error envelope carries `error.request_id`, and it **equals the `x-request-id` header** on every path, so a person quoting either one to support is quoting the same thing.

**Requirement 3 is genuinely asserted, not merely wired.** `verify-reference-module.ts` collects evidence across the aggregate, its transitions, the outbox row, the inbox receipt, the idempotency record, the job and the snapshot, then requires `all_correlated` and `all_requested` — every row carrying the same correlation and request id as the originating command. That runs on every `pnpm db:verify`.

**Finding P14-01 — redaction missed camelCase entirely, and most of this marketplace's own identifiers.** `redactProtectedFields` is the single gate: `json-logger.ts` passes all metadata through it before writing. Its key normalization converted `-` to `_` and nothing else, so camelCase never matched the protected-word pattern. Measured against a probe of realistic field names, these were written to logs in full:

| Passed through | Why it matters |
|---|---|
| `phoneNumber`, `otpCode`, `accessToken`, `deviceToken`, `refreshToken` | The snake_case spellings were redacted; the camelCase ones were not. Provider payloads are the obvious way in, since most arrive camelCase. |
| `mobile`, `msisdn` | A phone number under another name (CUS-01 is phone OTP sign-in). |
| `upi_id`, `vpa` | UPI is the primary payment method (CUS-40). |
| `ifsc`, `account_number` | Vendor and partner payout setup (VEN-02, DLP-07). |
| `aadhaar`, `pan` | Partner identity and document capture (DLP-02). |
| `lat`, `lng`, `lon` | Precise location; `latitude` and `longitude` were caught but the short forms were not. |

Corrected on both fronts: `safeKey` now splits camelCase boundaries, and the pattern covers the terms above. Verified in both directions — 23 protected names redacted, and 14 operational keys still legible, including `latency_ms` (which must survive the new `lat` entry), `account_reference`, `template_payload` and `platform`. Redaction that blinds the logs is its own failure.

**The schema limits the blast radius, which is worth stating.** Most stored columns are hashes and references — `access_token_hash`, `pickup_otp_hash`, `phone_lookup_hash`, `bank_account_reference` — not raw values. The exposure was inbound payloads and provider responses on their way through, not the database.

**Finding P14-02 — the same localization gap as P13-03, one layer down.** Field errors carry their own `message_key`, and `validation.invalid_request_id` and `validation.invalid_traceparent` were both unregistered. The check added yesterday derives its expectations from `ERROR_DEFINITIONS` and could not see them, because they were inline string literals at the throw site with nothing able to enumerate them.

Root cause addressed rather than the instance: they are now `FIELD_ERROR_MESSAGE_KEYS` in `errors.ts`, the hook references that constant, migration `0065` registers both with English and Hindi, and `verify-launch-readiness.ts` checks the declared field-error keys alongside the stable codes. `validation.bad` and `validation.must_be_positive` remain unregistered and should stay so — they are fixtures in `errors.spec.ts`, not production keys.

**Hindi copy in migration 0065, like 0064, needs a native-speaker review** at the phase 12.3 gate.

**A false alarm worth recording.** My first probe reported the header and body request ids disagreeing on the malformed-header path. They do not: the probe read `body.request_id`, but the error envelope nests it as `error.request_id`. The values match exactly. The flat-key assumption, not the API, was wrong.

**Verification.** `pnpm db:verify` exit 0 — 66 migrations, 27 modules, 298 scenarios; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 427 pass / 0 fail (415 before this run).

**Step 3.2: VERIFIED_LOCAL.**

## Run 15 (7 September 2026) — step 3.3, idempotent command handling

This step is the best-built one audited so far. Four of five requirements needed nothing.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Store actor, scope, key, canonical hash, status, response | Met. `idempotency_records` carries all of them plus `lease_expires_at`, `reconciliation_due_at` and `expires_at`. |
| 2 | Replay the original result for the same key and body | Met, asserted with a handler that fails the run if it executes twice. |
| 3 | Reject reuse with a different body | Met, `IdempotencyKeyReusedError` asserted. |
| 4 | Hold uncertain provider outcomes long enough for reconciliation | Met, with **defect P15-01** on the abandoned-command path. |
| 5 | Test simultaneous duplicate submissions | Met, genuinely concurrently. |

**Canonicalization measured, not read.** Reordered top-level and nested keys hash identically; array order, `null` versus a missing key, `'1'` versus `1`, and an extra field all hash differently; `-0` normalizes to `0`. `undefined`, `NaN`, cycles and class instances are refused outright rather than silently coerced. That is exactly the behaviour requirements 2 and 3 rest on.

**Scoping is right on both the write and the read path.** The unique index is `(actor_id, command_scope, idempotency_key)`, and the lookup query filters on all three rather than trusting the index to protect only inserts — so one actor cannot receive another's stored response by guessing a key.

**Requirement 5 is tested properly.** `verify-lifecycle.ts` holds a handler open on an unresolved promise, launches the duplicate while the first is still running, releases, then awaits both and asserts they collapsed to one execution. That is a real overlap, not two sequential calls.

**Finding P15-01 — an abandoned command would not have been reconciled for a week.** A lease expires when the process running a command died mid-flight, so its outcome is genuinely unknown — precisely the case D-15 says must enter reconciliation rather than be retried. `markExpiredLeaseUncertain` set `reconciliation_due_at = now + UNCERTAIN_RETENTION_MS`, reusing the seven-day **retention** constant as the **reconciliation** due date. Two different questions, one number.

Nothing breaks today, because **no sweep exists yet**: `reconcileUncertainCommand` is called only from the verifier, and no worker or job queries `reconciliation_due_at`. The column, its partial index (`WHERE status = 'UNCERTAIN'`) and the function are all built; the consumer belongs to a later phase — ENG-15 reconciliation workers, phase 10.5. So this is a trap laid for whoever builds that sweep: a crashed payment authorization would have been invisible to it for seven days while the customer's holds expired.

Corrected by separating the constants. `UNCERTAIN_RECONCILIATION_DELAY_MS` is one minute, leaving the provider a moment to settle; retention is untouched, since `expires_at = greatest(due_at, created_at + interval '7 days')` still keeps the record the full seven days.

**The abandoned-lease path had no test at all.** The uncertain-outcome coverage exercised only the path where a handler *returns* an uncertain result and supplies its own due date. `verify-lifecycle.ts` now seeds an `IN_PROGRESS` record whose lease has already expired, then asserts the next attempt does **not** re-execute the handler, that the record becomes `UNCERTAIN`, that it is due for reconciliation promptly, and that it is still retained for seven days.

**The new assertion was mutation-tested.** Inverting its comparison made `pnpm db:verify` fail with *"An abandoned command is not due for reconciliation promptly"*, then it was restored and the ladder passed again. A test that has never been seen to fail is not yet evidence.

**A schema constraint caught my own fixture.** The first version of the test inserted a record whose lease had expired before it was created, and `idempotency_lease_after_creation` refused it. The constraint was right; the fixture now backdates `created_at` so the lease is genuinely expired rather than nonsensical.

**Verification.** `pnpm db:verify` exit 0 — 27 modules, 298 scenarios, idempotency scenarios raised from 5 to 6; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 427 pass / 0 fail.

**Step 3.3: VERIFIED_LOCAL.**

**Carried forward.** No reconciliation sweep consumes `reconciliation_due_at`. That is correct for this phase — requirement 4 asks that uncertain outcomes be *held* long enough, which they are — but the worker that acts on them is outstanding and belongs to phase 10.5 / ENG-15.

## Run 16 (7 September 2026) — step 3.4, aggregate versioning and transition records

The strongest step audited so far. Every requirement already had a real assertion behind it; the work was finding what the assertions did **not** cover.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Integer aggregate versions | Met. Creation establishes version one; a transition advances version and state together. |
| 2 | Require expected versions for conflict-sensitive edits | Met. A stale edit returns `AggregateVersionConflictError` carrying the current version and state. |
| 3 | Validate allowed state, actor, evidence and reason | Met. Invalid actor, evidence and reason attempts are all rejected. |
| 4 | Append an attributable transition record | Met. The record carries previous and resulting version, from and to state, actor id and kind, reason code, evidence, request/correlation/causation ids and the command record. |
| 5 | Return stable conflicts without partial mutation | Met, and better than the wording requires. |

**Requirement 5 is genuinely enforced, including the caller's own writes.** `transitionAggregate` takes an optional `apply(client, resultingVersion)` callback and hands it **the same `PoolClient` inside the open transaction**, so a caller's domain mutation commits or rolls back with the version bump. The verifier proves it: the callback inserts a side-effect row and then throws, and the assertion requires version `1`, history count `1` and **side-effect count `0`**. A rejected transition leaves no partial state anywhere, not just in the aggregate tables.

Concurrency is tested with real overlap — two transitions submitted together, both with `expected_version: 1`, asserting exactly one fulfilled and exactly one `AggregateVersionConflictError`.

**Finding P16-01 — the append-only guard was only half tested.** `aggregate_transitions_append_only` fires `BEFORE UPDATE OR DELETE`, and both halves work: an `UPDATE` and a `DELETE` were each refused at runtime with *"aggregate transition history is append-only"*. The verifier asserted only the `UPDATE` half.

That gap matters more than it first appears. Narrowing the trigger to `BEFORE UPDATE` would have passed the entire suite while allowing an actor to **erase** the record of what they did — worse than editing it, because nothing is left to contradict. `verify-lifecycle.ts` now asserts the deletion is refused too, and `aggregate_scenarios` rises from 6 to 7.

**Mutation-tested, after the first attempt silently did nothing.** The probe narrowed the trigger in migration 0002 and expected the suite to fail. It passed — which briefly looked like the new assertion was ineffective. The real cause was my own edit: the source reads `BEFORE UPDATE OR DELETE` while PostgreSQL had reported the clause as `BEFORE DELETE OR UPDATE`, so the string replacement matched nothing and returned silently. A `diff` against the backup showed the file unchanged. Repeated with an assertion on the replacement, the probe applied and `pnpm db:verify` failed with *"Append-only transition history accepted a deletion"*; the trigger was then restored and the ladder passed again.

The lesson is worth keeping: an unasserted string replacement that no-ops looks exactly like a passing test, and would have produced the opposite conclusion about the assertion's worth.

**Verification.** `pnpm db:verify` exit 0 — 27 modules, aggregate scenarios raised from 6 to 7; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 427 pass / 0 fail. Migration 0002 confirmed byte-identical to its backup after the probe.

**Step 3.4: VERIFIED_LOCAL.**

## Run 17 (7 September 2026) — step 3.5, transactional outbox and inbox

| # | Requirement | Verdict |
|---|---|---|
| 1 | Business change and outbox event in the same transaction | Met. A rolled-back transition leaves no event. |
| 2 | Poll committed events in bounded batches | Met. Concurrent claims neither overlap nor exceed the batch size. |
| 3 | Publish or dispatch with retry and backoff | Met, and provider detail is asserted **not** to be stored on the failed attempt. |
| 4 | Deduplicate consumer receipts | Met. Concurrent receipts choose exactly one processor and leave exactly one database effect. |
| 5 | Expose dead-letter and recovery operations | Met. Retry exhaustion produces a bounded dead letter; recovery is reset, attributed, and returns to normal dispatch. |

The outbox side was already the best-covered module in the repository — including **both** halves of its append-only guard, the exact pair that step 3.4 was missing on `aggregate_transitions`.

**Finding P17-01 — the inbox guard had no assertion at all.** `protect_messaging_history` permits exactly one inbox transition, `PROCESSING → PROCESSED`, and only when `consumer_scope`, `event_id`, `request_id`, `correlation_id` and `received_at` are all unchanged and `processed_at` is set. Everything else, deletion included, raises `55000`. It is careful, and nothing tested it — while the outbox beside it had two assertions.

The narrowness is the whole protection. An update free to rewrite `event_id` or `consumer_scope` would let a consumer mark one event processed by pointing a receipt at another, which **defeats deduplication** rather than merely corrupting an audit row. `verify-messaging-lifecycle.ts` now asserts deletion is refused, a reopen to `PROCESSING` is refused, and updates that repoint the receipt at another event or reassign it to another consumer are refused. `messaging_scenarios` rises from 6 to 7.

**Two of my own tests were wrong first, and mutation testing found both.**

The first version asserted the identity rewrite against a receipt that had **already been processed**. Removing `NEW.event_id = OLD.event_id` from the guard left the suite green, because the guard rejected the update on `OLD.status = 'PROCESSING'` being false and never reached the identity comparison. The assertion passed for a reason unrelated to what it claimed to test — the precise failure this audit exists to catch. It now creates a receipt in `PROCESSING` so the comparison is actually reached.

The second version fabricated an event id for that receipt, which `inbox_event_fk` refused: a receipt may only reference a real outbox event. The run failed, but on the foreign key, not the guard — a red result that would have been just as misleading as the green one. It now reuses two committed events under a consumer scope of its own.

Only after both corrections did the probe behave: removing the identity check produced *"Inbox receipt accepted an update that repointed it at another event"*, and restoring it returned the ladder to green with migration 0003 byte-identical.

**Verification.** `pnpm db:verify` exit 0 — 27 modules, messaging scenarios raised from 6 to 7; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 427 pass / 0 fail.

**Step 3.5: VERIFIED_LOCAL.**

## Run 18 (7 September 2026) — step 3.6, scheduler and job framework

| # | Requirement | Verdict |
|---|---|---|
| 1 | Store durable scheduled jobs and ownership | Met. |
| 2 | Claim concurrent work safely | Met; `FOR UPDATE SKIP LOCKED` with the claim window asserted, and the clock-skew defect closed in run 3. |
| 3 | Retry idempotently with bounded backoff | Met. |
| 4 | Record attempts, error class, next attempt and terminal failure | Met, with **defect P18-01** in how the history guard reports refusals. |
| 5 | Queue age, throughput, failure and recovery metrics | Met. |

**Finding P18-01 — two of the four append-only guards raised the wrong error, and the tests could not tell.** Following a lead from step 2.4, where deleting a `scheduled_jobs` row returned `record "old" has no field "outcome"` rather than an append-only refusal:

| Table | Refusal raised | Intended |
|---|---|---|
| `aggregate_transitions` | `55000` | `55000` |
| `inbox_receipts` | `55000` | `55000` |
| `scheduled_jobs` | **`42703`** | `55000` |
| `outbox_events` | **`42703`** | `55000` |

`protect_job_history` guards both `job_attempts` and `scheduled_jobs`; `protect_messaging_history` guards both `inbox_receipts` and `outbox_events`. Each reads columns that exist only on its first table — `OLD.outcome`, `NEW.consumer_scope` — from inside a single `IF` condition. PL/pgSQL resolves every field reference in that condition regardless of which `AND` term would decide it, so firing on the second table produced an internal field-resolution error instead of the intended refusal.

**Nothing was permitted that should have been refused.** The write still failed, and it fails closed either way, because the table-name term is false and the `RAISE` is reached once the fields resolve. What broke was the contract: `55000` is what the guards document and what the assertions I wrote for steps 3.4 and 3.5 check for, and two of four tables did not honour it. Migration `0066` gates the field access behind the table check; all four now refuse with `55000` and their intended message, and the permitted `PROCESSING → PROCESSED` inbox transition still works.

**Why it survived: three assertions used a bare `catch`.** The outbox deletion, the scheduled-job mutation and the scheduled-job deletion all recorded "something threw" without checking what. Each has been tightened to require `55000`, and `job_attempts` — the other table the job guard serves — gained a deletion assertion it never had. `job_scenarios` rises from 7 to 8.

**Proven by reverting the fix.** Making migration 0066 install the original single-condition guards turned the ladder red with *"Durable outbox history accepted deletion"*; restoring it returned green. The tightened assertions genuinely catch the defect they were written for.

**One of my own assertions failed for the wrong reason first.** The `job_attempts` deletion targeted `firstSchedule.job_id`, a job that is never claimed and therefore has no attempts: the `DELETE` matched no rows, raised nothing, and failed the assertion for want of a row rather than because the guard let anything through. It now selects an existing attempt and asserts one is present before testing the refusal. This is the third such case in three steps — an assertion that fails, or passes, for a reason unrelated to what it claims to test.

**Verification.** `pnpm db:verify` exit 0 — 67 migrations, 27 modules, job scenarios 7→8, messaging scenarios 7; `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 427 pass / 0 fail.

**Step 3.6: VERIFIED_LOCAL.**

## Run 19 (7 September 2026) — step 3.7, configuration and feature-flag foundation

The best-covered step in Phase 3. Every requirement already had a real assertion.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Scoped, versioned configuration records | Met. A draft starts at version one in `DRAFT`; scoped versions activate independently. |
| 2 | Draft, validation, approval, schedule, active, superseded, rollback lifecycle | Met. Self-approval is refused, an invalid lifecycle jump is refused, activation supersedes the prior scoped version, and rollback creates a new attributable version from history rather than resurrecting the old row. |
| 3 | Safe flag evaluation by internal user, vendor, category, zone or cohort | Met, and it fails safe. |
| 4 | Preserve configuration versions on created business records | Met. A business record is asserted to retain its effective configuration version. |
| 5 | Invalid and overlap constraint tests | Met. Concurrent overlapping schedules produce exactly one winner; a non-boolean feature flag is refused by the database. |

**Requirement 3 fails safe by construction, and that is asserted.** An unresolved flag returns `enabled: false` rather than throwing or defaulting on, and a resolved value that is not a boolean throws rather than being coerced — so a stored `"true"` string cannot quietly enable anything. The verifier covers both, including deterministic specific-to-global scope precedence. The five gated capabilities are all `UNAVAILABLE` in the registry, consistent with D-15.

**Finding P19-01 — the bare-catch pattern is repository-wide, not local to step 3.6.** After correcting three of these in run 18, a sweep found **17 bare `} catch {` blocks across the connected verifiers**. Not all are defects: some sit in cleanup paths or genuinely mean "any failure blocks this". The dangerous ones assert a *specific* refusal while accepting any error, which is exactly how two guards raised `42703` for months behind green tests.

Two are in this step's verifier, both asserting append-only refusals. Both are now tightened to require `55000`, sharing an `isAppendOnlyRefusal` helper with the job verifier.

**Proven by changing the error code rather than the behaviour.** Making the configuration guard raise `22000` instead of `55000` — still refusing the write, only reporting it differently — turned the ladder red with *"Configuration content or business snapshot did not refuse with the append-only code"*. The bare-catch version would have passed that unchanged. Restored, and the ladder is green.

**Carried forward: the remaining bare catches belong to their own phases.** `verify-assignment-custody.ts` (2), `verify-inventory-reservations.ts` (1), `verify-money-lifecycle.ts` (4), `verify-reference-module.ts` (1), `verify-messaging-lifecycle.ts` (1), `verify-lifecycle.ts` (1) and `verify-static.ts` (5). They are recorded here rather than fixed, because each needs its own judgement about whether the specific error matters — money-lifecycle's four sit in phase 10, custody's in phase 9. Fixing them blind would replace one unexamined assumption with another.

**A probe of mine was inconclusive and is recorded as such.** Deleting from `business_configuration_snapshots` and `configuration_lifecycle_events` on the local database raised nothing, which briefly looked like a missing guard. Both tables are empty locally, so the statement matched no rows and no trigger fired. Their guard, `protect_configuration_history`, raises unconditionally and reads no fields, so it carries none of the P18-01 fragility — but that conclusion comes from reading the function, not from that probe.

**Verification.** `pnpm db:verify` exit 0 — 67 migrations, 27 modules, 8 configuration scenarios; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 427 pass / 0 fail.

**Step 3.7: VERIFIED_LOCAL.**

### Phase 3 exit gate

*"A reference module proves request context, transaction, state transition, outbox, worker consumption, idempotency replay, conflict handling, metrics, and audit correlation."*

`verify-reference-module.ts` does exactly that, and asserts `all_correlated` and `all_requested` across the aggregate, its transitions, the outbox row, the inbox receipt, the idempotency record, the job and the snapshot. It runs on every `pnpm db:verify`. **Steps 3.1 through 3.7 are all VERIFIED_LOCAL and the Phase 3 exit gate is met**, on the standing qualification that "local" means this machine: Phase 2's CI and staging gates remain open, so none of this has been observed anywhere else.

## Run 20 (7 September 2026) — step 4.1, OTP request and verification

| # | Requirement | Verdict |
|---|---|---|
| 1 | OTP challenge storage and provider adapter | Met. |
| 2 | Rate, device, phone, attempt, expiry and replay controls | Met, all six asserted. |
| 3 | No plaintext OTP in logs or durable general-purpose data | Met, and now proven on both halves. |
| 4 | Synthetic fixtures for success, failure, delay and duplicate callback | Met; all four scenarios exercised. |
| 5 | Accessible sign-in states in the first client surface | Met, with **finding P20-01** on how failures are announced. |

**Requirement 3 proven by canary, not by inspection.** The storage half was already covered — `otp_challenges` holds `code_hash` and `phone_lookup_hash`, never the code or the number, and the verifier asserts hashing, callback deduplication, destruction on lockout, and OTP-free append-only attempt evidence. The **logs** half had nothing behind it.

A real request was driven through the running API: `POST /auth/otp/request` returned **202**, a six-digit code was generated (read back from `otp_protected_test_outbox`), and across **326 captured log lines neither the code nor the phone identifier appears verbatim**. The response body carries `challenge_id`, `expires_at`, `replayed` and `status` — no code.

The only plaintext code in the schema is `otp_protected_test_outbox.otp_code`, a table whose name states its purpose and which exists so a synthetic run can read the code the fake adapter "delivered".

**Requirement 2 is complete.** A 15-minute rate window and a 30-second resend cooldown keyed on **both** phone hash and device id, attempt lockout with destruction of protected content, expiry, replay-safe idempotent consumption, and concurrent duplicate requests collapsing to one challenge — each with its own assertion.

**Finding P20-01 — sign-in failures were announced politely.** `sign-in-panel.tsx` routed every message, success and failure alike, through one `role="status" aria-live="polite"` region, and nothing in state distinguished them. A polite region is queued: a screen reader finishes what it is saying first, and the message can be missed entirely if the user moves on.

That matters more here than the general accessibility guidance suggests, because **this step implements a bounded attempt count**. A user who does not hear "that code was wrong" can spend the attempt that locks the account out. Failures now render in a `role="alert"` region while progress stays polite, routed through `showError` and `showStatus` so every message has a decided tone.

**The regression test is source-inspection, and that is a real limitation.** It asserts both regions still exist and that no message bypasses the two helpers. It cannot prove what a screen reader announces — the customer PWA has no component test runner. That belongs with the client test infrastructure recorded in run 5, and this is a further instance of the same gap: **249 capabilities claim PWA evidence backed by five spec files that read source rather than render.**

**Two probes of mine were invalid before they were valid.** The first log canary sent `purpose` where the endpoint wants `request_key`, and returned 400 — a "no leak" result from a request that generated no OTP proves nothing. The second still failed because `device_id` must be a UUIDv7, not a readable string. Only the third run generated a code and made the absence of that code in the logs meaningful.

**Verification.** `pnpm db:verify` exit 0 — 67 migrations, 27 modules; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 428 pass / 0 fail.

**Step 4.1: VERIFIED_LOCAL.**

**Carried forward.** The approved MSG91 adapter remains unimplemented, so the fake adapter is still the only one and any non-local environment must declare itself synthetic to start. That is the D-15 gate recorded in run 2, unchanged.

## Run 21 (7 September 2026) — step 4.2, sessions and devices

**No defect found in the implementation.** All five requirements were already covered, several by assertions I initially failed to find. The outcome is one meaningful strengthening and a correction to my own first reading.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Issue secure sessions after successful verification | Met. A consumed OTP replay is proven not to issue a second session. |
| 2 | Rotate, refresh, revoke, expire | Met. Refresh rotates **both** credentials; the old access token stops authenticating immediately. |
| 3 | Safe device metadata and notification-token lifecycle | Met, activation and removal both asserted. |
| 4 | Sign-out for current and approved other sessions | Met. `revoke` is exercised twice with a count assertion on the result. |
| 5 | Stolen, expired, replayed and cross-account cases | Met. All four, including `SessionForbiddenError` when one account's token is presented with another user's expected id. |

**A finding of mine that was wrong.** I first recorded that refresh-replay detection was "implemented and asserted nowhere", having grepped for the `REFRESH_REPLAY` revoke-reason constant, which appears only in the implementation. The behaviour **is** tested — the verifier replays a rotated token, expects the dedicated `SessionReplayDetectedError`, and then proves the rotated access token no longer authenticates. My grep looked for the wrong token: the test asserts the effect and the error class, not the string. The claim was withdrawn before it reached the record as a defect, and the duplicate assertion I had already written was removed rather than left beside the original.

**What the existing coverage genuinely left open, and now does not.** Replaying a rotated refresh token revokes the session, and the test proved that by watching the rotated *access* token die. Access tokens are short-lived, so that assertion also passes when only the access token is invalidated. It now additionally asserts that the revocation is **recorded** (`state = 'REVOKED'`, `revoke_reason = 'REFRESH_REPLAY'`, so an operator reading the session later can see why) and that **no refresh token in the family survives**, plus that the newer rotated refresh token is itself refused.

That distinction is the whole point of revoking on replay. A replayed token means either the thief or the rightful holder is presenting a credential the server already retired, and the server cannot tell which — so both must be forced to sign in again. If the newer refresh token survived, the thief holding it would keep the session while the victim was locked out.

**Mutation-tested.** Disabling only the family token revocation — leaving the replay rejection and the access-token invalidation intact, so every pre-existing assertion still passed — turned the ladder red with *"A refresh token survived the replay revocation"*. Restored, and green. `session_scenarios` rises from 9 to 10.

**Verification.** `pnpm db:verify` exit 0 — 67 migrations, 27 modules, 10 session scenarios; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 428 pass / 0 fail.

**Step 4.2: VERIFIED_LOCAL.**

**Carried forward.** D-15 also requires PWA credentials in HttpOnly cookies with CSRF protection through the BFF, and Android credentials in SecureStore. The Android half was corrected in run 5. The cookie and CSRF half belongs to the customer BFF and is **not** covered by this step's database-level verifier; `apps/customer-pwa/app/session-bff.spec.ts` exists and reads source rather than driving the route. Recorded against step 4.4 and the client-testing gap from run 5.

## Run 22 (7 September 2026) — step 4.3, roles, capabilities and memberships

**No defect found, and nothing changed.** All five requirements are modelled and enforced, and every enforcement I went looking for turned out to be tested already. This is the first step audited that needed no correction at all.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Roles and fine-grained capabilities | Met. `roles`, `capabilities`, `role_capabilities`, with the catalogue's shape asserted. |
| 2 | Vendor-location staff membership | Met. `staff_memberships`, with the wrong membership subtype refused. |
| 3 | Partner eligibility and active-assignment capability | Met. `partner_assignment_memberships`. |
| 4 | Admin scopes and separation of duties | Met and enforced in the database. |
| 5 | Deny access by default | Met, asserted 15 times. |

**Requirement 5 is asserted more strictly than the wording requires.** `expectDenied` demands both `allowed === false` **and** `reason === 'DENY_BY_DEFAULT'`, so a denial that happened for some incidental reason fails the test. Its counterpart `expectAllowed` requires the returned actor kind and role key to match, so an allow must carry the right scoped evidence rather than a bare boolean.

**Requirement 4 is enforced by a trigger, and the trigger is careful.** `enforce_role_assignment_separation` matches a conflicting pair regardless of which role is assigned first (`LEAST`/`GREATEST`) and only when the two validity windows actually overlap — so the same person may hold conflicting roles at different times, which is correct, while holding them simultaneously is refused with `23514`. Confirmed live against the local database: granting `FINANCE_OPERATOR` succeeded and the conflicting `FINANCE_APPROVER` was refused with *"separation-of-duty conflict"*. The probe row was removed and the table verified back to zero.

Five maker-checker pairs are defined: finance, trust, configuration, vendor onboarding and vendor publication.

**Two findings of mine that were wrong, and why.** I recorded separation of duties as "enforced but never tested" after searching for the word *separation* and the SQLSTATE `23514` in the verifier. Both searches missed it: the test grants `FINANCE_APPROVER` to a user already holding `FINANCE_OPERATOR` and wraps it in a generic `expectConflict` helper, with no domain wording and no code literal. I had made the same mistake in run 21, grepping for the `REFRESH_REPLAY` constant when the test asserted the error class.

**The method was at fault, not the codebase.** Grepping for domain vocabulary finds tests that happen to name the thing; it silently misses tests written through shared helpers, which is how well-factored suites are written. The correction is to read a verifier's helper functions *before* searching it — `expectConflict`, `expectDenied` and `expectAllowed` here, `rejectsWith` in the session verifier — because those helpers are where the assertion lives. Both false findings were withdrawn before they reached this record as defects, but only because the next step of checking happened to catch them.

**Requirement audit on D-15's related clause.** `password_credentials` stores `algorithm`, `parameters`, `hash`, `salt` and `version` — there is no plaintext column, so "admins cannot retrieve permanent plaintext passwords" holds because there is nothing to retrieve. `admin_provisioning_commands.result_body` is the one path that could carry a generated credential; it is empty on this machine, so its contents were not inspected and that remains unverified rather than cleared.

**Verification.** `pnpm db:verify` exit 0 — 67 migrations, 27 modules, 14 access scenarios; `pnpm typecheck`, `pnpm lint` exit 0; `pnpm test:unit` 428 pass / 0 fail. No files changed in this step.

**Step 4.3: VERIFIED_LOCAL.**

## Run 23 (7 September 2026) — step 4.4, authorization enforcement

| # | Requirement | Verdict |
|---|---|---|
| 1 | Customer resource ownership | Met. |
| 2 | Vendor and location membership | Met. |
| 3 | Current assignment for partner detail | Met. |
| 4 | Admin capability and scope | Met. |
| 5 | Safe 403/404 without leaking record existence | Met, and proven end to end. |

**Requirement 5 verified through the running API, not only in the guard's unit tests.** A customer was signed in who owns nothing — fresh phone, fresh OTP, real session — and then asked for two addresses through `GET /customer/addresses/:id/eligible-vendor-locations`: one that **exists and belongs to somebody else**, and one that does not exist at all.

Both returned **404**, with response bodies identical byte for byte apart from the request id. An attacker cannot distinguish "this record exists but is not yours" from "there is no such record", which is exactly what the requirement asks and the strongest form of evidence available for it.

The unit-level coverage is unusually good on its own: concealment is asserted to happen **before** capability evaluation, so denial does not vary by whether the actor would otherwise have had the capability, and there is a separate case for valid object-reference guesses.

**The BFF surface carried forward from run 21 is sound.** Session cookies are `httpOnly`, `path=/`, `sameSite=lax`, with `secure` derived from `request.nextUrl.protocol === 'https:'` — correct, since `Secure` cannot be set on local http. CSRF uses double-submit: a non-`httpOnly` token cookie the page can read, required to match an `x-csrf-token` header, with an origin check as a second line. **One deployment-time item, not a defect:** behind a TLS-terminating proxy `nextUrl.protocol` can report `http:` even when the client connection is HTTPS, which would drop the `Secure` flag. There is no deployment to test that against, so it is recorded for when step 2.6 unblocks rather than asserted either way.

**Finding P23-01 — a dead authorization exemption reserved a route name.** `KNOWN_UNPROTECTED` in `cross-role-denial.spec.ts` listed `CatalogueProductsController.map`, commented as a *"public product map endpoint — no auth required"*. There is no such endpoint: `map` is a private error translator called from the controller's catch blocks. Enumerating the controller confirms it — eight methods carry route metadata and `map` is not among them, so the entry could never match.

Harmless today, and the reason it matters is what it reserves. Exemptions are keyed `Controller.method`, so the entry made the name `map` on that controller permanently exempt from the unprotected-route check. A future `@Get('map')` on `CatalogueProductsController` would have been silently unprotected, and the test that exists to catch exactly that would have stayed green. The comment would also have told a reviewer the endpoint was deliberate.

The entry is removed, and a new test requires every exemption in both allowlists to name a route that actually exists. Mutation-tested: reinstating the dead entry fails with *"exemptions must name a real route, or they exempt a future one"*.

**Verification.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 429 pass / 0 fail. The end-to-end concealment probe ran against the API on the local database and left no residue beyond one synthetic sign-in.

**Step 4.4: VERIFIED_LOCAL.**

## Run 24 (7 September 2026) — step 4.5, profile, consent, language and notification preferences

| # | Requirement | Verdict |
|---|---|---|
| 1 | Optional customer profile fields | Met. Normalized, versioned, clearable, replay-safe. |
| 2 | Versioned consent records | Met. Withdrawal appends a new version rather than editing the old one. |
| 3 | English/Hindi preference | Met. Defaults to `EN`, set to `HI`, and a replayed request preserves it. |
| 4 | Channel preferences within required-notification policy | Met, and stronger than the wording. |
| 5 | Retention classification on sensitive identity rows | **Defect P24-01** — the assertion could not fail. |

**Requirement 4 is enforced in the right direction.** A required notification channel cannot be disabled — the database refuses it. A marketing preference cannot be enabled while consent is withdrawn, and granting consent activates the channel. Preference is therefore gated on consent rather than merely recorded beside it, which is what makes "preference-aware" mean anything.

**Finding P24-01 — a vacuous assertion.** The retention check counted rows where `retention_class IS NULL OR retention_review_at IS NULL` across six hard-coded tables. **Every one of those columns is declared `NOT NULL`** — all 30 column instances across the 15 tables that carry them — so the count could only ever be zero. The assertion could not fail, and passed for four phases while proving nothing.

It was also narrower than the schema: six tables named, fifteen classified, so a table classified later was covered only if somebody remembered to extend the list.

**My first fix was equally vacuous, and I nearly reported it as a fix.** I replaced the hard-coded UNION with `unclassified_retention_rows()`, a catalogue-driven sweep (migration 0067), and confirmed it returned zero rows. Only when the mutation probe tried to null a classification and hit `violates not-null constraint` did the real picture appear: widening the scope of an impossible condition leaves it impossible. Scope was never the problem.

**What the requirement actually needs asserting.** Not that no row is unclassified — the schema guarantees that — but that a sensitive table cannot be added *without* the classification. The check now asserts the declaration: both columns present, both `NOT NULL`, on every table that classifies anything, and the table count not shrinking below fifteen.

Mutation-tested by making `users.retention_class` nullable in migration 0009: the ladder failed with *"A retention classification column is nullable and can be left unset"*. The previous assertion would have passed that unchanged, because a nullable column with a default still yields no null rows.

**Migration 0067 is kept deliberately.** The sweep is redundant against `NOT NULL` columns, but it covers the one case the declaration check does not: a table that carries the columns as *nullable*, where rows could genuinely be left unset. The two are complementary — one guards the schema, the other the data.

**Requirement 5's consumer is still missing**, in the same shape as `reconciliation_due_at` in step 3.3: `retention_class` is written and now properly asserted, and nothing reads it to expire anything. SEC-11's retention and deletion engine belongs to a later phase and remains outstanding.

**Four requirements I initially misread as untested.** Language (3) and retention (5) both looked absent because their assertions carry no domain vocabulary in the error text — the language case asserts `profile.language !== 'HI'` inside a message about profile normalization. That is the same failure mode as runs 21 and 22, now four for four: **searching a verifier for domain words finds what it names, not what it tests.** Reading the assertions in order is the only reliable method; searching is a shortcut that has produced a false negative every time it has been used alone in this audit.

**Verification.** `pnpm db:verify` exit 0 — 68 migrations, 27 modules, 12 preference scenarios; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 429 pass / 0 fail.

**Step 4.5: VERIFIED_LOCAL.**

## Run 25 (7 September 2026) — step 4.6, prove isolation

Step 4.6 names eight isolation cases. All eight are genuinely proven, and `docs/engineering/identity-isolation-proof.md` maps each to its proof layer accurately — including its specific claim of "16 valid opaque guesses", which the guard spec does exercise (`Array.from({ length: 16 }, () => createUuidV7())`).

| Required case | Where it is proven |
|---|---|
| Cross-customer reads | Guard spec, plus the end-to-end probe in run 23 — another user's real address and a nonexistent one returned byte-identical 404s |
| Cross-vendor writes | `'Cross-vendor catalogue write'` |
| Wrong-location staff | `'Wrong vendor location'`, `'Picker capability escalation'` |
| Inactive partner assignment | Four variants: `'Pending partner'`, `'Eligible partner without active assignment'`, `'Wrong partner assignment'`, `'Ended partner assignment'` |
| Wrong admin role | `'Wrong admin role for approval'`, `'Wrong admin scope'`, `'Onboarding operator attempting review'` |
| Self-approval | Admin self-grant refused, and the maker-checker trigger confirmed live in run 22 |
| Object-reference guessing | 16 valid opaque guesses plus malformed input, one concealed result |
| Redacted logs | Canary probes in runs 14 and 20 — no OTP, phone, or key material in captured output |

Fifteen labelled denials in total, each through `expectDenied`, which requires the reason be `DENY_BY_DEFAULT` rather than merely that access failed. Two go beyond the requirement: `'Expired role'` and `'Revoked role'`.

**Finding P25-01 — denials were tested but not observable.** The exit gate asks that cross-role isolation be *"observable and tested"*. The tested half is thorough. The observable half was not.

`http.request.completed` logs method and route, but the interceptor emits it from `.pipe(map(...))` — the **success** path only. Every authorization denial is a thrown exception, so it bypasses the interceptor entirely and reaches the exception filter, which logged `{ status, error_code }` and nothing else.

The consequence is specific to the concealment design proven in run 23. A concealed 404 for someone walking another customer's address ids produced a log line **identical to a dead link**, on every route in the API. An operator asking "is anyone enumerating customer records?" had counts per actor and no way to tell what was being probed. Concealment is right for the response; the log is the only place the attempt is meant to be visible, and it was silent.

The filter now records `method` and `route` on the failure path. `route` is `routeOptions.url`, the registered pattern, so it carries the parameter *name* and never the value — the same value the success path already logs.

**Verified end to end.** An unauthenticated request to a customer address route logged `route=/customer/addresses/:customer_address_id/eligible-vendor-locations`; a request to an unregistered path logged `route=unmatched`; the two are distinguishable, and **the probed identifier appears nowhere in the output**. Two regression tests cover both, including an assertion that the logged route contains no identifier.

**Verification.** `pnpm db:verify` exit 0 — 68 migrations, 27 modules; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 431 pass / 0 fail.

**Step 4.6: VERIFIED_LOCAL.**

### Phase 4 exit gate

*"Every later module can express its authorization as reusable policy plus domain ownership checks. Cross-role isolation and OTP abuse controls are observable and tested."*

The first clause holds: authorization is declared per route as a capability plus the ownership, vendor-location, active-assignment or admin-scope evidence the guard passes to a default-deny evaluator, and `cross-role-denial.spec.ts` fails if a new route appears without one. The second holds as of this run — OTP abuse metrics were already asserted in step 4.1, and isolation denials became observable here. **Steps 4.1 through 4.6 are VERIFIED_LOCAL and the Phase 4 exit gate is met**, on the standing qualification that local means this machine: Phase 2's CI and staging gates remain open.

## Run 26 (7 September 2026) — step 5.1, vendor and location domain

All five requirements are covered by fourteen assertions: versioned draft creation, versioned lifecycle transitions, profile/money/timezone/preparation settings preserved, operating-hour replacement, overlapping hours refused, service-zone suspend and resume, honest open status with approved fulfilment modes, holiday and temporary closures overriding hours, out-of-zone customers not serviceable, immutable history, and event/zone evidence.

**Finding P26-01 — every user-visible name field rejected Hindi.** Deferred from run 13 with a note against MKT-11; this is its owning step, and the scope turned out to be wider than one field.

`\p{L}` matches Devanagari **consonants**, but the vowel signs that spell most Hindi words are combining marks (`\p{M}`), which no name pattern allowed. Measured: `शर्मा किराना`, `किराना स्टोर` and `अन्नपूर्णा` were all refused, while `शरम` — three consonants, no matras — passed. Since migration 0062 the database constraint is length-only, so **the database would have accepted every one of them**; the application regex was the sole blocker.

MKT-11 (English and Hindi) is a **Launch** capability and the launch city is Jaipur, so this is not a theoretical limitation: a vendor whose shop sign is in Hindi could not enter its name.

Eight patterns shared the defect, covering essentially every field a person types:

| Field | Module |
|---|---|
| Vendor and location names | `vendor-network.ts`, `vendor-onboarding.ts` |
| Catalogue product titles | `catalogue-products.ts` |
| Inventory display names | `inventory-reservations.ts` |
| Customer address labels | `customer-addresses.ts` |
| Store names in discovery | `customer-discovery.ts` |
| Delivery area names | `assignment-custody.ts` |
| Dispatch text sanitizer | `delivery-dispatch.ts` |

All eight now permit combining marks in the **continuation** class only. The first character stays `[\p{L}\p{N}]`, so a name cannot begin with a stray mark, and `\p{M}` admits no format or bidi controls — those are `\p{Cf}` and remain excluded. Verified in both directions: the widened patterns accept Hindi and Latin names and still refuse `Bad ~ name`, a bidi override, a leading space, a tab, an empty string and a single character.

**Fixing all eight rather than only 5.1's was deliberate.** They are one defect with one fix, and shipping partial Hindi support — a vendor can register a Hindi name but cannot title a product in Hindi — would be worse than none, because it fails at a point the user has already committed effort.

Mutation-tested: removing `\p{M}` from the vendor pattern alone turned the ladder red with *"Business name contains unsupported characters"*. `vendor_network_scenarios` rises from 12 to 13.

**A correction to my own method, again.** My first pass extracted assertion messages with a pattern requiring the message and its `throw`/`check` call on one line, and concluded requirement 5 — minimum order and preparation time — was untested. It is tested; the assertion spans several lines. Re-extracting without that assumption showed all five requirements covered. Same failure as runs 21–24 in a new form: **the shortcut for finding assertions keeps producing false negatives, and only re-checking has caught them.**

**Verification.** `pnpm db:verify` exit 0 — 68 migrations, 27 modules, vendor-network scenarios 12→13; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 431 pass / 0 fail.

**Step 5.1: VERIFIED_LOCAL.**

**Carried forward.** Hindi is now storable. Whether it *renders* correctly — font coverage, line breaking, and the expansion tolerance UX-08 asks for — is a client concern for phase 12.3, unchanged by this.

## Run 27 (7 September 2026) — step 5.2, vendor onboarding workflow

All five requirements are covered by 26 assertions: lead, invitation and direct-application entry; business and payout-profile references; document upload with a short-lived protected read returning the right evidence; the pending, under-review, approved, expiring, grace and reverification states; a successful appeal returning the case to pending; and immutable reviewer evidence. Approval is asserted to create draft vendor and location aggregates **and** grant the applicant `VENDOR_OWNER` membership.

**Finding P27-01 — the invitation was one-use but never expired.** D-15 requires "an expiring one-use invitation". The one-use half is properly enforced: `claimInvitation` refuses unless the case is still `INVITED`, and the expected-version check refuses a replay a second way. Nothing expired.

That gap matters because **the applicant is optional**. `createInvitation` takes `applicant_user_id?`, and inviting a vendor who has not signed up yet is the ordinary case — you cannot know their user id in advance. `claimInvitation` binds the claim to `applicant_user_id` **only when the case already has one**, so for that ordinary case the reference was the sole credential. References are admin-chosen text matching `[A-Z0-9][A-Z0-9._:/-]{5,127}` — `INV-JAIPUR-0001` is valid — so one that leaked or was guessed stayed claimable indefinitely. Claiming it means becoming the applicant for that vendor, and approval grants `VENDOR_OWNER` membership. Admin review of the application is a compensating control, but the reviewer would be assessing an impostor presenting as the invited vendor.

Migration `0068` adds a nullable `invitation_expires_at` with a partial index on unclaimed invitations. `createInvitation` records one, defaulting to fourteen days through a named `INVITATION_LIFETIME_MS` rather than a literal at the call site — D-15 does not name a period, so this is a default an owner can revise, not a policy decided here. `claimInvitation` refuses an expired invitation with its own message, separate from the identity check, so an expired invitation does not read as though the caller were the wrong person. The column is nullable because cases created before the migration have no expiry and must stay claimable rather than being locked out by a backfilled date.

Two assertions added, and `vendor_onboarding_scenarios` rises from 15 to 17: an expired claim is refused **and leaves the case still `INVITED`** rather than half-advancing it, and an already-claimed reference cannot be claimed again. Mutation-tested by disabling the expiry check, which turned the ladder red.

**Recorded, not fixed: invitation references carry no entropy requirement.** The pattern permits sequential admin-chosen values. Expiry bounds the window; it does not make a reference unguessable. Whether references should be system-generated with entropy is a product decision about how admins issue them, not a correction to make unilaterally.

**A fifth false negative from searching.** `grep -c "INVITATION"` on the verifier returned **0**, and I nearly recorded invitation entry as untested. It is tested — through `createInvitation` and `claimInvitation`, camelCase method names containing no such literal. The pattern is now consistent enough to state as a rule: **in this repository, searching a verifier for a domain term finds what it names, never what it exercises.** Only reading it works.

**Verification.** `pnpm db:verify` exit 0 — 69 migrations, 27 modules, vendor-onboarding scenarios 15→17; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 431 pass / 0 fail.

**Step 5.2: VERIFIED_LOCAL.**

## Run 28 (7 September 2026) — step 5.3, admin vendor pipeline

| # | Requirement | Verdict |
|---|---|---|
| 1 | Role-scoped pipeline list and filters | Met. The onboarding queue asserts cases awaiting review are present, that it counts the documents waiting on each, and that undecided cases sort ahead of decided ones. |
| 2 | Owner, checklist, SLA and document-review views | Met. An incomplete draft cannot be marked ready; a complete one is. |
| 3 | Test-order gate | **Not implemented.** |
| 4 | Impact-aware publish, pause, unpublish and restore | Met, including that unpublish contains the storefront. |
| 5 | Audit every decision | Met. Self-approval is refused and publication evidence is immutable. |

**Finding P28-01 — the test-order gate does not exist, and the feature matrix said it did.** There is no test-order concept anywhere: no schema column matching `test` or `is_test`, no service, no route. The publication checklist has exactly six checks — `ONBOARDING_APPROVED`, `PROFILE_COMPLETE`, `OPERATING_HOURS_CONFIGURED`, `SERVICE_ZONE_ACTIVE`, `FULFILMENT_APPROVED`, `DOCUMENTS_CURRENT` — and a test order is not among them.

`VEN-12` (*Onboarding test order*, catalogue status **Launch**) recorded `status: backend_only` with the note *"Publication requires test. No client flow."* Both halves were wrong: publication requires no such thing, and there is no backend either. It also claimed `domain: true`, `api: true`, `tests: true` and three verifiers.

Corrected to `not_started`, all evidence false, no verifiers, and a note stating what the checklist actually contains.

**This one is on my own run-4 work.** Those three verifiers were not written by anyone claiming to test a test order — my `verified_by` generator assigned each capability the verifiers of its `phase_steps`, so VEN-12 inherited step 5.3's. For a capability that is implemented, step-level attribution is roughly right. For one that is **not implemented, it manufactures evidence**: three real, passing verifiers appeared beside a capability nothing tests. The general limitation is recorded here — `verified_by` proves a verifier exists for the step, not that it exercises the capability — and it is a reason to treat a `not_started` or `backend_only` row's verifiers with suspicion rather than as coverage.

**What is *not* wrong.** D-15 also says unpublished stores must stay out of public discovery. That holds independently of the missing gate: discovery joins on `p.lifecycle_state = 'PUBLISHED'` alongside active location and active service zone, so an unpublished storefront is not reachable through it. The gap is the absence of a sanctioned internal test-order path, not a leak of unpublished stores into a public one.

**Deliberately not built.** A test-order system means an order flag, its propagation through checkout, fulfilment, ledger and metrics, and exclusions in payouts and reporting — a feature spanning phases 7 through 11, not a correction. Building it here to close a step would be exactly the inflation this audit is meant to detect. It is recorded as an open Launch-scope gap.

**Verification.** `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 431 pass / 0 fail; the feature-matrix control passes with the corrected row.

**Step 5.3: PARTIAL.** Four of five requirements are met and verified. Requirement 3 is unimplemented, and VEN-12 remains a Launch capability with no implementation.

## Run 29 (7 September 2026) — step 5.4, vendor staff and settings

Canonical numbering: 5.4 is staff and settings, 5.6 is CSV import. Earlier conversations used other numbers for these.

Thirty-one assertions cover the step, and four of five requirements needed nothing.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Invite owner, manager and picker roles | Met. The roster holds all three; a phone-addressed invitation resolves to the right account; an unknown number is refused; a manager cannot invite. |
| 2 | Permission summaries and access-denied states | Met. A picker cannot reach settings, a stranger with no membership cannot read an access summary, and a revoked picker leaves the active roster. |
| 3 | Store profile, hours, closure, zone, minimum, prep-time and fulfilment settings | Met, including a negative minimum refused, a finished closure no longer offered as current, and zone activation counts restored on deactivation. |
| 4 | Prevent vendors from overriding platform-owned fee policy | Met structurally; the **check** was too narrow — finding P29-01. |
| 5 | Record activity history | Met, for both staff invitation and settings changes. |

**Requirement 4 holds structurally.** The vendor-facing service exposes eight writes, and none reaches fee policy. `updateOrderingSettings` accepts only `minimum_order_minor` and `preparation_seconds`, both bounded, and its SQL fragment is a literal rather than built from input. Fulfilment modes are readable but have no writer. Fee policy lives in `financial_policy_configuration` and `money-policy.ts`, both platform surfaces.

**Finding P29-01 — the guard was a two-name blocklist.** What enforced this was `!('addFulfilmentMode' in staff) && !('setFulfilmentMode' in staff)`: a check for two exact spellings. A method named `updateFulfilmentModes` would have passed it, and **nothing checked fees at all** — the requirement's actual subject.

The check is now an allowlist of the eight approved writes, derived reflectively from the service prototype, plus an assertion that no write path name matches fee, commission, payout, policy or fulfilment. Any new mutating method on the vendor-facing service fails until it is reviewed and named, whatever it is called.

Mutation-tested with the case the blocklist would have allowed: adding `updateCommissionBasisPoints` to the service turned the ladder red with *"Vendor staff write surface changed"*. `vendor_staff_scenarios` rises from 10 to 11.

**A blocklist and an allowlist are not the same strength**, and this is the third control in the audit found to be the weaker kind — after the CI command list in run 11 and the route exemptions in run 23. A blocklist protects against what someone thought of; an allowlist protects against what they did not.

**Verification.** `pnpm db:verify` exit 0 — 69 migrations, 27 modules, vendor-staff scenarios 10→11; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 431 pass / 0 fail.

**Step 5.4: VERIFIED_LOCAL.**

## Run 30 (7 September 2026) — step 5.5, catalogue product management

Twenty-five assertions cover the step, including cross-vendor isolation in both directions — a rival location can neither change nor read another's catalogue — and an unauthenticated caller refused.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Product, variant, category, image, price, tax, unit and availability models | Met. Creation starts at version one and opens a current price; a duplicate product reference within one location is refused. |
| 2 | Add, edit, view, activate, deactivate | Met. Deactivation advances the version and a stale expected version cannot change lifecycle state. |
| 3 | Packaged and variable-weight definitions | Met. An out-of-range weight variance is refused, and a packaged product may not carry one at all. |
| 4 | Substitution suggestions | Met, including that deactivating one does not create a second row and that a rival location cannot substitute across catalogues. |
| 5 | Preserve product/price history for later order snapshots | **Defect P30-01** — the history was mutable. |

**Requirement 5's model is right.** `catalogue_prices` is temporal: `effective_from`, `effective_until`, `reason_code`, `actor_id`. A price change closes the open row and inserts a new one, so the history is preserved by construction.

**Finding P30-01 — the price history was the one financial history without a guard.** Eight comparable tables carry an append-only trigger: aggregate transitions, outbox events, inbox receipts, scheduled jobs, job attempts, configuration versions, business configuration snapshots and configuration lifecycle events. `catalogue_prices` carried none, so a historical price could be rewritten or deleted outright.

**Scoping the exposure honestly.** No foreign key points at `catalogue_prices`; orders copy their amount, so rewriting history does not alter a past order's own record. What it alters is the **corroboration**. The step's wording is that this history exists "for later order snapshots" — when a charge is disputed, the order says one thing and this table is the independent record of what the price was that day. A mutable history can be edited to agree with whatever is claimed. That is a weaker exposure than rewriting orders, and a real one.

Migration `0069` adds a controlled guard rather than a flat append-only rule, because closing the open row *is* how a new price opens. Exactly one update is permitted — setting `effective_until` on a row where it was null, with every other column unchanged — and everything else, deletion included, is refused with `55000`. Confirmed live: a legitimate close succeeded, while rewriting the amount, deleting the row, and reopening a closed one were each refused.

**My assertion passed for the wrong reason first, for the second time in this audit.** The initial test set `price_minor` alone. That leaves `effective_until` null, so the guard refuses it on the status clause and never evaluates the amount clause — and removing `NEW.price_minor = OLD.price_minor` from the guard left the ladder **green**. The test now closes the row and changes the amount in one statement, which is the only path that reaches the clause, and the same probe turns the ladder red with *"A historical price amount could be rewritten while closing the row"*. The in-place case is kept as a second assertion.

This is the identical mistake as the inbox guard in run 17, and the lesson generalises: **testing a guard whose permit branch has several conditions requires satisfying every other condition, or the refusal comes from the wrong clause.** `catalogue_product_scenarios` rises from 11 to 12.

**Probe residue restored.** The live checks left one price row closed that the new guard correctly refused to reopen. The trigger was disabled, the row restored, and the trigger re-enabled; the table is back to eighteen open rows with the guard active.

**Verification.** `pnpm db:verify` exit 0 — 70 migrations, 27 modules, catalogue-product scenarios 11→12; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 431 pass / 0 fail.

**Step 5.5: VERIFIED_LOCAL.**

## Run 31 (7 September 2026) — step 5.6, CSV import

Canonical numbering: 5.6 is CSV import, 5.4 is staff and settings.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Explicit template and version | Met. The header must equal `CATALOGUE_CSV_V1` exactly — the version is the template. |
| 2 | Upload and scan the file | Uploaded and bounded; **not scanned** — see below. |
| 3 | Parse into staged rows without changing the live catalogue | Met, asserted directly. |
| 4 | Row-level validation and correction | Met. Staging reports per-row validation and an import with invalid rows cannot commit. |
| 5 | Commit valid rows idempotently and produce a report | Met. Replaying an idempotency key creates no second import; replaying a commit neither changes the result nor duplicates the product. |

**Finding P31-01 — the row cap was untested.** `parse` refuses more than 10,001 rows, and nothing exercised it. That cap is the only bound between an upload and parsing every row into memory before a single insert: the API's `bodyLimit` of 7 MB constrains *bytes*, and a narrow file reaches far more than 10,001 rows inside that budget. Now asserted, and mutation-tested by raising the cap to 100,001, which turned the ladder red. `catalogue_product_scenarios` rises from 12 to 13.

**Requirement 2 — uploaded, bounded, not scanned. Recorded rather than papered over.** A CSV arrives as an inline `csv_content` string. Unlike onboarding documents and catalogue images, it never passes through `ProtectedObjectStorage.put()` and its `scan_scenario`, so nothing scans it.

Weighing what that actually exposes rather than reciting the requirement:

- The file is parsed and discarded; only parsed rows and a SHA-256 of the content persist. It is never stored as a file and never served back, so the usual malware-delivery path is absent.
- The applicable threat is **CSV formula injection**: `raw_row` keeps the original untrusted row, and requirement 4 shows those rows back for correction. A cell beginning `=`, `+`, `-` or `@` executes when opened in a spreadsheet.
- **There is no CSV export path today** — `raw_row` is read back only to commit — so that threat has no delivery vector yet. It acquires one when ADM-58 (exportable reports, phase 11.8) is built.

**Not neutralised at ingest, deliberately.** Prefixing or escaping formula-like cells would alter a vendor's own data on the way in, and a product legitimately named `+1 Fresh` would be stored wrong forever. Formula neutralisation belongs at export, where the spreadsheet risk actually arises. Recorded against phase 11.8 rather than fixed here.

**Step 5.6: PARTIAL.** Four requirements met and verified; requirement 2's scan does not exist. The risk it exists to control is largely absent from the current design, but the requirement says scan and there is no scan — recording that as met would be exactly the inflation this audit is for.

**Verification.** `pnpm db:verify` exit 0 — 70 migrations, 27 modules, catalogue-product scenarios 12→13; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 431 pass / 0 fail.

## Run 32 (7 September 2026) — step 5.7, availability freshness and moderation

| # | Requirement | Verdict |
|---|---|---|
| 1 | Stock status and last-confirmed time | Met. Fresh inventory is labelled fresh and an old vendor confirmation is labelled expired. |
| 2 | Expose freshness to customer queries | Met, and customer availability is asserted **not** to expose exact stock. |
| 3 | Cross-vendor moderation queue | Met, admin-only. |
| 4 | Actionable correction reasons | Met. A correction-required item stops being customer-visible and an unrelated item is untouched. |
| 5 | Test one vendor cannot read or edit another vendor's catalogue | **Defect P32-01** on the moderation surface. |

**Requirement 2 examined rather than assumed.** Freshness has three tiers — `FRESH` within fifteen minutes, `STALE` within an hour, `EXPIRED` beyond — and appears in discovery and the admin control plane but **not** in the cart, checkout or reservation paths. So freshness informs the customer and does not gate purchase.

That is correct, not a gap. The requirement says *expose*, and the design holds together without gating: reservations prevent overselling, and the vendor confirms stock at acceptance (VEN-21). Refusing to sell anything a vendor had not touched in an hour would empty the marketplace, and the label is what makes the availability honest.

**Finding P32-01 — the moderation surface had no isolation test at all.** `openCase`, `decideCase` and `listQueue` each call `assertAdmin`, and this verifier contained **no rejection assertion of any kind** — no `rejects`, no error-class check, nothing exercising any of the three guards.

`listQueue` is the one that matters: the queue is deliberately cross-vendor, so it returns every vendor's cases, and its only protection is that one call. Remove it and any authenticated actor — including a vendor — reads every other vendor's moderation cases, which are catalogue data about their products and the reasons those products were restricted. That is precisely what requirement 5 says must be tested.

Three assertions added: a vendor cannot read the queue, cannot open a case, and cannot decide their own. `catalogue_freshness_moderation_scenarios` rises from 6 to 7. Mutation-tested by removing `assertAdmin` from `listQueue` alone, which turned the ladder red with *"A vendor read the cross-vendor moderation queue"*.

**Verification.** `pnpm db:verify` exit 0 — 70 migrations, 27 modules, freshness/moderation scenarios 6→7; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 431 pass / 0 fail.

**Step 5.7: VERIFIED_LOCAL.**

### Phase 5 exit gate

*"One approved vendor is published and discoverable using synthetic/staging data. A second vendor cannot access it. Catalogue import, stale availability, moderation, and document expiry paths pass."*

- **Published and discoverable**: met. `verify-vendor-publication.ts` publishes a storefront and discovery joins on `PUBLISHED`, active location and active zone.
- **A second vendor cannot access it**: met, now on every surface — catalogue read and write (5.5), staff and settings (5.4), substitutions across catalogues (5.5), and moderation (this run).
- **Import, stale availability, moderation and document expiry**: met. Import stages, validates and commits idempotently; freshness labels stale and expired; moderation opens, decides and hides; expiring, grace and reverification document states are each asserted in 5.2.

**Phase 5 status: PARTIAL, on step 5.3 and step 5.6.** Five of seven steps are VERIFIED_LOCAL. The exit gate's own criteria are met, but 5.3's test-order gate does not exist — `VEN-12` is a Launch capability corrected to `not_started` — and 5.6's file scan does not exist. Neither is a gap the exit gate names, which is why the gate reads as passed while the phase does not.

## Run 33 (7 September 2026) — step 6.1, customer address management

Thirty-four assertions, the most thorough step audited: coordinate round-trip through the geography column, landmark and instructions, auto-selection of the first address, version advance on edit, stale-version refusal, archiving that releases the selection without deleting the row, serviceability against active and deactivated zones, cross-customer refusal on edit, archive and serviceability, and an unauthenticated caller refused.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Manual search, device location, coordinates, pin adjustment, landmark, instructions | Met. |
| 2 | Create, edit, select, remove saved addresses | Met. |
| 3 | Configurable default limit of four | Met; the **configurable** half was untested — finding P33-01. |
| 4 | Validate serviceability against active zones | Met. |
| 5 | Stage-gate address visibility for later fulfilment actors | Met, and proven under mutation. |

**Requirement 5 is the strongest privacy control in the system, and it holds.** `#disclose` sets `precise = stage === 'CARRYING'` and nulls landmark, delivery instructions, latitude and longitude for every other stage, while pin code and label — area-level, needed for routing — always return. Three assertions cover it: an unassigned stage exposes no precise address, an assigned-but-not-carrying stage exposes no coordinates, and a carrying partner can read what it must deliver to.

Mutation-tested, because this is the control D-15 states as "platform partners receive exact customer address only after verified custody": widening the gate to `stage !== 'UNASSIGNED'` — leaking coordinates to an assigned partner before custody — turned the ladder red with *"An assigned-but-not-carrying stage exposed coordinates"*.

**Finding P33-01 — the limit was tested, its configurability was not.** `savedAddressLimit` resolves `customer.saved_address_limit` from versioned configuration and returns `DEFAULT_SAVED_ADDRESS_LIMIT` of 4 whenever the lookup yields nothing usable. The verifier asserted the default is four and that a fifth address is refused — both of which pass on the fallback alone.

So a broken lookup was invisible. Renaming the configuration key to a typo left every existing assertion green: the limit still resolved to four, the fifth address was still refused, and the operator control was simply dead. Requirement 3 says *configurable*, and nothing exercised that word.

The verifier now drives a real configuration through its lifecycle — draft, validate, approve, schedule, activate, with distinct proposer and approver because the maker-checker separation from step 3.7 refuses self-approval — and asserts the limit becomes 6. `customer_address_scenarios` rises from 12 to 13. The same key-typo probe now fails with *"An activated saved-address limit did not replace the default"*.

**A fallback that hides its own failure is a recurring shape.** This is the same class as the vacuous retention assertion in run 24: a check that cannot distinguish "the mechanism worked and produced the expected value" from "the mechanism failed and the default produced it". Wherever a default exists, the test has to move the value away from it.

**Verification.** `pnpm db:verify` exit 0 — 70 migrations, 27 modules, customer-address scenarios 12→13; `pnpm typecheck`, `pnpm lint`, `pnpm format:check` exit 0; `pnpm test:unit` 431 pass / 0 fail.

**Step 6.1: VERIFIED_LOCAL.**

## Run 34 (7 September 2026) — step 6.2, eligible store discovery

Twenty-nine existing assertions cover requirements 1, 2, 4 and 5 well, including two privacy checks that most suites would omit: *"Anonymous browsing wrote a per-user discovery event"* (public browsing must not be attributed to a user) and *"A zero-result search left no funnel evidence"* (an empty result is still a funnel outcome and must be recorded). Discovery is also cross-checked against the address-scoped feed to confirm both resolve the same store.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Active, published, open/next-open, zone-eligible locations | Met. |
| 2 | Category, distance, minimum, methods, rating, fee, promise metadata | Met. |
| 3 | Pagination and deterministic ordering | **Both defective** — findings P34-01 and P34-02. |
| 4 | Loading, empty, denied-location, unavailable-zone, error, stale states | Met. |
| 5 | Privacy-safe discovery funnel events | Met. |

**Finding P34-01 — product search had no unique tiebreaker, so results at the page boundary were non-deterministic.** Three ordered queries live in `customer-discovery.ts`. Store discovery ends `distance_meters ASC, l.vendor_location_id ASC` and storefront listing ends `p.title ASC, p.catalogue_product_id ASC` — both deterministic. Search ended at `p.title ASC`, which is not unique.

Two products tying on availability, rank, similarity and title therefore had undefined relative order, and because the query carries a `LIMIT`, which of them appears on the last page could differ between identical requests. `recentSearches` had the same shape, ordering only by `last_searched_at DESC`. Both now carry their table's primary key as a final tiebreaker, matching the pattern the same file already used correctly twice.

**This fix is recorded as inspection-verified, not mutation-proven.** Removing a tiebreaker does not reliably turn a suite red: PostgreSQL's unspecified order is *unspecified*, not *different*, and a small fixture will usually return the same row order either way. Claiming a passing mutation test here would misrepresent the evidence. What is proven is that the corrected clauses are syntactically valid and the full ladder passes with them.

**Finding P34-02 — pagination was accepted and never exercised.** `discoverStores` takes optional `limit` and `offset`. Because both are optional, deleting them from the SQL entirely would have changed nothing any assertion could observe; a caller asking for page two would silently receive page one.

The verifier now requests `limit: 1, offset: 0` and `limit: 1, offset: 1` and asserts the first returns one store and the second returns none. `customer_discovery_scenarios` rises from 9 to 10.

Mutation-tested: neutralising the clause to `LIMIT GREATEST($4,50) OFFSET LEAST($5,0)` — which preserves parameter arity so the query still executes — turned the ladder red with *"An offset past the last result still returned a store, so offset is ignored"*.

**Scope limit, stated rather than glossed.** This proves the parameters reach the query. It does not prove page boundaries are stable across a multi-page result, because the fixture publishes exactly one in-zone store — the existing assertion reads *"exactly the in-zone published store"* — so there is no second page to compare against. A genuine multi-page test needs a second discoverable fixture store and is left open.

Two of the three added assertions initially failed for reasons that were my errors, not the code's: the extra discovery calls pushed the funnel count past the exactly-one assertion (the block was moved after that check, and now asserts the count reaches three, proving paginated calls are also instrumented), and two table and column names were guessed wrong — `discovery_funnel_events` for `customer_discovery_events`, and `search_term` for `customer_recent_search_id`. The ladder caught all three.

**Verification.** `pnpm db:verify` exit 0 — 70 migrations, 27 modules, customer-discovery scenarios 9→10; `pnpm typecheck` exit 0.

**Step 6.2: VERIFIED_LOCAL**, with the multi-page ordering test recorded as an open gap.

## Run 35 (7 September 2026) — step 6.3, search and filters

The step names five requirements. Two were implemented and untested, two were partly unimplemented, and one held. Fourteen assertions were added and every one was mutation-proven.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Normalize product, store, brand, category, Hindi, transliteration, synonym, misspelling | **Store and misspelling terms did not work at all** — P35-01, P35-02. |
| 2 | Rank available ahead of unavailable | Implemented; tested vacuously — P35-03. |
| 3 | Approved filters | All four implemented, none exercised — P35-04. |
| 4 | Store and delete recent searches safely | Met, including dedup, delete, and no history for anonymous callers. |
| 5 | Measure zero-result and search-to-cart outcomes | **Half missing** — P35-05. |

**P35-01 — misspellings were findable only if somebody had enumerated them.** Requirement 1 asks for common misspellings. `similarity()` appeared in the ORDER BY, where it reranks matches but cannot produce one, so a misspelling reached a product only when the synonym table happened to list it: `pyaaz` worked because it is enumerated, `tomatoe` returned nothing. The WHERE clause now carries `lower(p.title) %> $3` — trigram *word* similarity, which compares the term against the closest word in the title rather than the whole string, so a long product title cannot dilute the score below the threshold. It uses the `catalogue_products_title_trigram` GIN index that migration 0032 already created.

**P35-02 — store names were not searchable from any surface.** Requirement 1 lists "store" among the term kinds. `location_name` appeared in no WHERE clause anywhere in the file: `search_document` covers title, brand, category, description and product reference, and `discoverStores` takes no term at all. Typing a shop's name returned nothing. The search now matches `location_name` against the expanded term array, so a store name gets the same synonym and transliteration handling a product title gets.

**P35-03 — the ranking test could not fail.** The fixture published exactly one product, so `ORDER BY is_available DESC` could have been deleted with the suite still green. A second product in the same category, out of stock, makes the order observable.

The first attempt at this was itself vacuous, and worth recording: the out-of-stock product was named *"SYNTH Sold Out Onion"*, which sorts after *"SYNTH Discovery Tomato"* on the `p.title` tiebreaker anyway — so removing `is_available DESC` still produced the expected order and the probe passed. Renaming it to *"SYNTH Basket Onion"*, which sorts **before** the available product, is what makes availability the only thing that can rank it last. A fixture has to be adversarial to the ordering under test, not merely plural.

**P35-04 — four filters accepted, none exercised.** `category`, `available_only`, `fulfilment_mode` and `max_distance_meters` were all wired into the SQL and none had an assertion; each could have been dropped from the WHERE clause unnoticed, so a customer filtering to in-stock items would have been shown sold-out ones.

`max_distance_meters` turned out to be untestable rather than merely untested: the fixture places the store on the customer's own coordinates, so its distance is zero and **no positive threshold could ever exclude it**. My first assertion asked for `max_distance_meters: 1` and failed — correctly, because the code was right and the test was wrong. Fixing it required a third fixture store, in zone but about ten kilometres away.

That store also closes the gap run 34 left open. With two eligible stores, pagination is now a genuine multi-page test: consecutive pages return different stores, in the order the unpaginated feed returned them, and the page after the last is empty.

**P35-05 — half the required funnel was unmeasurable.** Requirement 5 measures zero-result *and* search-to-cart outcomes. `SEARCH_TO_CART` existed only as a member of the event-type union in `customer-discovery.ts` and was written by nothing, anywhere in the repository.

`recordSearchToCart` now records it, and `POST customer/cart/lines` calls it after the line is actually held, so a rejected add is never counted. Attribution is explicit: the client states the add came from search results. Inferring conversion from "this customer searched a few minutes ago" would have invented a measurement definition nobody approved and would have counted adds unrelated to any search. The metric is therefore a lower bound, which is stated rather than hidden.

**Mutation results.** Nine probes, each restored and confirmed byte-identical afterwards:

| Probe | Caught by |
|---|---|
| `ORDER BY is_available DESC` removed | *Search did not rank the available product first* |
| Category filter neutralised | *The category filter did not exclude another category* |
| `%>` misspelling branch removed | *Search did not resolve the tomato for a common misspelling (tomatoe)* |
| Available-only filter neutralised | *The available-only filter still returned an out-of-stock product* |
| Fulfilment-mode filter neutralised | *The fulfilment-mode filter matched a mode the store does not offer* |
| Distance filter neutralised | *The maximum-distance filter did not exclude a distant store* |
| Synonym expansion suppressed | *Search did not resolve the tomato for a transliterated Hindi term (tamatar)* |
| Store-name branch removed | *Searching a store by name returned none of its products* |
| `SEARCH_TO_CART` changed to `SEARCH_RUN` | *A search-to-cart conversion left no funnel evidence* |

Two probes initially failed for the wrong reason and were redone rather than counted. Deleting the `%>` branch left the closing parenthesis inside a SQL comment, so the query failed to parse — a syntax error, not an assertion. Emptying the synonym expansion left `synonyms` unreferenced, so TypeScript refused to build and the probe never reached the database. **A probe that fails before the assertion runs proves nothing**, and both were rewritten to fail at the assertion.

**Verification.** `pnpm db:verify` exit 0 — 70 migrations, 27 modules, customer-discovery scenarios 10→24. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm contracts:check` (246 routes) exit 0; `pnpm test:unit` 431 pass / 0 fail.

**Step 6.3: VERIFIED_LOCAL.** One scope note: the search-to-cart wiring in the cart controller is covered by typecheck and the contract check, not by a behavioural API test — the funnel event itself is proven at the domain layer.

## Session handoff — end of run 2 (6 September 2026)

**Resume at:** Phase 2.1 (repository/ownership map), then 2.2 controls, 2.4 migrations, 2.5 executed CI evidence, 2.6 staging skeleton. Phase 2.3 is PARTIAL with the readiness defect closed; worker bootstrap, graceful shutdown and structured startup logging within 2.3 are still unaudited.

**Files changed in run 2**

- `database/src/runtime-config.ts` — environment classification, `resolveSecretMaterial`, synthetic-provider acknowledgement gate, explicit clearing-account requirement.
- `apps/api/src/runtime-config.ts` — identity material routed through the shared policy; distinct session and one-time-password digests; adapter error names the open D-15 gate.
- `apps/api/src/health.controller.ts` — readiness answers 503 when degraded.
- `tooling/scripts/verify-online-test-deployment.mjs` — private material must fail closed in compose; customer PWA verified against the Workers/OpenNext BFF target instead of a static export.
- `infrastructure/online-test/compose.yaml` — injects every required private value with `${VAR:?...}`.
- `infrastructure/online-test/release.env.example`, `infrastructure/supabase-dev/env.example`, `infrastructure/supabase-production/env.example` — document the newly required variables.
- New tests: `database/src/runtime-config.spec.ts`, `apps/api/src/runtime-config.spec.ts`, `apps/api/src/health.controller.spec.ts`.
- `phases.md` §23 and this audit record.

**Commands to reproduce the run-2 result**

```bash
pnpm typecheck && pnpm test:unit && pnpm lint && pnpm format:check && pnpm test:controls && pnpm security:secrets
```

All six passed at the end of run 2 (unit: 358 tests, 358 pass, 0 fail). `pnpm lint` had been failing before run 2.

**Known blocked checks on this machine**

- `pnpm --filter @neighbourhood-store/api test:integration` and every PostgreSQL/PostGIS or Valkey integration path need `pnpm db:test:up`; the local stack is not running.
- `pnpm test:e2e` (Playwright) not executed in run 2.
- No staging provider, database or deployment was contacted.

**Operator action before the next remote-database run.** Add `ALLOW_SYNTHETIC_PROVIDERS=synthetic-testing-only`, `PAYMENT_WEBHOOK_KEY` and `PROVIDER_CLEARING_ACCOUNT_REFERENCE` to `infrastructure/supabase-dev/.env` and `infrastructure/supabase-production/.env`, and replace any remaining `replace-with-...` placeholder values. Without these the API and worker now refuse to start, by design.

## Documentation changes versus code changes

This pass changes contracts, decision indexing and audit evidence only. It does not implement staging providers, change runtime configuration, migrate databases, provision cloud resources, send SMS, move money, or approve public production. D-15 requirements must still be implemented and verified.
