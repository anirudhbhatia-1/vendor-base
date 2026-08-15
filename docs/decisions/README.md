# Production Decision Governance

This directory controls the decisions that must not be invented while building the Neighbourhood Store Marketplace. It implements Phase 0, Step 0.1 of `phases.md`.

## What these records do

- `register.md` is the overview of decisions D-01 through D-10.
- `template.md` defines the required structure for every decision record.
- `D-01.md` through `D-10.md` contain the evidence and approval history for individual decisions.

An accountable owner is responsible for moving a decision to approval. Contributors and reviewers may help, but shared responsibility never replaces the one named owner.

## Status lifecycle

1. `OPEN` — evidence is still being gathered or evaluated.
2. `READY_FOR_APPROVAL` — required evidence and a recommendation are present.
3. `APPROVED` — an authorized person has recorded the decision, reasons, consequences, and approval date.
4. `SUPERSEDED` — a later approved record replaces this decision without erasing its history.

`BLOCKED` may be added to an `OPEN` record when progress cannot continue without external evidence, authority, or a provider response. A record never becomes `APPROVED` merely because its due date passes.

## Approval rules

- Owners and due dates in the register assign follow-up responsibility; they do not approve a production policy.
- Every approval must cite the evidence it used and name the approver and approval date.
- Financial, legal, privacy, safety, provider, or production choices remain pending until their individual record is explicitly approved.
- Example prices, radii, timers, and pilot processes remain `VALIDATION_ONLY` unless an approved decision expressly promotes them to a versioned production policy.
- Sensitive evidence, credentials, personal data, bank data, identity documents, OTPs, and real addresses must not be committed. Records may link to an approved protected system using a non-sensitive reference.
- A superseding record must link to the prior record and explain migration, rollback, and historical-order effects where applicable.

## Review rhythm

The accountable owner reviews an open decision before its due date, confirms that evidence is complete, and requests approval from the appropriate project authority. Overdue items remain visibly open and continue blocking the capability named in `register.md`.
