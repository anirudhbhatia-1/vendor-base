# Phase 7 grouped checkout

Phase 7 is implemented for the approved company-local, synthetic-data environment. It converts one authenticated customer's validated grouped cart into one checkout group, one prepaid synthetic payment authorization, and exactly one independent order for every quoted vendor location.

## Transaction boundary

`GroupedCheckoutService.createQuote()` revalidates ownership, delivery address, active vendor/location/publication state, service area, current product/variant/price versions, store minimum, and counted inventory. It calculates INR amounts only in integer paise under `SYNTH-POLICY-D05-LOCAL-V1`. A five-minute quote stores immutable group and line snapshots and creates row-locked per-line inventory holds. Invalid sibling groups are returned with an explicit reason and do not consume stock. The blocked reasons are `FULFILMENT_METHOD_UNAVAILABLE` (the store no longer offers the group's method — checked first, because the customer can repair it without changing what they are buying), `MINIMUM_NOT_MET` and `INVENTORY_UNAVAILABLE`. A `CUSTOMER_PICKUP` group is priced with no delivery fee; delivery groups carry the distance fee. Before batch 10 the pricing ignored the method and charged every group the distance fee, collection included.

`place()` owns checkout idempotency. The customer and quote are rechecked, expired quotes are released, current catalogue/location versions must still match, and a repeated quote or customer idempotency key returns the original checkout. A successful authorization creates the checkout, vendor orders, order-line snapshots, provisional reservations, exact payment allocations, aggregate transitions, checkout/payment/inventory history, and transactional outbox events in one PostgreSQL transaction.

Declines commit the release of only that quote's reservations and create no order. Timeout, network-equivalent, or malformed provider outcomes are stored as `PAYMENT_UNKNOWN`; the client is told not to retry payment. A later verified webhook can finalize or cancel the same checkout.

## Provider boundary

`MoneyProviderAdapter` separates authorization, capture, refund, and status operations from checkout. `LocalFakeMoneyProvider` supplies deterministic `SUCCESS`, `DECLINE`, `UNKNOWN`, and `MALFORMED` company-test scenarios. It is synthetic by design and must be replaced through the production replacement register before any real-money environment.

The local webhook endpoint verifies the HMAC-SHA256 signature over the exact JSON payload, a five-minute timestamp window, provider event shape, provider operation ownership, and unique event identity. Receipts are persisted before processing. Replayed events return a replay result without duplicating orders, allocations, transitions, or outbox records.

## Customer API and projection

- `POST /customer/checkout/quotes`
- `POST /customer/checkout/groups`
- `GET /customer/checkout/groups/:checkout_group_id`
- `GET /customer/checkout/groups/:checkout_group_id/history`
- `POST /customer/checkout/provider-webhook` (signature-verified provider boundary; no customer capability)

Customer routes require `customer.checkout.manage` and conceal cross-customer identifiers. The group projection exposes only overall and child-order summaries. It derives aggregate status from child states and does not expose another store's product or finance details. History is cursor-based and carries request/correlation references.

The customer PWA loads the authenticated active cart, displays each quoted and blocked store, fulfilment method, promise, decision rule, amount breakdown, combined authorization, and the zero local buffer. It presents UPI, card, and wallet test choices, explicitly disables COD, and handles decline, unknown, partial blockage, success, and reconnect-safe result retrieval.

## Verification

The connected verifier covers a three-store cart with an unavailable sibling, quote retry, checkout retry, exact order/allocation counts, ownership concealment, malformed provider response, signed webhook success, and webhook replay. Existing inventory, money, cart, aggregate, messaging, and access verifiers cover row-lock contention, expiry/release, state-transition integrity, outbox integrity, and controlled finance behavior.

Run:

```sh
pnpm db:test:up
pnpm --filter @neighbourhood-store/database verify:lifecycle
pnpm check
```

No real payment, customer data, provider credential, SMS, or cloud service is used.
