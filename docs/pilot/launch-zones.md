# Internal Test Launch Zones

**Environment:** Internal company testing only  
**City:** Jaipur, Rajasthan, India  
**Operating timezone:** Asia/Kolkata  
**Decision owner:** Operations Lead  
**Approved for testing:** 13 August 2026

## Candidate clusters

| Test zone ID | PIN code | Reference locality | Status | Purpose |
|---|---:|---|---|---|
| `ZONE-JPR-01` | `302020` | Mansarovar | CANDIDATE | Compare synthetic demand, vendor coverage, travel, and support scenarios. |
| `ZONE-JPR-02` | `302021` | Vaishali Nagar | CANDIDATE | Compare synthetic demand, vendor coverage, travel, and support scenarios. |
| `ZONE-JPR-03` | `302019` | Shyam Nagar | CANDIDATE | Compare synthetic demand, vendor coverage, travel, and support scenarios. |

PIN codes are discovery and test-group labels, not precise delivery polygons. Before any real pilot or production use, Operations must verify exact service boundaries, route feasibility, vendor locations, customer coverage, and applicable restrictions outside source control.

## Internal test boundary

- Test flows may reference only the three synthetic zone IDs above.
- Test addresses must be clearly fictional and must not reproduce a real home or person's location.
- Exact map coordinates, real vendor addresses, phone numbers, staff details, customer details, and delivery instructions are prohibited in source control.
- No zone is published, advertised, or enabled for real ordering.
- No test result is evidence that the whole PIN code can be served safely or economically.

## Excluded zones and categories

- Every PIN code other than `302020`, `302021`, and `302019` is excluded from this internal test scope.
- Cross-zone route consolidation and citywide Jaipur coverage are excluded.
- Pharmacy, prescription products, alcohol, tobacco, controlled or age-restricted goods, meat, and other legally sensitive categories are excluded.
- Kirana/general-store ordering is held as a later test cohort and is not part of this first-category catalogue.
- Production delivery radii, fees, service promises, and operating areas remain unresolved production decisions.

## Promotion gate

These candidate zones may move beyond internal testing only after D-01 is reopened with real operational evidence stored in an approved protected system. That review must cover willing vendors, reachable customers, travel times, safe access, support coverage, unit economics, and legal/privacy requirements.
