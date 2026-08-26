# Vendor and location domain

**Phase:** 5.1  
**Environment:** company-local synthetic development only  
**Production authority:** none

## Outcome

Migration `0010_vendor_network` introduces a vendor aggregate and independently versioned vendor-location aggregates. A vendor owns one or more physical locations; staff memberships now reference an existing location instead of an unconstrained UUID. The customer-facing category is deliberately limited to `FRUIT_VEGETABLE` for the Jaipur pilot. Kirana and regulated categories remain disabled until their product and compliance rules are approved.

All company-test names must start with `SYNTH`. Coordinates use PostGIS geography with SRID 4326, money is stored as integer INR minor units, and preparation time is stored in seconds. Vendor and location mutations require an expected version and append attributable history in the same transaction.

## Aggregate states

Vendor transitions:

```text
DRAFT -> ACTIVE -> SUSPENDED -> ACTIVE
                   |             |
                   +-- CLOSED <--+
```

An active vendor may also close directly. `CLOSED` is terminal.

Location transitions:

```text
DRAFT -> ACTIVE -> PAUSED -> ACTIVE
          |          |
          +-- CLOSED-+
```

Onboarding reviewer evidence belongs to Phase 5.2. Phase 5.3 adds publication approval and atomically calls the guarded lifecycle primitive introduced here.

## Location operations

`VendorNetworkService` provides transactional operations for:

- synthetic business and location profile creation and editing;
- lifecycle changes with optimistic concurrency;
- replacing non-overlapping weekly operating windows;
- closed-date or special-hours calendar exceptions;
- bounded temporary closures;
- PostGIS polygon service zones that must contain their location;
- admin-approved pickup, vendor-delivery, and platform-delivery modes; and
- minimum-order and preparation-time settings.

Operating windows are same-day intervals. Overnight trading must be represented as two windows on adjacent days so date and holiday precedence stays explicit. One calendar exception is allowed per local date. A temporary closure overrides every schedule.

## Operational status contract

Status evaluation converts the requested instant using the location's IANA timezone and applies precedence in this order:

1. vendor inactive;
2. location inactive;
3. temporary closure;
4. closed calendar date;
5. special hours or regular weekly hours;
6. optional service-zone containment.

The result returns `open`, one stable reason, approved fulfilment modes, the minimum order, currency, and configured preparation duration. It does not promise an exact delivery time; later capacity and order workflows must produce honest operational estimates.

## Isolation and history

The location-to-vendor foreign key prevents orphan locations. The staff-membership foreign key prevents assignment to a guessed or nonexistent location. Service settings are keyed by location, and all geographical queries include that location identifier. Fulfilment modes require an authenticated admin actor because they express platform approval, not a vendor preference alone.

`vendor_network_events` is append-only and unique for each aggregate version. A stale expected version fails without partially changing schedules, zones, fulfilment modes, or profile state.

## Verification

`verify-vendor-network.ts` proves:

- real-looking names are rejected in company-test state;
- aggregate creation and lifecycle rules;
- INR, timezone, coordinate, minimum, and preparation settings;
- application and database rejection of overlapping hours;
- holiday and temporary-closure precedence;
- PostGIS inside/outside serviceability;
- admin-only fulfilment approval;
- stale-write rejection; and
- append-only version evidence.

Run the complete disposable PostGIS proof with `pnpm db:verify`. Phase 5.2 adds onboarding commands and protected-document references; Phase 5.4 will add authorized vendor settings screens and APIs.
