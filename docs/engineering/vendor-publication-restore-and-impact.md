# Vendor Publication: Restore and Impact Preview

**Scope:** phases.md Phase 5 step 5.3 remainder — completes the admin vendor pipeline's "publish,
pause, unpublish, and restore actions" and gives pause/unpublish/restore an impact preview,
company-local synthetic development only
**Production authority:** None

## What this closes

`vendor-publication-workflow.md` and `database/src/vendor-publication.ts` already covered pipeline
list/filters, readiness checklist, submit/decide, publish, pause, and unpublish, and full audit
evidence. Two of phases.md 5.3's five items were still open:

1. **A distinct `restore` action.** `publish()` could resurrect a `PAUSED` case, but a case that had
   gone all the way to `UNPUBLISHED` had no path back to `PUBLISHED` at all.
2. **Impact-aware pause/unpublish/restore.** Nothing surfaced what a transition would affect before
   an admin committed to it.

## Restore

`VendorPublicationService.restore()` transitions `UNPUBLISHED → PUBLISHED` through the same
`#operate` state machine as every other transition: it re-checks full readiness (profile, hours,
zone, fulfilment, and now the two current `VENDOR_PUBLICATION` documents), and records the
resulting event with `event_type = 'PUBLISHED'` and `previous_state = 'UNPUBLISHED'`. No new event
type or schema change was needed — the existing `previous_state` column already gives the audit
trail everything it needs to distinguish a restore from a first publish. `publish()` itself
continues to refuse an `UNPUBLISHED` case (`from: ['APPROVED', 'PAUSED']` only), so the two actions
stay distinct in code, not just in name.

## Impact preview

`VendorPublicationService.impact({ publication_case_id })` returns the count of currently `ACTIVE`
`cart_vendor_groups` and `ACTIVE` `catalogue_products` referencing the case's vendor location. It is
purely informational: it never blocks a transition, and calling it never mutates cart or catalogue
state. The customer's own `revalidate()` call (Phase 6.7) is what later resolves whatever impact
this surfaces — pausing or unpublishing a store does not retroactively touch carts that already
reference it.

Routes: `POST :publication_case_id/restore` and `GET :publication_case_id/impact`, both behind
`admin.vendor_publication.manage`.

## What is still deliberately not built: the test-order gate

`vendor-publication-workflow.md` already states why: *"Catalogue review, prohibited-item checks,
image quality, fee-impact preview, and an end-to-end test order remain mandatory before real
marketplace launch. Their aggregates do not exist yet, so Phase 5.3 does not fabricate evidence for
them."* An end-to-end test order needs the order aggregate, which is Phase 7's job. Building a
"test order" gate now would either fabricate evidence against an order that cannot exist yet, or
require pulling forward Phase 7 work into Phase 5 — both are excluded by `phases.md` §2.2 ("no
hidden bundling"). This item is carried forward as a Phase 7-dependent launch-strip check, not
closed here.

## Verification

Covered by `database/scripts/verify-vendor-staff.ts` (scenarios 10 in its own numbering), which
drives a real fixture through `PUBLISHED → PAUSED → UNPUBLISHED`, asserts `publish()` refuses the
`UNPUBLISHED` case, asserts `restore()` succeeds and records the correct `previous_state`, and
asserts the impact preview counts a real cart group created against the location before the pause.
See [vendor staff and settings](vendor-staff-and-settings.md) for the rest of that verifier.
