# Identity and access isolation proof

**Status:** Phase 4.6 verified locally  
**Environment:** synthetic company development only

Phase 4.6 closes the identity foundation by proving that authenticated identities cannot cross customer, vendor-location, partner-assignment, or admin boundaries. It adds no vendor, order, assignment, or approval aggregate ahead of its owning phase; it verifies the reusable policy and ownership boundary those modules must invoke.

## Automated abuse matrix

| Required case | Proof layer | Expected result |
|---|---|---|
| Cross-customer read | API guard ownership test and customer-preference database verifier | A valid session cannot read another customer; the result is concealed |
| Cross-vendor write | Real PostgreSQL role evaluator with a vendor manager at location A requesting `vendor.catalogue.manage` at location B | `DENY_BY_DEFAULT` |
| Wrong-location staff | Real PostgreSQL role evaluator with a picker assigned to location A acting at location B | `DENY_BY_DEFAULT` |
| Inactive partner assignment | Pending, eligible-without-assignment, wrong-assignment, and ended-assignment database scenarios | `DENY_BY_DEFAULT`; activation conflicts leave no partial membership |
| Wrong admin role | Finance operator requesting the separate refund-approval capability | `DENY_BY_DEFAULT` |
| Self-approval | Database-enforced maker/checker role separation and admin self-grant rejection | Transaction rejected with no grant/event residue |
| Object-reference guessing | API guard exercises 16 valid opaque guesses plus malformed input | Every valid unauthorized guess produces the same concealed 404; malformed identifiers produce safe 400 |
| Redacted logs | Domain redaction unit tests and API process-output smoke test | OTP, phone, access/refresh/device/notification tokens, authorization data, and configured secret sentinels never appear |

The cross-vendor test proves the write capability boundary because the vendor/catalogue aggregates intentionally begin in Phase 5. Every Phase 5 mutation route must load its authoritative location ownership and pass it to the same enforcement service; policy proof does not replace that future domain-route test.

## Safe denial and observability

Authorization failures expose only the stable 401, 403, 404, or validation envelope plus request reference. Concealed resource denials do not reveal whether an opaque object exists. Logs retain safe request/correlation/trace identity, status, and stable error code, while actor identity appears only after successful authentication and authorization.

OTP abuse controls remain transactionally measured through delivered, failed, verified, locked, and wrong-attempt counts. The lifecycle verifier covers phone/device limits, resend cooldown, attempt lockout, expiry, replay, and provider-fault fixtures without logging OTP content.

## Verification commands

```bash
pnpm db:verify
pnpm check
pnpm build:verify
```

`pnpm db:verify` uses a disposable PostgreSQL/PostGIS database and emits `identity_isolation_scenarios: 8` only after the complete matrix passes. `pnpm check` runs the API guard, redaction, smoke, boundary, dependency, and secret-scanning controls.

## Phase 4 exit gate

- Later modules can declare a fine-grained capability and provide authoritative owner, vendor-location, active-assignment, or admin-scope evidence.
- Session authentication never grants a role implicitly.
- Missing or mismatched evidence denies by default.
- Cross-role isolation and OTP abuse controls are tested and observable with safe metadata.

Phase 5 may now begin with vendor and vendor-location aggregates. It must preserve these boundaries and add route-level sibling-vendor tests when real vendor resources exist.
