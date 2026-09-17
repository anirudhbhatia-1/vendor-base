# Repair batch 01 — startup, customer identity and partner proof eligibility

**Implemented:** 7 September 2026. **Verification level:** component/transaction-boundary tests; not connected staging acceptance.

This executes bounded items from [R0/R1/R2/R8](connected-marketplace-repair-plan.md). It does not complete those work packages or authorize launch. Existing user changes were preserved. No shared database records, migrations, real credentials or providers were changed. Parallel reviewers were unavailable due to an account usage limit; this is not an independently reviewed batch.

## Start the intended development stack

1. Stop the stack you started with Ctrl+C in its terminal. Do not kill unrelated processes.
2. From the repository root, run `pnpm dev:preflight:supabase-development`. This reads the existing ignored `infrastructure/supabase-production/.env`; it neither copies credentials nor changes their values.
3. Correct all reported missing/placeholder settings. The check validates the existing runtime profile offline, including API/worker configuration, certificate readability, synthetic acknowledgement, loopback API destination and runtime database identity syntax. It does **not** establish effective database grants.
4. Run `pnpm dev:supabase-development`. The old `dev:supabase-production` command is retained as an alias. Internal application scripts and the database target still use the legacy name so existing credentials are not silently repointed.
5. Open the customer PWA at `http://localhost:3100`. Development navigation from `127.0.0.1:3100` or `[::1]:3100` redirects to localhost before form submission. Other role PWAs remain on 3101–3103.
6. Restart API and PWAs together after these changes. An older API that cannot attest transactional customer enrolment is intentionally rejected by the new customer clients; an unusable session must not appear successful.

Preflight passed against the current configuration without connecting to Supabase. Cold start/stop, actual migrations/grants, broker readiness, queue consumption, storage access and provider delivery remain **NOT CHECKED**. No process was stopped or stack started by this batch.

For a deployed customer BFF, configure `CUSTOMER_PWA_ORIGIN` as the exact external HTTPS origin without a trailing slash in the Worker/runtime as well as the build environment. `NODE_ENV=production` fails closed for missing/invalid origins. The PWA env runner forwards this non-secret setting alongside `NEXT_PUBLIC_*`; it does not forward database/service-role credentials from the file. Leave it unset for the normal local `next dev` flow. Public production remains blocked by D-15.

## What changed

### Customer identity — CUS-01, CUS-02, CUS-03, SEC-06; canonical 4.1, 4.2, 4.5

**Before:** successful OTP verification and customer enrolment were two upstream calls. A failed enrolment could consume the code without delivering a usable customer session. Customer role denial was converted to 401 and cookies were erased. Successful login discarded the requested destination, and optional settings failure could leave the OTP form active.

**Now:**

- `/auth/otp/verify` accepts an optional boolean `customer_enrolment`. Only the fixed CUSTOMER role can be requested; supplied role/user fields do not grant authority.
- For customer completion, the existing OTP transaction creates/resolves identity and session, ensures active CUSTOMER membership, writes its existing membership audit event, and consumes the challenge together. Any enrolment failure rolls the transaction back. No new migration is needed.
- Existing active membership is reused. Disabled identities and revoked, expired or future-only customer assignments are denied. The separate self-enrolment endpoint uses the same guard. Restoration requires a controlled authorized workflow; retrying login does not restore access.
- Successful customer completion returns `customer_enrolled: true` in addition to session tokens. The PWA BFF requires that attestation before issuing cookies. Android OTP sign-in uses the corresponding typed `verifyCustomerOtp` method with platform ANDROID. Generic role OTP sign-in remains non-enrolling.
- A lost committed response still requires checking the existing session or using a fresh challenge. Consumed codes never replay plaintext tokens. Distributed/multi-tab refresh coordination remains open.
- One strict Origin check protects OTP, sign-out and backend mutations. CSRF checks remain in place for authenticated commands. Forwarded-host headers cannot establish a trusted deployment origin.
- Introspection returns 403 for customer-access denial without clearing valid cookies or automatically enrolling again. Revoked/invalid sessions still return 401. Temporary identity/proxy failures preserve already-rotated cookies.
- Sign-out reports failure when remote revocation is unavailable instead of claiming success and discarding local recovery state.
- Login validates the internal `next` destination, preserves order/checkout query paths, and rejects external, protocol-relative, encoded separator/control and token-endpoint destinations.
- Login success no longer depends on loading optional settings. A settings outage offers retry/sign-out without asking the user to consume another OTP. Access denial has a sign-out recovery action.

Main code: `database/src/customer-enrolment.ts`, `identity-access.ts`, `identity-sessions.ts`; API OTP/preferences controllers; contracts client; customer PWA origin/session/login files; Android `SignInPanel.tsx`.

### Partner proof eligibility — DLP-14; canonical 9.3

**Before:** a failed `partner/field/offline-proofs` lookup became an empty array and could enable Accept.

**Now:** explicit unknown/loading/denied/unavailable/ready states. Only a successful, fresh zero-pending result while online enables new work. The click handler rereads eligibility and the offer deadline before submitting. Permission failures, concealed 404, server outages, malformed payloads, offline/stale results all block acceptance. Reconnect refreshes the check; superseded proof reads cannot overwrite newer results. Existing custody/emergency controls remain reachable.

The shared authenticated request helper now retains HTTP status for safe UI branching. Partner typechecking excludes duplicate generated `.next` trees while retaining the active declarations imported by `next-env.d.ts`.

The running stack's original 404 cause is **not established**: registration exists, but effective capability/migration/eligibility still needs the authorized read-only diagnostic. Android partner proof parity and server races remain open.

## Verification evidence

Run from repository root unless stated otherwise. Test doubles never use real OTP/provider/database services.

| Check | Evidence and boundary |
|---|---|
| Customer PWA `tsx --tsconfig apps/customer-pwa/tsconfig.test.json --test apps/customer-pwa/app/*.spec.ts` | PASS: 65 tests covering browser helpers, BFF handlers, route policy, existing render/source controls. Not a browser automation run. |
| `node --import tsx --test database/src/customer-enrolment.spec.ts` | 9 transaction-boundary tests using a PoolClient test double: first identity, rollback, idempotent enrol, restricted membership, disabled identity, consumed-code replay, generic role isolation. Not PostgreSQL constraint/concurrency evidence. |
| API OTP/preferences/authorization specs (run inside `apps/api`) | 24 tests; flags/platform forwarding, forbidden error mapping, role/user injection ignored, session/role scope boundaries. |
| Contracts client + PWA-auth specs | 29 tests, including customer-specific OTP contract and retained HTTP status. |
| Partner PWA specs | PASS: 34 tests. Proof-state behavior plus existing source controls; no authenticated browser/device journey. |
| Development preflight specs | PASS: 2 tests. Aggregated diagnostics and credential-value redaction with isolated inputs. |
| TypeScript | Database, API, contracts, customer PWA, customer Android, partner PWA and PWA-auth targeted checks. |
| Static controls | Feature matrix: 354 features/101 steps; API contracts: 246 served routes; import boundaries. These do not prove workflow acceptance. |

Initial new BFF tests reproduced 403→401 and missing-Origin dispatch defects before the fixes. Regressions now exercise those paths, cookie preservation after rotation/outages, consumed/invalid responses, atomic-enrolment attestation and safe return paths. Final pass: 163 targeted tests passed across the suites above, including inherited source controls. Targeted typechecks/lint, formatting and the repository secret scan passed. This number is not 163 connected feature acceptances.

## Next unaccepted work, in order

1. Run G01 on an explicitly isolated PostgreSQL/PostGIS target: real rollback, concurrent enrolment/revocation, lost response, refresh replay/multi-tab and access denial. Review the new lock order under concurrency. **Partly done — see [batch 02](repair-batch-02-evidence.md).** Rollback, concurrency, revocation and access denial are now asserted against a real database, and the lock review found that nothing in the schema forbade a duplicate active role grant (migration 0070 adds the constraint). Lost response, refresh replay/multi-tab and end-to-end access denial remain open, since they live above the domain layer.
2. Run PWA browser tests for OTP → safe return → refresh → sign-out and settings outage; run Android process restart/SecureStore checks against the same completion contract. Password-based customer sign-in is a separate path and is not certified by OTP tests.
3. Perform R0 cold start/stop, migration/effective-role and Valkey/consumer health checks; health-table presence is still not broker health. **Health half done — see [batch 03](repair-batch-03-evidence.md).** Readiness now reports broker state from a real Valkey connection and consumer liveness from a durable worker heartbeat (migration 0071), with `checks.queue` renamed to `checks.job_schema` because table presence is all it ever meant. A bounded end-to-end queue canary now runs in the worker smoke. Effective database grants and the full dev-stack cold start remain open.
4. Diagnose the partner 404 in the approved environment, run authenticated proof gating/custody recovery and native parity, including server rejection under races.
5. Repair R12 stale browser selectors/OTP response URLs and create deterministic acceptance fixtures. Existing live suites still require review before running; no shared acceptance data was created here. **Selectors and harness done — see [batch 04](repair-batch-04-evidence.md).** `pnpm test:e2e` passes for the first time (15 passed, 25 skipped): the customer PWA looped for ever on 127.0.0.1, which is what the suite targets, and the golden path was wrapped in conditionals that let an empty database pass it. Deterministic fixtures still do not exist and the live-gated journeys remain unrun.
6. Complete the cross-role supply → customer order → vendor preparation → partner delivery → receipt/refund/earnings loop, then continue R3–R12 against each Launch feature. **Domain loop closed — see [batch 05](repair-batch-05-evidence.md).** The operational walk through delivery, capture, settlement and partner earning already existed; what was missing was every role-facing money view — `customerReceipt`, `vendorStatement` and `partnerStatement` appeared in no verifier, so nothing proved the four roles reconcile to the same ledger. The G10 partial-refund journey is now walked on the same order, with maker/checker and replay protection. Admin reconciliation now runs against this order too — a disagreeing provider statement raises a finance exception instead of silently adjusting the receipt. The browser/device halves remain open.

Do not mark all features/phases complete from this batch. The feature register records component evidence only; provider, device, load/security and full connected release gates remain open.
