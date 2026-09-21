# Android apps: the four hosted workspaces

Each role has an Android app under `apps/<role>-app`: an Expo shell that hosts
the role's PWA in a native WebView (`packages/app-shell`). The workflows are
the web's — everything phases 5–9 verified on the PWAs runs unchanged — and
the shell adds what the device has:

- the app identity (icon, name, `android.package`, a URL scheme for deep links
  such as `neighbourhood-partner://active`);
- the hardware back button walking the workspace's history before it leaves
  the app;
- an offline banner in the shell's words (the workspaces have their own held
  states beneath: the partner's held completion, the vendor's queued actions);
- links that leave the workspace — the map handoff (`geo:`), a call — handed
  to the device;
- a failed load offering a retry instead of a blank page;
- for the partner, the foreground location permission asked on start so the
  web's geolocation prompt can be answered (arrivals, 9.4 and 9.6, are trusted
  by the device's fix);
- `window.__nativeShell = { role, release, platform }` on the page, so a
  workspace can tell it is hosted.

The native React Native screens the shells used to carry (the partner's job
panel, the vendor's orders panel, the admin's control plane, the customer's
router screens) were retired when the apps became hosted workspaces: they
were partial re-implementations of the PWAs and had fallen behind them.

## Where each app points

`resolveWorkspaceUrl` in `packages/app-shell/src/workspace-config.ts`: the
company-test deployment for the role unless the build sets
`EXPO_PUBLIC_WORKSPACE_URL` (https only, or a loopback dev server such as
`http://10.0.2.2:3102` from the emulator).

| App | Package | Scheme | Default workspace |
|---|---|---|---|
| customer | `com.neighbourhoodstore.internal.customer` | `neighbourhood-customer` | `https://shop.bravebay-be9940ed.centralindia.azurecontainerapps.io` |
| vendor | `com.neighbourhoodstore.internal.vendor` | `neighbourhood-vendor` | `https://nbhdvendortest.z29.web.core.windows.net` |
| partner | `com.neighbourhoodstore.internal.partner` | `neighbourhood-partner` | `https://nbhdpartnertest.z29.web.core.windows.net` |
| admin | `com.neighbourhoodstore.internal.admin` | `neighbourhood-admin` | `https://nbhdadmintest.z29.web.core.windows.net` |

## Building an APK

Requirements on the machine: a JDK 17 and the Android SDK (platform-tools,
platform 36, build-tools 36). On this Mac they are Homebrew's
`openjdk@17` and `android-commandlinetools`, found by the script by default;
set `JAVA_HOME` / `ANDROID_HOME` for others.

```bash
pnpm --filter ./apps/partner-app build:apk
```

runs `expo prebuild --platform android --clean` (the `android/` directory is
generated and git-ignored: Continuous Native Generation) and
`./gradlew assembleRelease`, then copies the APK to
`artifacts/android/<slug>-<release>.apk` at the repository root (git-ignored). The release build is signed
with the generated debug keystore: installable on any phone with "install
unknown apps" allowed, never a store artefact. `EXPO_PUBLIC_RELEASE_VERSION`
(defaulting to the Git head) is stamped into the app.

## Installing and testing

Copy the APK to the phone (AirDrop, USB, a shared drive) and open it; allow
installs from the source when asked. Or with a phone on USB debugging:

```bash
adb install -r artifacts/android/neighbourhood-partner-internal-<release>.apk
```

Sign in with the synthetic test accounts as on the PWA. The partner app asks
for location on first start; grant it, or arrivals become claims the store
confirms (9.4).

For a dev loop without an APK, `pnpm --filter ./apps/partner-app android`
starts Expo for a connected device or emulator; `expo prebuild` output is
required for the native WebView, so use a development build rather than Expo
Go.

## Verification

- `pnpm --filter @neighbourhood-store/app-shell test:unit`: the workspace
  resolution, the same-origin rule for navigation, deep-link mapping, the
  offline sentence.
- each app's `tests/hosted-workspace.spec.ts`: the app hosts its own
  workspace and keeps navigation inside it.
- `pnpm verify:entrypoints`: each app's Hermes export exists beside its PWA.
