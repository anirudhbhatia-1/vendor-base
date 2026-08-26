# API development startup debug report — 2026-08-21

**Status:** DONE

## Symptom

`pnpm --filter @neighbourhood-store/api dev` logged a Nest undefined dependency during bootstrap. Stopping the still-running `tsx watch` process then produced pnpm exit status 130. VS Code separately displayed `File 'expo/tsconfig.base' not found` for `apps/admin-app/tsconfig.json`.

## Root cause

The API development script executes TypeScript through `tsx`. Unlike the compiled `tsc` integration path, that runtime does not emit `design:paramtypes` metadata. `AuthorizationGuard` explicitly decorated only its session-service parameter and depended on emitted constructor metadata for `Reflector` and `AuthorizationEnforcementService`. Nest therefore could not resolve two guard dependencies during development bootstrap.

Exit status 130 was the later SIGINT/Ctrl+C result, not the original bootstrap cause.

The Expo editor diagnostic is independent. The dependency and `expo/tsconfig.base.json` symlink exist, `require.resolve` succeeds from the app, and the workspace TypeScript 5.9.3 command-line typecheck passes. This is stale or non-workspace VS Code TypeScript-service state rather than a missing package.

## Fix

`apps/api/src/authorization.guard.ts` now applies `@Inject` to all three constructor dependencies. This removes any dependency on emitted constructor metadata in the development runtime.

## Regression test

`apps/api/src/authorization.guard.spec.ts` asserts that `self:paramtypes` contains explicit injection metadata for constructor indices 0, 1, and 2. The test executes through `node --import tsx`, matching the development transpilation behavior.

## Evidence

- Before the fix, the source runtime exposed explicit injection metadata only for index 1 and Nest logged an undefined dependency.
- After the fix, all 14 API unit tests pass.
- The fixed `tsx watch` API mapped all routes and logged `api.started` on `127.0.0.1:3001`.
- `GET /health/live` returned `200` with the expected safe local/synthetic response.
- The admin Android app command-line typecheck resolves the Expo base configuration successfully.

## Related

When adding Nest providers used under `tsx`, constructor dependencies must use explicit `@Inject(...)` tokens. Compiled integration tests alone cannot detect reliance on TypeScript decorator metadata.
