# Pilot Measurement Package

**Phase/step:** Phase 1, Step 1.4
**Current evidence mode:** `SYNTHETIC_DESK_BASELINE`
**Owner:** Operations Lead
**Finance reviewer:** Finance Lead
**Timezone:** `Asia/Kolkata`

## Purpose

This package defines how to measure demand, vendor operations, fulfilment, support, and unit economics without mixing denominators or presenting synthetic results as observed behaviour. The current baseline is calculated from eight deterministic desk runs containing nine vendor orders.

It does not contain real customer, vendor, partner, address, contact, location, payment, document, or employee data. It does not establish business viability or permission to begin production.

## Files

| File | Responsibility |
|---|---|
| [Metric dictionary](metric-dictionary.md) | Defines every metric, formula, denominator, source, valid exclusions, and current availability |
| [Synthetic baseline](synthetic-baseline.md) | Calculates reproducible desk-run counts, rates, and money totals |
| [Exception analysis](exception-analysis.md) | Groups scripted exceptions, financial exposure, control result, owner, and missing real evidence |

## Evidence labels

| Label | Meaning | Permitted claim |
|---|---|---|
| `SYNTHETIC_COVERAGE` | A deterministic scenario exercised a branch | The documents/calculations represent that branch |
| `SYNTHETIC_CALCULATION` | Values were derived from fictional integer-paise rows | Arithmetic and allocation are internally consistent |
| `NOT_OBSERVED` | No trained human or real participant generated the measure | No outcome claim may be made |
| `CONTROLLED_REAL_CASE` | Future approved company-account or participant evidence | Only the exact approved cohort/case may be described |
| `PRODUCTION_OBSERVED` | Future production event under approved policy | May support production reporting after quality/privacy checks |

Synthetic scripted confirmation is not conversion. A written timestamp is not observed elapsed time. A fictional repeated persona is not a repeat customer. A balanced test order is not profitable real unit economics.

## Collection workflow for a future approved rehearsal

1. Open a session with a versioned metric dictionary and approved cohort evidence.
2. Record safe event timestamps at each handoff using the same order/trip/case references.
3. Record the fee-shown event before confirmation or abandonment.
4. Capture vendor, preparation, pickup, delivery, refund, case, and settlement outcomes without free-form personal data.
5. Reconcile money before publishing a session result.
6. Validate denominators, missing events, duplicate references, clock order, and terminal-state consistency.
7. Publish aggregated counts only when the minimum group size and privacy review permit it.
8. Label every result with evidence mode, cohort version, policy version, timezone, and collection interval.

## Data-quality gates

- Every vendor order belongs to exactly one customer request and one vendor.
- Every duration has valid ordered start/end events and a named clock source.
- Retry/duplicate events contribute once.
- Cancelled, returned, pickup, and completed-delivery outcomes remain separate.
- Missing timing data stays missing; it is never replaced by zero.
- Money uses integer paise and reconciles to zero difference.
- Cases link to exact affected orders but reporting excludes protected evidence content.
- Repeat ordering uses a privacy-approved stable customer key; fictional aliases are not sufficient.
- Business thresholds are versioned and approved before results are compared against them.

## Current conclusion

The measurement design and synthetic arithmetic baseline are ready. Human timing, fee-visible conversion, vendor performance, support effort, safety performance, satisfaction, and repeat ordering remain `NOT_OBSERVED`. Step 1.5 cannot make a credible build/no-build decision from this baseline alone.
