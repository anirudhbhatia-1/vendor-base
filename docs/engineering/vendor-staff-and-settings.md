# Vendor Staff and Settings

**Scope:** phases.md Phase 5 step 5.4, company-local synthetic development only
**Production authority:** None

## Outcome

Migration `0022_vendor_staff_settings` and `VendorStaffService` let a vendor location's own owner
and manager invite/revoke staff, read a permission summary, and edit store profile, hours,
closures, service zones, and ordering settings — all self-service, none of it routed through admin.
Before this slice, `VendorNetworkService` (Phase 5.1) held all of this data but only an `admin`
actor could touch it, and `IdentityAccessService.grantVendorMembership` had no HTTP surface at all;
a vendor location's own staff had no way to manage themselves or their store.

## Roles

`VENDOR_OWNER`, `VENDOR_MANAGER`, `VENDOR_PICKER` already existed (migration `0008`). This slice
adds two capabilities: `vendor.staff.manage` (owner only) and `vendor.settings.manage` (owner and
manager). A picker can read their own access summary and the store's fulfilment modes, and nothing
else.

## Deliberate scope decisions

- **Only the owner invites, and only manager/picker are invitable.** A location's owner is
  established when its onboarding case is approved, not by another owner's invite; letting one
  owner invite a second owner would create an ambiguous multi-owner conflict this slice does not
  need to resolve. The owner role is also never revocable through `revokeStaff` — only manager and
  picker are.
- **Fulfilment modes are read-only here.** The schema hard-requires an `approved_by_user_id` and
  `approval_state = 'APPROVED'` on every row; a vendor requesting a new mode still needs an admin
  approval workflow that doesn't exist yet. `listFulfilmentModes` lets any staff role see the
  current approved set; adding one stays with `VendorNetworkService` (admin-only), unchanged by this
  slice.
- **Fee policy is structurally unreachable.** "Prevent vendors from overriding platform-owned fee
  policy" is satisfied by omission: this service exposes no column, table, or route from
  `money_policy` or `versioned-configuration`. `updateOrderingSettings` only ever touches
  `minimum_order_minor` and `preparation_seconds` — the store's own ordering thresholds, not a
  platform fee, tax, or commission rate.
- **Activity history is a separate table**, `vendor_staff_events`, distinct from
  `vendor_network_events` (which already records admin-authored changes to the same underlying
  rows). Keeping them separate preserves the existing meaning of `vendor_network_events` as "what
  admin did to this vendor" instead of conflating it with self-service activity.

## A related gap this slice surfaced, not fixed

Vendor onboarding approval does not currently grant the approved applicant a `VENDOR_OWNER`
membership at their own location — `VendorOnboardingService` never calls
`IdentityAccessService.grantVendorMembership`. Without it, an approved vendor would have no staff
membership at all and every route in this slice would be unreachable for them.
`createDiscoverableStoreFixture` (used by every Phase 5.5+ / Phase 6 verifier) now grants this
directly, matching what a correct onboarding-approval step should do — but the fix belongs in
`vendor-onboarding.ts` itself, in whichever step revisits Phase 5.2, not in this slice.

## API

- `vendor/locations/:id/staff` — `POST invite`, `POST revoke`, `GET` (roster), `GET activity`, all
  behind `vendor.staff.manage`.
- `vendor/locations/:id/access` — `GET mine`, behind `vendor.staff.manage` (any of owner, manager,
  or picker resolves; the guard checks capability grant, not the specific role).
- `vendor/locations/:id/settings` — `POST profile`, `POST ordering`, `POST hours`,
  `POST closures`, `POST zones`, `POST zones/:zone_id/deactivate`, `GET fulfilment-modes`, all
  behind `vendor.settings.manage`.

## Verification

`database/scripts/verify-vendor-staff.ts` — 10 connected scenarios: owner invites manager and
picker with a correct roster; a manager cannot invite; a picker cannot reach settings but a manager
can, with an optimistic version check; ordering-settings bounds; hours replace, a closure add, and
a zone add/deactivate cycle that restores the original active-zone count; fulfilment modes are
readable by every role and have no write path; activity history records both staff and settings
events; a stranger with no membership is refused everywhere; a revoked membership cannot be revoked
twice; and the publication restore/impact behaviour from
[restore and impact](vendor-publication-restore-and-impact.md). Wired into `verify-lifecycle.ts` as
`vendor_staff_scenarios`.

## Boundaries

Order-time staff actions (accept, pick, ready) are Phase 8. Nothing here creates or reads an order.
