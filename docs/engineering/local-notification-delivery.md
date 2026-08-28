# Local Notification Delivery

The company-local environment now exercises notification intent, preference evaluation,
delivery attempts, retries, durable in-app inboxes, and read state without contacting a real
person or provider.

`0037_local_notifications` stores deduplicated intents, append-only channel attempts, and
per-user in-app messages. `LocalNotificationService` consumes customer-visible vendor-order
events and partner wait-policy events. The operations worker discovers new signals and processes
pending attempts every 15 seconds. `LOCAL_FAKE` is the only adapter: success, transient failure,
and permanent failure are deterministic scenarios; no network call or plaintext device token is
used.

`GET /notifications` and `POST /notifications/{id}/read` require an authenticated session and
derive ownership from that session. All four PWAs and all four Android clients expose the same
local inbox contract. Customer PUSH/SMS decisions use the reviewed notification policy and any
explicit preference; in-app operational messages remain available as the safe local fallback.

This does not authorize production push, SMS, or email. Real FCM/Web Push/SMS adapters, sender
identity, templates, credentials, cost controls, privacy approval, provider receipts, and outage
tests remain in `docs/production/test-to-production-replacement-register.md`.
