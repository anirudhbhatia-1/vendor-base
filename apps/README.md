# Applications

Runtime applications live here. An application may import an approved shared package from `packages/`, but it must not import source code from another application.

Step 2.1 creates package boundaries only. Framework dependencies, entry points, routes, screens, runtime configuration and health checks belong to later numbered steps.

| Directory | Owner | Responsibility |
|---|---|---|
| `customer-pwa/` | Customer web team | Next.js customer PWA and browser-specific states |
| `customer-app/` | Customer mobile team | Expo/React Native customer Android app and device-specific states |
| `vendor-pwa/` | Vendor web team | Next.js vendor PWA and browser-specific states |
| `vendor-app/` | Vendor mobile team | Expo/React Native vendor Android app and device-specific states |
| `partner-pwa/` | Delivery web team | Next.js delivery-partner PWA and browser-specific states |
| `partner-app/` | Delivery mobile team | Expo/React Native delivery-partner Android app and device-specific states |
| `admin-pwa/` | Operations web team | Next.js admin/support PWA and browser-specific states |
| `admin-app/` | Operations mobile team | Expo/React Native admin/support Android app and device-specific states |
| `api/` | Backend team | NestJS/Fastify modular-monolith HTTP process |
| `worker/` | Backend/platform team | Independently runnable NestJS/BullMQ background worker process |

Each role receives both clients: one Next.js PWA and one Expo/React Native Android app. The Android app is a native shell that hosts the role's PWA in a WebView (`packages/app-shell`), so every workflow is the web's and the shell adds the device states — offline, the back button, external links, the location permission — and the app identity; see `docs/engineering/android-apps.md` for how the four are built and installed. Browser applications will use the Next.js App Router when their entry points are created. The API remains the authority for permissions, prices, availability and workflow transitions.
