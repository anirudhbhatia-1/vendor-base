# Contributing

## Before changing files

1. Read `README.md`, `implementation.md`, `phases.md` and `rules.md`.
2. Work on one numbered phase step at a time.
3. Use Node.js `24.19.0` and pnpm `11.19.0` from the repository pins.
4. Use synthetic data only. Never commit credentials, real contact/address data, OTPs, bank details, private documents or production exports.
5. Stop when a money, privacy, safety, legal, provider, deployment or production decision is unresolved.

## Local setup

```bash
pnpm install --frozen-lockfile
pnpm check
```

Copy `.env.example` to an ignored local file only when the current numbered step requires it. The example contains placeholders, not usable credentials.

## Change rules

- Import other workspace packages only through their declared package name and an explicit `workspace:` dependency.
- Do not import source from another application.
- Keep test data deterministic, fictional and unavailable to production runtime code.
- Add success, failure, timeout, duplicate, retry, authorization and recovery coverage where applicable.
- Update product contracts, tests, runbooks and production-transition records in the same change when behaviour changes.
- Do not push, deploy, purchase, activate external accounts or contact real users without explicit approval.

## Before review

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:controls
pnpm test:unit
pnpm test:integration
pnpm security:secrets
pnpm security:dependencies
```

Explain every changed file, verification result, assumption, remaining concern and rollback effect in the phase-step completion report.
