# Versioned Configuration and Feature Flags

**Scope:** Phase 3.7 local company development with synthetic data only  
**Production authority:** None

The database package provides server-authoritative operational configuration and feature flags. PostgreSQL preserves immutable version content, maker-checker lifecycle attribution, effective versions, controlled rollback provenance, and the exact versions used by created business records.

## Configuration identity and values

Every version records:

- a stable lowercase dotted configuration key;
- a monotonically increasing version number within its key and scope;
- kind `SETTING` or `FEATURE_FLAG`;
- a typed boolean, safe integer, string, object, or array value;
- scope kind and bounded opaque scope reference;
- proposer, request, and correlation attribution; and
- optional rollback provenance.

Values are canonical JSON and limited to 65,536 encoded bytes. Feature flags accept only booleans. Clients cannot select adapters, raw database scopes, or configuration versions.

## Controlled lifecycle

The only forward lifecycle is:

```text
DRAFT → VALIDATED → APPROVED → SCHEDULED → ACTIVE → SUPERSEDED
```

The proposer cannot approve the same version. Validation, approval, scheduling, activation, and supersession append attributable lifecycle events in the same transaction as the state change. Database triggers reject skipped/backward transitions, content mutation, deletion, and history rewriting.

Only one `SCHEDULED` and one `ACTIVE` version may exist for a key/scope. Activating a replacement atomically supersedes the current active version and closes its effective interval before exposing the replacement. These unique constraints prevent ambiguous concurrent evaluation.

## Controlled rollback

Rollback never reactivates or edits an older row. `createConfigurationRollbackDraft` copies a previously active version into a new higher-numbered `DRAFT`, records `rollback_of_version_id`, and requires the same validation, different-actor approval, scheduling, and activation path as any other change.

Historical business records and lifecycle evidence therefore continue to point at the versions that actually governed them.

## Feature-flag evaluation

`evaluateFeatureFlag` considers only currently effective `ACTIVE` feature-flag versions. When several verified server-side subject dimensions match, precedence is fixed:

1. internal user;
2. vendor;
3. category;
4. zone;
5. cohort; and
6. global.

An unconfigured flag resolves to `enabled: false` with no version. Scope references must come from authenticated identity and authoritative domain records, not arbitrary client claims. This foundation does not implement percentage rollout, client-side evaluation, or analytics-provider flags.

## Business-record snapshots

`snapshotConfigurationVersions` runs inside the caller's business transaction. It stores each business record type/ID, configuration key, and activated configuration version under a unique key. Exact idempotent repeats are accepted; a changed mapping is rejected.

Snapshots and referenced versions cannot be updated or deleted. Quotes, orders, assignments, approvals, and future ledger records can therefore retain the policy and flag versions used at creation even after later configuration changes.

## Verification

`pnpm db:verify` proves against the disposable PostgreSQL/PostGIS service:

1. draft/version creation and the complete controlled lifecycle;
2. proposer/approver separation;
3. deterministic evaluation across internal-user, vendor, category, zone, cohort, and global scopes;
4. safe disabled fallback for an unconfigured flag;
5. scheduled-overlap, invalid value, and invalid lifecycle rejection;
6. atomic supersession of the prior active version;
7. rollback through a new fully approved version; and
8. immutable business-record version snapshots and lifecycle history.

It also verifies migration `0005_versioned_configuration` independently rolls back and that all six migrations can roll down, reapply, and rebuild from zero. No persistent developer database is changed.

## Current integration boundary

No admin configuration API, authorization capability, product business record, or always-running activation worker exists yet. Later phases must put these functions behind scoped server authorization and use the Phase 3.6 scheduler for due activation. Production configuration remains blocked pending approved environment, secret, audit, rollout, monitoring, and rollback operations.
