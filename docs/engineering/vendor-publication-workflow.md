# Vendor publication workflow

**Phase:** 5.3  
**Environment:** company-local synthetic development only  
**Production authority:** none

## Outcome

Migration `0012_vendor_publication` and `VendorPublicationService` add the independent approval boundary between an approved onboarding case and an active storefront. Publication preparation and approval use separate global admin capabilities and mutually exclusive operator/reviewer roles. Every case is versioned, every decision includes a stable reason and note, and every event preserves the readiness snapshot used at that moment.

Publishing updates the publication case, vendor aggregate, vendor-location aggregate, and their append-only evidence in one PostgreSQL transaction. The console therefore cannot report a storefront as published if its underlying vendor or location activation failed.

## Publication lifecycle

```text
DRAFT -> PENDING_APPROVAL -> APPROVED -> PUBLISHED -> PAUSED -> PUBLISHED
              |                              |
              +-> CHANGES_REQUIRED           +-> UNPUBLISHED
                       |                      PAUSED -> UNPUBLISHED
                       +-> PENDING_APPROVAL
```

The proposal creator cannot approve the same case. A stale expected version fails without changing readiness, aggregate states, or history. `UNPUBLISHED` is terminal in this phase; restoring it requires a future reviewed workflow rather than silently reusing old approval.

## Launch strip

The server computes six checks from authoritative database state:

1. approved onboarding linked to the vendor and location;
2. complete vendor and location descriptions;
3. at least one operating-hours window;
4. at least one active PostGIS service zone;
5. at least one admin-approved fulfilment mode; and
6. the latest publication-affecting verification documents are approved and not beyond expiry/grace.

Submission and approval fail closed while any check is missing. The API returns stable missing-check keys rather than client-calculated readiness.

Catalogue review, prohibited-item checks, image quality, fee-impact preview, and an end-to-end test order remain mandatory before real marketplace launch. Their aggregates do not exist yet, so Phase 5.3 does not fabricate evidence for them. They must be added as server-side launch-strip checks by their owning phases before production authority can be proposed.

## Operations and evidence

An approved case can be published. A published location can be paused and restored; a published or paused location can be unpublished. Each action records actor, previous/resulting state, reason, note, request/correlation identifiers, timestamp, and the complete readiness snapshot. Publication evidence is protected against update and deletion by a database trigger.

The API exposes the filtered pipeline and commands under `/admin/vendor-publications`. Preparation, readiness, submission, publish/pause/unpublish use `admin.vendor_publication.manage`; independent approval or changes-required decisions use `admin.vendor_publication.review`. Resource denials are concealed.

The admin PWA uses a desktop queue/workbench layout and the Android app uses a horizontal case queue with a phone-sized review surface. Both show the same six-check launch strip and maker-checker warning. Their current controls demonstrate synthetic states locally; server APIs remain authoritative.

## Verification

`verify-vendor-publication.ts` proves incomplete readiness rejection, all six computed checks, stale-safe submission, self-approval rejection, independent approval, atomic publication, pause, restore, unpublish containment, pipeline reads, and immutable evidence. The complete lifecycle additionally proves migration down/up boundaries and rebuild from zero.

Run:

```sh
pnpm db:verify
pnpm check
pnpm build:verify
```
