# Safe Vendor Catalogue Template

**Used by:** Catalogue Test Operator; reviewed by Operations Lead  
**Use when:** Preparing or changing a fictional vendor's catalogue snapshot before a test session  
**Protected data:** None expected; real vendor identity, address, contact, supplier, barcode, image metadata, and real price are prohibited  
**Next handoff:** Approved snapshot reference goes to the Customer Intake Operator

## Header

| Field | Entry |
|---|---|
| Session reference | `<TEST-...>` |
| Catalogue ID/version | `<CAT-FV-BASE-01 / version>` |
| Synthetic vendor ID | `<FV-01 through FV-09>` |
| Zone ID | `<ZONE-JPR-01 through ZONE-JPR-03>` |
| Effective from | `<ISO 8601 +05:30>` |
| Effective until | `<ISO 8601 +05:30>` |
| Prepared by role | `Catalogue Test Operator` |
| Reviewed by role/time | `<Operations Lead / timestamp>` |
| Scenario | `<NORMAL / OUT_OF_STOCK / VARIABLE_WEIGHT / SUBSTITUTION / TIMEOUT / PICKUP / VENDOR_CONFIRMS / MULTI_PACKAGE>` |
| Status | `<DRAFT / REVIEWED / ACTIVE_FOR_SESSION / VOID>` |

## Catalogue rows

All money uses integer paise and `INR`. Do not place a currency symbol or decimal value in an `*_minor` field.

| Product ID | Fictional display name | Selling unit | Quantity basis | Quoted price minor | Currency | Availability | Stock checked at | Substitution policy | Variable-weight rule | Safe note |
|---|---|---|---|---:|---|---|---|---|---|---|
| `<PROD-FV-001...020>` | `<from approved base catalogue>` | `<piece/pack/bunch/target grams>` | `<COUNTED / VENDOR_CONFIRMS>` | `<integer>` | `INR` | `<AVAILABLE / LOW_STOCK / VENDOR_CONFIRMS / OUT_OF_STOCK>` | `<ISO 8601 +05:30>` | `<NONE / CUSTOMER_DECIDES>` | `<FIXED / FINAL_WEIGHT_REQUIRED>` | `<structured, synthetic>` |

## Validation checklist

- [ ] Exactly 20 unique approved product IDs are present.
- [ ] The vendor and zone are from the synthetic cohort.
- [ ] Every unit and quantity basis is explicit.
- [ ] Every price is a non-negative integer number of paise with currency `INR`.
- [ ] Availability uses an allowed state.
- [ ] Default substitution is `NONE`; no replacement is pre-approved silently.
- [ ] Every variable-weight line requires final weight and price confirmation.
- [ ] No customer data, supplier data, real-world vendor data, barcode, or unlicensed image exists.
- [ ] The previous snapshot remains preserved; this version does not rewrite an order already quoted.
- [ ] Reviewer and effective times are present.

## Failure handling

Duplicate product ID, invalid unit, missing price/currency, stale effective time, prohibited data, or inconsistent availability changes the snapshot to `VOID`. Record a safe reason, correct a new version, and do not hand it to intake. If a real value appears, stop the session and open a privacy incident without copying that value.

## Handoff

| Catalogue snapshot | Vendor | Result | Sent to | Sent at | Accepted at | Open issue/case |
|---|---|---|---|---|---|---|
| `<ID/version>` | `<FV-..>` | `<ACTIVE_FOR_SESSION>` | `Customer Intake Operator` | `<timestamp>` | `<timestamp>` | `<NONE or CASE-T-...>` |
