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
| 4 | Preserve configuration versions on created business records | Met as recorded here; **corrected in run 41**: the record retained the reference, but the resolver could not resolve a superseded version, so the preserved reference was unusable after the first change to the key. |
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

## Run 36 (18 September 2026) — the executed CI evidence, and what one order found

Step 2.5's outstanding item was executed CI evidence. The push happened on 17 September; the evidence was seven failed runs. Every one failed the same way, on unit tests that imported `@neighbourhood-store/domain-types/dist/index.js` before anything had built it — `packages/contracts`, `pwa-auth` and `app-auth` ran their tests without the `ensure-packages-built.mjs` guard every app already had, and a fresh checkout has no `dist/`. Locally the suite passed on leftover builds. Reproduced on a fresh clone, fixed (the three scripts, plus the guard once at the root so sibling packages do not rebuild the same `dist/` concurrently), and re-run: [run 35329095886](https://github.com/anirudhbhatia-1/vendor-base/actions/runs/35329095886) is green on every mandatory step, the first on a tree with domain code. **Step 2.5 is now PARTIAL on one item: branch protection.** `main` has none, which is how seven red runs landed on it.

The same session repaired four defects on the path an order takes out of the shop, recorded as [batch 10](repair-batch-10-evidence.md) B10-02 through B10-06: the cart and quote never checked that a store offered the fulfilment method the group asked for (CUS-33 — carried as `complete_local_synthetic` while batch 08 had recorded the gap open; the matrix claim was wrong); a collected order was charged the distance-based delivery fee; vendor self-delivery (VEN-37, Launch, `backend_only`) had no flow, and the counter accepted a fallback code on such an order; and a collected order never settled, because `createSettlement` ran only on `vendor_order.delivered` — §13.2 scenario 1 read as covered by a verifier that asserted inventory settlement, not money. Ladder now 81 migrations; `customer_cart` 30 → 37, `grouped_checkout` 15 → 23, `vendor_fulfilment` 145 → 171; eleven mutation probes caught, one only after its assertion was moved to a state where the intended clause, not an earlier one, refuses — the trap runs 17 and 30 recorded.

Three documents had drifted from the code and are corrected in the same batch: the vendor-fulfilment doc described a five-module split that commit `f0e646e` had abandoned; the README named migration `0045` of 46 as head; the topology, deployment, register, CI and entry-point docs predated Valkey/BullMQ activation, worker heartbeats and the D-16 Azure environment. `CLAUDE.md` now says what `database/schema.ts` is (a ratcheted mirror, not the schema authority).

## Run 37 (19 September 2026) — step 6.4, favourites, preferred store, and shop request

The step names five requirements. Two held. One was tested vacuously, one was met only for favourites and not for the preferred store, and one — the pipeline — did not exist: a request was written and nobody could read it. Twenty-three assertions were added and every one was mutation-proven, eleven probes.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Add/remove favourite stores | Add held; **removal was never asserted**, and an unknown store was a 500 — P37-01. |
| 2 | Exactly one preferred store | Held (primary key on `user_id`), now asserted by count rather than by reading the value back. |
| 3 | Show eligibility changes without deleting preference | Met for favourites. **The preferred-store read returned a bare id**, so its eligibility could not be shown at all, and the assertion read the same value twice with nothing changed between — P37-02. |
| 4 | Submit a nearby shop request into the admin/vendor pipeline | **The request was stored; the pipeline did not exist.** `TRIAGED` and `CLOSED` were unreachable states — P37-03. |
| 5 | Prevent duplicate request spam | Held (partial unique index on open requests per customer and pin). |

**P37-01 — removal never asserted; an unknown store was a server fault.** `removeFavourite` had no assertion anywhere; its `DELETE` could have been dropped with the suite green (probe 1 confirms). Favouriting or preferring a `vendor_location_id` that does not exist violated the foreign key and surfaced as a 500, because nothing translated it. Both writes now go through `refusingUnknownStore`, which turns the violation into `CustomerDiscoveryNotFoundError` (404). The verifier asserts removal, idempotent re-adding, and the refusal.

**P37-02 — the preferred store could not show an eligibility change.** Requirement 3 asks that eligibility changes be *shown* without deleting the preference. `listFavourites` did that (an `is_currently_eligible` flag derived at read time); `preferredStore` returned only the id. The read now takes an optional address and returns the store with its name and `is_currently_eligible`, derived the same way. The earlier assertion — set a preference, read it, read it again, check it is still there — could not have failed for any implementation that stored a row; it now sets an out-of-zone store and asserts it is returned *and* reported ineligible, then an in-zone one and asserts eligible. The API response is `{ preferred_store }` (was `{ vendor_location_id }`); nothing but the typed client consumed it.

**P37-03 — no pipeline.** Migration 0020 gave a request a lifecycle of `OPEN → TRIAGED → CLOSED`, and no code in the repository listed requests or moved one. Migration 0081 adds who handled it, the onboarding lead it became, and the closing reason, with table checks that a moved request names a handler and a closed one names a reason. The domain gains `listShopRequests` (oldest first, filterable by state), `triageShopRequest` (OPEN → TRIAGED, optionally linked to a `vendor_onboarding_cases` lead the operator created through the onboarding module — that module owns lead numbering and audit, so triage links rather than creates) and `closeShopRequest` (OPEN or TRIAGED → CLOSED, reason required). Routes under `admin/shop-requests` sit behind `admin.vendor_onboarding.review` (read) and `.manage` (move), global scope, because a shop request is a lead for that pipeline and not a capability of its own. The queue does not carry the customer's identity: the request is about a place. Once closed, the customer may ask again for the same pin, which is what the partial index was designed to allow and had never been shown.

The same walk found that a shop named in Hindi was a server fault: the service accepted any letter (`\p{L}`) while the table's check accepted ASCII only, so `शर्मा किराना` passed validation and failed the insert. 0081 replaces that check with the length bound 0062 gave every other runtime name.

**The feature matrix was wrong in both directions.** CUS-21 (preferred store) claimed `pwa: true` with "PWA working"; no PWA or Android surface reads or sets it — only the typed client had the methods. It is `backend_only`. CUS-22 (request a shop) claimed `not_started` with "no nomination UI or API call"; the domain method and route had existed since 0020. It is `backend_only` too, with the pipeline now real. All three entries cited `customer-preferences.controller.spec.ts` as verification, a spec about profile, consent and notifications that mentions none of them; they now cite the discovery verifier and the discovery controller spec.

**Mutation results.** Eleven probes, each on a rebuilt database (the discovery fixture places its stores at fixed coordinates, so the verifier cannot re-run on one), each restored from the index and confirmed identical afterwards:

| Probe | Caught by |
|---|---|
| `removeFavourite` DELETE neutralised | *Removing a favourite did not remove it* |
| Preferred-store eligibility forced true | *A preferred store outside the address zone was reported eligible* |
| Foreign-key translation removed | *Favouriting a store that does not exist was not refused as not found (raised … violates foreign key constraint)* |
| Triage state guard removed | *A triaged request was triaged again* |
| Close state guard removed | *A closed request was closed again* |
| Resolution length check removed | *A request was closed without a reason (raised … violates check constraint)* |
| Queue `ORDER BY` removed | *The queue is not oldest first* — the second request is submitted a minute *earlier* than the first, because heap order alone would have listed them in the expected order |
| Queue actor check removed | *A customer read the shop-request queue* |
| 0081 `resolution_when_closed` check weakened | *The table let a request close without a reason* |
| 0081 `handled_when_moved` check weakened | *The table let a request move with nobody recorded as handling it* |
| 0081 ASCII name check kept | *A shop named in Hindi could not be requested (… violates check constraint customer_shop_request_name_shape)* |

One process failure worth recording: the first probe was restored with `git checkout -- <file>` before the day's edits had been staged, which restored the file to HEAD and discarded the domain work along with the mutation. The edits were re-applied and staged, and every later probe restored from the index. **Stage before probing.**

**Verification.** `pnpm db:verify` exit 0 — 82 migrations, full down/up ladder and rebuild from zero; `customer_discovery` 72 assertions measured (the static count of `check`/`rejects` calls went 47 → 70). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls`, `pnpm contracts:check` (253 routes) exit 0; `pnpm test:unit` 499 pass / 0 fail (+1 controller test).

**Step 6.4: VERIFIED_LOCAL.** Scope notes: the request has no customer nomination UI and the queue has no admin UI, recorded as `backend_only` in the matrix; the vendor-side view of a request (the "vendor pipeline" alternative the step names) is the onboarding lead itself.

## Run 38 (19 September 2026) — step 6.5, storefront and product browsing

The step names five requirements. Three held with scope notes. Requirement 3 was met for price, unit and substitution and **not** for availability freshness or the variable-weight estimate, and requirement 5 — no cross-vendor catalogue mixing — was asserted nowhere. Seven assertions added, four mutation probes, all caught.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Identity header, images, description, hours, rating, minimum, methods, policies, offers | Name, description, category, hours, rating, minimum and capacity-checked methods are projected. **Store images and per-store policies are not modelled** (product images are); offers are catalogued Later (CUS-68). Scope note, not a defect in this step. |
| 2 | Categories, product search, product cards, product detail | Met: the store page filters by category and searches within the store; the product page is a dedicated route. |
| 3 | Price, unit, availability freshness, variable-weight estimate, substitution behaviour | Price, unit and substitution held. **Freshness was "has an inventory row"; the 5.7 tiers never reached the customer** — P38-01. **The variable-weight bound was not projected** — P38-02. |
| 4 | Accessible loading, empty, unavailable, stale, error states | Met: `LoadingState`, `EmptyState`, `ErrorState`, the availability pill and the stale label are all rendered from the store page. |
| 5 | Prove no cross-vendor catalogue mixing | **Not proven.** The storefront query was scoped by `vendor_location_id`, and no assertion would have noticed if it were not — P38-03. |

**P38-01 — two definitions of stale, and the customer got the weaker one.** Run 32 recorded that freshness has three tiers (`FRESH` within fifteen minutes, `STALE` within an hour, `EXPIRED` beyond) and "appears in discovery". It appeared in `GET catalogue/locations/:id/availability`, which no customer surface calls. The storefront — what a customer actually browses — reported `is_stale` only when a product had *no* inventory row, so a product the shop last confirmed three days ago showed as `AVAILABLE` with nothing to say otherwise. The storefront now carries `freshness` and `last_confirmed_at`, computed by the same exported `availabilityFreshness` the 5.7 read uses, so there is one definition. The product sheet and product page say it in a sentence ("Stock confirmed by the store in the last 15 minutes." / "…within the last hour." / "The store last confirmed stock over an hour ago. It reconfirms when it accepts your order."), registered en and hi in migration 0082. Run 32's judgement that freshness informs and does not gate stands: `is_stale` keeps its meaning and nothing new disables the add.

**P38-02 — "variable-weight estimate" was a fixed sentence.** The product carries `permitted_weight_variance_bps` (0017, bounded 0–10000 for loose products) and the store page said "the store weighs it" with no number. The storefront projects the bound and the sheet appends "The final weight may differ from what you order by up to 10%."; the percentage is composed in the client from basis points, with a `{percent}` placeholder in both languages. `availability-copy.ts` holds both sentences with a unit test (3 tests) rather than the source-inspection style of the other PWA specs, because the tier-to-sentence mapping is logic.

**P38-03 — cross-vendor mixing had no assertion.** The verifier already had two published in-zone stores each with a product; it never asked whether one store's page listed the other's. It now asserts both directions. The first probe against it — dropping the vendor predicate — failed at bind time (*"bind message supplies 1 parameters, but prepared statement requires 0"*) and was redone with the parameter kept (`$1::uuid IS NOT NULL`), so that it fails at the assertion, as runs 17, 30 and 35 required.

**Mutation results.** Four probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Storefront vendor predicate neutralised (parameter kept) | *A storefront listed another vendor's product* |
| `availabilityFreshness` never returns EXPIRED | *A confirmation over an hour old was not reported EXPIRED, or hid the product* |
| Storefront freshness forced FRESH | same assertion — proves the storefront uses the shared function, not a copy |
| Weight variance not projected | *The loose product did not carry its permitted weight variance* |

**Verification.** `pnpm db:verify` exit 0 — 83 migrations, full ladder; `customer_discovery` 79 assertions (72 after run 37); launch readiness 76 with the five new keys covered en and hi. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls`, `pnpm contracts:check` exit 0; `pnpm test:unit` 502 pass / 0 fail (+3).

**Step 6.5: VERIFIED_LOCAL**, with the requirement-1 scope note: store images, per-store policy text and offers are not modelled; the first two are not in the feature catalogue at all and should be added as entries with an owner decision, the third is Later.

## Run 39 (19 September 2026) — step 6.6, vendor-grouped cart

The step names five requirements. Four held in code; two of those had parts with no assertion, and requirement 3's word *configured* was a constant with a comment naming a configuration key nothing read. Nine assertions added, five mutation probes, all caught — two only after being redone to fail at the assertion.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Cart, vendor groups, lines, quantities, preferences | Held; **the line's substitution preference had no assertion** — P39-02. |
| 2 | Another store is a separate group with a clear fee/order explanation | Held: a second store makes a second group, and the basket says "One payment. Each shop confirms, packs and delivers its own order" with the fee hint. Scope note: the explanation is at the basket, not at the moment of adding. |
| 3 | Enforce the configured group limit, default three | **Not configured.** `cartGroupLimit()` returned the constant; the comment above it named a key "when no active configuration exists" that no code resolved — P39-01. |
| 4 | Per-group fulfilment method, notes, substitution preferences, tip where enabled | Method held (run 36). **The note had no assertion** — P39-02. Tip: not enabled anywhere; `tip_minor` is priced and nothing can set it (scope note). |
| 5 | Never represent cart items as reserved inventory | Held and asserted (scenario 8). |

**P39-01 — "configured" meant a constant.** Run 33 found the same shape on the saved-address limit and called it *"the operator control was silently dead"*. `cartGroupLimit` now resolves `customer.cart_group_limit` (`SETTING`, 1–10) from versioned configuration at the instant of the add and falls back to `DEFAULT_CART_GROUP_LIMIT` of three, exactly as `savedAddressLimit` does. The verifier activates a limit of four through the draft → validate → approve → schedule → activate chain, asserts the read returns four, admits the fourth store, and refuses a fifth — which needed a fifth fixture store.

**P39-02 — two written fields never read back.** `substitution_preference` on the line and `customer_note` on the group were both stored and neither appeared in any assertion, so the `INSERT` could have discarded the preference and the `UPDATE` the note with the ladder green — probes 20 and 18b confirm. The verifier now asserts the preference given with a line is kept and one given without defaults to asking the customer; the note is kept trimmed; and a note over 240 characters is refused as input.

**Mutation results.** Five probes, each on a rebuilt database (the cart fixture's stores sit at fixed coordinates), restored from the index:

| Probe | Caught by |
|---|---|
| Configuration key changed to one nothing activates | *An activated cart-group limit did not replace the default* |
| Limit resolved at the epoch instead of the add's instant | *Raising the configured ceiling did not admit the fourth store (Error: A cart may hold at most 3 vendor groups)* — redone: the first attempt raised from `addLine` itself rather than at an assertion, so the fourth add now catches and the check reports |
| Note written as `NULLIF($4,$4)` | *The group note was not kept, trimmed* — redone: the first attempt (`customer_note=NULL`) failed at bind on an untyped parameter |
| Note length check removed | *A note over 240 characters was accepted (raised … violates check constraint cart_vendor_group_note_shape)* |
| Preference replaced by the default | *The substitution preference given with the line was not kept* |

**Verification.** `pnpm db:verify` exit 0 — 83 migrations, full ladder; `customer_cart` 46 assertions (37 after batch 10). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 502 pass / 0 fail.

**Step 6.6: VERIFIED_LOCAL**, with two scope notes: tipping is not enabled and not in the feature catalogue, though the column is priced; and the separate-order explanation lives at the basket rather than at the add.

## Run 40 (19 September 2026) — step 6.7, cart validation and recovery

The step is named *validation and recovery*. Validation existed for one of the three group reasons and one of the line reasons, and was asserted for the closed-store case alone. Recovery did not exist: a group marked `INVALID` and a line marked `STALE` could never come back, nothing recorded why either had failed, and the basket drew both exactly as before. Twenty-four assertions added, eight mutation probes, all caught.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Revalidate publication, price, availability, store state, minimum, method, address | Publication, store state and address held. **Price and availability were not revalidated**: a line with no current price or no inventory row stayed `ACTIVE` in the basket and was dropped by the quote's inner joins without a word — P40-02. Minimum and method are derived on the projection (`minimum_met`, `fulfilment_method_offered`, run 36) and blocked at the quote; that is validation without invalidation, which is right for a shortfall the customer can repair by adding more. |
| 2 | Isolate stale or invalid lines to the affected group | Held in code; the line-level path (`STALE`) had no assertion. |
| 3 | Preserve valid sibling groups | Held and asserted (run 33's exit-gate property). |
| 4 | Remove, replace, refresh, change method, change address | Remove, refresh, change method and change address exist. **None of them could recover anything**: `revalidate` skipped `INVALID` groups, so a store that reopened or an address changed back left the group `INVALID` for good — P40-01. Replace is remove-and-add (scope note). |
| 5 | Test reconnect and repeated quantity updates | Optimistic versioning was asserted for one update. Repeated updates now walk five, each against the version the last returned. Reconnect is the pre-sign-in basket's server replay, asserted in the PWA spec. |

**P40-01 — a group could only get worse.** `revalidate` iterated `ACTIVE` groups and `continue`d past everything else. Once `INVALID`, a group was never re-examined: the store reopening, the customer changing to an address the store covers, a paused publication resuming — none of it mattered. The quote selects `ACTIVE` groups only, so the store silently dropped out of the order while the basket, which drew every group identically, still showed it with a working quantity stepper. Migration 0083 puts the reason on the row (`invalid_reason`, `stale_reason`, each with a table check that a moved row names one) and adds `GROUP_REVALIDATED` and `LINE_REVIVED` to the append-only history. `revalidate` now examines `INVALID` groups and `STALE` lines too, and returns `recovered` and `revived_line_ids` alongside the failures. `setCartAddress` revalidates in the same command, because changing the address is one of the recovery actions the step names and a group that was out of zone is only worth keeping if that can bring it back.

**P40-02 — two of the quote's silent drops were not the cart's business until now.** The quote joins lines to a current price and to an inventory row; a line with neither vanished from the total with no blocked reason. The line check now names three reasons — `PRODUCT_NO_LONGER_ACTIVE` (product or variant), `PRICE_WITHDRAWN`, `AVAILABILITY_UNKNOWN` — each a line the quote would drop. Out of stock is deliberately not among them: the quote reports it as a blocked group the customer can see, and a cart that invalidated a line for stock would be pretending to reserve.

**The basket now says so.** `GroupCard` renders an `INVALID` group with the reason's sentence and *Remove this store*; a `STALE` line with its sentence and *Remove*, in place of the stepper and the substitution choice (a stale line accepts no quantity change — asserted). `basket-copy.ts` maps reason to sentence with a unit test (3 tests); the copy is registered en and hi in 0083. The recheck notice used to say "current" when a line had gone stale, because `changed` looked only at invalidated groups; it now counts stale, revived and recovered.

**Also closed:** the cart verifier's fixed `SYNTH-ADDRESS-CART` reference, which batch 06 and batch 10 recorded as the reason it could not re-run on one database, is unique per run. The fixture's stores still sit at fixed coordinates, so the discovery-style limitation remains for the store list assertions.

**Mutation results.** Eight probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| `recovered` forced false | *A reopened store did not recover its group on refresh* |
| Loop skips non-`ACTIVE` groups, as before | same assertion — proves the loop change, not only the flag |
| `PRICE_WITHDRAWN` branch removed | *A line with no current price was not marked stale as unpriced* |
| `AVAILABILITY_UNKNOWN` branch removed | *A line with no inventory row was not marked stale as availability unknown* |
| Revival never selected | *A product brought back did not revive its line on refresh* |
| `setCartAddress` no longer revalidates | *Changing to an address outside every zone did not invalidate each group with the reason* |
| 0083 line reason check weakened | *The table let a line go stale with no reason* |
| 0083 group reason check weakened | *The table let a group go invalid with no reason* |

One defect the table check caught before any probe: removing a `STALE` line left its reason set on a `REMOVED` row, and the new constraint refused it. Removal, and the revive-on-re-add paths for lines and groups, now clear the reason — the check earned its place on the first run.

**Verification.** `pnpm db:verify` exit 0 — 84 migrations, full ladder; `customer_cart` 70 assertions (46 after run 39); `grouped_checkout` unchanged at 23. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 507 pass / 0 fail (+3 basket copy, +2 panel).

**Step 6.7: VERIFIED_LOCAL**, with the scope note that *replace* is remove-and-add rather than a command of its own.

### Phase 6 exit gate

*"A customer can build and restore a three-store cart. A stale line or closed store does not destroy valid sibling groups. No UI or API claims cart inventory is reserved."*

- **Build and restore a three-store cart**: met. The cart verifier builds three groups (and, with the configured ceiling raised, four); `currentCart` finds the one active cart on every call; the pre-sign-in basket is replayed through the server at sign-in (PWA spec).
- **A stale line or closed store does not destroy valid sibling groups**: met, and since run 40 the reverse holds as well — a stale line or invalid group can come back, and the basket says which and why.
- **No UI or API claims cart inventory is reserved**: met. The verifier asserts `inventory_reservations` stays empty across the whole scenario; the basket copy says "Nothing is reserved" in the guest path and the quote is where holds begin.

**Phase 6 status: VERIFIED_LOCAL.** All seven steps are VERIFIED_LOCAL (6.1–6.3 in runs 33–35, 6.4–6.7 in runs 37–40). Open by scope note, not by gate: the preferred store and the shop request have no customer or admin surface (`backend_only`); store images, per-store policy text and offers are not modelled; tipping is priced but not enabled or catalogued; the discovery multi-page ordering test recorded at 6.2.

## Run 41 (19 September 2026) — step 7.1, pricing and policy evaluation

The pure pricing function was in good shape. The step's requirements are about what surrounds it — the policy version attached to a quote, the D-05 examples, the refusals at the boundary — and there the connected layer asserted almost nothing: the quote's amounts were never checked, the policy stamp was never checked, and the one thing the stamp exists for turned out not to work. Sixteen unit tests and eleven connected assertions added; six mutation probes, all caught.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Item subtotal, discount, tax, delivery fee, tip, authorization buffer, final amount, in integer minor units | Met in the module (discount, tax and buffer are explicit zeros, as D-05 requires). **Unasserted at the connected layer**: nothing checked that the quote stored the module's amounts for the store's real route — P41-02. |
| 2 | Attach active policy/configuration versions | Attached: `finance.financial_policy` is resolved as of the quote's instant, stamped on the quote and on every allocation. **It could not be used**: the resolver considered `ACTIVE` rows only, so after the first policy change every earlier order's version resolved to nothing — P41-01. |
| 3 | Independent vendor-group calculations plus a combined total | Met, unit-tested. |
| 4 | Reject unsupported currency, negative results, overflow, invalid rounding | Currency is refused where it can enter — the policy reader (`not priced in INR`) and the schema (`vendor_locations.currency = 'INR'`) — but the reader had no test. Negatives, overflow and fractions refused; overflow and fractions had no test. |
| 5 | Table-driven policy examples from D-05 | **Not table-driven, and not D-05's examples.** Three scalar assertions on 2 km, 5 km and 2001 m; worked example 1 (₹349) appeared nowhere. |

**P41-01 — the attached version resolved to nothing once superseded.** `resolveConfiguration` filtered `status = 'ACTIVE'` and `effective_from <= at`. Activation marks the predecessor `SUPERSEDED` with `effective_until` set to the successor's `effective_from`, so a superseded version has exactly the window it governed — and was excluded anyway. `OrderMoneyOrchestrator.recordDeliveryEarnings` resolves the policy `at: row.quoted_at`, with a comment saying the order "settles under the rules it was sold under even if the fee model has since changed"; after any change, that call threw `FinancialPolicyUnavailableError` for every order quoted before it, and settlement went to the dead-letter path. Run 19 recorded requirement 4 of step 3.7 ("preserve configuration versions on created business records") as met because the record retained the reference; retaining a reference nothing can resolve is not preservation. **Run 19's verdict on 3.7 requirement 4 is corrected here.** The resolver now considers `ACTIVE` and `SUPERSEDED` rows within their effective window. The configuration verifier resolves as of an instant on each side of a supersession; the checkout verifier prices a quote, activates a successor policy with identical amounts an hour later, and asserts that the quote's own instant still resolves its version, that a quote *made after the change for an instant before it* is priced under the predecessor (the case that separates "as of the quote" from "as of the wall clock"), and that a later quote takes the successor.

**P41-02 — the quote's amounts were never checked.** The verifier asserted how many groups were quoted and never what they cost. It now reads each store's route distance from PostGIS and asserts item ₹100, delivery = `calculateDistanceAmount(route)` = ₹15 (both stores inside the included 2 km), tip 0, total ₹115, quote ₹230, and that the allocations carry the same amounts and the same policy reference after placement.

**Requirement 5 now is a table.** `checkout-pricing.spec.ts` drives seven D-05 rows through `calculateCheckoutPricing` — worked example 1 (₹300 + ₹39 + ₹10 = ₹349), the 2 km included distance, 2001 m (0.8 paise rounds to 1), 2003 m (2.4 rounds to 2), 2007 m (5.6 rounds to 6), the 40 km boundary (₹15 + 38 × ₹8 = ₹319) and a zero-distance route (the base fee, not nothing) — plus the refusal past 40 km and worked example 6 (₹1 of fictional tax over three lines is 34, 33, 33). Overflow across three groups and fractional amounts are refused with the field named. A new `financial-policy.spec.ts` proves the reader refuses a non-INR policy, a missing, fractional or negative field, and the absence of any policy, and that the reference names the version number and row.

**Scope notes.** (1) D-05 says "no tax-exempt claim", and `catalogue_products.tax_basis` admits `EXEMPT`, which every verifier fixture uses; the quote stores `tax_minor = 0` regardless, so no record *computes* an exemption, but the catalogue field is a claim in D-05's sense. An owner decision, not a fix here. (2) `route_metres` is `ST_Distance` — a straight line, not a route; D-05 says "route km". Recorded, not changed: a routing provider is outside D-15's boundary. (3) Tip is priced and always zero (run 39).

**Mutation results.** Four connected probes on a rebuilt database and two unit probes, each restored from the index:

| Probe | Caught by |
|---|---|
| Resolver back to `status = 'ACTIVE'` | *Resolving as of an instant before supersession did not return the version then in force* (configuration verifier, first in the ladder) |
| Quote resolves the policy at the wall clock instead of its own instant | *A quote for an instant before the policy change was priced under the successor (…V2…)* |
| Quote stamps a constant reference | *The quote does not carry the policy version in force when it was priced* |
| Allocations stamp a constant reference | *The allocations do not carry the policy version and amounts the quote was priced with* |
| `roundHalfUp` bias removed | four unit tests, including *D-05: one metre past the included distance is 0.8 paise, rounded half-up to 1* |
| Currency check removed from the reader | *a policy in any currency but INR is refused, not priced as rupees* |

**Verification.** `pnpm db:verify` exit 0 — 84 migrations, full ladder; `grouped_checkout` 32 assertions (23 after batch 10); `money_lifecycle` unchanged at 23. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 523 pass / 0 fail (+16). The checkout verifier's two fixed address references are unique per run, so it re-runs on one database.

**Step 7.1: VERIFIED_LOCAL**, with the tax-basis and straight-line-distance scope notes carried for an owner.

## Run 42 (19 September 2026) — step 7.2, inventory soft holds

The inventory module itself was well built and well verified — concurrency, replay, release, expiry, all asserted since run 26's era. The defects were in the two modules that bypassed it. Each had a private copy of "release a hold", and each copy was wrong in its own way. Fourteen connected assertions added; six mutation probes, all caught, one redone after the race it targeted did not materialise on its own.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Create an expiring hold only during checkout quoting where policy permits | Met: the cart never reserves (run 39), the quote holds one soft hold per line expiring with the quote, and a blocked store consumes nothing — now asserted. |
| 2 | Scope reservations to vendor location and product variant | Met at location and product: `inventory_items` is keyed by `(vendor_location_id, product_reference)` and the catalogue creates one variant per product, so the scope is equivalent today. Scope note: a second variant of one product would share its stock count. |
| 3 | Prevent over-reservation under concurrency | Met in the module; **the checkout path had no such test** — P42-03. |
| 4 | Release or expire invalid, abandoned, timed-out or failed groups | **Two of the three release paths were broken** — P42-01, P42-02. |
| 5 | Preserve independent sibling reservations | Met and now asserted through the checkout: a competitor is blocked on the held store alone and takes nothing from it. |

**P42-01 — the checkout's release could not give back the last units, and stalled the sweep.** `GroupedCheckoutService.#releaseQuote` added the units back to `exact_available_quantity` and left `availability_state` alone. The table's `inventory_counted_state_shape` check forbids a positive quantity at `OUT_OF_STOCK`, so whenever a hold had taken the last units — the case a hold exists for — the release was refused by the database: a declined payment on such a quote failed outright with a 500 instead of a decline, and `expireQuotes`, which sweeps every lapsed quote in one transaction, threw on the first such quote and expired none of the others until the inventory worker's own sweep had expired the reservations first. Probe 35 reproduces the symptom exactly: *"raised error: new row … violates check constraint inventory_counted_state_shape"*.

**P42-02 — the fulfilment's release never returned the units at all.** `VendorFulfilmentService.#releaseHolds` set the reservations to `RELEASED` and stopped. Every vendor decline, accept-deadline timeout and customer cancellation of a counted item lost that stock for good — the shelf said 6 with 8 on it (probe 40: *quantity 6, events 0*). Neither module wrote an inventory event, so the append-only history had gaps exactly where stock moved.

Both now call one exported routine, `releaseReservationsLocked`, which locks the reservation and the item, restores counted units through the same `updateItemQuantity` the module's own release and expiry use (state recomputed), transitions to `RELEASED` and appends the event with the reason (`PAYMENT_DECLINED`, `PAYMENT_FAILED`, `QUOTE_EXPIRED`, `VENDOR_DECLINED`, `ACCEPT_DEADLINE_TIMEOUT`, `CUSTOMER_CANCELLED`). `place()` used to sweep every customer's lapsed quotes under the caller's context; it now sweeps the caller's own, and the worker's sweep carries the worker's system context, so the events name who released.

**Also found: a re-quote was blocked by its own dead hold.** A quote lapses after five minutes; its holds stay `SOFT_HELD` until the inventory sweep (every 15 s) reaches them. A customer re-quoting in that window read stock already reduced by their own lapsed hold, so the last units on the shelf were "unavailable" to the only customer holding them. `createQuote` now gives back the same cart's lapsed holds and marks those quotes `EXPIRED` before it reads stock.

**P42-03 — the race through the checkout had never been run, and running it once proved nothing.** The first assertion started two quotes for the last unit with `Promise.allSettled` and saw one winner — but so did probe 38 with the row lock removed, because the two transactions happened not to interleave. The verifier now holds the item's row lock in a third connection while both quotes start, so each reads one unit before either can take it, then lets go: the correct path re-reads under the lock and the second quote finds nothing; the mutant held the unit twice and was caught by the event table's `(item, version)` uniqueness before the assertion could count the holds — the database's second line of defence, recorded as such.

**Mutation results.** Six probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Release restores units without the shelf state (the old checkout behaviour) | *A declined authorization did not surface as a decline (raised error: … violates check constraint "inventory_counted_state_shape")* |
| Release never gives the units back | *A declined payment did not give the shelf back with its state recomputed ({"quantity":"0","state":"OUT_OF_STOCK"})* |
| Re-quote does not clear the cart's lapsed quotes | *Re-quoting after one's own quote lapsed was blocked by the dead hold (Every cart group is blocked)* |
| Quote reads inventory without the row lock — interleaving left to chance | **not caught**; redone below |
| Same, with the interleaving forced by a held row lock | *Two customers quoting the last unit at once did not produce exactly one hold (loser: duplicate key … inventory_event_item_version_unique)* |
| Fulfilment release back to its old inline `UPDATE` | *A declined order's units were not returned to the shelf with the release recorded ({"quantity":"6","events":"0"})* |

**Verification.** `pnpm db:verify` exit 0 — 84 migrations, full ladder; `grouped_checkout` 45 assertions (32 after run 41), `vendor_fulfilment` 173 (172). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 523 pass / 0 fail; `pnpm test:integration` exit 0 (the worker's quote sweep now takes its context). The checkout verifier's remaining fixed address reference is unique per run.

**Step 7.2: VERIFIED_LOCAL**, with the variant-scope note carried.

## Run 43 (19 September 2026) — step 7.3, quote creation

Two of the five requirements were met. The quote was *not* bound to the cart's content, retry was idempotent only by accident of a shortcut that returned the wrong quote once the cart changed, and "blocked groups returned explicitly" held for three reasons and silently failed for the rest — a closed or paused store vanished from the quote, and a group with an unpriced line was quoted without it. Migration 0084; twenty connected assertions and one unit test added; seven mutation probes, all caught, one redone to reproduce the old behaviour rather than a new refusal.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Revalidate every vendor group | Location, vendor, zone, method, minimum and stock were checked. **Publication was not** — a paused storefront could be quoted — and every group that failed a join was dropped rather than revalidated — P43-03. |
| 2 | Calculate route, fee, promise, minimum, availability, buffer | Fee, minimum and availability calculated (run 41 for the fee). Route is a straight line (run 41). **The promise is fixed copy** ("Arrives in 45–75 minutes") — a scope note for an owner, since an ETA model is a product decision. Buffer is an explicit zero. |
| 3 | Return quoted and blocked groups explicitly | Explicit for method, minimum and stock. **Silent for everything else** — P43-03. |
| 4 | Bind the quote to customer, cart, address, group content, versions and expiry | Customer, cart, address and expiry were columns. **Content was not binding**: the digest hashed the shelf, and nothing compared the cart to the quote at placement — P43-01, P43-02. |
| 5 | Make quote retry idempotent | **By accident.** The digest never matched a retry; a cart-only shortcut covered for it and returned a stale quote after any change — P43-01. |

**P43-01 — the digest could not match, so a shortcut returned the wrong quote.** `quote_digest` hashed the groups *including* each line's `exact_available_quantity` and inventory version. The first quote's own hold changes both, so the digest of an identical retry never equalled the stored one, and the replay-by-digest path was dead. A shortcut ahead of it returned any live quote for the cart, content unread — so a customer who quoted, added a line, and quoted again within five minutes got the first quote back, and would have paid for a basket that was not theirs. The digest is now `quoteContentDigest`: customer, cart, address, each group's method and tip, each line's variant, quantity, price and catalogue versions — never the shelf, never the policy (which the quote stamps). A retry replays the live quote with that digest; anything else retires the cart's live quotes as `INVALID` (`QUOTE_SUPERSEDED`) and lapsed ones as `EXPIRED`, holds given back, before the stock is read. `quote_digest` was globally unique, which a content digest cannot be — the same basket re-quoted after lapsing is the same content — so 0084 replaces it with uniqueness among live quotes.

**P43-02 — placement never looked at the cart.** `place()` checked that the *catalogue* had not moved (product, variant and price versions, store state) and never that the *cart* had not: a line added or removed, a quantity changed, a method or the address switched after the quote were all placed as quoted. It now recomputes the content digest from the cart and refuses `Quote contents changed` on a mismatch. Probes 43 (quantity dropped from the digest) and 44 (the check removed) both land on *A quote whose cart had changed was placed anyway*.

**P43-03 — a group that could not be quoted was not blocked; it was gone.** The group query joined location, vendor, zone, variant, product, price and inventory with inner joins. A closed, unpublished or out-of-zone store produced no row and therefore no blocked group — the customer saw the store in the basket and not in the quote, with no reason (`STORE_UNAVAILABLE` was in the table's reason list and produced by nothing). Worse, the *line* joins were inner too: a group with two lines, one of which had lost its price or its stock record, was quoted with one line, so the basket said two items and the order had one. The loader now takes every active group and every active line with left joins and flags, and the classification names the reason in the order the customer can repair it: `STORE_UNAVAILABLE`, `FULFILMENT_METHOD_UNAVAILABLE`, `LINE_UNAVAILABLE` (new in 0084), `MINIMUM_NOT_MET`, `INVENTORY_UNAVAILABLE`. The checkout used to print the code in lower case; it now names the store and says the reason in a sentence (six keys, en and hi, in 0084).

**Mutation results.** Seven probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Digest replay removed | *Quote retry was not idempotent* |
| Live quotes not retired on re-quote (lapsed only) | *The superseded quote was not retired with its hold given back ({"lifecycle_state":"ACTIVE","holds":"1"})* |
| Line quantity dropped from the digest | *A quote whose cart had changed was placed anyway* |
| Placement no longer compares the cart | same |
| Publication ignored in store availability | *A paused store was not returned as a blocked group with STORE_UNAVAILABLE ([])* |
| Unsupplied line no longer blocks (first attempt) | **failed before the assertion** on `checkout_quote_lines.unit_price_minor NOT NULL` — the new loader carries the line to the insert, where the old one had dropped it; redone |
| Unsupplied line silently left out — the old behaviour | *A group with an unpriced line was quoted short, or blocked for the wrong reason ({"groups":[…, …],"blocked":[]})* |

**Verification.** `pnpm db:verify` exit 0 — 85 migrations, full ladder; `grouped_checkout` 53 assertions (45 after run 42); launch readiness 76 with the six new keys covered en and hi. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 524 pass / 0 fail; `pnpm test:integration` exit 0.

**Step 7.3: VERIFIED_LOCAL**, with the promise (fixed copy) and route (straight line) scope notes carried for an owner.

## Between runs 43 and 44 (20 September 2026) — real roads (D-17)

Not an audit step. Runs 41 and 43 recorded two scope notes for an owner — the route was a straight line, the promise was fixed copy — and the owner answered them in one instruction: real maps for everyone, Mapbox, everywhere a distance or a time is shown. [D-17](../decisions/D-17.md) records the decision; [road-routing.md](road-routing.md) records the design. What matters for this log:

- One routing service (`database/src/routing.ts`) with two sources: `MAPBOX` and a labelled `ESTIMATE` (the line times 1.3 at 18 km/h) that is the test provider and the fallback. Routes are cached for a day by rounded pair (migration 0085). A deployment must route on real roads or acknowledge itself as synthetic, the same rule as the fake OTP.
- The quote stores the road it priced on and the promise it made from it (`route_metres`, `route_seconds`, `route_source`, `ready_after_seconds`, `arrives_after_seconds`); the fee is priced on the road; offers and settlement read the stored route rather than measuring a line of their own; discovery orders and filters by road; the vendor's console shows the road for a self-delivered order; the promise is composed in the customer's language and marked when estimated.
- Eleven routing assertions in a new ladder module, seven in the checkout verifier (estimate and a fake Mapbox answering 3 500 m: ₹27 delivery, 32–47 minutes, stored, asked once), two in fulfilment (the offer shows the quoted road; the earning is paid on it), one in discovery. Five mutation probes, all caught — two only after the fulfilment fixture's address was moved off the store, because a road and a line are the same number at zero distance and a settlement measuring its own line could not be told from one reading the quote.
- The Mapbox token is configured in the laptop profiles and in the Azure environment's `release.env`, never in the repository. Release `f661558` (20 September 2026) carried it to Azure: the deployed API answers `distance_source: MAPBOX` for store discovery, `GET /catalogue/maps/config` hands the shells their public token, `pnpm online-test:health` passed against the five URLs, and `provider-targets.json` no longer lists routing as unconnected. An environment without the token still runs every route as a labelled estimate, and outside local/test must acknowledge itself as synthetic to do so.

Runs 41 and 43's scope notes on route and promise are closed by this; the tax-basis note stands.

The same day, the owner asked that nobody type a coordinate: `LocationPicker` in `packages/ui` (map, place search, tap, drag, device, hand entry behind a disclosure) replaced the customer's two number fields, the vendor application's device-or-hard-coded point, the admin's defaulted fields, the rider's hard-coded fallback and the zone's typed corners. The public token reaches a page through `GET catalogue/maps/config`, which hands out a `pk.` token only. Verified in the browser against the synthetic project: search, fly-to, pin, tap, save, edit, and a home feed at real road distance and time. CUS-11 (map-pin adjustment) moves from `not_started` to complete. The seven migrations 0079–0085 were applied to the synthetic Supabase project, which the running API already required. See [road-routing.md](road-routing.md).

## Run 44 (20 September 2026) — step 7.4, payment adapter and webhook intake

One of the five requirements was met. The port existed but no real provider could implement it; the void never reached the provider; a provider that threw escaped the money service with nothing recorded; a placement the provider did not answer was left to rot, and its late answer was refused forever; the replay guard was read before the lock; and the API turned any word it did not know into a failure that cancels the placement. Migration 0086; twenty-one connected assertions in the checkout verifier and two in the money verifier, two unit tests; nine mutation probes, all caught, one after the race was forced.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Provider-neutral authorization, capture, refund, status interfaces | **Not neutral.** Every operation was synchronous and there was no void, so no provider a network away could implement it; `voidAuthorization` wrote VOIDED with a provider result of SUCCEEDED that no provider had given — P44-01. |
| 2 | Verify signature, timestamp/replay, event identity, payload | Signature (HMAC over the canonical body), window (±5 min), identity (pattern, unique) held. **Replay was read before the lock** and a reused id with different content passed as a replay — P44-05; **the payload's outcome was coerced**: anything but SUCCEEDED became FAILED — P44-06. |
| 3 | Store unique provider receipts | Met: `provider_webhook_receipts` unique by event id with a content digest, written in the same transaction as the effect. Orphan webhooks (unknown operation) leave none — a scope note. |
| 4 | Handle success, decline, timeout, network error, malformed, duplicate, late success | Success and decline at placement held. **Malformed/timeout/network at authorise, capture, refund or payout threw out of the transaction** — P44-02. **An unknown placement opened no finance exception** — P44-03. **Late success was refused on every delivery** and every other late answer was recorded and ignored — P44-04. Duplicate: sequential only — P44-05. |
| 5 | Provider contract tests and statement fixtures | Met: the fake's contract (memo by reference, unknown preserved, HMAC) in `money-policy.spec.ts`; statement import with every reconciliation class and its replay in the money verifier. Extended for the async port and the no-answer helper. |

**P44-01 — a void that never left the building.** `MoneyProviderAdapter` had authorize, capture, refund, payout and status, all returning a bare outcome synchronously, and no void. `CompleteMoneyLifecycleService.voidAuthorization` therefore marked the payment VOIDED and wrote a payment event with `provider_result='SUCCEEDED'` without asking anyone; with a real provider the customer's bank would keep the hold. The port is now asynchronous throughout, carries `void`, and the void goes through it: SUCCEEDED → VOIDED; DECLINED or no answer → `UNKNOWN_REQUIRES_RECONCILIATION` with a `PAYMENT_UNKNOWN` exception (`RECONCILE_VOID_SAME_OPERATION`), because a declined void is not a declined payment and money is still held. The complete-money service takes a provider; the API and both workers hand every money service the one configured fake (the worker's money service had been building its own with the default clearing account).

**P44-02 — a provider that threw was a 500, not an unknown.** `place()` caught a throwing provider and held the placement unknown; the money service's authorize/capture, refund and payout did not, so the fake's MALFORMED — and a real adapter's timeout or parse failure — escaped the transaction, rolled back the in-flight `_STARTED` record and told the caller nothing, though the money may have moved. `providerOutcome` wraps every call now: a throw is UNKNOWN, and the exception the provider's own UNKNOWN opens is opened for it.

**P44-03 — finance was not told.** The money service opened a `PAYMENT_UNKNOWN` exception for its unknowns; the checkout, where every real authorization happens, never did. An unknown placement is now an open exception (`AWAIT_PROVIDER_WEBHOOK`) from the moment of placement, resolved by the webhook that settles it.

**P44-04 — the placement nobody answered.** Held as PAYMENT_UNKNOWN, the group was touched by nothing but a webhook. Its quote lapsed five minutes later and the expiry sweep gave the stock back, while the group stayed PAYMENT_UNKNOWN; a late SUCCEEDED then reached `#finalize`, found no SOFT_HELD reservation, threw `Inventory hold is unavailable`, and the whole delivery — receipt included — rolled back, so the provider retried into the same 409 forever with the customer's money authorised and nobody told. Every other late answer (`checkout_state !== 'PAYMENT_UNKNOWN'`) was recorded and returned. Now: the expiry sweep leaves a quote whose group is PAYMENT_UNKNOWN alone; `abandonUnknownPayments` (worker, with the other sweeps) cancels such a group after `PAYMENT_UNKNOWN_DEADLINE_MS` (15 minutes) — stock back, quote EXPIRED, `PAYMENT_ABANDONED` event, `checkout.payment_abandoned` outbox event, exception re-labelled `RECONCILE_ABANDONED_AUTHORIZATION`, payment still unknown because it is; and `#lateWebhook` acts on what a late answer says about the money: SUCCEEDED for an abandoned payment → AUTHORIZED, then voided through the provider (VOIDED, exception resolved) or, if the void goes unanswered, left AUTHORIZED with `VOID_LATE_AUTHORIZATION`; FAILED for an abandoned payment → FAILED, resolved; an answer contradicting a settled payment → `STATUS_MISMATCH` for a person, the order untouched.

**P44-05 — the replay guard was read before the lock.** `SELECT` the receipt, then `FOR UPDATE` the payment, then `INSERT` the receipt: two deliveries of one event both passed the read, the second waited on the lock and then died on the unique key — a 500 to the provider, which retries. And a reused event id carrying different content was "replayed" without a look. The receipt is now inserted `ON CONFLICT DO NOTHING` after the lock; on conflict the stored digest is compared — equal is a replay, different is refused. The unforced race passed with the old order (the first delivery finished before the second began), so the verifier holds the payment row from a third connection while both deliveries are issued.

**P44-06 — `outcome: 'PENDING'` was a failure.** The controller mapped anything but `SUCCEEDED` to `FAILED`, and a FAILED webhook cancels the placement and gives its stock back. It refuses what it does not know.

**Mutation results.** Nine probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Finance exception at unknown placement removed | *An unknown authorisation did not open one finance exception that the webhook resolved ({"states":null})* |
| Replay guard read before the lock, no content check (old) | *A reused event id carrying a different payload was accepted as a replay* |
| Replay guard read before the lock, content checked, unforced race | **passed** — the deliveries did not interleave; the race was forced with a third connection holding the row |
| Same, forced | pg `duplicate key value violates unique constraint` (`_bt_check_unique`) at the second delivery |
| Content comparison removed | *A reused event id carrying a different payload was accepted as a replay* |
| Expiry sweep releases an unknown payment's holds (old) | *The holds of a placement awaiting the provider were not kept past the quote's life ({… "quote_state":"EXPIRED","holds":"0" …})* |
| Abandonment keeps the holds | *A placement past the deadline was not abandoned with its stock given back ({… "holds":"1" …})* |
| Late answers recorded and ignored (old) | *A late success after abandonment was not voided through the provider* |
| Void never asks the provider (old) | *A void the provider did not answer was not held as unknown with an exception ({"state":"VOIDED","evidence":{"provider_result":"SUCCEEDED","exceptions":"0"}})* |
| Provider error escapes authorise (old) | the provider's own `Synthetic malformed provider response` at the authorise call — the assertion after it is never reached, which is the behaviour |
| Late void marks VOIDED whatever the provider said | *A late success whose void went unanswered was not left authorised with an exception ({… "payment_state":"VOIDED" …})* |

**Scope notes for the real-adapter step (PRV register).** The signature is verified over a canonical re-serialisation of four fields, not the raw request bytes a real provider signs; the controller will need the raw body. A webhook for an operation this platform never issued leaves no receipt (404). The fake's memo is per operation reference and its scenario decides every operation alike, so with the fake a payment unknown at authorise cannot be voided successfully — the verifier proves that branch with a provider whose void answers.

**Verification.** `pnpm db:verify` exit 0 — 86 migrations, full ladder; `grouped_checkout` 81 assertions (60 after D-17), `money_lifecycle` 25 (23). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 547 pass / 0 fail; `pnpm test:integration` exit 0 (the worker's sweep now runs `abandonUnknownPayments` beside the quote expiry).

**Step 7.4: VERIFIED_LOCAL**, with the raw-body signature, orphan receipts and fake-memo notes carried for the real-adapter step.

## Run 45 (20 September 2026) — step 7.5, checkout transaction

Two of the five requirements were met. The provider was asked inside the transaction that would record its answer, with nothing written until it came back; a placed order's stock holds kept the quote's five-minute expiry, so the inventory sweep gave the stock back while the order was being packed — and the same sweep defeated run 44's "holds kept while the provider is awaited"; a key reused for another quote returned the earlier checkout; a duplicate of a decline answered "quote invalid"; and aggregate transitions were written as 1 → 2 whatever the head said. Migration 0087; fifteen connected assertions; nine mutation probes, all caught, two by exception.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Validate owner, idempotency key, quote integrity, expiry, versions | Owner, integrity (content digest, run 43), expiry and catalogue versions held. **The key was not checked against the quote**: reused for another quote it returned the earlier checkout as if it were this one — P45-03. |
| 2 | Atomically persist holds, group, drafts, snapshots, payment attempt, allocations, transitions, outbox *before provider calls* | **Not before.** The provider was called first, inside the transaction, and the group written only after its answer; a decline wrote no group at all — P45-01. **The holds were not persisted for the order's life**: the PROVISIONAL conversion kept the quote's five-minute expiry — P45-02. |
| 3 | Provider order outside the transaction; webhook/reconciliation confirm; unknown/late success without reviving inventory | **Inside the transaction** — P45-01. Webhook confirmation held (run 44); nothing revived inventory (run 44). No reconciliation existed for a submission whose process died between recording and answer — P45-01. |
| 4 | Same result for duplicate submission | Same checkout for a repeated quote or key. **A duplicate of a decline was "quote invalid"** (the quote had been retired) — P45-03. |
| 5 | Never report failure while the outcome is unknown | Met: `PAYMENT_UNKNOWN` is a projection, not an error; a `PROCESSING` record is now what a crashed submission leaves. |

**P45-01 — the provider inside the transaction.** `place()` opened a transaction, validated, called `authorize`, and only then inserted the payment and (on success or unknown) the group, transitions and outbox; a decline inserted the payment row and released the holds. Two consequences a fake provider hides: a network call ran while the quote row was locked `FOR UPDATE`, for as long as the provider took; and a process that died after the provider had authorised and before the commit left the customer's money held with no record anywhere — the one failure a payment system must not have. `place()` is now two transactions around the call. The first records the submission and commits it: payment `AUTHORIZING` with an `AUTHORIZATION_STARTED` event, the group in `PROCESSING` (a state the constraint had allowed since 0023 and nothing had used), the quote's soft holds carried to the submission's deadline, the aggregate head, its transition and the `checkout.submitted` outbox event, `CHECKOUT_SUBMITTED` in the history. The provider is asked with no transaction open. The second records the answer through `#settleAuthorization`, one routine that the webhook (which real providers send during the call as often as after it) and the sweep share, so the three cannot drift: `SUCCEEDED` finalizes, `DECLINED` releases and cancels, `UNKNOWN` holds with the exception. A group a webhook settled while the call was out stands; the call's own late answer is checked against it like any late answer. `reconcileProcessingPlacements` (worker) finds a `PROCESSING` group older than two minutes, asks the provider's `status` outside any transaction, and settles it with the answer — none being the unknown one. The verifier's provider looks at the database from another connection *while being asked*: it must see the group committed as `PROCESSING`, the payment `AUTHORIZING`, the outbox event, the history row, the holds carried, and no row lock on the table.

**P45-02 — a placed order's stock came back to the shelf in five minutes.** `#finalize` turned the quote's `SOFT_HELD` reservations `PROVISIONAL` without touching `expires_at`, which was the quote's five minutes. The inventory sweep expires `SOFT_HELD` *and* `PROVISIONAL` reservations past their expiry, so five minutes after the quote every placed order's units went back on the shelf with reason `RESERVATION_EXPIRED` while the shop was packing them, and the pickup commit skipped the released reservation without a word (`if (state !== 'PROVISIONAL') continue`). The same sweep took the soft holds of a submission awaiting its provider, which run 44 had protected only from the *quote* sweep. The submission now carries its holds to the submission's deadline, and the placed order's to `PLACED_ORDER_HOLD_MS` (24 hours) — the safety net behind the fulfilment's own endings, which commit at pickup and release on every cancellation and timeout.

**P45-03 — the same submission, and a different one.** `WHERE checkout_quote_id=$1 OR idempotency_key=$3` answered a key reused for a different quote with the earlier checkout. And a declined submission retried found its quote `INVALID` and answered `Quote contents changed` — a different answer from the first. A key on another quote is refused as a conflict; a decline is recorded as a cancelled group (it used to leave only a payment row) and replayed as the decline.

**P45-04 — transitions at version 1 → 2, always.** `#transitionAggregate` wrote `previous_version 1, resulting_version 2` and updated the head `WHERE version=1`, true only while a group had exactly one transition in its life. It now reads the head under lock, requires the expected `from_state`, and writes the real versions; the second transition of a group used to die on `aggregate_transitions`' unique key.

**Mutation results.** Nine probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Provider asked inside the recording transaction (old shape) | *The submission was not committed before the provider was asked, or a row was held while asking ({})* — the witness saw nothing |
| Soft holds not carried to the submission's deadline | same assertion, on its hold-expiry clause (`hold_expires_at` five minutes out) |
| Placed order's hold keeps the quote's expiry (old) | *A placed order's hold did not outlive the quote ({"states":["PROVISIONAL"],"expires":["false"]})* |
| Key reused for another quote returns the earlier checkout (old) | *An idempotency key reused for a different quote returned the earlier checkout* |
| Duplicate of a decline returns a projection | *A duplicate of a declined submission did not answer the same decline* |
| Transition versions hard-coded 1 → 2 (old) | pg `duplicate key value violates unique constraint` on the group's second transition |
| The call's answer settles whatever state it finds | `CheckoutPaymentDeclinedError` from the sweep-settled walk — a late decline cancelled a placed order; with the settlement's own guard, `Checkout is not awaiting a payment answer` |
| The sweep never asks the provider | `CheckoutPaymentDeclinedError` — the call's answer then settled the unknown, so the walk's decline surfaced instead of the sweep's authorisation |
| A definitive answer after the sweep held the group unknown is dropped | *A call's answer arriving after the sweep held the submission unknown did not settle it ({… "WEBHOOK_RESULT:AUTHORIZED","PAYMENT_VOIDED:VOIDED"…})* — the late-answer path voided the money instead |

**Scope notes.** The fake provider's `status` answers from its own memory, so in a real deployment the sweep's question is only as good as the adapter's status call; the real adapter (PRV-02) must implement it against the provider's order/payment lookup. A hosted-checkout redirect (the customer completing payment on the provider's page) is not modelled: the synthetic provider answers the call; the two-transaction shape is what a hosted flow needs, with the redirect return in the webhook's place.

**Verification.** `pnpm db:verify` exit 0 — 87 migrations, full ladder; `grouped_checkout` 96 assertions (81 after run 44), `money_lifecycle` 25. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 547 pass / 0 fail; `pnpm test:integration` exit 0 (the worker's sweep now runs `reconcileProcessingPlacements` before the abandonment sweep).

**Step 7.5: VERIFIED_LOCAL**, with the status-call and hosted-checkout notes carried for the real-adapter step.

## Run 46 (20 September 2026) — step 7.6, customer checkout UI

Two of the five requirements were met. The quote card showed neither the method nor the decision rule, and the decision rule was not a thing the quote knew; the buffer was explained only when there was one; a declined payment reached the customer in a shop's words with a "Try again" that fetched a fresh basket — and so did an answer that never arrived, which is how a lost confirmation becomes a second order. Migration 0088; nine connected assertions, five unit tests (four on the screen's logic, one on the API's codes) and two panel assertions; three mutation probes, all caught; the placement verified live in the browser against the synthetic project.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Show every store group, amount, method, promise, decision rule, blocked issue | Group, amounts, promise (D-17) and blocked issue (run 43) shown. **Method and decision rule not shown**, and **`decision_rule` was a fixed sentence** ("Quoted only when store, minimum, service area, price and stock validate"): the customer's substitution rule, chosen per basket line, was not on the quote, not in the content digest and not on the shop's order line — P46-03. |
| 2 | Combined authorization and buffer explanation | Total shown. **Buffer explained only when non-zero**; the local buffer is always zero, so "You authorise ₹297" stood alone — P46-03. |
| 3 | UPI, card, wallet through the approved provider | Met: the three choices, the chosen one sent as `payment_method`. |
| 4 | Disable COD | Met: absent from the choices, refused by the server, said on the screen. |
| 5 | Handle processing, provider handoff, pending/unknown, decline, expiry, partial blockage, success, reconnect | Unknown, expiry (countdown), partial blockage and success held. **Processing was a busy button and nothing said**; **decline read "That step is not available yet…"** — P46-01; **a lost answer was followed by a fresh quote** — P46-02. Provider handoff: not modelled by the synthetic provider — scope note. |

**P46-01 — the decline in a shop's words.** `CheckoutPaymentDeclinedError` translated to 409 `ORDER_STATE_CONFLICT`, whose sentence is written for a vendor's console; so did `Quote expired` and `Quote contents changed`. The screen showed it in an `ErrorState` titled with that sentence, under a "Try again" that fetched a new quote. Three stable codes now — `PAYMENT_DECLINED`, `QUOTE_EXPIRED`, `QUOTE_CHANGED` (409, registered keys, en and hi) — carried by the domain errors and mapped through `coded`; the screen names the decline ("Your bank declined the payment. Nothing was charged and your basket is unchanged…"), fetches a fresh quote under the notice so the customer can pay another way at once, and re-quotes for a lapsed or changed quote with a sentence saying why.

**P46-02 — the lost answer.** Every placement failure took the same branch: `setFailure(message)` and a retry that called `createQuote()`. A dropped connection, a gateway error or a rate limit after the request had been sent therefore ended in a *new quote* — for a cart the server may already have checked out — while the order that had been placed sat in Orders unseen; the customer, told "The order could not be placed", would try again with a second basket. `classifyPlacementFailure` tells the checkout's own answers (by code) from an answer that never arrived (no `ApiError`, a 5xx, 408, 429) and from a definitive refusal (any other 4xx). An interrupted placement keeps the quote and offers "Check what happened", which re-submits with the same idempotency key — the server replays the same result (run 45: the same checkout, or the same decline) and never places twice. Only a definitive refusal shows an error, and its action is "Get a fresh quote". The placement in flight is announced in a live region ("Placing your orders and asking your bank… keep this page open.").

**P46-03 — what the quote did not say.** The quote card listed the store, the total, items/delivery/tip and the promise. It now states how the order arrives (the group's method) and the rule it proceeds under, and the buffer is said either way ("No buffer is added: this is exactly the amount your bank is asked to hold."). Saying the rule truthfully needed the quote to know it: `substitution_preference` is snapshotted on `checkout_quote_lines` and carried to `vendor_order_lines` (0088), it is part of `quoteContentDigest` — so changing a rule after quoting re-quotes, as changing a quantity does — and `decision_rule` is the one rule every line shares or `MIXED`.

**Mutation results.** Three probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Rule left out of the digest (old) | *Changing a line's rule did not re-quote with the rule stated and snapshotted ({"replaced":false, …})* |
| Order line keeps the default | *The order lines do not carry the customer's substitution rule ({"rules":["ASK_CUSTOMER","ASK_CUSTOMER"]})* |
| Projection states a fixed rule (old) | *The quote does not state each group's rule (["ASK_CUSTOMER","ASK_CUSTOMER"])* |

The screen's own logic is in `checkout-outcome.ts` with four unit tests (each code told apart; six ways of not hearing back all `interrupted`; a 4xx refusal never retried blindly; the rule and the buffer always said), and `customer-panels.spec.ts` holds the panel to it (the check re-submits with `place()`, the decline and the processing state are said, method/rule/buffer are rendered).

**Live.** Against the synthetic project through the local stack: two stores in the basket, the quote stating for each "How you get it: Delivery partner brings it · If something is out of stock: it is refunded, never replaced" (the tiles had set `NO_SUBSTITUTION` for products the store does not substitute), "No buffer is added…" under ₹297.16, and the placement landing with `CHECKOUT_SUBMITTED` before `CHECKOUT_PLACED` (run 45), order lines carrying `NO_SUBSTITUTION`, holds `PROVISIONAL` for 24 hours.

**Forward finding (Phase 8, not fixed here).** The fulfilment's substitution flow (`proposeSubstitution` → a customer decision with a deadline) asks the customer whatever the line's rule says: `ALLOW_SAME_STORE` should let the store substitute without asking and `NO_SUBSTITUTION` should refuse a proposal and refund. The rule now reaches the order line; honouring it is step 8.x's.

**Scope note.** Provider handoff (a hosted checkout page) is not modelled by the synthetic provider; the interrupted-and-check shape is what a redirect return needs.

**Verification.** `pnpm db:verify` exit 0 — 88 migrations, full ladder; `grouped_checkout` 105 assertions (96 after run 45); launch readiness 76 with the three error keys and the checkout copy registered en and hi. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 554 pass / 0 fail; `pnpm test:integration` exit 0 (a first run that overlapped the ladder's database rebuild was discarded).

**Step 7.6: VERIFIED_LOCAL**, with the hosted-handoff note and the Phase 8 forward finding carried.

## Live QA pass (20 September 2026) — every role's workflow against the running stack

Not an audit step. Between runs 46 and 47 the owner asked for the `supabase-production` stack to be run again and every API and feature walked step by step, per role, in workflow order. A scratch walk of 163 API steps (admin provisioning and every console read; vendor settings, catalogue, inventory, staff, insights, finance; partner standing, availability, earnings; customer preferences, addresses, discovery, cart; then five orders — a full delivery with wait, handover, delivery code, rating, support and settlement; a substitution proposal answered; a customer cancellation; a vendor decline; a customer pickup — and the admin's moderation, shop request, suspension, reports, export and dead-letter recovery) ends at 163 of 163, and the four Playwright journeys (customer OTP → address → basket → checkout; vendor accept → pick → ready; partner online → custody; admin sign-in, order monitor, moderation queue) all pass against the same stack. Nine defects, none of them in the step audits' domains, fixed on the way:

| # | Found | Was | Now |
|---|---|---|---|
| L-01 | Worker: `vendor_order_events_actor_id_fkey` on every tick | The worker acted as a fresh random id per process; the accept-deadline sweep wrote an event with it, failed on the foreign key and rolled back — an order the shop never answered was never expired, its holds never released, an error every 15 s forever | A platform system user (`PLATFORM_SYSTEM_USER_ID`, migration 0089) is the actor every sweep and outbox consumer runs as, in both workers; the first tick after the fix expired the two overdue orders and voided their authorisation through the provider |
| L-02 | `GET /notifications` 500 for every signed-in user | A session-only route ran with no actor in the request context; the notifications list asked who was calling and threw | The guard attaches an actor to session-only routes, its kind resolved from the user's live roles (`IdentityAccessService.resolveActorKind`) |
| L-03 | Partner application queue and dispute resolution 404 for every admin | Two `admin.*` requirements named no `admin_scope`; an ADMIN_SCOPE capability without one can never match | Scoped; `admin-scope.spec.ts` reads every controller and refuses an admin requirement without a scope |
| L-04 | Policy register 404 for the approver | Listing configurations was gated on `propose` (operator only) | `admin.configuration.read` (0090) for both sides of the pair |
| L-05 | Onboarding queue and case 404 for the reviewer; shop-request queue 404 for the operator | Reads gated on one side of the maker-checker pair while the actions belonged to the other | `admin.vendor_onboarding.read` (0091) for both sides; queue, case and shop-request list read under it |
| L-06 | Rating a delivered order 409 | `submitRating` admitted `PICKED_UP` alone, from before 0055 added `DELIVERED` | `DELIVERED` rated too; the fulfilment verifier rates a delivered order |
| L-07 | Granting a role someone holds 500 | The single-active-row index (0070) surfaced as a unique violation | The held assignment is answered; the access verifier grants twice |
| L-08 | Customer address form: the PIN read off the map had to be typed back | The picker showed "456222, Ujjain…" under the pin and left the PIN field empty | `LocationPicker` reports the geocoded place; the form fills the PIN from its postcode until the person types one |
| L-09 | Admin console opened empty | Every view waited for "Refresh queues"; the catalogue view said "0 live cases" over a queue that was not | The workspace loads on arrival and on each view change |

Also: every product tile's add button is now named after its product (fourteen tiles said "Add"); the three cross-role journeys and the customer loop journey were written against shells since rebuilt and are re-pointed at what the shells say now (the vendor journey ends at the counter note, because the pickup code is the partner's to show); a `checkout.submitted` event dead-lettered by the pre-run-45 worker was recovered through the admin API and consumed.

Two things the walk needed that the repository does not provide: an admin account holding each side of the maker-checker pairs (the bootstrap grants one side; a second synthetic admin was seeded with the other) and a role a bootstrap admin cannot grant itself (`INCIDENT_COMMANDER` for reporting, granted by the second admin). Both are how the pairs are meant to work.

**Verification.** `pnpm db:verify` exit 0 — 91 migrations; `vendor_fulfilment` 176 assertions (175); `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 556 pass / 0 fail; `pnpm test:integration` exit 0; the API walk 163/163 and `pnpm test:e2e` 23 passed with `LIVE_SUPABASE_ACCEPTANCE=true ACCEPTANCE_SEED_FIXTURES=true` against the running stack.

## Run 47 (20 September 2026) — step 7.7, group and child-order projections

Three of the five requirements were met. The customer's group projection leaked what it should never have carried, and the group's summary state — the one thing the projection is for — was never derived. Migration 0092; three connected assertions and four unit tests; four mutation probes, all caught.

| # | Requirement | Verdict |
|---|---|---|
| 1 | Return overall group summary | Returned. **Not a summary**: `lifecycle_state` was the stored payment state; `derived_lifecycle_state` counted CANCELLED children alone and nothing read it — P47-02. |
| 2 | Actor-specific child-order views | Met: the vendor's `VendorOrderSummary` and the partner's `DeliveryAssignmentRecord` are named projections (the partner's drop address only while in custody); the customer has tracking and receipt per order; the admin has the monitor. |
| 3 | Prevent sibling product, support, or financial leakage | Sibling isolation held (the vendor list is scoped by location, the pick list by order and location). **The customer's own projection leaked internals**: `SELECT *` of the group and of every order — P47-01. |
| 4 | Derive group status from children without owning their transitions | **Not derived** where it was read: the order history and the admin monitor showed the stored payment state, so a group of delivered orders read "In progress" for good — P47-02. |
| 5 | Cursor-based history and request references | Met: `history()` pages by event id with a next cursor and carries request and correlation ids. |

**P47-01 — the projection that carried everything.** `#projectCheckout` spread the whole `checkout_groups` row (idempotency key, request and correlation ids) and, for each order, `vendor_order.*`: `pickup_otp_hash`, `delivery_otp_hash`, `pickup_otp_issued_by`, `vendor_delivery_by_user_id`, `decline_note`, `package_condition_note` and every timestamp — to the customer, on placement and on every `GET`. The hashes are plain SHA-256 of a six-digit code: a million hashes take milliseconds, so the customer held the partner's pickup code. The projection now names its fields: group id, reference, quote id, created time, summary state, payment state, total, version; per order id, store, reference, state, method, total, accept-by, version. The verifier pins the two field lists.

**P47-02 — the summary nobody derived.** A group owns nothing but its payment; what it *is* after that is what its orders are. The PRD names seven summaries and 0049 had copy for six of them, but nothing computed them: the customer's order history and the admin monitor showed `checkout_groups.lifecycle_state` — `ACTIVE` from authorisation to the end of time — and the one derivation, in the placement projection, counted CANCELLED children only (an EXPIRED order, the shop never answering, left its group "In progress") and was returned as a field nothing read. `deriveCheckoutGroupState` (`checkout-group-state.ts`, four unit tests) is the one derivation: the payment's own state until it authorises; then all ended → `CANCELLED`, any ended → `PARTIALLY_CANCELLED` (what the customer needs to know first), all complete → `COMPLETED`, any complete → `PARTIALLY_COMPLETED`, all `PLACED` → `PROCESSING`, any `PLACED` → `PARTIALLY_ACCEPTED`, else `ACTIVE` — where a collected order is complete at `PICKED_UP` and a delivered one at `DELIVERED` (the same state is the partner holding a delivery), and `EXPIRED` and `RETURNED` are endings. It serves the placement projection, the order history and the admin monitor; the payment state travels beside it. 0092 adds the seventh label.

**Mutation results.** Four probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Every order column spread again (old) | *The customer's group projection carries fields it should not ({… "delivery_otp_hash","pickup_otp_hash","decline_note","vendor_delivery_by_user_id" …})* |
| The stored payment state as the history's summary (old) | *Customer history does not summarise each group from its orders ({"two_store":"ACTIVE","collection":"ACTIVE","self_delivered":"ACTIVE" …})* |
| A collected order's PICKED_UP read as a delivery in custody | same, `"collection":"ACTIVE"` |
| EXPIRED not an ending (the old derivation) | the unit spec: *expected PARTIALLY_CANCELLED, actual ACTIVE* |

**Forward finding (the OTP steps, 8.x and 9.x).** The pickup and delivery codes are stored as plain SHA-256 of six digits (`createHash('sha256').update(otp)`); a keyed hash (HMAC with a server secret) would make any leaked hash worthless. The projection no longer leaks them; the hashing is the OTP steps' to harden.

**Verification.** `pnpm db:verify` exit 0 — 92 migrations, full ladder; `grouped_checkout` 107 assertions (105 after run 46), `vendor_fulfilment` 177 (176); launch readiness 78 with the new label en and hi. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 560 pass / 0 fail; `pnpm test:integration` exit 0.

**Step 7.7: VERIFIED_LOCAL**, with the keyed-hash note carried for the OTP steps.

## Run 48 (20 September 2026) — step 7.8, prove checkout invariants

The step is the proof, so the audit is of the proofs: eleven named scenarios and three exit-gate invariants against what the verifiers actually establish. Seven stood; four were missing, and two of the four found defects when written. Migration 0093; seven connected assertions and one API unit test; four mutation probes, three caught.

| Proof | Standing before run 48 | Now |
|---|---|---|
| Duplicate taps | Sequential replay: same group, order and allocation counts (run 43/45) | **Overlapping taps forced** with a third connection holding the quote row: one checkout, one footprint (payment, group, orders, allocations, holds, outbox, history, payment events); a later tap changes nothing — P48-01 |
| Last-unit competition | Forced in run 42 | unchanged |
| Three-store partial failure | The blocked sibling consumes no stock (run 43); a declined sibling leaves the other PLACED with holds (fulfilment verifier) | unchanged |
| Expired quote | Refused at placement, holds released (runs 42, 43, 45) | unchanged |
| Changed price | The price *withdrawn* at the quote (run 43) only | **Changed between quote and placement**: refused `QUOTE_CHANGED`, nothing placed, the quote's holds intact |
| Closed store | The location's lifecycle at placement | **Paused publication at placement** refused too — P48-03 |
| Provider timeout then webhook success | Run 44 | unchanged |
| Webhook replay | Run 44, forced concurrent | unchanged |
| Allocation totals | Item amounts and the policy stamp per allocation (run 41) | **The sums**: authorised amount = allocations = orders, each allocation = its order |
| Rollback | Nothing | **A placement whose holds lapsed while the provider was asked**: nothing of the orders kept, money voided, shelf whole, customer refused by name — P48-02 |
| Cross-customer access | `#projectOwned` concealment (run 43) | unchanged |

**P48-01 — two taps that overlapped.** The submission looked for an earlier group *before* taking the quote row `FOR UPDATE`. Two taps that had both begun read "no group yet", the second waited on the row, and when the first committed its submission the second inserted a group for the same quote and died on `checkout_groups_checkout_quote_id_key` — a 500 for a tap the customer had already been answered for (the screen's "check what happened" would have recovered it, but the server should never have failed it). The quote row is now locked first, whatever the quote's state, and the earlier submission looked for under it. The proof holds the row from a third connection while both taps are issued, then compares their answers and the footprint.

**P48-02 — the answer thrown away.** `#settleAuthorization` recorded the payment AUTHORIZED and then made the orders; a hold no longer there (`Inventory hold is unavailable`) threw out of the transaction, so the group stayed PROCESSING with an AUTHORIZING payment and the reconciliation sweep, asking the provider's status, walked into the same missing hold every tick — the customer's money held indefinitely, nothing to show for it. The orders are now made inside a savepoint; on a missing hold the placement is ended: remaining holds given back (`FULFILMENT_UNAVAILABLE`), quote INVALID, group CANCELLED with `CHECKOUT_FAILED` (0093), the authorisation voided through the provider (or, unanswered, left AUTHORIZED with an exception asking for the void), and the customer refused as `INVENTORY_UNAVAILABLE` at 422 (`CheckoutUnfulfillableError`), which their screen names and answers with a fresh quote. The proof's provider expires the submission's holds while being asked.

**P48-03 — a paused store took the order.** Placement re-checked catalogue versions, prices and the location's lifecycle, not its publication; a store paused after the quote received the order. Publication is now part of the check, refused as `QUOTE_CHANGED` (the re-quote then blocks the store with `STORE_UNAVAILABLE` and says so).

**Mutation results.** Four probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Earlier submission looked for before the row is taken (old) | pg `duplicate key value violates unique constraint` on the second tap |
| Publication not checked at placement (old) | *A store paused after the quote still took the order (null)* |
| No savepoint: a missing hold throws the answer away (old) | *A placement whose holds were gone was not ended with the money released ({… "checkout_state":"PROCESSING","payment_state":"AUTHORIZING" …})* |
| Price dropped from placement's catalogue check | **passed** — the content digest (run 43) refuses the changed price on its own; the catalogue check is the second proof of one invariant, kept |

**Exit gate.** One checkout, one group, one order per valid vendor: runs 43 and 45, and the footprint here. A duplicate creates no duplicate payment, order, allocation, hold, event or notification: the footprint here — notifications follow the outbox, and the outbox is proven single. An invalid or failed group releases only its own resources: the blocked sibling (43), the declined sibling (fulfilment), the declined and abandoned payments (42, 44), and the unfulfillable placement here.

**Verification.** `pnpm db:verify` exit 0 — 93 migrations, full ladder; `grouped_checkout` 114 assertions (107 after run 47). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 560 pass / 0 fail; `pnpm test:integration` exit 0.

**Step 7.8: VERIFIED_LOCAL. Phase 7 exit gate: met.**

## Run 49 (20 September 2026) — step 8.1, vendor alert and response deadline

Five requirements. Three held: the countdown is the server's `accept_by` (Phase D, run 47's projection carries it), `timeoutOverdueAccepts` expires the unanswered order at the deadline, and the customer is told `TIMED_OUT` with the holds released (fulfilment verifier). Two were absent: nothing alerted the shop, and nothing escalated. One live defect found beside them. No migration; nineteen connected assertions, three unit tests, seven mutation probes, all caught.

| # | Requirement | Finding |
|---|---|---|
| 1 | Push/audible alert to authorized devices | **Absent.** The customer was notified of every state change; the shop's console polled a list every fifteen seconds in silence — P49-01. |
| 2 | Escalate after non-acknowledgement on configured channels | **Absent.** No acknowledgement existed to miss — P49-02. |
| 3 | Server-owned countdown | Met: `accept_by` is written at placement and the console counts down from it. |
| 4 | Auto-timeout at deadline | Met: the worker sweep, `FOR UPDATE SKIP LOCKED`, `ACCEPT_DEADLINE_TIMEOUT`. |
| 5 | Customer told; reservations and allocations released | Met: `syncDomainSignals` carries `TIMED_OUT`; the release is the decline path's. |

**P49-01 — the shop that was never told.** `alertStaffOfPlacedOrder` (`local-notifications.ts`), called by the worker's `order.placed` handler before dispatch looks for a partner: one `vendor_order_event.placed` intent per current staff member of the location — an active role assignment with a membership there; a revoked picker is nobody — in-app and push, payload `order_reference`, `accept_by`, `audible: true`, deduplicated on order and person so the outbox may retry, and nothing for an order no longer `PLACED`. The vendor console (`order-alerts.ts`) asks for its unread alerts on every load of the list, sounds two synthesised notes for orders it has not sounded for, and marks the alerts for the orders it is showing read; a hidden tab acknowledges nothing, and a page nobody has touched cannot sound (browser policy), which is what the push is for.

**P49-02 — the escalation.** `escalateUnacknowledgedOrders` in the worker sweep: an order still `PLACED` after `after_seconds`, still inside `accept_by`, with no read `placed` alert for it and no escalation already sent, is raised once to the location's owners as `vendor_order_event.placed_escalation` on the policy's channels. The policy is the `SETTING` `vendor.order_alert_escalation` (`after_seconds` 15–600, `channels` ⊆ {IN_APP, PUSH, SMS}), resolved through the versioned-configuration workflow the admin already has; defaults 60 seconds on all three, SMS because an unheard push is what this is for.

**P49-03 — the inbox that showed nothing.** `GET /notifications` returned a bare array; the reference interceptor wraps a bare value as `data`, and the contract, the customer inbox and the native app all read `notifications` off the answer — so the customer's inbox had always been empty. The controller answers `{ notifications }`; a controller unit test pins it.

**Mutation results.** Seven probes on `local-notifications.ts`, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Deduplication key includes the time (alerts repeat on retry) | *The alert was not one in-app-and-push intent per staff member (…four intents…)* |
| The read-alert clause dropped (an acknowledged order escalates) | *Escalation did not raise exactly the one unheard order once, to its owner alone (2/0)* |
| The wait dropped (escalation at once) | *An alert was escalated before its wait ran out (1)* |
| SMS dropped from the default channels | *The escalation did not reach store B's owner by SMS for the unheard order* |
| Revoked role assignments counted as staff | *A placed order did not alert every current staff member of its shop, and no one else (2/2/3)* |
| The configured `after_seconds` ignored | *An activated escalation setting did not replace the defaults ({"after_seconds":60 …})* |
| Escalation to all staff rather than owners | *…to its owner alone (2/0)* — after store B was given a picker; the first form of the walk let this one through |

**Verification.** `pnpm db:verify` exit 0 — 94 migration files (0000–0093), full ladder; `vendor_fulfilment` 187 assertions (177 after run 47). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 563 pass / 0 fail; `pnpm test:integration` exit 0.

**Step 8.1: VERIFIED_LOCAL.**

## Run 50 (20 September 2026) — step 8.2, accept and decline

Five requirements. Two held outright (the placed-state, deadline and version gates on accept; the estimate stored), one held in substance (siblings preserved, history written), two did not: the acceptance committed nothing, and the decline took any string for a reason and previewed nothing. A fourth defect fell out of the new proofs: no customer has ever been able to cancel an accepted order. Migration 0094; fourteen connected assertions, one unit test; eight mutation probes, all caught.

| # | Requirement | Finding |
|---|---|---|
| 1 | Accept only from PLACED, before the deadline | Met in code; the deadline gate and the not-PLACED gate had no proof — both now walked. |
| 2 | Commit counted inventory atomically | **Absent.** Accept touched no inventory; the holds were committed at pickup, from the worker, one transaction each (PRD: "vendor acceptance commits it") — P50-01. |
| 3 | Store preparation estimate | Met; now also in the `ACCEPTED` event's note, so a later revision does not lose what was promised. |
| 4 | Preview decline impact; standardized reason | **Absent.** Any shouting-snake-case string was a reason; the "preview" was a sentence the console computed from the order total — P50-02. |
| 5 | Preserve siblings; complete audit history | Met: the sibling walk (runs 41–49); `DECLINED` with reason and note, `ACCEPTED` with the estimate. |

**P50-01 — the acceptance that sold nothing.** The provisional holds placed at checkout stayed provisional through preparation and were committed by `settleInventoryOnPickup`, invoked by the worker on `vendor_order.picked_up`, one `commit` transaction per line: not atomic with anything, and an accepted order lived its whole preparation on a hold with a deadline (the run 45 fix stretched that deadline to a day rather than remove it). `commitReservationsLocked` (inventory module) now commits inside the caller's transaction; `accept` calls it after the state write, so the acceptance and the sale stand or fall together. A hold in any state but `PROVISIONAL` or `COMMITTED` — released, expired: the units went back to the shelf — refuses the acceptance (`The stock held for this order is no longer held`) and the order is left `PLACED` at its version. A provisional hold past its deadline that the sweep has not reached is committed: its units are still deducted, the row is locked, and the shop has just promised them. `settleInventoryOnPickup` stays as the backstop for orders accepted before this run and now finds nothing to do. A customer's cancellation of an accepted order releases `COMMITTED` too — before, it looked for holds only and would have left the stock sold to nobody.

**P50-02 — the reason and the preview.** `VENDOR_DECLINE_REASONS` is the vocabulary (the seven the console offered, now the server's); `decline` refuses anything else at 400. `previewDecline` reads what the decline would use: the money released is the order's payment allocation (zero once declined), the units per line are the ones held, the siblings are counted, and the shop's own record over the window is given as counts before and after (`3 of 4 … 3 of 5`), with the reasons. The console's decline sheet asks for it on opening and shows the API's sentences; the reasons it offers are the API's, labelled by its own copy.

**P50-03 — the cancellation that never worked.** `cancelByCustomer` allows PLACED, ACCEPTED and PICKING, but 0026's `vendor_order_accepted_after_placed` required a CANCELLED order to have no `accepted_at`, so every cancellation after acceptance died on the constraint — a 500 to the customer, since the day the route existed; nothing in the ladder had walked it. 0094 lets a cancelled order keep the time it was accepted, which is what happened.

**Mutation results.** Eight probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Accept commits nothing (old) | *Accepting did not commit the order's holds in the acceptance ([{"state":"PROVISIONAL" …}])* |
| Any shouting-snake-case reason (old) | *A reason outside the standard list was accepted for a decline* |
| The deadline gate dropped | *An order past its response deadline was accepted* |
| The PLACED gate dropped | *A declined order was not refused acceptance for its state (…The stock held for this order is no longer held…)* — the commit refused it second; the walk asks for the first refusal |
| Cancellation releases holds only (old) | *A customer's cancellation of an accepted order did not return its committed units ([{"state":"COMMITTED","shelf":"3"}])* |
| Preview's money from the order total (old) | *A declined order's preview still offered a decline with money to release* |
| Preview counts the order among its siblings | *The decline preview did not state the money, the units, the siblings and the record* |
| A lapsed hold skipped rather than refused | *An order whose hold had lapsed was accepted* — after the lapsed-hold walk was written; the first form of the walk let this one through |

**Forward findings.** (8.3/8.5) A line marked missing or removed during picking keeps its committed units: nothing releases a reservation per line, so the shelf undercounts by what was not taken. (9.x) A `RETURNED` order's committed units are never released. (6.x) `setCountedStock` refuses while any reservation is `SOFT_HELD`, `PROVISIONAL` or `COMMITTED`, and a completed sale's reservation stays `COMMITTED` for good — after its first completed order an item can never be recounted; the vendor's inventory list counts those units as held. A terminal state for a consumed commitment, or a stocktake that ignores commitments whose orders have ended, is the fix.

**Verification.** `pnpm db:verify` exit 0 — 95 migration files (0000–0094), full ladder; `vendor_fulfilment` 201 assertions (187 after run 49). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 564 pass / 0 fail; `pnpm test:integration` exit 0.

**Step 8.2: VERIFIED_LOCAL**, with the three forward findings carried.

## Run 51 (21 September 2026) — step 8.3, picking workflow

Five requirements. One held (unresolved lines cannot reach ready, with its own code since 0073), one held more strictly than asked (edits lock at `READY`, before custody), and three did not hold as written: the snapshot was immutable by convention only; "found" took any quantity at any price, a replacement ignored the customer's rule and the store it came from, and any pick overwrote any other — a pending decision included; and the console's offline queue replayed picks with nothing to say whether they were stale. Migration 0095; twenty connected assertions, one unit test; eight mutation probes, all caught. The run 50 forward finding (a missing line keeps its units) is closed here.

| # | Requirement | Finding |
|---|---|---|
| 1 | Immutable ordered-line snapshots | Shown from the snapshot; nothing rewrote `vendor_order_lines`, and nothing forbade it — P51-01. |
| 2 | Mark found, remove, weigh, propose substitution | All four exist. Found took any quantity and price; a substitution ignored the customer's rule and could name another store's variant — P51-02. |
| 3 | Safe drafts during reconnect | The console queues picks offline (VEN-40) and the pick row is the server-side draft, but a pick carried no version: a queued or repeated tap overwrote whatever had happened since, a pending customer decision included — P51-03. |
| 4 | Unresolved lines cannot reach ready | Met (run with `PICKING_INCOMPLETE`). |
| 5 | Lock ordinary edits after custody | Met, more strictly: picks require `PICKING`, so edits lock at `READY`; kept, since money is settled on the picks. |

**P51-01 — the snapshot by convention.** 0095 puts the same append-only guard on `vendor_order_lines` that the order history has (`55000`). The walk tries the rewrite.

**P51-02 — found, and the rule.** `markLineFound` now bounds the pick to the line as ordered: at least one unit, no more than ordered, at the snapshot's price — a changed price or a heavier weight is a proposal for the customer (8.4), never a "found". `proposeSubstitution` reads the line's rule (0088 carried it to the order line; nothing read it): a "refund, never replace" line is refused with `SUBSTITUTION_NOT_ALLOWED`, and the replacement must be one of this store's own `ACTIVE` variants — the FK alone let any store's product be proposed. The pick list carries `substitution_preference` and `variable_weight`; the console shows the rule beside each line, hides Substitute on a refund-only line and Weigh on a line not sold by weight.

**P51-03 — the draft with no version.** `lockLine` locks the ordered line, reads its pick and requires the caller's `expected_version` to equal the pick's version (0 before any pick); the four pick routes take it, the console sends `pick.version` on found, missing, weigh and substitute, and the offline queue therefore replays a draft that is refused as `VERSION_CONFLICT` if a newer answer stands, rather than applied over it. The same lock refuses any edit on a line whose proposal is pending or was approved (`LINE_AWAITING_CUSTOMER`, 0095) — before, a picker could mark a line found under a live proposal and the customer's later approval would have moved money for a line the shop had already packed as ordered. A rejected proposal, a found or a missing line may be marked again with the version it has.

**Closing run 50's finding.** At `markReady`, once every line is resolved, the lines that will not be in the bag as ordered — `MISSING`, `SUBSTITUTION_REJECTED`, `WEIGHT_REJECTED`, `SUBSTITUTION_APPROVED` — give their committed units back to the shelf (`LINE_NOT_SUPPLIED`); a found line keeps its commitment. The decision walk's three lines (one replaced, two refused) end released with the shelf restored.

**Mutation results.** Eight probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Version check dropped (old) | *A pick sent against a version the line never had was not refused as stale* |
| Found bounds dropped (old) | *A found line was recorded with more units than were ordered* |
| The customer's rule ignored (old) | *A replacement was offered on a refund-never-replace line* |
| The replacement's store not checked (old) | *A replacement from another store's catalogue was proposed* |
| Pending/approved lines editable (old) | *A line with a pending decision was edited by the shop* |
| No release at ready (old) | *Lines that will not be in the bag kept their units at ready ([{"state":"COMMITTED","shelf":"4" …}])* |
| Found lines released too | *Reservations were not committed on pickup* (the run 41 check), and the walk's own *A found line lost its commitment at ready* |
| 0095's trigger absent | *An ordered line could be rewritten* |

**Forward findings.** (8.4) `proposeWeight` creates a customer decision for every weight, lighter included; the PRD asks for a decision only when the total rises and a plain partial refund when it falls. (8.4) An `ALLOW_SAME_STORE` line still goes to the customer as a proposal; the rule says the store may choose within the price limit. (8.4/8.5) An approved replacement reserves no stock for the replacement variant, and a found line short of the ordered quantity keeps the whole reservation (a reservation is one row). (8.5/8.6) Nothing yet reduces the capture for a missing or short line; the receipt's refund arithmetic is the money step's.

**Verification.** `pnpm db:verify` exit 0 — 96 migration files (0000–0095), full ladder; `vendor_fulfilment` 215 assertions (201 after run 50); launch readiness 78 with the two new codes' keys. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 565 pass / 0 fail; `pnpm test:integration` exit 0.

**Step 8.3: VERIFIED_LOCAL**, with the forward findings carried to 8.4–8.6.

## Run 52 (21 September 2026) — step 8.4, customer decision requests

Five requirements. One held (approve/reject once, with ownership and the deadline; walked since run 41), one held in its mechanism but not its inputs (the timeout), and three did not: every weight and every replacement was a question, the question said nothing about what it was, and the money behind it was captured before the question could be asked. Migration 0096; sixteen connected assertions; nine mutation probes, all caught. The run 51 forward findings on weight and `ALLOW_SAME_STORE` are closed here; the money one (capture not reduced for a missing line) too.

| # | Requirement | Finding |
|---|---|---|
| 1 | Substitution or *material* weight/price proposal | **Not material.** A lighter weight and a replacement at no extra cost on a line whose rule lets the store choose both waited on the customer — P52-01. |
| 2 | Notify with old/new item, quantity, amount, reason, deadline | **Absent.** The pending list carried the proposed quantity and price alone; the notice carried the event type alone. The customer was asked to approve "A replacement item — 1 × ₹180" — P52-02. |
| 3 | Accept approve/reject once | Met: row lock, ownership, `PENDING` only, deadline (runs 41–51). |
| 4 | Apply configured timeout behaviour | The behaviour (reject) held; the deadline was the constant, never `customer.decision_seconds` (implementation.md 6.1) — P52-03. |
| 5 | Update authorization/capture or a transparent refund/adjustment path | **Broken in production.** The group was captured the moment every shop had accepted, so every approved dearer change after that was refused for want of an uncaptured payment, and a missing or refused line was captured in full with no adjustment path at all — P52-04. |

**P52-01 — what is a question.** `#recordPickAndProposal` computes the delta first: a total that does not rise is not a question. A lighter weight is recorded as `WEIGHT_APPROVED`; a replacement at no extra cost on an `ALLOW_SAME_STORE` line as `SUBSTITUTION_APPROVED` under that rule. Both are recorded as decisions answered `APPROVED` at once, the difference comes off the authorisation, the event says why (`LIGHTER_WEIGHT_RECORDED`, `CUSTOMER_RULE_ALLOW_SAME_STORE`), and the customer is told (the sync now carries shop-made `SUBSTITUTION_APPROVED` / `WEIGHT_APPROVED`; the inbox has the sentences). A dearer replacement on the same rule, or any dearer weight, still asks.

**P52-02 — what the question is about.** `CustomerDecision` (`listPendingCustomerDecisions`, the contract, the card): the item as ordered and the item offered with titles, quantities, prices and totals, the difference, the reason, the deadline, the store and the order. The event carries its `decision_id` (0096), so `syncDomainSignals` builds the notice's payload from the history — `ordered_title … decision_deadline_at` — and the inbox sentence names the change ("Product A (1) → Product B (1), +₹30").

**P52-03 — the configured deadline.** `decisionDeadlineSeconds` resolves `customer.decision_seconds` (SETTING, 60–3600) for every proposal that does not name its own; the walk activates 120 and reads it back on the deadline.

**P52-04 — the capture that came too soon.** `settleAuthorizationForOrder` waited only for no order to be `PLACED`; the worker ran it on every acceptance. `answerDecision`'s adjustment requires an `AUTHORIZED` payment, so in the running system every approved dearer replacement was a 409 (the ladder never ran the worker, so it never saw it). The orchestrator now waits while any order is `PLACED`, `ACCEPTED`, `PICKING` or awaiting a decision; `markReady` publishes `vendor_order.ready`, which the worker settles on beside `accepted` and `ended`. The adjustment itself is one routine, `adjustAuthorizationForOrder` (payment and allocation by the delta, one append-only adjustment, replay-safe), used by the customer's approval, the rule-applied changes, and — new — `markReady`, which takes what is not in the bag (a missing line, a refused proposal, a short found line; an approved change already moved its own delta) off the authorisation in one `LINES_NOT_SUPPLIED` adjustment (0096; implementation.md 6.2.4's capture plan). An order with nothing in the bag is refused ready: that is an ending, not a package.

**Mutation results.** Nine probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Every proposal asks (old) | *A cheaper replacement under the customer's own rule was not applied (PENDING, PROPOSED_SUBSTITUTION)* |
| `ALLOW_SAME_STORE` applies a dearer replacement too | *A dearer replacement was applied without asking (APPROVED)* |
| Settled once no order is PLACED (old) | *The group authorization was settled as CAPTURED while an order was still being packed* |
| No shortfall at ready (old) | *Ready did not take the lines not in the bag off the authorisation ([{"amount":"88500","item":"87000","adjustments":null}])* |
| Empty bag allowed ready | *An order with every line missing was marked ready* |
| Configured deadline ignored (old) | *… not put to the customer with the configured deadline (PENDING, …:41Z)* |
| Offered title always the ordered one | *The customer is not told what they are deciding on* |
| Notice payload without the detail (old) | *The customer's notice does not carry the old item, the new one, the amount and the deadline ({"event":"SUBSTITUTION_PROPOSED"})* |
| Event without its decision id | same |

**Forward findings.** (8.5) The vendor console's decision tracking shows pick states; a rule-applied change reads as "approved" with nothing saying the customer was not asked. (8.6/8.7) The customer's receipt lists refunds after capture but not the pre-capture adjustments; `payment_authorization_adjustments` per order should appear on it, or the total shown should be the allocation. (8.4/8.5, carried) An approved replacement reserves no stock for the replacement variant; a short found line keeps its whole reservation. (8.5) There is no vendor cancellation after acceptance: an order the shop cannot fill at all after accepting has only the customer's cancellation or support.

**Verification.** `pnpm db:verify` exit 0 — 97 migration files (0000–0096), full ladder; `vendor_fulfilment` 231 assertions (215 after run 51). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 565 pass / 0 fail; `pnpm test:integration` exit 0.

**Step 8.4: VERIFIED_LOCAL**, with the forward findings carried.

## Run 53 (21 September 2026) — step 8.5, package and ready state

Five requirements. Two held (every line and decision resolved — `PICKING_INCOMPLETE`, the pending-proposal block and run 52's empty bag; ready once, by the state gate), one held in part (the customer is told of `READY`; the delivery attempt exists from placement), and two did not: the package's condition and handling needs were not recorded, and no promise was ever made. Migration 0097; eight connected assertions; six mutation probes, all caught.

| # | Requirement | Finding |
|---|---|---|
| 1 | All lines and decisions resolve | Met (runs 41, 51, 52). |
| 2 | Record package count, condition, handling needs | **Count only.** The condition note was accepted by the domain and the API and sent by no screen; handling needs had no column, no field and no route — P53-01. |
| 3 | Server timestamp and applicable pickup/delivery promise | **Timestamp only.** `pickup_promise_at` existed since 0026, was an optional input the API never passed, and was null on every order ever readied — P53-02. |
| 4 | Notify customer or begin delivery assignment | Met in substance: `READY` reaches the customer through the history sync; the attempt is created at placement and offered from acceptance. But the attempt carried a package count guessed from the line count, which `confirmPickup` then required the partner to type back exactly: a three-line order packed as one bag could not be handed over — P53-03. |
| 5 | Prevent duplicate ready transitions | Met by the state gate; now walked: a second ready is refused for its state and the first timestamp and count stand. |

**P53-01 — the package.** 0097 adds `vendor_orders.handling_flags` (a fixed vocabulary, `HANDLING_FLAGS`); `markReady` takes `handling_flags` (deduplicated, vocabulary-checked at 400), the route takes them, and the console's ready control has the six as checkboxes and a condition field beside the count. The `READY` event's note carries the count, the needs and the condition.

**P53-02 — the promise.** Made on the server at ready: a collected order is ready from `ready_at`; a delivered one should arrive at `ready_at` plus the `route_seconds` the quote was priced on (null for a delivery whose quote carried no route). Read as `promise_at` on the vendor summary and the customer's order list; the customer's card says "Ready to collect since …" or "Expected around …" (0097 keys).

**P53-03 — the count the partner had to guess.** Ready now writes the shop's `package_count` and `handling_flags` onto the order's live delivery attempt (`UNASSIGNED` … `AT_VENDOR`) — as packaging facts, without a version bump, so a partner's open offer is not made stale by the shop finishing its packing. The partner's job card and offer say the needs ("Handle with care: fragile, keep cold"). The walk creates the attempt with a guessed 3 before ready and reads 1 with the needs after, at the same version.

**Mutation results.** Six probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| No promise (old) | *Ready did not record the package, its needs and the promise ({… "promise_at":null,"route_seconds":103})* |
| The attempt not told (old) | *The delivery attempt was not told the shop's count and needs, or was made stale ([{"package_count":3,"handling_flags":[],"version":1}])* |
| Unknown handling needs dropped silently | *A handling need outside the vocabulary was recorded* |
| READY re-enterable | *A second ready was not refused, or changed the order (null, v5)* |
| The attempt's version bumped | *… or was made stale ([{… "version":2}])* |
| Promise not carried to the customer's list | *The customer's order list does not carry the promise* |

**Forward findings.** (9.x) The attempt is offered from acceptance, before the bag is ready; the wait policy compensates the partner for the gap. Whether offers should wait for ready is an owner decision. (8.6) `confirmPickup` compares the partner's typed count with the attempt's; with the shop's count on the attempt that now works, but a partner handed a different number of bags than the shop recorded still cannot proceed except by typing the shop's number. (carried) The console does not say a change was applied without asking; no vendor cancellation after acceptance; the receipt omits pre-capture adjustments.

**Verification.** `pnpm db:verify` exit 0 — 98 migration files (0000–0097), full ladder; `vendor_fulfilment` 237 assertions (231 after run 52). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 565 pass / 0 fail; `pnpm test:integration` exit 0.

**Step 8.5: VERIFIED_LOCAL**, with the forward findings carried.

## Run 54 (21 September 2026) — step 8.6, customer pickup

Five requirements. Four held in their mechanism — a 15-minute code that rotates; actor, order, location, state, attempt, expiry and replay checks with each failed attempt committed on its own; completion once by the state gate and the 0026 shape constraint; capture (at ready, since run 52), settlement and the customer's `PICKED_UP` notice on the outbox — but two of them had never been walked (the attempt limit and expiry), the code was stored as the plain SHA-256 of six digits (run 47's forward finding), and the "proof" was the shop's free-text note. No migration; nine connected assertions; five mutation probes, all caught.

| # | Requirement | Finding |
|---|---|---|
| 1 | Time-limited pickup OTP | Met, and now walked: expiry at issue + 15 minutes. **Stored unkeyed** — P54-01. |
| 2 | Validate actor, order, state, attempts, expiry, replay | Met in code; attempts and expiry had no proof. Now: five wrong codes count, the sixth — the right one — is refused; an expired right code is refused without counting; a fresh code counts afresh; a completed order refuses the same code again with nothing moved. |
| 3 | Server-confirmed pickup proof | **The note stood alone.** `picked_up_at` and the reason were the server's, but the event's note was whatever the shop typed — P54-02. |
| 4 | Complete fulfilment and order once | Met (state gate; `vendor_order_pickup_completes_once`); now walked with the replay leaving one `PICKED_UP` record and the version unmoved. |
| 5 | Capture/ledger/receipt events | Met: `vendor_order.picked_up` on the outbox drives inventory settlement (a backstop since run 50) and, for a collected order, the settlement lines; capture happened at ready (run 52); the notice reaches the customer through the history sync. The receipt is 8.7's. |

**P54-01 — the code that was its own hash.** `handover-code.ts`: `handoverCodeDigest(hashKey, code)` is HMAC-SHA-256 under a key derived from the material with the label `handover-code` (so it is not the sign-in OTP key), and `handoverDigestsMatch` compares in constant time. Both services that mint or check a code — `VendorFulfilmentService` (collection and self-delivery codes) and `AssignmentCustodyService` (the partner's delivery code) — take `hash_key`; the API passes its `otpHashKey`; the worker passes none and never needs to. A code issued before this deploy will not validate after it (its life is fifteen minutes; re-issue). The walk pins that the stored digest is neither the plain SHA-256 of the code nor another key's.

**P54-02 — the proof.** The `PICKED_UP` event's note is written by the server: `Code validated at <time>, issued by CUSTOMER | PARTNER | VENDOR_FALLBACK`, and only then the shop's note. Support reads which code was validated, not just that the shop said it handed the bag over.

**Mutation results.** Five probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| No attempt limit | *The right code was accepted after 5 wrong ones* |
| No expiry check | *An expired collection code was accepted* |
| The shop's note as the proof (old) | *The handover proof is not the server's ([{… "note":"Handed to the customer."}])* |
| A fresh code keeps the old count | *A fresh code did not reset the attempt count* |
| Plain SHA-256 (old) | *The collection code is stored as an unkeyed digest* — after the walk was told to check the digest against the plain hash and another key; its first form let this one through |

**Forward findings.** (8.7) The receipt still shows the ordered total and the refunds, not the pre-capture adjustments (carried). (9.x) `confirmPickup` compares the partner's typed package count with the attempt's (carried). (carried) The console does not say a change was applied without asking; no vendor cancellation after acceptance.

**Verification.** `pnpm db:verify` exit 0 — 98 migration files (0000–0097), full ladder; `vendor_fulfilment` 253 assertions (237 after run 53). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 565 pass / 0 fail; `pnpm test:integration` exit 0.

**Step 8.6: VERIFIED_LOCAL**, with the forward findings carried.

## Run 55 (21 September 2026) — step 8.7, order history, receipt, reorder, rating and support entry

Five requirements. Two held (the grouped history with the derived summary since run 47; rating once, on a completed order, by its owner), one held in its mechanism (reorder re-adds the lines and the cart and quote revalidate) but lost each line's rule, and two did not: the receipt was the order as placed, not as supplied or charged, and a support case was a free category on the whole order with no deadline and no case event. Migration 0098; ten connected assertions, one unit test; six mutation probes, all caught. Run 52's forward finding (the receipt omits pre-capture adjustments) is closed here.

| # | Requirement | Finding |
|---|---|---|
| 1 | Completed and failed child orders under their group | Met (run 47's derivation; the walk reads all three summaries). |
| 2 | Itemized vendor-scoped receipt | **The order as placed.** The lines at ordered quantity and price under the ordered total, whatever the bag held and whatever was charged — P55-01. |
| 3 | Recreate a basket with current revalidation | Met in mechanism; every re-added line was given `ASK_CUSTOMER`, losing the rule the customer chose — fixed with the receipt. |
| 4 | Eligible vendor rating/review | Met: completed orders only, once, by the owner; now also walked for a placed order (refused). |
| 5 | Structured support case on the smallest affected object | **Neither structured nor smallest.** Any shouting-snake-case category; no line; no severity or deadline for the operations queue to rank by; no `support_case_events` row, unlike a case the control plane opens — P55-02. |

**P55-01 — the receipt.** `getReceipt` returns each line as ordered and as supplied — `pick_state`, the actual quantity and price, the replacement's title when one was approved, `supplied_quantity` (zero for a missing or refused line) and `supplied_total_minor` — with the line's `substitution_preference`; the pre-capture adjustments with their kind and, for a decision, its reason; the refunds after capture; and `charged`: the order's payment allocation, item by item, which is what capture takes. The customer's receipt sheet says "not supplied, not charged", "replaced with …", "3/4", itemises the adjustments, and shows **Charged** as the allocation. Reorder rebuilds the basket under each line's own rule. The walk reads order C's receipt: six lines (two replaced, three refused, one weighed), the supplied sum equal to the items allocation, four adjustments, the charged total equal to the authorisation as it stood.

**P55-02 — the case.** `CUSTOMER_SUPPORT_CATEGORIES` is the vocabulary (400 otherwise); the case may name a `vendor_order_line_id` of its own order (0098; another order's is concealed), is opened at severity `MEDIUM` with `response_due_at` from `support.p2_staffed_ack_seconds` (four staffed hours by default, implementation.md 6.1) and its own `OPENED` event, the way `createSupportCase` in the control plane opens one; the store's case list names the item. The customer's sheet offers "Which item?" from the receipt.

**Mutation results.** Six probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Supplied figures ignore the pick state (old) | *The receipt does not say what the bag held … ([["SUBSTITUTION_REJECTED",15000] …])* |
| Charged is the ordered total (old) | same check, on `charged.total_minor` |
| Any category (old) | *A category outside the customer list opened a case* |
| The named line not checked against the order | *A case named another order's line* |
| No OPENED case event (old) | *The customer's case is not structured … "events":null* |
| The replacement's title dropped | *The receipt does not say what the bag held …* |

**Phase 8 exit gate.** One-store prepaid pickup completes exactly once end to end: the collection walk (order P: accept, pick, ready, the customer's code, the vendor fallback, completion once, settlement). Vendor timeout (order T), decline (B), substitution approve (C line 1) / reject (C line 5) / timeout (C line 3, weight), variable weight (heavier asked and refused, lighter recorded), cancellation (X, after acceptance), OTP failure and replay (P), support (A, with its line) and refund input paths (the money walk's proposed refund) pass in the fulfilment verifier. **Met.**

**Forward findings.** (9.x) `confirmPickup` compares the partner's typed package count with the attempt's; offers go out from acceptance rather than ready (owner decision). (11.3) The customer's own case view (`getCustomerSupportCase`) does not yet show the line. (carried) The console does not say a change was applied without asking; no vendor cancellation after acceptance.

**Verification.** `pnpm db:verify` exit 0 — 99 migration files (0000–0098), full ladder; `vendor_fulfilment` 259 assertions (253 after run 54). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 566 pass / 0 fail; `pnpm test:integration` exit 0.

**Step 8.7: VERIFIED_LOCAL. Phase 8 exit gate: met.**

## Run 56 (21 September 2026) — step 9.1, partner onboarding and eligibility

Five requirements. One held (the seven references are collected and reviewed through a versioned, append-only application lifecycle whose approval grants the role and eligibility — runs 4–5's work), one held in part (an appeal is offered on every restriction in force; custody is never touched, which was true by omission), and three did not: no document could expire and nothing was ever reverified, going online failed with a bare "not eligible", and a trust restriction restricted nothing. Migration 0099; twenty-three connected assertions, one API unit test; eight mutation probes, all caught. DLP-04's matrix claim ("document and insurance warnings are shown … with what it stops") was copy nothing emitted, and is corrected.

| # | Requirement | Finding |
|---|---|---|
| 1 | Collect identity, vehicle, bank, insurance, zone, emergency contact, training | Met (references, synthetic); the three that expire now carry their dates — P56-01. Training is one reference (DLP-05 stays partial). |
| 2 | Review documents with expiry and reverification lifecycle | **Absent.** No expiry on any document, no renewal, no sweep; the partner's profile had sentences for "a document has expired" that no code emitted — P56-01. |
| 3 | Show exact online eligibility blockers | **Absent.** `set(ONLINE)` failed with "Partner is not eligible" as a bare state conflict; nothing listed why — P56-02. |
| 4 | Apply capability-specific restrictions | **Absent.** A trust restriction case on a partner was listed on their profile and consulted nowhere: going online and dispatch both ignored it — P56-03. |
| 5 | Preserve appeal and active-custody obligations | Met: `appealable` on every case in force; custody actions check the assignment, never eligibility. Now walked: a lapse and a restriction leave a delivery in custody untouched. |

**P56-01 — documents that expire.** 0099 adds `identity_expires_at`, `vehicle_expires_at` and `insurance_expires_at` to the application (required and future-dated at creation) and `partner_document_renewals` (one in review per document; a new reference and expiry; reviewed with a reason). `documentStanding` reads each document as VALID, EXPIRING (30 days), EXPIRED or UNDATED. The worker's `sweepExpiredDocuments` restricts a partner whose document has lapsed — eligibility `RESTRICTED`, reason `DOCUMENT_EXPIRED`, a `DOCUMENT_EXPIRED` event naming the documents — and dispatch reads the lapse directly, so a partner still ONLINE from before is not offered work even before the sweep. A renewal rejected leaves the restriction; approved, it writes the document onto the application and lifts the restriction only when nothing else has lapsed (two lapsed, one renewed: still restricted). The partner's profile lists the documents and takes a renewal; the admin console has the review queue.

**P56-02 — the exact blockers.** `onlineEligibility` returns `can_go_online`, the blockers by code and detail — `NO_APPLICATION`, `APPLICATION_NOT_APPROVED` (state), `DOCUMENT_EXPIRED` (document), `ELIGIBILITY_RESTRICTED` / `SUSPENDED` / `PENDING` (reason), `RESTRICTION_ACTIVE` (scope and reason), `OFFLINE_PROOF_PENDING` — and the warnings (`DOCUMENT_EXPIRING`). `PartnerAvailabilityService.set(ONLINE)` refuses for the same reasons with the new code `PARTNER_NOT_ELIGIBLE`, whose sentence sends the partner to the profile that names them.

**P56-03 — restrictions that restrict.** `eligible()` excludes a partner under an ACTIVE restriction that is `GLOBAL`, `VENDOR_LOCATION` for that store, or `ZONE` for a store whose active service zone carries that name; `set(ONLINE)` refuses under `GLOBAL`. A store-scoped restriction leaves the partner online and offered elsewhere.

**Mutation results.** Eight probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Insurance dropped from the sweep | *The sweep did not restrict the partner once, for the lapsed insurance (0/0)* |
| Eligibility restored while another document is lapsed | *Renewing one of two lapsed documents lifted the restriction* — after the two-document walk was written; the first form let this through |
| A rejection writes the document too | *A rejected renewal lifted the restriction* |
| GLOBAL restriction not checked at going online | *A GLOBAL restriction did not keep the partner off the road and off offers* |
| VENDOR_LOCATION scope ignores the store | *A store-scoped restriction did not apply to that store alone* |
| Dispatch ignores a lapse before the sweep | *A partner with a lapsed document was still offered work* — after the walk kept the partner present; the first form let this through |
| Past expiries accepted at application | *An application was accepted with a document that had already expired* |
| A decided renewal decided again | *A decided renewal was decided again* |

**Forward findings.** (11.4) A `ZONE` restriction matches a store's service zone by name; the platform has no zone identity of its own for partners (`home_zone_name` is free text). (9.1, carried) Training is one reference, not a per-module checklist (DLP-05). (9.2) An application made before 0099 has undated documents (`UNDATED`); nothing yet asks such a partner for the dates.

**Verification.** `pnpm db:verify` exit 0 — 100 migration files (0000–0099), full ladder; `partner_lifecycle` 73 assertions (47 after run 25). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 567 pass / 0 fail. `pnpm test:integration` exit 0 — after a finding of its own: the worker's liveness row stamped `started_at` from the process clock and `last_seen_at` from the database's, and its check (`last_seen_at >= started_at`) refused the first heartbeat whenever the database ran behind the worker; on a container clock that had drifted during host sleep, readiness saw no consumer for a worker that was running. Both instants are the database's now (`worker-lifecycle.service.ts`).

**Step 9.1: VERIFIED_LOCAL**, with the forward findings carried.

## Run 57 (21 September 2026) — step 9.2, availability and offer eligibility

Five requirements. Two held (online/offline/paused with a server-side session and presence; a partner on active work is excluded at offer and refused at accept — batch 9's dispatch work), and three did not hold as written: eligibility looked at zone (by restriction, since run 56), document, presence and eligibility but not at the vehicle, the account or incident controls, and its radius was a constant; presence kept the last online position after going offline; and the day's trips and earnings were counted in the database's date. No migration; sixteen connected assertions, one unit test; seven mutation probes, all caught.

| # | Requirement | Finding |
|---|---|---|
| 1 | Online/offline and active-zone state | Online/offline/paused met. **No active-zone state:** the application's home zone was the only zone the platform knew for a partner — P57-03. |
| 2 | Select eligible by zone, vehicle, document, account, capacity, incident controls | Zone (restriction), document and capacity met; **vehicle, account and incident controls were not looked at, and the radius was a constant** — P57-01. |
| 3 | Exclude partners with active work | Met: `eligible()` skips an ACTIVE assignment membership; `accept` refuses a second (unique). |
| 4 | Privacy-safe location/presence | Distance only to dispatch, no coordinates on events — but **the last online position was kept after going offline**, against the app's own disclosure — P57-02. |
| 5 | Daily trips, earnings, online time, device guidance | Trips and earnings **in the database's date**, not the partner's day; **no online time today**; device warnings met — P57-03. |

**P57-01 — who is offered.** `eligible()` takes the attempt's `package_count` and `handling_flags` (dispatch passes them) and passes over a bicycle for a HEAVY package or more than `BICYCLE_PACKAGE_LIMIT` (3) packages — the smallest honest vehicle rule, the exact algorithm being out of scope for the MVP (PRD); joins `users.state='ACTIVE'`; reads the radius from `dispatch.offer_radius_metres` (a SETTING, 100–50000 m, default 5000) unless the caller names one; and returns nobody while an ACTIVE `DELIVERY_PAUSE`, `PARTNER_ASSIGNMENT_PAUSE` or `ZONE_PAUSE` incident control reaches the store (global, the store, or its service zone by name). Found beside it: the service accepted any reference-looking string for the seven application references and let the schema's `SYNTH-PARTNER-…` shapes refuse it as a 500; the patterns now match the schema, and a renewal's reference is checked by its document's shape.

**P57-02 — presence.** Going offline clears the position and its accuracy; the summary no longer returns the raw geography.

**P57-03 — the partner's day, and the active zone.** `summary()` counts trips and earnings in `PARTNER_DAY_TIMEZONE` (Asia/Kolkata): a delivery at 23:30 IST is that day's, one at 00:30 IST the next day's — as `::date` in the session's UTC did not (and, bound as a JavaScript date, depended on the host's own time zone, which happens to be IST on the laptop and UTC in the container). It adds `online_seconds_today` from the availability history's ONLINE spans plus the session in progress, and `active_zones`: the names of the active service zones whose boundary holds the position — the active-zone state, and as much of the position as the summary says. The partner's screens show online time and the zone.

**Mutation results.** Seven probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Incident controls ignored (old) | *A paused delivery network still offered work … (1/1)* |
| Vehicle ignored (old) | *A bicycle was offered a load it cannot carry, or refused one it can* |
| Constant radius (old) | *The configured offer radius was not applied* |
| Account state ignored (old) | *A disabled account was still offered work* |
| Position kept after offline (old) | *Going offline left the last position on record* |
| The database's date (old) | *A delivery just after midnight IST was not counted in its day (1)* — after the after-midnight case was written; on this IST laptop the first form let it through |
| Live session not counted | *The summary does not name the active zone with today's online time ({… "online":0})* |

**Environment note.** The laptop was on battery with the lid closed for this run, cycling maintenance sleep between commands; the container VM's clock stalls during each nap and fell minutes behind the host, so a fixture's `valid_from` (host clock) sat in the database's future and membership checks against `now()` failed mid-ladder. Keeping the VM clock in step every fifteen seconds was not enough. The ladder's evidence for this run is CI's: the `Mandatory quality gate` on the branch at `6677f52` (run 35598344878) executed `pnpm db:verify`, the unit and the integration suites on a clean runner and passed.

**Forward findings.** (9.3) A partner with an open offer can be offered a second attempt; the second accept is refused, the second offer lapses. (11.7) Incident controls are read by dispatch now; whether checkout, vendor and payout paths read theirs is 11.7's audit. (carried) `ZONE` scopes match service zones by name.

**Verification.** `pnpm db:verify` exit 0 on CI (run 35598344878) — 100 migration files (0000–0099), full ladder; `partner_availability` 25 assertions (14 after batch 9). Locally: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 568 pass / 0 fail; `pnpm test:integration` exit 0; the availability module's own walk and all seven probes on a rebuilt database.

**Step 9.2: VERIFIED_LOCAL**, with the forward findings carried.

## Run 58 (21 September 2026) — step 9.3, immutable offer attempts

Five requirements. Three held in substance (one offered attempt with expiry; atomic acceptance; decline and expiry closed by events, not deletion) and two did not: the offer stated pay, areas, road and constraints but not when to be at the store or on what waiting terms, and "manual reassignment" ended the attempt and stranded the order with nothing owed to anybody. The offer window was also a hard-coded five minutes where the phase says thirty seconds, and the 9.2 forward finding stood: a partner holding a live offer could be offered a second attempt. One migration (0100); twenty connected assertions across three modules, three unit tests; eight mutation probes, seven caught and one survived on a second guard.

| # | Requirement | Finding |
|---|---|---|
| 1 | One offered attempt with expiry | One partner per attempt held; **the window was `5 * 60_000` in the dispatcher**, not a setting, and **a partner with an open offer could be offered another** — P58-01. |
| 2 | Show pay, areas, distance/time, pickup deadline, wait/return policy, constraints | Pay, areas, road with travel time (D-17) and handling met; **no ready time or pickup promise, no waiting terms** — P58-02. |
| 3 | Accept atomically | Met: row lock, version, state, partner and expiry checks, one ACTIVE membership by unique index. Now verified under a forced concurrent arrival. |
| 4 | Close decline/expiry without deleting | Met: `DECLINED` and `OFFER_EXPIRED` events name the partner; `returnToPool` reopens the attempt; `offerHistory` keeps decliners off it. |
| 5 | Manual reassignment with reason and compensation history | **Not met:** `endBeforePickup('REASSIGNED')` set a terminal state and nothing re-offered the order; no compensation existed anywhere — P58-03. |

**P58-01 — the window, and one offer at a time.** `DeliveryDispatchOrchestrator.offerSeconds` reads `assignment.offer_seconds` (a SETTING, 5–300, default `DEFAULT_OFFER_SECONDS` = 30) and `offerReadyAssignments` cuts each offer to it. `PartnerAvailabilityService.eligible` passes over a partner whose current offer has not lapsed, so two offers cannot race to the same rider. The admin console's manual offer keeps its own five-minute window: that one is the operator's choice, not the dispatcher's.

**P58-02 — an honest offer.** `listOffersForPartner` carries `expected_ready_at` (the order's `ready_at`, or its acceptance plus its preparation estimate), `promise_at` (`pickup_promise_at`) and `wait_policy` (included seconds, per-completed-minute rate and cap from the financial policy). The partner's offer card says "Ready to collect in about N min" and "first 5 min waiting included, then ₹1.00/min up to ₹10.00" beside the pay and the road.

**P58-03 — reassignment with a record.** 0100 adds `marketplace.partner_attempt_compensations` (append-only: the attempt, the partner displaced, who decided, the state displaced from, the amount 0–100000 minor, reason, note). `AssignmentCustodyService.reassign` (admin only; OFFERED, ASSIGNED or AT_VENDOR with a partner and no custody; replay-safe) ends the membership, writes the compensation row, appends a `REASSIGNED` event naming the displaced partner, and returns the row to `UNASSIGNED` with no partner and no expiry, so the next dispatch tick re-offers it — `offerHistory` now counts an admin's `REASSIGNED` as that partner's decline, so not to them. The API's `end-before-pickup` routes `resulting_state: 'REASSIGNED'` to it with `compensation_minor` and an optional note; `GET partner/compensations` (`partner.earnings.read`) gives the partner their own record, and the earnings panel lists it under "Compensation for reassigned work". The admin console gains "Take off this partner and re-offer" on offered, accepted and at-store attempts, asking the compensation and the reason.

**Mutation results.** Eight probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Compensation row not written | *Reassignment did not record who was displaced, from what, and what they are owed (undefined)* |
| `REASSIGNED` ignored by `offerHistory` | *A partner an operator displaced could be offered the same attempt again* |
| Dispatcher uses the constant, not the setting | *The configured offer window was not honoured* |
| Membership not ended on reassignment | *… ("memberships":"1", …)* |
| Reassignment allowed from PICKED_UP | *An attempt in custody was reassigned away from its partner* |
| Open offer not excluded from eligibility | *A partner with a live offer was offered a second attempt … (1/1)* |
| `expected_ready_at` dropped from the offer | *The offer does not state the ready time and waiting terms* |
| Row lock removed from `lockAssignment` | **Survived**: with the lock gone both accepts read the same version and the second is refused by the unique ACTIVE-membership index instead (*Partner already has active work*). The outcome the walk asserts — one winner, one ACCEPTED event, one membership — holds on the second guard; the lock is what makes the loser's answer "stale" rather than "busy". Kept, recorded. |

**Environment note.** The laptop was awake and on power; the container VM's clock matched the host to the second, and the ladder ran locally. The first `pnpm test:integration` failed on the worker smoke's queue canary because the last probe's fulfilment walk had left outbox events for truncated orders on the test database (the worker retried `order.placed` for a vendor order that no longer existed and never reached the canary); on a rebuilt test stack it passed. Probe runs leave the test stack up; the suites need it fresh.

**Forward findings.** (9.5) The wait policy is shown on the offer and applied at settlement; the live wait timer's own thresholds and choices are 9.5's audit. (9.4) The admin's manual offer window is five minutes by console choice. (carried) `ZONE` scopes match service zones by name; branch protection off.

**Verification.** `pnpm db:verify` exit 0 locally — 101 migration files (0000–0100), full ladder; `assignment_custody` 26 assertions (15 before), `vendor_fulfilment` 264 (259), `partner_availability` 26 (25). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 571 pass / 0 fail (568 before: the partner PWA's offer sentences and the API's compensation capability and reassignment routing); `pnpm test:integration` exit 0 on a rebuilt test stack; all eight probes on a rebuilt database.

**Step 9.3: VERIFIED_LOCAL**, with the forward findings carried.

## Run 59 (21 September 2026) — step 9.4, active-job navigation and arrival

Five requirements. Two held (the resume control; support and emergency controls on the job) and three did not: nothing was cached, so a reload or an unreachable API left the partner with "Dispatch could not be loaded" and no job; heading to the store the partner had the store's *area* and a map link to `geo:0,0`, no address, no landmark, no coordinates; and "trusted arrival" was the partner's word — `arrive-vendor` from anywhere moved the attempt to `AT_VENDOR`, which is what starts the wait timer and its pay. One migration (0101); twelve connected assertions in the custody module, one in fulfilment, four unit tests; six mutation probes, all caught.

| # | Requirement | Finding |
|---|---|---|
| 1 | Cache the active assignment and last server-confirmed state | **Not met:** React state only; a failed load showed nothing — P59-01. |
| 2 | Resume-active-job control | Met: the "Resume" dock returns to `/active` from anywhere (DLP-20). With nothing loaded it had nothing to resume — closed by P59-01. |
| 3 | Vendor address plus map and text/landmark fallback | **Not met:** no address or landmark existed on a store; the map handoff had no point — P59-02. |
| 4 | Record trusted arrival or approved fallback | **Not met:** the partner's word, from anywhere — P59-03. |
| 5 | Keep support and emergency controls available | Met: the field-ops panel and the Emergency control sit on the job; an open safety report holds it (DLP-43). |

**P59-01 — the last confirmed picture.** `active-job-cache.ts` keeps the assignments the server last confirmed with the time; the workspace writes it on every successful refresh, reads it when the first load fails, shows the job with "Showing the job as the server last confirmed it, N minutes ago. Reconnect to take the next step." and a retry, and forgets it on sign-out. Commands still carry their version, so acting on a stale picture is refused, not doubled.

**P59-02 — the store, in words.** 0101 gives `vendor_locations` a `landmark` (2–120 characters; the vendor's settings form has the field). Between acceptance and pickup the partner's record carries `pickup_location` — name, landmark, description, point — gated in the query by state like the customer's address is; an offer has the area only, and custody has the customer's leg only. The job card shows "Collect from", the landmark, a written direction from the phone's last fix ("About 300 m to the east"), and the map handoff opens on the store's coordinates.

**P59-03 — trusted or confirmed.** `arriveAtVendor` takes the device's fix and measures it against the store in PostGIS. Within `assignment.arrival_radius_metres` (SETTING, 25–1000, default 150) with accuracy ≤ 100 m: `AT_VENDOR`, `arrival_kind = TRUSTED_LOCATION`, the distance recorded, reason `TRUSTED_VENDOR_ARRIVAL`. Otherwise an `ARRIVAL_CLAIMED` event with its reason (`NO_LOCATION` / `POOR_ACCURACY` / `OUT_OF_RANGE`), the attempt still `ASSIGNED` with the claim on it; the partner is told the store has to confirm and can retry with location. The vendor's order card shows the claim and "The rider is here" posts `confirm-partner-arrival` — staff of that store only, for a claimed arrival only — recording `VENDOR_CONFIRMED` under the vendor actor. The schema says it too: `AT_VENDOR` now requires an `arrival_kind` (NOT VALID, so rows that arrived on their word before this run stand). Pickup and the vendor handover already required `AT_VENDOR`, so a claim cannot be handed the order. The Android shell has no device fix, so its arrivals are claims — said in its own message.

**Mutation results.** Six probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Any fix, or none, is an arrival (old) | *An arrival with no fix was not recorded as a claim (… "AT_VENDOR" …)* |
| Accuracy not looked at | *A 400 m fix at the store was taken as presence* |
| The constant radius, not the setting | *The configured arrival radius was not applied* |
| Any store's staff confirms | *Staff of another store confirmed an arrival at this one* |
| Store location kept into custody | *The store stayed on the record after the goods left it* |
| A claim moves to AT_VENDOR anyway | *An arrival with no fix was not recorded as a claim* |

**Forward findings.** (9.5) The wait timer starts on `AT_VENDOR`, which is now verified presence; its own thresholds, the vendor's delay reason and the revised estimate are 9.5's audit. (9.6) `arriveAtCustomer` is still the partner's word; DLP-29's "permitted location and fallback process" is 9.6's. (Android) No device geolocation in the shell: arrivals are claims. (carried) `ZONE` scopes by name; branch protection off.

**Verification.** `pnpm db:verify` exit 0 locally — 102 migration files (0000–0101), full ladder; `assignment_custody` 38 assertions (26 before), `vendor_fulfilment` 265 (264). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 575 pass / 0 fail (571 before: the cache and direction helpers, the workspace's source checks, the arrive route's fix, the confirm route's scope); `pnpm test:integration` exit 0 on a rebuilt test stack; all six probes on a rebuilt database.

**Step 9.4: VERIFIED_LOCAL**, with the forward findings carried.

## Run 60 (21 September 2026) — step 9.5, waiting and pickup proof

Five requirements. Two held (the pickup code is validated against the vendor, the order and the assignment; custody begins only after the server has the vendor's handover) and three did not: the wait timer was the partner's to remember to start, nothing ever closed it, and the waiting pay it counted on the screen was never carried into any earning or settlement (`partner_wait_minor: 0` with a comment saying so); the leave the app offered at the store was refused every time, because the only leave path was the customer's door; and the store had no way to say it was running late, so no "revised estimate" existed anywhere. One migration (0102); nineteen connected assertions across three modules, six unit tests; eight mutation probes, all caught.

| # | Requirement | Finding |
|---|---|---|
| 1 | Start server wait timer at valid arrival | **Not met:** started by the partner's button, not by the arrival; parameters hard-coded (`300,600,3600,100`) against a policy that says cap ₹10; never closed — P60-01. |
| 2 | Show thresholds, compensation, revised estimate, wait/leave/reassign/support choices | Thresholds and pay shown, **but the pay was never paid, the screen rounded up where the ledger rounds down, no revised estimate existed, and "leave" at the store was refused** — P60-01, P60-02, P60-03. |
| 3 | Validate QR/OTP and vendor/order/assignment | Met (8.6, run 55): the partner's code is minted on their assignment, stored as a keyed digest on the order, validated by the store at `complete-pickup` with `PARTNER_NOT_PRESENT` until `AT_VENDOR`. |
| 4 | Agree package count, condition, and handling | Met: the store's count and handling needs are on the attempt (run 53); the partner's `confirmPickup` must match the count and confirm with the store; a damaged or missing package is a field report. |
| 5 | Begin custody only after server confirmation | Met: `confirmPickup` requires the order `PICKED_UP` (the vendor's validated handover) before custody; the client shows server state. |

**P60-01 — the wait is the server's.** `wait-timer.ts` holds the arithmetic and the two writes: `openWaitTimer` at a trusted or confirmed arrival (same transaction), under `resolveFinancialPolicy` at that instant — included seconds as the first threshold, the rate, `max_credit_seconds` carrying the cap as time — with the leave threshold from `assignment.wait_leave_seconds` (SETTING, default 600); `closeWaitTimer` at the handover (`RESOLVED`) writing `partner_wait_earning_adjustments` with the elapsed seconds and `waitCreditMinor` (completed minutes past the included, at the rate, to the cap). The settlement reads that row into the earning's `wait_minor`, the `PARTNER / WAIT` line and the net, capped by the order's own policy. `credit_minor` on the wait read is the same function, so the partner's screen and the ledger agree; the screen's `Math.ceil` is gone. One wait per partner per attempt (0102 replaces the per-attempt unique keys), because an attempt is re-offered after a leave.

**P60-02 — leaving the store.** `AssignmentCustodyService.leaveStoreAfterWait`: at `THRESHOLD_TWO`, the wait closes `LEFT_POLICY` with its pay on record, the membership ends, a `LEFT_AFTER_WAIT` event names the partner, the attempt returns to `UNASSIGNED` with its arrival cleared, and `offerHistory` keeps that partner off it. Before the threshold: refused. The API's `wait/leave` reads where the partner is and routes to this at the store or to `PartnerWaitPolicyService.leave` at the door (DLP-38, unchanged). The card says what leaving does.

**P60-03 — the store says it is late.** `VendorFulfilmentService.reportDelay` (ACCEPTED/PICKING; 1 min–2 h; a reason from `DELAY_REASONS`) adds the time to `preparation_estimate_seconds` and records `delay_reason_code` / `delay_reported_at` (0102), a `DELAY_REPORTED` event and a `vendor_order.delayed` outbox event (acknowledged; the customer's notice is 11.x's). The active record carries `expected_ready_at` and `delay_reason_code` while the partner is heading there or waiting; the wait card reads "The store says about N min more — running late: item being sourced" beside "Paid after 5 min · you may leave after 10 min · up to ₹10". The console has "Running late?" with minutes and a reason.

**Mutation results.** Eight probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Arrival does not open the wait (old) | *A trusted arrival did not open the wait (undefined)* |
| Handover does not close it (old) | *The handover did not close the wait ({"wait_state":"RUNNING",…})* |
| Settlement carries zero (old) | *The waiting pay was counted but not paid ({"wait_minor":"0",…,"settlement_wait":null})* |
| Leave before the threshold | *A partner left the store before the leave threshold* |
| Leave keeps the membership | *Leaving under the policy did not return the attempt with the wait paid on record* |
| `LEFT_AFTER_WAIT` ignored by re-offer | *A partner who left under the policy could be offered the same attempt again* |
| Estimate not moved by the delay | *The store's delay did not move the estimate with its reason on record* |
| Leave threshold constant, not the setting | *The next partner's wait was not their own, under the configured leave threshold ({"leave_threshold_seconds":600,…})* |

**Forward findings.** (9.10 / 10.x) A partner who leaves under the policy has their waiting pay on record (`partner_wait_earning_adjustments`) but no earnings record, since the delivery is another partner's; paying it out is the earnings and payout audit's. (11.x) `vendor_order.delayed` reaches the outbox and nobody tells the customer yet. (9.2) The wait-leave and arrival-radius settings leak across verifier modules on one database; the ladder's order keeps them consistent. (carried) `ZONE` scopes by name; branch protection off; Android arrivals are claims.

**Verification.** `pnpm db:verify` exit 0 locally — 103 migration files (0000–0102), full ladder; `assignment_custody` 44 assertions (38 before), `vendor_fulfilment` 270 (265), `partner_wait_policy` 10 (unchanged, now on the shared arithmetic). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 579 pass / 0 fail (575 before: the wait arithmetic, the leave routing, the delay route's scope, the estimate sentence); `pnpm test:integration` exit 0 on a rebuilt test stack; all eight probes on a rebuilt database.

**Step 9.5: VERIFIED_LOCAL**, with the forward findings carried.

## Run 61 (21 September 2026) — step 9.6, customer delivery

Five requirements. Three held (the exact address only in custody; the delivery code with expiry, attempts and single use; completion closing custody, the order and the earning trigger in one commit) and two did not: arrival at the door was the partner's word from anywhere, and that word started the paid customer-unreachable wait; and there was no contact at all — the customer heard nothing between "left the shop" and "delivered", and a partner at the wrong gate had no way to say so short of a support report. One migration (0103); fifteen connected assertions, three unit tests; eight mutation probes, seven caught and one survived on a second guard.

| # | Requirement | Finding |
|---|---|---|
| 1 | Reveal exact customer address only after custody | Met (D-15, run 33): joined in the query for custody states only; no phone anywhere on the record. A written direction to the door now stands beside the map (DLP-46). |
| 2 | Masked contact and navigation fallback | Navigation met; **no contact existed** — masked calling is gated (COM-08) and nothing stood in for it — P61-02. |
| 3 | Record arrival | **The partner's word** — `arriveAtCustomer` was a bare transition, and it opened the paid wait — P61-01. |
| 4 | Validate delivery OTP or approved alternative proof | Met (8.6, run 55): keyed digest, expiry, five attempts counted durably, spent on success; alternative proof stays gated (DLP-31). |
| 5 | Complete custody, fulfilment, order and earning exactly once | Met: one transaction closes custody, the membership and the vendor order; the outbox event settles the money once. Now verified under a forced double delivery. |

**P61-01 — the door, trusted or confirmed.** 0103 adds `customer_arrival_kind` (`TRUSTED_LOCATION` / `UNVERIFIED` / `CUSTOMER_CONFIRMED`), `customer_arrived_at`, `customer_arrival_distance_metres` and `customer_arrival_claim_reason`; `ARRIVED` now requires a kind (NOT VALID for rows before it). `arriveAtCustomer` measures the fix against the delivery address in PostGIS under the same radius as the store; a trusted fix records the distance, anything else records why (`NO_LOCATION`, `POOR_ACCURACY`, `OUT_OF_RANGE`, or `NO_DESTINATION` for an attempt with no order). The partner proceeds either way — the customer reading their code is the proof of the door, and `deliver` turns an unverified arrival into `CUSTOMER_CONFIRMED`. `PartnerWaitPolicyService.start` at `ARRIVED` refuses unless the arrival is trusted: an unreachable customer without a fix at the address is a report to support, not a timer. The app sends the fix with the arrival and says when it fell short.

**P61-02 — reaching the customer without a number.** The customer is told the partner is at the door: `syncDomainSignals` reads `ARRIVED` assignment events into `assignment_event.arrived` notices for the order's customer (the event and the order reference; nothing of the partner). `customerNudge` admits three fixed messages — at the door, cannot find the door, waiting outside — for the order's customer, once per kind per two minutes, only in custody, only by the partner holding it, and returns who and what with nothing personal; the API enqueues the notification under the platform actor on the partner's request ids. The customer's inbox reads each in words. The partner's card offers the three as buttons under the address. Masked calling remains gated.

**Mutation results.** Eight probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Any arrival is trusted (old) | *An arrival with no door to measure against was not recorded as unverified* |
| Paid waiting at the door on any arrival (old) | *Paid waiting at the door started on an unverified arrival* |
| The code does not confirm the door | *The customer's code did not confirm the arrival* |
| A nudge before custody | *A partner not yet holding the order could nudge the customer* — after the check was moved to an attempt with a customer; on the order-less attempt the "no customer" refusal had made it vacuous |
| A nudge every second | *A second nudge within the interval was admitted* |
| Any partner may nudge this customer | *Another partner could nudge this customer (admitted)* |
| The customer is not told of the arrival (old) | *The customer was not told the partner is at the door ([])* |
| The delivery's state guard removed | **Survived**: under the forced race the loser is refused as stale by the version check, and a client that refreshed would be refused by the spent code before the state is looked at. The guard is the third layer; exactly-once held on the other two. Kept, recorded. |

**Forward findings.** (11.x) `assignment_event.arrived` and the nudges are IN_APP and PUSH notices; SMS fallback for a customer without the app is COM-03's audit. (COM-08) Masked calling stays gated; the nudges are the launch-scope stand-in. (9.2) The custody module's settings (`assignment.wait_leave_seconds`, `assignment.arrival_radius_metres`) leak to later modules on one database — the wait-policy verifier now reads its thresholds from the timer rather than assuming them, and the fulfilment verifier reads the leave setting in force. (carried) `ZONE` scopes by name; branch protection off; Android arrivals are claims.

**Verification.** `pnpm db:verify` exit 0 locally — 104 migration files (0000–0103), full ladder; `assignment_custody` 49 assertions (44 before), `vendor_fulfilment` 276 (270), `partner_wait_policy` 10, `local_notifications` 7. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 581 pass / 0 fail (579 before: the nudge route and the partner app's door checks); `pnpm test:integration` exit 0 on a rebuilt test stack; all eight probes on a rebuilt database.

**Step 9.6: VERIFIED_LOCAL**, with the forward findings carried.

## Run 62 (21 September 2026) — step 9.7, offline proof recovery

Five requirements, and the step was a façade: the partner app's "I have no signal — hold my proof" button made a network request to register a digest of `assignment:DELIVERY:<time>` — a digest of nothing, sent to a server the offline device could not reach — and "Send it now" marked that digest SYNCED, which completed no delivery. The handover's real proof, the customer's code (DLP-30), was never held anywhere; a partner at a door without signal had no path but to try again later against a code that expires in fifteen minutes. One migration (0104); eight connected assertions, four unit tests; six mutation probes, all caught.

| # | Requirement | Finding |
|---|---|---|
| 1 | Encrypt locally saved proof and bind it to the active assignment | **Not met:** nothing was saved locally but a digest in `localStorage`; nothing was encrypted; the "proof" bore no relation to the handover — P62-01. |
| 2 | Display pending synchronization, never false success | Met in wording (a held card), but **what it described did not exist** — P62-01. |
| 3 | Retry idempotently after reconnect | **Not met:** the sync marked a digest SYNCED; the completion was never retried at all — P62-02. |
| 4 | Block new work until server confirmation or support resolution | Met: the active membership blocks a second job (DLP-14), and the proof-queue policy refuses new work while a registered proof is pending (batch 01). |
| 5 | Remove local sensitive proof after verified synchronization or approved expiry | **Nothing sensitive was held**, so nothing was removed; now the sealed completion is forgotten on confirmation, on escalation, and the worker expires what never synced on the grace — P62-01, P62-03. |

**P62-01 — what is held.** `held-proof.ts`: the completion command (its stable command reference, the version it was built against, the code, the proof reference, when it was captured) is sealed with AES-GCM under a per-device, non-extractable key kept in IndexedDB, with the assignment and the partner as additional authenticated data; the record opens only for that job on that account on that device. Without a key store the partner is told to keep the code and report to support rather than promised a hold the device cannot keep. `listHeld` reads what is held without opening it; `heldSentence` says "held, not confirmed" and, after a refusal, why. The workspace holds a delivery only when the request never reached the server (`isNetworkFailure`: no status, no code, or the browser offline) and never shows it as delivered.

**P62-02 — the replay.** On reconnect (the `online` event, and once the session is known) the app registers the proof by the digest of the sealed record — the server holds the digest and the key reference, never the code — reusing a registration already pending for the attempt, then replays `deliver` under the held command reference with `held_since` and `offline_proof_id`. `deliver` keeps the code, the attempts and the state guards, and changes one thing: a code that lapsed while the device was dark is accepted when it was current at capture and signal returned within `assignment.offline_proof_grace_seconds` (SETTING, default 24 h); the proof row is consumed — `SYNCED`, `consumed_by_command_reference` (0104) — in the same commit, and the history's reason is `DELIVERY_PROOF_HELD_OFFLINE`, decided by the server. A proof of another attempt, another partner, or no longer pending is refused. A retry finds the command replayed and the proof spent.

**P62-03 — the support path and the clean-up.** A refusal is kept on the device record with its code; the card offers "Report to support", which raises a `PROOF_SYNC_FAILED` exception (a new kind, 0104) with the refusal as its reason and forgets the sealed record. A confirmed completion is forgotten on the server's answer. The worker expires unsynced proofs on the same grace the completion is judged by, not a separate constant.

**Mutation results.** Six probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| Capture time not checked against expiry | *A completion captured after the code lapsed was accepted* |
| No grace window | *A held completion beyond the grace window was accepted* |
| Proof not bound to the attempt and partner | *A held completion consumed another attempt's proof* |
| History does not say it was held | *… ({"reason_code":"DELIVERY_PROOF_VERIFIED", …})* |
| Proof left pending after consumption | *… ({… "sync_state":"PENDING","consumed_by":null …})* |
| A live lapsed code accepted (grace without `held_since`) | *A lapsed code entered live was accepted* |

**Forward findings.** (DLP-31) Alternative proof stays gated; a held completion is the customer's code only. (9.7) The Android shell does not hold completions offline. (COM-03) A customer whose code lapsed while the partner was dark is not told the handover completed late; the delivered notice is the same. (carried) `ZONE` scopes by name; branch protection off; Android arrivals are claims.

**Verification.** `pnpm db:verify` exit 0 locally — 105 migration files (0000–0104), full ladder; `assignment_custody` 55 assertions (49 before), `vendor_fulfilment` 276, `partner_lifecycle` 73. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 583 pass / 0 fail (581 before: the sealed record and its listing, the deliver route's held fields; two source-text checks rewritten around the real path); `pnpm test:integration` exit 0 on a rebuilt test stack; all six probes on a rebuilt database.

**Step 9.7: VERIFIED_LOCAL**, with the forward findings carried.

## Run 63 (21 September 2026) — step 9.8, guided exceptions and safety

Five requirements. Three held (every path exists and is reachable from the partner's screen; emergencies are ranked first, hold the job and sit behind their own control; no integrity signal moves a partner's standing on its own) and two did not: an operator's "return it to the store", "reassign" and "cancel" were resolution words on the exception that moved nothing on the attempt, and the partner never read them — the card showed only open reports, so the instruction vanished the moment it was given; and no evidence or instruction text existed anywhere. One migration (0105); nine connected assertions, two unit tests; five mutation probes, four caught and one survived on a second guard.

| # | Requirement | Finding |
|---|---|---|
| 1 | Paths for vendor delay, missing/damaged, unreachable customer, wrong address, unsafe location, accident, medical emergency, threat, vehicle failure, prohibited goods | Met: eleven kinds (with 9.7's `PROOF_SYNC_FAILED`), grouped on the partner's sheet by where they stand. |
| 2 | End each path in a named retry/continue/return/cancel/reassign/support state | Named, **but a directed state was a word**: nothing returned, reassigned or cancelled the attempt — P63-01. |
| 3 | Record evidence and current instruction | **Not met:** the report carried no evidence, the resolution no author and no words, and the partner saw no instruction once given — P63-02. |
| 4 | Avoid automatic guilt from one integrity signal | Met: no code path opens a restriction or moves eligibility from a report; now asserted before and after an unreachable-customer report and an accident. |
| 5 | Keep emergency handling separate from generic support | Met: the Emergency control is its own, an open emergency holds the job, emergencies rank first in the operations queue. |

**P63-01 — the direction is the transition.** `AssignmentCustodyService.direct` (admin): `RETURN_TO_VENDOR` with goods in hand fails the delivery if it was not already, requires the return and authorises it to the destination given (the store's own reference by default) in one commit — three events under the operator, one return task authorised by them — and is a no-op once returning; `REASSIGN` with nothing in hand takes the attempt back with the compensation decided (`reassign`), and is refused with goods in hand; `CANCEL` with nothing in hand ends the attempt, is refused with goods in hand, and is refused for an attempt in the pool (the schema says a cancelled attempt had a partner; the order is cancelled with the order). The admin route applies the direction before it records the resolution, so the partner never reads an instruction the platform did not carry out.

**P63-02 — evidence and instruction.** 0105 puts `actor_kind`, `actor_id` and `instruction` on the exception event; a report carries the partner's `evidence_note` (the sheet asks "What happened?"); a directed row carries operations' words, which a partner may not write. `standingInstructions` in the partner app shows operations' latest word per kind — "Take the order back to the store. Take it back; the customer collects tomorrow." — until the job ends, while a newer open report of the same kind waits its turn. The operations queue shows the evidence and asks for the instruction, and for the compensation on a reassignment.

**Mutation results.** Five probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| A return direction authorises nothing (old) | *A directed return did not fail, require and authorise the return once* |
| Goods in hand reassigned by a word | **Survived**: `reassign` itself refuses an attempt with custody, so the direction's own guard is the second of two. Kept, recorded. |
| A partner may direct | *A partner directed their own return* |
| The direction does not say who gave it | *The direction did not carry who gave it and what they said* |
| A partner may write an instruction | *A partner wrote an instruction* |

**Forward findings.** (9.9) The return's destination is a reference; vendor closed/refusal and an alternate safe point are 9.9's. (11.3) The partner's report reaches operations as a queue entry; a support case with messages is the support slice's. (carried) `ZONE` scopes by name; branch protection off; Android arrivals are claims and its shell holds nothing offline.

**Verification.** `pnpm db:verify` exit 0 locally — 106 migration files (0000–0105), full ladder; `assignment_custody` 60 assertions (55 before), `partner_lifecycle` 77 (73). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 585 pass / 0 fail (583 before: the standing instruction and the directed route); `pnpm test:integration` exit 0 on a rebuilt test stack; all five probes on a rebuilt database.

**Step 9.8: VERIFIED_LOCAL**, with the forward findings carried.

## Run 64 (21 September 2026) — step 9.9, return to origin

Five requirements. Two held (custody preserved through the return; custody closed separately from the money, which a case decides) and three did not: the authorised destination was a reference the partner could not read and the returning partner's record carried no destination at all — not even the store's point it carries on the way there; a store that was closed or refused the goods had no report and no path, since an authorisation could not be moved once given; and completion recorded an invented proof reference and nothing else — no recipient, no count, no condition. One migration (0106); eight connected assertions, two unit tests; five mutation probes, all caught.

| # | Requirement | Finding |
|---|---|---|
| 1 | Authorize return and destination | Authorised, **but the destination was unreadable and absent from the partner's record** — P64-01. |
| 2 | Preserve custody while returning | Met: `IN_CUSTODY` from `DELIVERY_FAILED` through `RETURNING`; asserted on the returning record. |
| 3 | Handle vendor closed/refusal and alternate safe point | **Not met:** no report kind, and `authorizeReturn` only from `RETURN_REQUIRED` — P64-02. |
| 4 | Record recipient, counts, condition, and proof | **Not met:** a proof reference the app made up from the clock — P64-03. |
| 5 | Close custody separately from refund, settlement, earning, and dispute | Met: custody closes on the receipt, no settlement runs, the returned event opens a HIGH case (worker); asserted that no earning is posted by the return. |

**P64-01 — the destination.** 0106 adds `destination_note` to the return task. The partner's active record carries `return_destination` (reference, note, `is_store`) while `RETURN_AUTHORIZED` or `RETURNING`, and the store's own point (`pickup_location`) when the return is to the store — the same card as the outbound leg, headed "Return to". A safe point named in words is shown as operations wrote it.

**P64-02 — closed or refusing.** `RETURN_REFUSED` is a report kind on the partner's sheet. `direct(RETURN_TO_VENDOR)` with a destination while the return is authorised or under way redirects it: the task's destination and note change, a `RETURN_AUTHORIZED` event is appended at the current state, and the partner's record shows the new point and no longer the store. The operations queue asks for the alternate safe point in words when directing a return.

**P64-03 — the receipt.** `completeReturn` requires `received_by` (2–120 characters) and the count handed back (0–100), takes a condition note, and records them with the proof and `returned_at` on the task (0106; a completed return must carry them). Custody's closing event carries the count actually returned, and a shortfall against what was carried is said in the history as `RETURN_SHORT_OF_PACKAGES`. The partner's app closes the return on the receipt form, not a button.

**Mutation results.** Five probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| No destination on the return leg (old) | *The returning partner was not told where to go* |
| A redirect while returning is a no-op (old) | *A closed store did not redirect the return to a named safe point* |
| The receipt recorded is not the partner's | *The return did not record its receipt ({"received_by":"SYNTH nobody","returned_package_count":99, …})* — redone after a first form failed at bind time |
| A short return is not said | *A return short of its two packages was not said so* |
| Nobody has to receive it | *A return completed with nobody recorded as receiving it* |

**Forward findings.** (9.10 / DLP-49) What a partner is owed for a failed delivery and its return trip is unpriced; the case carries it. (8.x) A returned order's stock is not released to the shelf by the return; the case's operator does that. (11.3) The vendor's console does not yet show the return's receipt. (carried) `ZONE` scopes by name; branch protection off; Android arrivals are claims and its shell holds nothing offline.

**Verification.** `pnpm db:verify` exit 0 locally — 107 migration files (0000–0106), full ladder; `assignment_custody` 65 assertions (60 before). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 587 pass / 0 fail (585 before: the receipt route and the return leg's source checks); `pnpm test:integration` exit 0 on a rebuilt test stack; all five probes on a rebuilt database.

**Step 9.9: VERIFIED_LOCAL**, with the forward findings carried.

## Run 65 (21 September 2026) — step 9.10, earnings and disputes

Five requirements. One held (the CSV export) and four did not: the statement carried a total and a state per line and none of the eight components the record holds; the panel rendered no daily or weekly rollup (the matrix said it did); the app's "Query this amount" sent `disputed_component: 'TOTAL'`, a component the server refuses, so every dispute a partner ever raised from the app was refused as input; the partner could not read their disputes back at all — no route existed — and an operator's resolution at a different amount recorded the decided figure on the case and changed nothing on the earning or in the ledger. One migration (0107); fourteen connected assertions, three unit tests; five mutation probes, three caught by the walk and two by the schema.

| # | Requirement | Finding |
|---|---|---|
| 1 | Show trip base, distance/time, wait, return, incentive, tip, adjustment, and net | **Not met:** the statement had `total_minor` and nothing else — P65-01. |
| 2 | Show daily/weekly rollups and payout status | Payout state met; **no rollups existed** — P65-01. |
| 3 | Export statements | Met (CSV); now with every component. |
| 4 | Open a dispute on an exact line | **Refused every time:** the app named a component the server does not have — P65-02. |
| 5 | Show original/new amount, evidence, owner, deadline, and outcome | **Not met:** no read route, nothing rendered, and the outcome was a number on the case that moved no money — P65-02, P65-03. |

**P65-01 — the line and its days.** `partnerStatement` carries the eight components, the outcome, the payout's state and paid date, and the partner's day and week (Asia/Kolkata, as 9.2 counts the day) for each line, and rolls them up (`days`, `weeks`: trips, net, paid) so the totals reconcile to the lines. The panel shows the breakdown under each line, the rollups beneath, the paid date on the state; the CSV carries every column.

**P65-02 — the exact line.** The panel's query names one of the eight components (the server's own set; no `TOTAL`), the amount expected and why, and sends the recorded figure with it. `GET partner/earnings/disputes` reads them back — what was said, who resolved it, when it is due, how it ended — rendered in a sentence per dispute with a withdrawal while open.

**P65-03 — the outcome is money.** 0107 adds `partner_earning_adjustments` (append-only but for the posting stamp: the dispute, the delta, who decided). `resolveDispute` at an amount other than the recorded one writes the row and moves the earning's `adjustment_minor` and `net_minor` by the delta in the same transaction — the schema's net-shape check holds them together; a withdrawal, or a resolution at the recorded amount, moves nothing. `CompleteMoneyLifecycleService.postEarningAdjustment` posts the delta between platform clearing and the partner's payable once, keyed to the row; the resolving request posts pending adjustments and the worker's operations pass posts anything left. `GET partner/earnings/adjustments` shows the partner what changed. Paying out an adjustment after the original payout has gone is Phase 10's.

**Mutation results.** Five probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| A resolved dispute moves nothing (old) | *A resolved dispute did not move the money on the line ({"adjustment_minor":"0", …})* |
| The adjustment lands but the net stays | **The schema**: `partner_earnings_net_shape` refuses the row before any assertion runs |
| The posting is not idempotent | **The schema**: the append-only trigger refuses a second stamp, and the transaction with its second ledger entry rolls back — after the walk gained a direct replay of the posting; the sweep alone had let it pass |
| The statement drops the wait component | *The statement does not break the line down or roll it up by the partner's day* |
| The day is UTC's, not the partner's | *The statement's day is not the partner's …* — after the earning was posted at 00:30 IST; at the fulfilment walk's real hour UTC and IST share a date |

**Forward findings.** (10.x) An adjustment decided after the original payout was paid is on the ledger and the record but reaches no payout yet. (DLP-49) `return_minor` and `time_minor` are always zero: the return trip and time are unpriced by the policy. (DLP-54) Performance transparency is the profile's counts; coaching before restriction is 11.x's. (carried) `ZONE` scopes by name; branch protection off; Android arrivals are claims and its shell holds nothing offline.

**Verification.** `pnpm db:verify` exit 0 locally — 108 migration files (0000–0107), full ladder; `partner_lifecycle` 86 assertions (77 before), `vendor_fulfilment` 277 (276), `money_lifecycle` 25. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 588 pass / 0 fail (587 before: the CSV's columns, the dispute sentence and the component set, the read routes' scope); `pnpm test:integration` exit 0 on a rebuilt test stack; all five probes on a rebuilt database.

**Step 9.10: VERIFIED_LOCAL**, with the forward findings carried.

**Phase 9 exit gate.** Offer expiry and reassignment (run 58), one active assignment (57, 58), waiting (60), pickup (55, 59), delivery (61), offline proof (62), post-pickup cancellation (58 — refused with goods in hand, directed as a return in 63), return (64), safety (63) and the earning dispute (65) each pass in the ladder's walks; customer detail is joined only in custody states (33, 61). **Phase 9 is VERIFIED_LOCAL** on every step, with the carried findings above.

## Android hand-off (21 September 2026) — between Phase 9 and Phase 10

Not an audit step. The owner asked for the four Android apps to be installable before Phase 10 so the roles can be tested on a phone. Each of the four `apps/*-app` Expo projects now hosts its role's deployed PWA in a native shell (`packages/app-shell`, `HostedWorkspace`): the shell owns the WebView, the safe area, the back button, the offline banner, the retry, the deep link (`neighbourhood-<role>://…`) and — for the partner — the foreground location permission; everything the role does is the PWA's, so the matrix's Android claims other than CUS-02 remain as they were (`unverified` / `false`) and the earlier native screens are deleted rather than left as a second, diverging implementation. `packages/app-auth` is now unused and kept for the moment.

**Build.** `pnpm --filter @neighbourhood-store/<role>-app build:apk` → `tooling/scripts/build-android-apk.mjs` (`expo prebuild --clean`, `gradlew assembleRelease`, arm64-v8a only) → `artifacts/android/<slug>-<release>.apk`, stamped with the commit it was built from. The `android/` and `ios/` trees are generated and ignored; so is `artifacts/`. Signed with the generated debug keystore: company-test installs only, never a store artefact. See `docs/engineering/android-apps.md`.

**Verified on this machine.** All four APKs built from `6debd37`, installed in a headless Android 16 emulator (`nbhd-test`, Pixel 7 profile) and launched: customer reaches the shop home (the container app can take 20–30 s on a cold start); vendor, partner and admin reach their sign-in; the partner asks for location first. The header sits below the status bar and the tab bar above the gesture handle after moving to `react-native-safe-area-context` (React Native's own `SafeAreaView` applies no top inset on Android). `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm check:boundaries` (`app-shell` → `ui-tokens` only) and `pnpm test:unit` exit 0 with the shell's tests added.

**Carried.** Android arrivals are still claims (Phase 9); the shell holds nothing offline beyond what the PWA caches; no store listing, signing key or crash reporting exists.

## Run 66 (22 September 2026) — step 10.1, ledger accounts and posting engine

Five requirements. Two held in part and three did not: the account catalogue (0028) defined types and ownership that nothing consulted — a closed account accepted postings, and a vendor's proceeds and a partner's payout were entries on the shared payable accounts naming no vendor and no partner; the capture, the refund and the paid payout each committed their state and then posted the ledger in a second transaction, so a failure between the two left a captured payment the books knew nothing of, with nothing to re-drive it; the transaction carried its business reference and request/correlation but no provider operation and no policy version; zero-sum was enforced at commit only from the entries' side, so a transaction row with no entries passed; and the catalogue itself could be rewritten by a plain UPDATE. There was no read of the ledger at all. One migration (0108); 35 connected assertions in the money module (25 before), three unit tests; five mutation probes.

| # | Requirement | Finding |
|---|---|---|
| 1 | Define account types and ownership | Types defined; **ownership defined and never applied** — P66-02. |
| 2 | Post immutable debit/credit entries under one transaction ID | One transaction ID and append-only; **not in the transaction it records** — P66-01. |
| 3 | Enforce zero sum per currency before commit | Met per transaction (single-currency); **an empty transaction passed** — P66-03. |
| 4 | Store business, provider, policy, and correlation references | Business and correlation met; **provider and policy absent** — P66-02. |
| 5 | Reject direct edits and unbalanced visibility | Entries and transactions refused edits; **the catalogue did not**, and nothing read the books — P66-03. |

**P66-01 — the posting commits with what it records.** `capture` posts inside `#providerTransition`'s transaction through an `onSucceeded` hook; a refund's success posts inside the approval transaction; a paid payout posts inside `submitPayout`/`reconcilePayout`, with the settlement's state refreshed there too. A replay of a successful command runs the same idempotent posting, which heals a record posted separately before this run and lost. The verifier installs a trigger that refuses the posting, captures, and reads back an AUTHORIZED payment at its old version with no CAPTURED event and no ledger row; the same command then succeeds whole.

**P66-02 — whose money, under what.** `ledger_accounts.owner_dimension` says which entry column must name the owner (`VENDOR_LOCATION` on the vendor payable, `PARTNER_USER` on the partner payable); `ledger_entry_postable` refuses an entry on those accounts that names nobody, except in a REVERSAL, which mirrors history as posted, and refuses any entry on a CLOSED account. The posting engine (`#insertBalanced`, `#postEntries`) takes the vendor, partner and order on each entry and the provider operation and policy version on the transaction; the settlement names the vendor on proceeds and the partner on outbound, the payout names its beneficiary from the settlement, the capture credits one line per allocated order (falling back to one credit when the allocations do not account for the amount), the refund names its order. A settlement owing a partner amount to no partner is refused in code; the orchestrator no longer files a self-delivery tip as a partner's.

**P66-03 — the shell and the catalogue.** `ledger_transaction_has_entries` (deferred, on the transaction) refuses fewer than two entries at commit. `ledger_accounts_protected` allows only `lifecycle_state` to change and refuses deletion. `GET admin/finance/v2/ledger` is the trial balance — every account with its postings and the two totals — assembled by `assembleTrialBalance`, which throws rather than render a book whose totals differ; `GET admin/finance/v2/ledger/transactions/:id` reads one posting with its entries and references. The admin finance panel shows the balance or the refusal.

**Mutation results.** Five probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| The capture posts after its transaction commits (old shape) | *A capture whose posting failed was recorded anyway* |
| The vendor's proceeds name no vendor | **The schema**: `ledger entry on SYNTH-ACCOUNT-VENDOR-PAYABLE names no vendor` refuses the settlement before any assertion runs |
| The capture drops its provider reference | *A posting does not carry the provider operation or policy it was made under* |
| The schema accepts a transaction with no entries | *A transaction with no entries was accepted* |
| A closed account accepts a posting | *A closed account accepted a posting* |

**Forward findings.** (10.3) A tip on a self-delivered order now sits in the platform remainder rather than a partner payable owed to nobody; whose it is — the vendor's, on the settlement — is 10.3's. (10.4) `postPartnerEarning` posts the earning's breakdown as debits and credits on the partner payable alone, a memo that moves nothing; the partner's liability comes from the settlement's outbound credit, and the earning record carries no policy reference to post. (10.6) The admin console has no way to find an `original_ledger_transaction_id` to correct; the transaction read exists now and the panel does not use it. (carried) The `actor` of a posting is on the command's event, not the transaction; TRUNCATE is not refused (the verifiers depend on it); a database superuser can disable the triggers — an operations control, not a schema one.

**Verification.** `pnpm db:verify` exit 0 locally — 109 migration files (0000–0108), full ladder; `money_lifecycle` 35 assertions (25 before), `vendor_fulfilment` 277, `partner_lifecycle` 86. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 593 pass / 0 fail (590 before: the trial balance's sign, refusal and empty book; the two ledger routes' scope); `pnpm test:integration` exit 0 on a rebuilt test stack; all five probes on a rebuilt database.

**Step 10.1: VERIFIED_LOCAL**, with the forward findings carried.

## Run 67 (22 September 2026) — step 10.2, authorization, capture, void, and refund lifecycle

Five requirements. Three held and two did not, with two of the three held only in part: provider attempts map to internal transactions by operation reference, with duplicates, late answers and abandoned unknowns handled at the checkout since runs 44 and 48; capture takes what the bags hold since run 52; the unused authorisation is voided since run 44. But a capture the provider left *unanswered* was parked in `UNKNOWN_REQUIRES_RECONCILIATION` with an exception whose next action no route and no sweep performed, while the orchestrator answered `CAPTURED` regardless — the order was delivered against money nobody knew had moved and its settlement never ran; a refund the provider left unanswered was the same. A refund was bounded by the payment's captured total alone, counting only refunds that had succeeded, so one order's refund could be paid from a sibling's money and two pending proposals could both pass; it named no lines. And the cancellation preview promised a packed order's item total back while `cancelByCustomer` refused anything past PICKING and nothing would have filed the refund had it not. One migration (0109); 44 connected assertions in the money module (35 before) and 291 in fulfilment (277 before); one unit test; seven mutation probes.

| # | Requirement | Finding |
|---|---|---|
| 1 | Map provider attempts to internal transactions | Met (runs 44, 48): operation reference, receipts, late answers. |
| 2 | Capture only permitted completed/accepted amounts | Met since run 52 (the capture plan); the increase for an approved dearer change is recorded with no provider call — carried under D-12. |
| 3 | Void unused authorization where supported | Met (run 44): `voidAuthorization` through the port; a partial capture's remainder is the adapter's release. |
| 4 | Allocate partial/full refund to exact child orders and lines | **Not met:** bounded by the payment, not the order; pending proposals uncounted; no lines; the post-capture cancellation's refund never filed — P67-02, P67-03. |
| 5 | Handle unknown, late, duplicated, and failed outcomes through reconciliation | **Not met for capture and refund:** parked, unreachable, and reported as captured — P67-01; replayed commands errored on the unique key — P67-03. |

**P67-01 — the answer that came later.** `reconcilePayment` and `reconcileRefund` apply the provider's answer for a capture or refund it did not give at the time: "succeeded" is the capture or refund, posted in the same transaction, with the exception closed; "failed" leaves the authorisation standing (the capture may be attempted again) or makes the refund retryable; "unknown" changes nothing; an unanswered *authorisation* is refused here because the checkout settles it on its own deadline. `reconcileUnknownOperations` asks the port's `status` for every such operation older than a minute and applies what it says; the operations worker runs it on every pass. `POST admin/finance/payments/:id/reconcile` and `…/refunds/:id/reconcile` take a statement's answer from a person, as the payout's route does. `settleAuthorizationForOrder` reports `CAPTURE_UNKNOWN` and `CAPTURE_FAILED` as themselves. The fulfilment walk packs an order, captures it against a provider that answers nothing, reads `CAPTURE_UNKNOWN` and no settlement, sweeps, and reads a captured, settled order.

**P67-02 — the refund a cancellation is owed.** A customer may call an order off until someone is carrying it (PRD: cancellation after custody becomes a controlled return); `cancelByCustomer` now allows AWAITING_CUSTOMER_DECISION and READY as the preview did, and 0109 lets a cancelled order keep its ready snapshot. On `vendor_order.ended` the worker runs `refundEndedOrder`: for an order cancelled after its group was captured and never picked up, the platform proposes the refund against that order — item, tax and tip less the discount, the delivery fee kept as the customer was told — with the exact lines that were in the bag, replay-safe on the order's own references, and a person approves it (the platform's proposal waits three days for one; a person's own still fifteen minutes). An offer for an ended order can no longer be accepted.

**P67-03 — bounds, lines, replays.** A refund is bounded by what the order was charged and by what the payment captured, both net of every refund not yet failed — a pending proposal reserves its amount. `refund_lines` (0109) names the lines a refund returns; the schema holds their sum to the refund's item amount at commit; the customer's receipt shows them. A replayed proposal is the same refund and a replayed approval is its outcome, where both used to fail on the command's unique key (the walk's assertion that a replayed approval *throws* was the wrong assertion, and is now that it returns once-posted).

**Mutation results.** Seven probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| The sweep asks about an operation still in flight | *A capture the provider did not answer was not reconciled from its status ({"early":{"payments":1,…* |
| A failed capture marks the payment FAILED, the authorisation lost | *A capture the provider says failed did not leave the authorisation standing (…"state":"FAILED"…)* |
| The refund is bounded by the payment alone (old) | *A refund beyond what the order was charged, net of one pending, was accepted* |
| Nothing is filed for a cancellation after capture (old) | *A cancellation after capture did not file the refund the customer was promised (null, …)* |
| Refund lines need not sum to the item amount (code and schema) | *The refund does not name the exact line it returns ([{"quantity":2,"amount_minor":"30001",…* |
| Refund lines need not sum in code; the schema alone stands | **The schema**: `refund lines sum to 30001 against an item amount of 30000` refuses the proposal at commit |
| The orchestrator reports CAPTURED whatever the provider said (old) | *A capture the provider did not answer was reported as CAPTURED and settled=false* |

**Forward findings.** (D-12) An approved dearer replacement raises the recorded authorisation with `provider_scenario='SUCCESS'` and no provider call; a real adapter needs an incremental authorisation on the port, or the increase must be collected separately. (10.3) A cancelled order's kept delivery fee is captured and never divided — it sits in platform clearing with no settlement line; a return after custody still reaches money only through a support case and a person's refund. (10.5) `importProviderStatement` classifies a statement's answer for an unknown operation as a STATUS_MISMATCH exception rather than applying it as `reconcilePayout` does; the reconcile routes exist now for it to call. (9.3, carried) The order-state guard on `accept` is the only thing between a cancelled order and a partner collecting nothing; the ending does not withdraw its open offers.

**Verification.** `pnpm db:verify` exit 0 locally — 110 migration files (0000–0109), full ladder; `money_lifecycle` 44 assertions (35 before), `vendor_fulfilment` 291 (277 before), `partner_lifecycle` 86. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 594 pass / 0 fail (593 before: the ended order files its refund after settling); `pnpm test:integration` exit 0 on a rebuilt test stack; all seven probes on a rebuilt database.

**Step 10.2: VERIFIED_LOCAL**, with the forward findings carried.

## Run 68 (24 September 2026) — step 10.3, vendor fees and settlements

Five requirements. Two held, one held in part and two did not. The commission is a rate resolved from the version the order was quoted under (runs 41, 52) and the settlement writes policy-versioned component lines, and payouts are built in daily batches and submitted safely (runs 44, 62) — but the fee was charged once, at settlement, on what the bags held then: a refund that landed afterwards took money back from the customer and left the shop's proceeds and the platform's fee standing on goods that had been returned, so a fully refunded order still paid the shop and still charged it commission, and the batch then paid the stale figure. The statement showed a gross, a fee and a net — and the "fee" it showed was the platform's whole remainder, the delivery margin included, not the commission; nothing of a refund, an adjustment, a payment cost, a tax or the payout's own state appeared, against a catalogue entry that asks for all of them. And VEN-50, "vendors challenge a specific ledger or payout line through a tracked finance case", existed nowhere: no table, no service, no route, no screen — while the matrix recorded it as `backend_only` with `domain: true, api: true, tests: true`. One migration (0110); 303 connected assertions in fulfilment (291 before), three unit tests; seven mutation probes.

| # | Requirement | Finding |
|---|---|---|
| 1 | Approved platform/payment/tax rules from preserved versions | Platform rule met (the quote's version, resolved as of the quote). **Payment and tax rules do not exist** — gated by D-12; the components and the tax-payable account are in the schema and nothing writes them. |
| 2 | No completed-order fee on failed, platform-cancelled or fully refunded orders | Met at settlement time only; **a refund afterwards changed neither the proceeds nor the fee** — P68-01. |
| 3 | Create settlement lines and batches | Met; the re-division now writes its own lines — P68-01. |
| 4 | Submit payout safely | Met (runs 44, 62); it paid a stale payable, which P68-01 fixes upstream rather than in the payout. |
| 5 | Show vendor statement and dispute path | **Statement incomplete and its fee wrong; no dispute path at all** — P68-02, P68-03. |

**P68-01 — the refund re-divides the order.** `redivideSettlementForRefunds` takes a settlement whose succeeded refunds have outrun what it accounted for: the goods' share comes off the shop's proceeds and the commission is recalculated on what remains, under the policy the order was sold on, and what the refund took that was not goods — a delivery fee, a tip — the platform absorbs. The correction is one balanced ADJUSTMENT keyed to the settlement and the refunds it accounts for; the settlement's payable, remainder, customer net and accounted refunds move with it, so the balance constraint holds and a second pass finds nothing. `redivideRefundedSettlements` runs on the operations worker for every settlement not yet submitted or paid.

**P68-02 — the statement is the line.** `vendorStatement` reads the settlement's own policy-versioned lines: the sale, the platform fee (the commission line, not the platform's whole remainder), payment costs, tax, refunds, adjustments, and the payout's state and paid date. The CSV carries the same twelve columns; the panel shows the refund and the adjustment beside the net.

**P68-03 — the shop's challenge.** 0110 adds `vendor_settlement_disputes` (one open case per settlement line, the figure as recorded against the figure expected, what the shop says, a seven-day deadline) and `vendor_settlement_adjustments` (append-only but for the posting stamp). `vendor.finance.dispute` raises and withdraws; `admin.vendor_settlement.resolve` answers; a resolution at another figure writes the adjustment, moves the settlement's payable against the platform's remainder in the same transaction, and posts to the ledger once — the failure 9.10 found on the partner's side, not repeated here. The payouts panel raises a challenge on a line, reads its answer back and withdraws it.

**Mutation results.** Seven probes, each on a rebuilt database, restored from the index:

| Probe | Caught by |
|---|---|
| A refund after settlement changes nothing (old) | *A refund after settlement did not re-divide the order's money* |
| The refund comes off the proceeds, the commission stands | same assertion, on the expected payable |
| The re-division does not record what it accounted for | *The re-division ran twice or left the books unbalanced (1)* |
| A resolved challenge moves no money (the 9.10 failure) | *A resolved challenge did not move the money on the settlement (undefined)* |
| Any shop may challenge any settlement | *A shop challenged another store's settlement under its own location* — after the walk gained that case: staff membership alone had been doing the work, and the first form of the probe passed |
| The statement hides the refund (old) | *The shop's statement does not show the refund that changed its money* |
| The vendor adjustment posts twice | **The schema**: `ledger_transactions_source_reference_key` refuses the second posting — after the walk replayed the posting directly rather than through the sweep, which filters on the stamp and had let it pass |

**Forward findings.** (D-12) There is no payment-fee schedule and no tax policy: `PAYMENT_FEE` and `TAX` are components the schema allows, `SYNTH-ACCOUNT-TAX-PAYABLE` is an account nothing posts to, and `tax_minor` is written as zero at checkout — a real provider's fee and an approved tax version are gated, and the statement and the dispute components are already shaped for them. (10.4) A refund of a tip or a delivery fee on a delivered order is absorbed by the platform rather than clawed back from the partner who was paid it. (10.6) A settlement already submitted or paid is skipped by the re-division: a refund on a paid order is a correction, not a re-division. (10.3, carried) An order cancelled after capture still has no settlement — its kept delivery fee sits in platform clearing, divided by nothing; the refund exists (10.2) but the division does not.

**Verification.** `pnpm db:verify` exit 0 locally — 111 migration files (0000–0110), full ladder; `vendor_fulfilment` 303 assertions (291 before), `money_lifecycle` 44, `partner_lifecycle` 86. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 597 pass / 0 fail (594 before: the statement's columns, the statement's refund and payout, the shop's challenge on the panel, the dispute routes' scopes); `pnpm test:integration` exit 0 on a rebuilt test stack; all seven probes on a rebuilt database.

**Step 10.3: VERIFIED_LOCAL**, with the forward findings carried.

## Run 69 (28 September 2026) — step 10.4, partner earnings and payouts

Five requirements. One held (the statement and the line dispute, run 65) and four did not. The earning's components are posted per component (run 65), but a reassignment's compensation (9.3) was recorded and reached neither the books nor a payout, and a delivery that came back earned its partner nothing — not the trip out their offer had priced. The payout path could not pay a partner at all: a partner payout was a per-order item keyed to the order's settlement, and the settlement's single state was shared with the shop's payout, so the worker's daily run paid shops first, moved every settlement to SCHEDULED, and then looked for partner work only among settlements still PENDING or ELIGIBLE — none, for any order that also paid a shop. Nothing reached a payout that was not a settlement's share: a dispute answered after payout (run 65's forward finding), a compensation, a return. The batch's payout references lacked the `SYNTH-` prefix that the ledger's provider-reference check (0108) requires, so since run 66 every batch payout that was submitted asked the provider to pay and then rolled back at its posting, leaving it SCHEDULED to be sent again; and nothing submitted a batch anyway — the worker wrote the day's batches and stopped. A refused payout opened no case and could not be sent again safely; an unknown one had no rule against being paid twice. One migration (0112); a new connected walk of 28 assertions, one more in fulfilment, one unit test; nine mutation probes on the walk and one on fulfilment.

| # | Requirement | Finding |
|---|---|---|
| 1 | Post base, distance/time, waiting, return, incentive, tip, and adjustment entries | Earning components met (run 65). **Compensation never posted** — P69-02. Time, return and incentive are always zero: no policy prices them (DLP-49, forward). |
| 2 | Preserve earning effects across reassignment and return | **Not met:** a compensation moved no money, and a returned delivery earned nothing — P69-02. |
| 3 | Create payout batches and provider items | **No partner was ever paid by the batch** (the shared settlement state), and no batch payout could post — P69-01. |
| 4 | Handle bank failure and duplicate-risk safely | **Not met:** nothing submitted a batch; a refusal opened no case; nothing held an unknown payout's sources from being paid again — P69-03. |
| 5 | Show partner statement and line dispute | Met (run 65); the line's payout state now comes from the payout that carries it, and compensations are on the statement — P69-04. |

**P69-01 — a partner is paid once per batch, for items.** 0112 makes a partner payout the partner's (`payouts.partner_user_id`; no settlement) and adds `partner_payout_items`: each earning, dispute answer and compensation the payout carries, at the amount that source put on the partner's payable. The schema holds a source to one live payout (partial unique indexes), an item's partner to its payout's (composite key), and a payout to the sum of its items (a deferred constraint trigger); items are append-only but for one move from PAYING to PAID or RELEASED. `createPayoutBatch('PARTNER')` gathers every payable source — an earning once posted and, on a delivered order, once its settlement is eligible and not held; a dispute answer and a compensation once posted — and writes one payout per partner; an earning is paid at the amount it was posted at (net less its dispute deltas), so a later answer is its own item. A partner who owes money back (an answer below the line) has it recovered from the next payout; until they are owed more than that, nothing is sent. The shop's batch is unchanged in what it selects; both now write `SYNTH-BENEFICIARY-…`/`SYNTH-PAYOUT-…` references. `submitPayoutBatch` sends a batch's scheduled payouts through the one submission path and records the batch's state (READY, SUBMITTED, PARTIALLY_PAID, PAID, FAILED_REVIEW); the finance worker creates and then submits both batches, and a retried job sends only what is still scheduled. `schedulePayout` refuses a partner: a per-order payout beside the batch could pay an earning twice. A settlement is PAID when the shop's payout (and any per-order partner payout written before 0112) is; the partner's share is tracked on its items.

**P69-02 — the trip out and the attempt taken away.** `recordReturnEarnings` runs on `vendor_order.returned`: the attempt that carried the goods back earns the offer's base and distance on the road the order was priced on, and the wait at the counter; the trip back stays at zero rather than an invented rate, and a tip for a delivery that did not happen is not the partner's. `postPartnerEarning` funds an earning with no settlement to owe it (RETURNED, CANCELLED_POST_PICKUP) from `SYNTH-ACCOUNT-PLATFORM-SUBSIDY`, naming the order; a delivered one is still owed by its settlement. `postAttemptCompensation` posts a compensation from the subsidy to the partner's payable once, stamping the row (0112 lets the stamp be written once and nothing else change); the operations worker sweeps unposted ones. A replayed delivery or return whose posting had failed now finds the earning and posts it.

**P69-03 — refused, unknown, and paid twice.** A payout the provider refuses keeps its items and opens `PAYOUT_FAILED` (`VERIFY_PARTNER_BANK_ACCOUNT`); the partner is held out of later batches — new sources included — until finance releases it (`POST /admin/finance/v2/payouts/:id/release`, admin only, refused for anything but FAILED_REVIEW), which frees the items for the next batch and closes the case. A payout whose outcome is unknown stays SUBMITTED with its items; it cannot be released, and nothing it carries is paid again until reconciliation says. A refused payout reconciled as paid after its items were released and paid again is posted as paid — the partner's payable then reads what they owe back — and opens `PAYOUT_DUPLICATE_RISK` (`RECOVER_DUPLICATE_PARTNER_PAYOUT`). A paid payout is not reconciled again.

**P69-04 — what the partner reads.** The statement's line state is the payout that carries the earning (or, before 0112, its settlement's per-order payout); compensations are on the statement with theirs, and the earnings screen reads them from there with the payout state in words — a refused payout says the bank refused it and operations are checking the account. `GET partner/earnings/adjustments` carries each answer's payout state.

**Mutation results.** Ten probes, each on a rebuilt database, restored after:

| Probe | Caught by |
|---|---|
| The partner run selects by the settlement state the shop run moves (old) | *The partner's run did not pay the rider for an order the shop's run had moved on* — it paid only the return |
| References without `SYNTH-` (old) | **The schema**: `ledger_provider_shape` refuses the payout's posting |
| A refusal releases what it carried on its own | *A refused payout released what it carried on its own* |
| No hold after a refusal | *A rider whose bank refused a payout was paid again before anyone checked the account* — after the walk gained a new source during the hold: with nothing new owed, the first form passed |
| An unknown payout may be released | *A payout whose outcome is unknown was released to be paid again* |
| Compensations are never posted (old) | *A compensation posted a second time* (the posting found nothing to replay) |
| A return is not funded, only reclassified | *A returned trip was not funded from the platform's subsidy* |
| An earning is paid at its net, dispute deltas included | *The partner's run did not pay the rider…* (6,600 against 6,300: the answer paid twice) |
| No case when a refused payout later paid | *A payout paid twice was not recorded as owed back* |
| A return pays the base without the trip's distance (fulfilment) | *A returned delivery did not earn its partner the trip out* |

**Forward findings.** (D-12, policy) A refund of a tip or delivery fee on a delivered order is still absorbed by the platform, not recovered from the partner who was paid it: whether a refunded tip comes back off a partner is a pay-policy decision, not arithmetic. (DLP-49) The trip back, time and incentives are unpriced. (10.x) A settlement written by the admin route with a partner payable and no earning behind it is owed in the books and reaches no partner batch; the orchestrator always writes the earning first. (11.5) The admin finance queue lists `PAYOUT_FAILED` and `PAYOUT_DUPLICATE_RISK` but has no release button; the route exists. (10.5) Duplicate recovery is a finance case, not an automatic deduction. (carried) A vendor payout the bank refuses still opens no case (10.3's path, unchanged here).

**Verification.** `pnpm db:verify` exit 0 locally — 113 migration files (0000–0112), full ladder; `partner_payouts` 28 assertions (new), `vendor_fulfilment` 313, `money_lifecycle` 43 (44 before: the per-order partner payout it walked is now refused, and its unknown-and-reconciled path is walked in `partner_payouts`), `partner_lifecycle` 86. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 605 pass / 0 fail (the payout state in words, the release and submit routes' scope, the returned-order handler); `pnpm test:integration` exit 0 on a migrated test stack; all ten probes on rebuilt databases.

**Step 10.4: VERIFIED_LOCAL**, with the forward findings carried.

## Run 70 (28 September 2026) — step 10.5, provider-statement reconciliation

Five requirements. None held whole. The import was idempotent by reference or digest, but a statement that changed under its own reference was silently answered with the old import, and the digest was of the rows in the order sent, so the same statement re-sent sorted differently was a new import whose every row was then filed as a duplicate. Matching counted a voided payment as succeeded, so a provider settling money we had released matched. Any earlier row for an operation made a later one a duplicate — including an answer after an earlier "unknown" — and a definitive answer for an operation we were still waiting on (an unanswered capture, refund or payout) was filed as a status mismatch for a person rather than applied. Statements had no period, so nothing they left out could be named: `MISSING_EXPECTED` was a class the schema allowed and no code wrote. A refund the provider refused sat in FAILED_RETRYABLE with no path back; the customer was never repaid and nothing said so. Statement exceptions all carried one next action (`REVIEW_STATEMENT_ROW`), and six of the eleven places that write an exception gave it no owner. One migration (0113); a new connected walk of 25 assertions, the money walk's replay assertion turned to a refusal; eleven mutation probes.

| # | Requirement | Finding |
|---|---|---|
| 1 | Import or retrieve provider statements idempotently | Import idempotent only by accident of order; **a changed statement under its own reference was accepted as a replay** — P70-01. Retrieval: no provider exposes statements (D-12, forward). |
| 2 | Match expected and actual transactions | **A voided payment matched a settlement; an answer we were waiting for was not applied** — P70-02. |
| 3 | Classify unmatched, duplicated, amount mismatch, status mismatch, and missing cases | Four of five written; **duplicate over-matched and missing never written** — P70-03. |
| 4 | Retry only safe operations | **Nothing retried a refused refund**; unknown operations were correctly not retried — P70-04. |
| 5 | Route the remainder to owned finance queues | **One generic next action; six of eleven exception writers named no owner** — P70-05. |

**P70-01 — the statement is its content.** The digest is of the period and the rows sorted, so order does not make a new statement. The same reference with the same content is the same import; the same reference with different content is refused (`MoneyStateError`); the same content under another reference is the import already on record.

**P70-02 — matched against the books, and applied.** A payment is expected at its capture: captured is succeeded, voided/failed/cancelled moved no money, anything else is unknown. A refund refused is failed, a payout refused is failed. An operation whose outcome we are waiting on — a capture left unanswered, a refund with an open `REFUND_UNKNOWN`, a payout SUBMITTED — is matched by a definitive answer at its amount, and the answer is applied after the import commits through that operation's own reconciliation (`reconcilePayment`, `reconcileRefund`, `reconcilePayout`), so it posts once and its unknown case closes; an answer that cannot be applied opens `STATEMENT_CONFLICT` (`APPLY_STATEMENT_BY_HAND`). The import reports how many it resolved.

**P70-03 — duplicate, contradiction, missing.** A duplicate is an operation twice in one statement, or reported with the same definitive answer by an earlier one; an earlier "unknown" followed by an answer is not. A provider contradicting its own earlier definitive answer is a status mismatch even where nothing of ours stands behind the operation. 0113 gives an import a period; every capture, refund and payout the ledger posted inside it (the posting names the provider operation, 10.1) that no statement has reported is a `MISSING_EXPECTED` row — the amount the books expected, no provider state (0113 allows none only for that class) — and a `STATEMENT_MISSING` case, closed when a later statement reports the operation.

**P70-04 — a refusal is tried again, by a person.** `reproposeDeclinedRefunds` runs on the operations worker: a FAILED_RETRYABLE refund is proposed again as a new refund with the same amounts and lines, under a new provider operation, naming the one it retries (`refunds.retry_of_refund_id`, unique: one retry at a time), for a person to approve under the platform's three-day window and maker-checker. A refused retry is retried again the same way. A refund whose outcome is unknown is never proposed again; the refund cap already counts it.

**P70-05 — every exception has an owner and a next action.** Statement rows route to `FINANCE_RECONCILIATION` with `INVESTIGATE_UNKNOWN_OPERATION`, `CONFIRM_DUPLICATE_SETTLEMENT`, `RESOLVE_AMOUNT_DIFFERENCE`, `RESOLVE_STATUS_CONFLICT` or `CHASE_PROVIDER_FOR_MISSING_OPERATION`, one open case per operation and kind. 0113 backfills every unowned exception to `FINANCE_OPERATIONS`, makes it the default, and holds `owner_reference` to the two queues.

**Mutation results.** Eleven probes, each on a rebuilt database, restored after:

| Probe | Caught by |
|---|---|
| A voided payment counts as succeeded (old) | *A provider settling a payment we voided was matched* — after the probe was rewritten to the old rule: its first form made a void unknown, which still mismatched |
| An answer we were waiting for is not applied (old) | *The statement was not classified against the books* |
| Any earlier row makes a duplicate (old) | *An answer after an earlier "unknown" was treated as a duplicate rather than applied* |
| No missing sweep (old) | *What the books settled and the statement left out was not named missing* |
| A changed statement under its reference is a replay (old) | *A statement that changed under its own reference was accepted as a replay* |
| The digest depends on row order (old) | The reversed replay is refused as changed content |
| Unknown refunds are retried too | *The refused refund was not proposed again* (three proposed, not one) |
| Nothing is retried (old) | same assertion |
| Statement cases go to the general queue | *A STATEMENT_DUPLICATE was not routed to an owned queue with its next action* |
| A missing case stays open once reported | *A missing operation reported later did not close its case* |
| No self-contradiction rule | *A repeated or contradicted answer was not caught* — after the walk gained an operation only the provider stands behind: every contradiction in its first form also contradicted our own records |

**Forward findings.** (D-12) No provider exposes a statement to retrieve; import is the only path, and statements are synthetic. (10.2, carried) A capture the provider refused leaves the authorisation standing and nothing retries the capture. (10.6) A person's refund proposal that expires unapproved stays PENDING_APPROVAL and keeps its share of the refund cap. (11.5) Exceptions can be read in the queue but not assigned or resolved by a person; the queue's owner is now always set. (carried) A vendor payout the bank refuses still opens no case.

**Verification.** `pnpm db:verify` exit 0 locally — 114 migration files (0000–0113), full ladder; `statement_reconciliation` 25 assertions (new), `money_lifecycle` 43, `partner_payouts` 28, `vendor_fulfilment` 313. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 605 pass / 0 fail; `pnpm test:integration` exit 0 on a migrated test stack; all eleven probes on rebuilt databases.

**Step 10.5: VERIFIED_LOCAL**, with the forward findings carried.

## Run 71 (28 September 2026) — step 10.6, financial correction workflow

Five requirements. One held (reason and evidence were required, in their shapes) and one held in part (the reversal and the replacement posted together, linked to the correction). There was no preview: a correction stored its replacement entries and nothing of what they would move, so its approver saw a list of lines and not how much any shop's or partner's payable would move. There was no policy threshold: every correction needed two people whatever its size, with no setting saying where that line is, and nothing let a small one be posted by its maker. Nothing stopped two corrections of one posting, each reversing it; a posting's own reversal could be corrected; a replacement naming a closed account or an owner-less payable was accepted and failed only when a second person tried to post it. A proposal nobody answered stayed PROPOSED past its window with no way to reject it; its entries, amount and reason could be rewritten by an UPDATE; and no route read a correction or its history. The admin console's only correction control sent a body the API refused — no entries, no amount, no original posting, no evidence, and no version on approval — so no correction had ever been proposed from the console, while ADM-31 recorded the panel as done. One migration (0114); a new connected walk of 27 assertions; four unit tests for the impact, three for the new panel; eleven mutation probes, and one more for the refund cap carried from run 70.

| # | Requirement | Finding |
|---|---|---|
| 1 | Preview amount and participant impact | **Not met:** nothing computed or showed what a correction moves — P71-01. |
| 2 | Require reason and evidence | Met (shapes checked); the reason is now checked before the database is asked. |
| 3 | Require maker-checker approval above policy threshold | **No threshold existed**; two people always, and the console could not reach the command at all — P71-02, P71-05. |
| 4 | Correct through reversal and adjustment entries | Met for one correction; **a posting could be reversed twice, a reversal corrected, and a bad account found only at approval** — P71-03. |
| 5 | Preserve original and correction history | Ledger met; **the proposal could be rewritten, nothing expired or rejected it, and nothing read its history** — P71-04. |

**P71-01 — the preview.** `correctionImpact` is the replacement's net less the original's, per account and per owner (a shop's or partner's payable is reported per shop or partner); the impact is the sum of the increases, equal to the decreases because both postings balance. `previewCorrection` (`POST /admin/finance/v2/corrections/preview`) returns the original, the replacement, the impact rows, the impact, the single-approval limit and whether a second operator is needed, and writes nothing. The proposal records the same impact, which is what its approver reads.

**P71-02 — the threshold.** The single-approval limit is the versioned setting `finance.correction_approval` (`single_approval_limit_minor`); with none set, every correction needs two people. A proposal records the limit in force and whether a second approver is required (`impact_minor > limit`); 0114 holds the two together and lets the proposer approve only where no second approver is required. The threshold is measured on the impact, not on the size of the replacement, which says nothing about how far it moves from the original.

**P71-03 — one correction per posting, checked at proposal.** 0114 allows one live correction (proposed or posted) per original; a later correction of the same fact corrects the first correction's adjustment. A reversal cannot be corrected on its own. Every account in the replacement must be open and, where it has an owner, name it — refused at preview and proposal, not after a second person has looked. A proposal is replayed by its reference and refused when the reference is reused for something else (compared key-sorted: jsonb keeps its own key order, so a plain string comparison would have refused every replay).

**P71-04 — history.** 0114 makes a proposal history: its reference, original, reason, evidence, entries, amount, impact, limit, proposer and window cannot change, and it moves once out of PROPOSED. `rejectCorrection` closes one with a reason; the operations worker expires one unanswered in its window (`APPROVAL_WINDOW_ELAPSED`), freeing its original. `GET /admin/finance/v2/corrections` lists corrections with their events; a ledger posting's read names the corrections it is the original, reversal or adjustment of.

**P71-05 — the console.** `corrections-panel.tsx` loads the posting to correct, starts the replacement as the original so only what was wrong is changed, previews it (impact per account and owner, in words, and whether a second operator must approve), proposes it with its reason and evidence, and lists corrections with their history and an approve or reject that sends the version it read. The order-intervention panel's broken controls are gone.

**Carried from run 70.** A person's refund proposal that lapsed unapproved kept its share of the refund cap for ever, though it could never be approved; the cap now leaves out a PENDING_APPROVAL refund whose window has passed.

**Mutation results.** Twelve probes, each on a rebuilt database, restored after:

| Probe | Caught by |
|---|---|
| Two people always (old) | **The schema**: `financial_correction_threshold_shape` |
| The threshold measured on the replacement's size | **The schema**: same constraint |
| The proposer may always post | *A correction over the limit was posted by its proposer* — raised by `financial_correction_maker_checker` |
| Maker-checker ignores the limit (old) | *Correction approval is stale, expired, or self-approved* at the proposer's own post within the limit |
| No guard on a second correction (old) | **The schema**: `financial_corrections_one_live_per_original` |
| A reversal may be corrected (old) | *A reversal was corrected on its own* |
| No catalogue check at proposal (old) | *A correction with an owner-less payable was previewed* |
| No reason check in the service | **The schema**: `financial_correction_reason_shape` (raised as a database error, not an input error) |
| No expiry (old) | *A proposal nobody answered did not expire* |
| Replay compared as strings | *A correction with this reference proposes something else* on the exact replay |
| No impact stored (old) | *The proposal did not record the impact its approver will see* |
| A lapsed refund proposal holds the cap (old) | *Refund exceeds the remaining captured amount* (statement walk) |

**Forward findings.** (10.7, 11.5) A correction moves the books, not the operational record it came from: correcting a settlement posting leaves the settlement's payable as it was, so its payout pays the recorded figure and the payable reads the difference owed — paid or recovered by finance, as 10.3's post-payout adjustments are. (11.5) No correction can be raised from a finance exception directly; the operator enters the posting. (D-12) Evidence is a reference, not an uploaded document.

**Verification.** `pnpm db:verify` exit 0 locally — 115 migration files (0000–0114), full ladder; `financial_corrections` 27 assertions (new), `statement_reconciliation` 26, `money_lifecycle` 43, `partner_payouts` 28, `vendor_fulfilment` 313. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:controls` exit 0; `pnpm test:unit` 612 pass / 0 fail; `pnpm test:integration` exit 0 on a migrated test stack; all twelve probes on rebuilt databases.

**Step 10.6: VERIFIED_LOCAL**, with the forward findings carried.

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
