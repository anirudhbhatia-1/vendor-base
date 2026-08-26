# Debug Report — Generated output quality gate

- **Symptom:** `pnpm check` failed during `prettier --check .` on `outputs/01a02307-df32-75f0-9c9e-d89e7de0f412/build_daily_work_log.mjs`; linting the same artifact also produced repository-rule errors.
- **Root cause:** `outputs/` contains untracked generated spreadsheets, previews, inspection data, and builder internals, but the directory was missing from Git, Prettier, ESLint, and import-boundary exclusions.
- **Fix:** Treat `outputs/` consistently as generated build output in all repository quality boundaries.
- **Evidence:** The original root command `pnpm check` passes with the generated artifact left unchanged.
- **Regression test:** `tooling/scripts/check-boundaries.mjs --self-test` asserts that Git, Prettier, and ESLint continue to exclude `outputs/`.
- **Related:** Other generated directories (`dist`, `build`, `coverage`, `test-results`, and `playwright-report`) already followed this pattern.
- **Status:** DONE
