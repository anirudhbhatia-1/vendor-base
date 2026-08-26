# Assignment and Custody Lifecycle

**Phase:** 5.5  
**Scope:** Company-local synthetic development only  
**Production authority:** None

Phase 5.5 establishes the delivery attempt and physical package-custody boundary. It does not create real orders, route tracking, customer addresses, navigation, provider OTPs, payments, earnings, or production dispatch authority.

## State ownership

An assignment attempt advances through:

```text
UNASSIGNED → OFFERED → ASSIGNED → AT_VENDOR → PICKED_UP
           → EN_ROUTE_TO_CUSTOMER → ARRIVED → DELIVERED
```

Before pickup, an attempt may end as `DECLINED`, `OFFER_EXPIRED`, `FAILED_PICKUP`, `REASSIGNED`, or `CANCELLED`. After pickup, ordinary cancellation is rejected. Failed delivery follows the controlled branch:

```text
DELIVERY_FAILED → RETURN_REQUIRED → RETURN_AUTHORIZED → RETURNING → RETURNED
```

Custody is separate from assignment status. Confirmed pickup records `PICKUP_VERIFIED` and `IN_CUSTODY`; only a verified delivery or return closes custody as `DELIVERED` or `RETURNED`.

## Invariants

- A partial unique index permits only one active attempt for a synthetic source-order reference.
- Offer acceptance rechecks an active eligible delivery-partner role and rejects expired offers.
- Acceptance opens an exact assignment membership; completion, return, or a permitted pre-pickup ending closes it.
- Partner reads and actions require the authenticated partner to match that exact active assignment.
- Pickup requires vendor confirmation, the assignment's exact package count, and a marked synthetic proof reference.
- Every mutation carries an expected version and a globally unique command reference. An exact retry replays its prior result; reuse for another assignment or intent is rejected.
- Assignment and custody history are append-only. Direct update or deletion is blocked by database triggers.
- Only an admin-authorized return task may enter `RETURNING`; its synthetic destination and completion proof remain attributable.

## API boundaries

Delivery partners may accept or decline their own offers, read their own active assignment, record arrival/pickup/route/delivery states, and progress the controlled return path. Eligibility authorizes only offer decisions. All work after acceptance requires the exact active assignment membership.

Administrators with `admin.delivery.assignment_manage` may create and offer synthetic attempts, authorize returns, or end a pre-pickup attempt. Public references never grant access. Cross-partner reads are concealed as not found.

## Local interfaces

The partner PWA and Android app render the same synthetic active-job fixture: approximate pickup/drop areas, verified package count, a sequential custody lane, and the controlled-return rule. Their buttons change local screen state only and are explicitly labelled as not sending API commands. This preserves honest local demonstration until authenticated client-to-API integration has an owning phase.

## Verification

The dedicated verifier covers successful delivery, exact retry replay, wrong-partner concealment, package-count mismatch, custody creation, rejected post-pickup cancellation, the full authorized-return branch, server-time offer expiry, membership closure, and append-only evidence. It is also part of the disposable lifecycle proof.

```sh
pnpm --filter @neighbourhood-store/database typecheck
pnpm db:verify
pnpm check
pnpm build:verify
```

Production requires separate approved decisions for live order ownership, identity and personal data, dispatch policy, maps/location, proof providers, partner operating model, payments/earnings, monitoring, recovery, and credentials.
