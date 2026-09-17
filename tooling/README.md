# Tooling

This directory owns the repository controls: the scripts that decide whether a change is
allowed to merge. `pnpm lint`, `pnpm test:controls` and CI run them.

| Script | Enforces |
|---|---|
| `check-boundaries.mjs` | Which workspace package may import which |
| `check-dependency-policy.mjs` | Exact external versions, `workspace:` for local packages, private manifests |
| `check-directory-ownership.mjs` | Every top-level directory documents what it owns and may import |
| `verify-api-contracts.mjs` | Served routes match the published contracts |
| `verify-feature-matrix.mjs` | Capabilities reconcile with FEATURES.md, name their phase steps and their verifiers |
| `verify-ci-workflow.mjs` | The CI workflow keeps its mandatory gates |
| `verify-client-entry-points.mjs` | Each client builds to a real entry point |
| `verify-online-test-deployment.mjs` | The deployment skeleton fails closed on private material |
| `scan-secrets.mjs` | No committed credentials |
| `load-smoke.mjs`, `e2e-smoke.mjs`, `online-test-health.mjs` | Runtime smoke checks |

A control may import Node built-ins only. It must not import application source, a shared
package or a test framework: a control that depends on the code it judges can be made to pass
by changing that code. Every control exposes `--self-test` so the control itself is tested.
