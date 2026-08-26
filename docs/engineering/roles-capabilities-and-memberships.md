# Roles, capabilities, and memberships

**Status:** Phase 4.3 verified locally  
**Environment:** synthetic company development only

Phase 4.3 adds authorization policy data and a default-deny evaluator. Phase 4.4 now connects that evaluator to authenticated routes and reusable domain enforcement; see [Authorization Enforcement](authorization-enforcement.md).

## Policy model

Signing in creates a minimal user and session but grants no role. Authorization requires all of the following:

1. an active user;
2. an explicit, active, unexpired role assignment;
3. an explicit role-to-capability mapping;
4. the resource evidence required by that capability; and
5. no eligibility, assignment, scope, or separation-of-duty conflict.

An absent capability, role, membership, or matching scope always returns `DENY_BY_DEFAULT`. The evaluator does not explain which internal condition failed, preventing callers from using policy details as an existence oracle.

## Reviewed role catalog

| Actor | Roles | Scope evidence |
|---|---|---|
| Customer | `CUSTOMER` | Authenticated account |
| Vendor staff | `VENDOR_OWNER`, `VENDOR_MANAGER`, `VENDOR_PICKER` | Exact vendor-location membership |
| Delivery partner | `DELIVERY_PARTNER` | Current eligibility; exact active assignment for assignment actions |
| Admin | Support, finance, trust, configuration, and incident roles | Explicit global, zone, or vendor-location scope |

Roles do not contain conditional business logic. They map to fine-grained capability keys such as `vendor.order.manage`, `partner.assignment.act`, or `admin.finance.refund_approve`. Each capability declares one resource rule: account, vendor location, partner self, active assignment, or admin scope.

## Vendor-location membership

`staff_memberships` binds one vendor role assignment to one user and one opaque vendor-location UUID. Phase 5 will add the vendor-location foreign key when the vendor aggregate exists. Until then, the authorization evaluator requires an exact UUID match; a role at one store never grants another store.

## Partner eligibility and assignment

Partner access has two independent gates:

- `partner_eligibilities` records pending, eligible, restricted, or suspended status and an optional eligibility window.
- `partner_assignment_memberships` records the one currently active delivery assignment.

Eligibility alone permits only partner-self capabilities. Assignment read/action capabilities additionally require the requested assignment UUID to match the active membership. Partial unique indexes prevent one partner from holding two active assignments and prevent one assignment from being active for two partners.

## Admin scopes and separation of duties

Admin assignments are explicitly scoped to global, zone, or vendor location. Global scope must have no scope UUID; bounded scopes must have one.

Reviewed maker/checker exclusions prevent the same user from holding overlapping active operator and approver roles for finance, trust, or configuration. Admin roles cannot be self-granted. Database triggers enforce conflicting role windows even if a future caller bypasses the service.

## Lifecycle evidence

Role grants/revocations, partner eligibility changes, and partner assignment activation/end events are request- and correlation-linked in append-only `access_membership_events`. Rejected grants are transactional and leave neither assignments nor events.

## Verification

`pnpm db:verify` exercises:

- unassigned and cross-role default denial;
- correct and wrong vendor location;
- picker capability boundaries;
- pending, eligible, inactive, current, wrong, ended, and duplicate partner assignments;
- bounded and global admin scopes;
- maker/checker conflict and admin self-grant rejection;
- expired and revoked roles;
- membership subtype constraints and append-only event history;
- migration rollback, forward reapplication, and rebuild from zero.

## Phase 4.4 integration

`IdentityAccessService.evaluate` remains the policy decision point. Phase 4.4 authenticates sessions, attaches the actor to request context, invokes the evaluator through `AuthorizationEnforcementService`, and produces non-leaking 403/404 responses. Later domain routes must supply authoritative ownership or scope evidence after loading their resource.

Phase 4.5 keeps sign-in and authorization separate: the customer PWA issues an explicit authenticated enrolment command after OTP sign-in. Repeating it returns the existing active customer assignment. Other roles cannot be self-enrolled.

Phase 4.6 proves the complete isolation matrix at the policy, API-concealment, database-constraint, and log-redaction layers. See [Identity and Access Isolation Proof](identity-isolation-proof.md).
