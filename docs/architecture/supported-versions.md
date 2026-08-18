# Supported versions for internal development

**Baseline date:** 13 August 2026  
**Scope:** Free local company development only

This file records approved release families. Phase 2 must resolve exact dependency patches into `pnpm-lock.yaml` and exact container tags or immutable digests into `compose.yaml`. `latest`, canary, beta, release-candidate, and unbounded dependency ranges are prohibited.

| Component | Approved family | Resolution rule |
|---|---|---|
| Node.js | 24 LTS | Pin one supported 24.x patch in the repository toolchain file |
| pnpm | 11.x stable | Pin the exact version through Corepack/package-manager metadata |
| TypeScript | Stable release compatible with all selected frameworks | Pin exact patch in the shared lockfile |
| Next.js | 16.x Active LTS | Pin exact patch; do not use canary |
| Expo | SDK 56 | Let Expo select its compatible React and React Native versions; keep the matched set together |
| React Native | Expo SDK 56 compatible line | Do not override the Expo-supported version without an ADR |
| NestJS | 11.x | Pin all Nest packages to a compatible exact set |
| Fastify | NestJS 11 adapter-compatible line | Resolve and test exact patch during scaffolding |
| PostgreSQL | 18.x | Pin an exact Compose image tag/digest |
| PostGIS | 3.6.x | Use an image that proves PostgreSQL 18 compatibility; assert extension version in tests |
| Drizzle ORM and Drizzle Kit | Mutually compatible stable releases | Pin exact patches; review generated SQL |
| Valkey | 9.1.x preferred | Pin exact container tag/digest; acceptance depends on BullMQ contract tests |
| Redis | 7.2.x fallback only | Pin exact container tag/digest; run only in the compatibility profile |
| BullMQ | Stable release compatible with the selected Node client and both queue datastores | Pin exact patch and pass the dual-store contract suite |
| Jest, Supertest, Playwright | Stable mutually compatible releases | Pin exact patches in the lockfile |
| Maestro CLI | Stable local CLI | Pin the version in setup documentation and verify its checksum/source |
| Podman Desktop | Current stable developer installation | Record the tested version; keep `compose.yaml` compliant with the Compose specification |

## Upgrade rule

1. Open a deliberate dependency or container upgrade change.
2. Read upstream migration and security notes.
3. Update exact pins and the generated lockfile together.
4. Run type checks, linting, unit tests, integration tests, migrations, PWA journeys, Android smoke tests, and queue compatibility tests as applicable.
5. Record any supported-family change in a new or superseding ADR.

No version in this document selects a hosting provider or authorizes production use.

## Resolved Step 2.1 toolchain pins

| Component | Exact repository pin | Recorded in |
|---|---:|---|
| Node.js | `24.19.0` | `.node-version`, `.nvmrc`, root `package.json` |
| pnpm | `11.19.0` | root `package.json` `packageManager` and `engines` |
| TypeScript | `5.9.3` | root `package.json` and `pnpm-lock.yaml` |
| ESLint | `10.8.1` | root `package.json` and `pnpm-lock.yaml` |
| typescript-eslint | `8.67.0` | root `package.json` and `pnpm-lock.yaml` |
| Prettier | `3.9.6` | root `package.json` and `pnpm-lock.yaml` |

## Resolved Step 2.3 application pins

| Component | Exact repository pin | Recorded in |
|---|---:|---|
| Next.js | `16.3.1` | PWA manifests and `pnpm-lock.yaml` |
| Expo | `56.0.19` | Android manifests and `pnpm-lock.yaml` |
| Expo Status Bar | `56.0.4` | Android manifests and `pnpm-lock.yaml` |
| React / React DOM | `19.2.3` | client manifests and `pnpm-lock.yaml` |
| React Native | `0.85.3` | Android manifests and `pnpm-lock.yaml` |
| NestJS core/common/Fastify adapter | `11.2.1` | API and worker manifests and `pnpm-lock.yaml` |
| NestJS BullMQ integration | `11.0.5` | worker manifest and `pnpm-lock.yaml` |
| Fastify | `5.12.0` | API manifest and `pnpm-lock.yaml` |
| BullMQ | `6.1.2` | worker manifest and `pnpm-lock.yaml` |
| RxJS | `7.8.2` | API and worker manifests and `pnpm-lock.yaml` |
| reflect-metadata | `0.2.2` | API and worker manifests and `pnpm-lock.yaml` |

## Resolved Step 2.4 database pins

| Component | Exact repository pin | Recorded in |
|---|---:|---|
| PostgreSQL/PostGIS image | `postgis/postgis:18-3.6@sha256:db8c151a4e1f4686b1a985a3490cf96f9f8c8c2725f58a46ef7a57e52f167cc3` | `compose.yaml` |
| PostgreSQL/PostGIS contents | PostgreSQL `18.x`, PostGIS `3.6.4` | Image tag plus lifecycle version assertions |
| Drizzle ORM | `0.45.2` | `database/package.json` and `pnpm-lock.yaml` |
| Drizzle Kit | `0.31.10` | `database/package.json` and `pnpm-lock.yaml` |
| node-postgres | `8.23.0` | `database/package.json` and `pnpm-lock.yaml` |
| node-postgres types | `8.20.0` | `database/package.json` and `pnpm-lock.yaml` |

## Resolved Step 2.5 CI pins

| Component | Exact repository pin | Recorded in |
|---|---:|---|
| GitHub hosted runner | `ubuntu-24.04` label with a 30-minute job timeout | `.github/workflows/ci.yml` |
| `actions/checkout` | `7.0.1` at `3d3c42e5aac5ba805825da76410c181273ba90b1` | `.github/workflows/ci.yml` |
| `pnpm/setup` | `2.0.2` at `bf5bfae7d43e2b2b1191383f5005cd3fb69b848d` | `.github/workflows/ci.yml` |
| `actions/upload-artifact` | `7.0.1` at `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` | `.github/workflows/ci.yml` |

GitHub Actions remain pinned to reviewed full commit hashes. Dependabot may propose updates, but the CI workflow verifier and mandatory quality gate must pass before an action pin changes.

Product test-runner patches remain unresolved until their owning numbered step introduces them. Do not add placeholder version claims to the lockfile.
