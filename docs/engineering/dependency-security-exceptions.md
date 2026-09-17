# Dependency security exceptions

**Scope:** Company-local development only

**Last reviewed:** 6 September 2026

**Owner:** Engineering Lead

An audit exception is not a claim that an advisory is harmless. It records why an otherwise-blocking advisory cannot currently be upgraded, the bounded exposure accepted for local work, and the event that ends the exception. Production, a shared build service, or untrusted file processing requires a fresh security decision.

## Active high-severity exceptions

| Advisory | Dependency path | Why an upgrade is not applied | Local exposure and controls | Removal trigger |
|---|---|---|---|---|
| `GHSA-w3rx-r6r6-pgpr` — ICNS parser infinite loop | Expo SDK 56 / React Native 0.85.3 → Metro 0.84.4 → `image-size@1.2.1` | The registry advisory names `image-size>=2.0.3` as patched, but `2.0.3` was not published when checked. Metro also declares the incompatible `^1.0.2` range, so forcing the current 2.x release would be an unverified major override. | Metro runs only on developer workstations against reviewed repository assets. Step 2.3 includes no ICNS asset, upload path, external asset ingestion, shared builder or production deployment. Do not add ICNS input. | Remove the ignore and upgrade Expo/Metro or its dependency immediately when a compatible patched release exists; review sooner if any external asset, shared runner or deployment is proposed. |
| `GHSA-5p2g-fcmc-qvqq` — JXL/HEIF parser infinite loops | Expo SDK 56 / React Native 0.85.3 → Metro 0.84.4 → `image-size@1.2.1` | Same unavailable `image-size>=2.0.3` patch and Metro compatibility constraint as above. | Same repository-controlled local build boundary. Step 2.3 includes no JXL or HEIF asset. Do not add JXL or HEIF input. | Same compatible-upgrade trigger; review sooner if any external asset, shared runner or deployment is proposed. |

**Re-verified 6 September 2026.** The premise still holds: the newest published `image-size` is `2.0.2`, so the `>=2.0.3` the advisory names as patched does not exist yet and the removal trigger has not fired. The installed version remains `1.2.1`. Checked with `npm view image-size versions`; re-check it rather than trusting this line, because the exception ends the day that release appears.

The explicit `--ignore` values live in the root `security:dependencies` script so an exception cannot be mistaken for a clean unqualified audit. `pnpm audit --json` remains the command for viewing all findings without exceptions.

## Monitored moderate finding

`GHSA-w5hq-g745-h8pq` affects `uuid@7.0.3` through Expo's Xcode configuration tooling. It is below the repository's high-severity blocking threshold, Android is the selected local target, and forcing `uuid@11.1.1` across a major-version boundary is not justified. Review it with the same Expo/Metro upgrade and before any iOS work.
