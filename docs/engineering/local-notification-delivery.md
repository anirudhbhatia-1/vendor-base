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

The shop's alert (phases.md 8.1, audit run 49). When the outbox delivers `order.placed`, the
worker calls `alertStaffOfPlacedOrder` before dispatch: one `vendor_order_event.placed` intent per
current staff member of the location (an active role assignment with a membership there), in-app
and push, whose payload carries the order's reference, `accept_by` and `audible: true`; the
deduplication key is the order and the person, so an outbox retry alerts nobody twice, and an
order no longer `PLACED` alerts nobody at all. The vendor console sounds (two synthesised notes;
a page nobody has touched cannot sound, which is what the push is for) and marks the alerts for
the orders it is showing read — that read is the acknowledgement. `escalateUnacknowledgedOrders`
runs in the worker sweep: an order still `PLACED` after the configured wait, still inside its
deadline, with no read alert for it, is raised once to the location's owners as
`vendor_order_event.placed_escalation` on the configured channels. The policy is the `SETTING`
`vendor.order_alert_escalation` (`after_seconds` 15–600, `channels`), defaulting to 60 seconds on
IN_APP, PUSH and SMS. Until run 49 nothing told the shop of a new order and nothing escalated.

A customer decision's notice (8.4, run 52) carries what the customer needs to answer it: the
event's `decision_id` (0096) joins the decision, its line and the offered product, so
`vendor_order_event.substitution_proposed` / `weight_proposed` — and the shop-applied
`substitution_approved` / `weight_approved` — carry `ordered_title`, `ordered_quantity`,
`ordered_unit_price_minor`, `offered_title`, `offered_quantity`, `offered_unit_price_minor`,
`difference_minor`, `reason_note`, `decision_deadline_at`, `order_reference` and `location_name`.

`GET /notifications` answers `{ notifications: [...] }`, the name the contract gives it; it used to
answer a bare array, which the reference interceptor wrapped as `data`, so every inbox that read
`notifications` off the answer showed nothing (run 49). `GET /notifications` and
`POST /notifications/{id}/read` require an authenticated session and derive ownership from that
session. All four PWAs and all four Android clients expose the same
local inbox contract. Customer PUSH/SMS decisions use the reviewed notification policy and any
explicit preference; in-app operational messages remain available as the safe local fallback.

This does not authorize production push, SMS, or email. Real FCM/Web Push/SMS adapters, sender
identity, templates, credentials, cost controls, privacy approval, provider receipts, and outage
tests remain in `docs/production/test-to-production-replacement-register.md`.
