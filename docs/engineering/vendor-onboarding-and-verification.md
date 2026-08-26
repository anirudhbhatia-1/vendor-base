# Vendor onboarding and verification

**Phase:** 5.2  
**Environment:** company-local synthetic development only  
**Production authority:** none

## Outcome

Migration `0011_vendor_onboarding` and `VendorOnboardingService` provide one resumable workflow for operator-created leads, invitation claims, and direct vendor applications. Each case keeps opaque synthetic business-profile and payout-profile references, a proposed Jaipur store profile, current review state, version, and attributable append-only events.

The workflow can create a Phase 5.1 `DRAFT` vendor and location only after a separate reviewer approves all required evidence. Publication and activation remain Phase 5.3 responsibilities.

## State model

```text
LEAD -> PENDING
INVITED -> PENDING
PENDING -> UNDER_REVIEW -> APPROVED
                         -> REJECTED -> PENDING (appeal overturned)

APPROVED -> EXPIRING -> GRACE -> REVERIFICATION
```

The applicant-facing and admin summaries return the same explicit state vocabulary: pending, under review, approved, rejected, expiring, grace, and reverification. Applicant reads require exact case ownership. Administrative routes require either `admin.vendor_onboarding.manage` or `admin.vendor_onboarding.review`; the operator and reviewer roles cannot be assigned to the same admin principal.

## Protected documents

The local protected-object adapter accepts only explicitly marked synthetic PDF, JPEG, or PNG payloads up to 5 MiB. It:

- rejects absolute, traversal, malformed, and symbolic-link paths;
- creates non-overwriting files with owner-only permissions;
- applies a deterministic clean/rejected scan scenario;
- stores SHA-256, media type, byte length, and clean-scan evidence in PostgreSQL;
- exposes no filesystem path through an application response; and
- reads only through an HMAC-signed grant that expires within five minutes and must match the recorded checksum.

`OBJECT_STORAGE_LOCAL_PATH` selects the ignored local directory. `OBJECT_STORAGE_GRANT_KEY` signs development-only access grants and must contain at least 32 characters. Neither value grants authority for production or real documents. A future provider adapter must preserve this interface, private-object default, scan gate, checksum verification, short-lived access, retention, deletion, and audit behavior.

## Review, expiry, and appeal evidence

Required business-registration, food-safety-declaration, and settlement-account document slots are versioned. Replacements point to the prior document instead of modifying it. Reviews are append-only and preserve decision, reviewer, notes, reason code, evidence reference, and timestamp.

Approval requires all three current documents to be clean and approved. Case creators cannot start or decide their own review. A rejection requires a stable reason and reviewer notes. An applicant can submit an appeal with a reason and evidence reference; a separate reviewer records whether it is upheld or overturned. Expiry advancement and explicit grace grants preserve document and case history while moving the case through expiring, grace, and reverification states.

## Interfaces

The API exposes authenticated applicant commands under `/vendor/onboarding` and capability-guarded administrative commands under `/admin/vendor-onboarding`. An operator endpoint advances evidence deadlines using server time; a later production scheduler can invoke the same domain method. Protected content retrieval uses a short-lived grant in a POST body so it is not copied into URLs or access logs.

The vendor PWA and Android app present the same four-step synthetic journey: shop, opaque business/payout references, required documents, and review. Their controls currently demonstrate the local company-test flow; server APIs remain authoritative for persistence and decisions. Phase 5.3 adds the separate admin publication pipeline after onboarding approval.

## Verification

`verify-vendor-onboarding.ts` proves all three entry paths, applicant isolation, required-document gating, maker-checker review, protected read grants, draft vendor/location creation, expiring/grace/reverification transitions, appeal overturn, and append-only evidence. Unit tests cover object-path containment, synthetic and scan enforcement, grant expiry, and checksum rejection. API metadata tests prove applicant session requirements and separate manage/review capabilities.

Run `pnpm db:verify` for the disposable PostGIS lifecycle and `pnpm check` for repository, unit, integration, and secret controls.
