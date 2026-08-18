# Internal Cohort Rehearsal

**Phase/step:** Phase 1, Step 1.2
**Decision:** Option A — internal cohort rehearsal
**Environment:** Company-internal testing only
**Owner:** Operations Lead
**Timezone:** `Asia/Kolkata`

## Purpose and limitation

This package prepares fictional participants and training evidence for rehearsing the manual operating kit. It does not recruit or represent a real customer, vendor, shop, delivery partner, employee, or contractor. It cannot prove genuine demand, willingness to pay, serviceability, vendor willingness, employment status, or production readiness.

Only authorized company team members or specifically approved known testers may perform a rehearsal. Their names, contact details, personnel records, documents, signatures, and assignments belong in an approved protected company workspace—not Git.

## Cohort prepared

| Actor group | Synthetic cohort | Count | Repository evidence | Readiness boundary |
|---|---|---:|---|---|
| Vendors | `FV-01` through `FV-09` | 9 | [Existing vendor cohort](../vendor-cohort.md) | Fictional role and catalogue fixture only |
| Customers | `CUS-T-01` through `CUS-T-20` | 20 | [Customer personas](customer-personas.md) | Fictional scenario persona only |
| Delivery testers | `DPT-T-01` and `DPT-T-02` | 2 | [Delivery-tester roles](delivery-tester-roles.md) | Synthetic role; real operator assignment remains protected |
| Verification packs | `VPK-T-*` | 31 | [Fictional verification register](fictional-verification-register.md) | Fake document metadata only |

## Required operating files

1. Use the [manual operating kit](../manual-kit/README.md) for every session.
2. Allocate fictional customer scenarios from [customer-personas.md](customer-personas.md).
3. Allocate delivery scenarios from [delivery-tester-roles.md](delivery-tester-roles.md).
4. Check fictional document states in [fictional-verification-register.md](fictional-verification-register.md).
5. Run [training and assessment](training-and-assessment.md) for each assigned company tester.
6. Record only safe status and evidence references in [readiness-register.md](readiness-register.md).

## Protected assignment boundary

The repository may contain:

- fictional actor IDs and scenario descriptions;
- role names and training modules;
- fictional document references and lifecycle states;
- blank checklists and safe completion statuses.

The repository must not contain:

- the name or contact detail of the person playing a role;
- a real vendor/customer/partner identity or location;
- employment, contractor, bank, insurance, licence, vehicle, identity, or background-check records;
- raw training recordings, signatures, OTPs, addresses, payment details, or exact movement data;
- a link that grants public or unrestricted access to protected evidence.

## Rehearsal onboarding sequence

```text
Operations assigns authorized tester in protected workspace
→ tester receives one fictional role and minimum data
→ fictional verification pack reaches approved test state
→ tester completes common and role-specific training
→ independent assessor records pass/retrain using a safe evidence reference
→ Operations marks the fictional role READY_FOR_REHEARSAL
→ session lead assigns a scripted scenario
```

An operator cannot approve their own readiness. Missing, expired, rejected, duplicated, or contradictory evidence leaves the role `NOT_READY`.

## Stop conditions

Stop onboarding or training if real personal/business data appears, a real document is requested, an external message or payment could occur, a tester is asked to perform a real delivery, unsafe time pressure appears, or the protected evidence workspace is unavailable. Open a synthetic case using a safe reference and do not copy the sensitive value.

## Completion gate

This documentation package is prepared when all fictional roles, scenarios, document packs, training modules, and readiness requirements exist. Step 1.2 operational completion additionally requires the Operations Lead to confirm, outside Git:

- authorized company testers are assigned;
- every assigned tester passed the applicable training;
- protected evidence is access-controlled;
- fake adapters and synthetic data are confirmed;
- rehearsal date, staffed roles, and stop authority are named.

Until that confirmation exists, the cohort status is `PREPARED_NOT_TRAINED` and Step 1.3 must not begin.
