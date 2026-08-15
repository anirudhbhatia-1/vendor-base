# Synthetic Fruit-and-Vegetable Vendor Cohort

**Environment:** Internal company testing only  
**First category:** Fruit and vegetables  
**Cohort owner:** Operations Lead  
**Cohort size:** 9 synthetic vendors

All entries below are fictional test identities. They do not represent, invite, approve, or publish a real business. Real business names supplied during planning are intentionally omitted from source control.

| Vendor ID | Zone ID | Fictional test profile | Catalogue | Test responsibility | Status |
|---|---|---|---|---|---|
| `FV-01` | `ZONE-JPR-01` | Small mixed fruit-and-vegetable shop | `CAT-FV-BASE-01` | Normal in-stock order | READY_FOR_INTERNAL_TEST |
| `FV-02` | `ZONE-JPR-01` | Produce shop with changing daily availability | `CAT-FV-BASE-01` | Out-of-stock and removal | READY_FOR_INTERNAL_TEST |
| `FV-03` | `ZONE-JPR-01` | Produce shop using variable-weight items | `CAT-FV-BASE-01` | Final weight and price adjustment | READY_FOR_INTERNAL_TEST |
| `FV-04` | `ZONE-JPR-02` | Fruit-focused neighbourhood shop | `CAT-FV-BASE-01` | Customer-approved substitution | READY_FOR_INTERNAL_TEST |
| `FV-05` | `ZONE-JPR-02` | Vegetable-focused neighbourhood shop | `CAT-FV-BASE-01` | Customer rejection and fallback | READY_FOR_INTERNAL_TEST |
| `FV-06` | `ZONE-JPR-02` | Busy produce shop | `CAT-FV-BASE-01` | Vendor response timeout | READY_FOR_INTERNAL_TEST |
| `FV-07` | `ZONE-JPR-03` | Small mixed produce shop | `CAT-FV-BASE-01` | Pickup fulfilment | READY_FOR_INTERNAL_TEST |
| `FV-08` | `ZONE-JPR-03` | Produce shop with limited stock confidence | `CAT-FV-BASE-01` | Vendor-confirms availability | READY_FOR_INTERNAL_TEST |
| `FV-09` | `ZONE-JPR-03` | Mixed produce shop with several packages | `CAT-FV-BASE-01` | Multi-package delivery handoff | READY_FOR_INTERNAL_TEST |

## Ownership and privacy

- Operations Lead owns cohort readiness, synthetic scenario assignment, and internal-test scheduling.
- Catalogue Test Operator owns synthetic price and availability setup.
- Support Test Operator owns scripted exception handling during a test session.
- No real vendor recruitment, verification, banking, licensing, payout, contact, or address data is stored here.
- Synthetic vendor IDs are display/test references and never prove authorization in future application code.

## Readiness rules

A synthetic vendor is ready only when its 20 catalogue entries load, its assigned scenario is documented, the test operator is named outside fixtures, and no real personal or financial data appears in the test record. Test failure returns the vendor to `NEEDS_TEST_SETUP`; it never triggers a real restriction or notification.

## Reserve cohort

Kirana/general stores are reserved for a later internal test after the fruit-and-vegetable workflow is stable. Their supplied real-looking names are not retained here. Adding them requires a later approved scope update with synthetic IDs and catalogues.
