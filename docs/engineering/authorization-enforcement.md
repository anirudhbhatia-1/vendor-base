# Authorization enforcement

**Status:** Phase 4.4 verified locally  
**Environment:** synthetic company development only

Phase 4.4 connects opaque sessions to the Phase 4.3 default-deny role evaluator. Protected handlers receive a verified actor only after session authentication, capability evaluation, and required ownership or scope evidence all pass.

## Request boundary

Routes opt in with `@RequireAuthorization`. The metadata contains a reviewed capability, whether an object-specific denial must be concealed, and only the route parameters that may provide policy evidence. The global `AuthorizationGuard` then:

1. parses the opaque bearer credential;
2. authenticates the active, unexpired session;
3. reads only the evidence sources declared by the server-side decorator;
4. calls `AuthorizationEnforcementService` and `IdentityAccessService`;
5. attaches the verified actor and successful role evidence to the request; and
6. lets `AuthenticatedActorInterceptor` preserve that actor throughout asynchronous request context.

Client actor, role, capability, or scope headers are never trusted.

## Ownership and scope enforcement

`AuthorizationEnforcementService` is reusable outside route-parameter guards. A domain handler can load an order by opaque order ID, then pass its authoritative `owner_user_id` or `vendor_location_id` into the same enforcement service before projecting or mutating it.

Supported evidence is deliberately narrow:

- customer owner user ID;
- exact vendor-location ID;
- exact active delivery-assignment ID; and
- global, zone, or vendor-location admin scope.

Role membership alone is insufficient. Customer ownership must match the authenticated user. Vendor access must match staff membership. Partner assignment access requires current eligibility and the exact active assignment. Admin access requires the capability and matching scope.

## Safe denial behavior

- Missing, malformed, expired, replayed, or revoked session credentials return `401 UNAUTHENTICATED`.
- Malformed UUID evidence returns `400 INVALID_ARGUMENT`.
- Object-specific missing and unauthorized cases both return the standard `404 RESOURCE_NOT_FOUND` envelope when `conceal_resource` is enabled.
- Known non-object administrative actions may return the standard `403 FORBIDDEN` envelope.
- Error bodies contain only the stable error code and request reference; internal membership or existence details are not returned.

The policy evaluator itself returns only `DENY_BY_DEFAULT` for missing roles, capabilities, memberships, assignments, or scopes.

## First protected route

`GET /auth/customer/me` requires an authenticated session plus `customer.account.read`. It proves the NestJS guard/interceptor wiring without creating a business-resource API ahead of its phase. OTP, refresh, health, and session-management routes keep their existing explicit authentication behavior.

## Verification

The API unit and integration suites cover:

- anonymous-route pass-through;
- missing bearer rejection;
- customer ownership match and mismatch;
- correct vendor-location evidence;
- current partner-assignment evidence;
- bounded admin-scope evidence;
- identical concealed 404 decisions for ownership and policy denial;
- explicit 403 decisions for non-concealed actions;
- actor-kind mapping and role evidence attachment;
- actor propagation across asynchronous handler work; and
- the protected customer route rejecting missing credentials through the standard error envelope.

Database lifecycle verification continues to cover the real role, membership, eligibility, active-assignment, scope, expiry, revocation, and separation-of-duty decisions.

## Phase 4.5 integration

Phase 4.5 uses the authorization boundary for customer profile, consent, and notification settings. The one exception is the explicit customer-enrolment command: it requires a valid session through `@RequireSession`, then idempotently grants the customer role. OTP verification itself still grants no role. See [Customer Profile, Consent, and Preferences](customer-profile-consent-and-preferences.md).
