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

