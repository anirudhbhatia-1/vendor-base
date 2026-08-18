# Synthetic End-to-End Desk Runs

**Phase/step:** Phase 1, Step 1.3
**Mode:** `DESK_SIMULATION_ONLY`
**Environment:** Local company documentation and calculation checks only
**Run date:** 17 August 2026
**Timezone:** `Asia/Kolkata`

## Outcome boundary

These runs exercise the manual records and arithmetic without assigned or trained company testers. They use fictional references, actors, products, routes, proofs, cases, provider results, and money. They do not represent orders placed by people, real operational timing, demand, conversion, customer satisfaction, vendor performance, delivery safety, or production readiness.

The Step 1.2 readiness register remains `DO_NOT_START`. This desk simulation does not change any actor to `READY_FOR_REHEARSAL` and does not authorize a real or staffed rehearsal.

## Files

| File | Responsibility |
|---|---|
| [Scenario plan](scenario-plan.md) | Defines inputs, expected branch, proof/case requirement, and pass condition for eight runs |
| [Aggregate run evidence](aggregate-run-evidence.md) | Records safe state/handoff outcomes without protected completed forms |
| [Reconciliation summary](reconciliation-summary.md) | Proves customer, vendor, partner, and platform amounts balance or enter an explicit exception |

## Execution method

1. Read each scenario against the [manual operating kit](../manual-kit/README.md).
2. Use only safe fictional references in repository evidence.
3. Model the customer choice and visible final amount.
4. Model vendor confirmation, change, decline, or timeout independently for each vendor order.
5. Model dispatch/pickup or customer pickup, proof metadata, custody, failure, and return as applicable.
6. Apply the approved synthetic financial policy using integer paise.
7. Reconcile `customer net = vendor payable + partner payable + platform remainder`.
8. Record an explicit case/hold for any unknown or unresolved result.

No completed manual form, exact address, contact route, OTP content, raw location, person assignment, document, or payment instrument is stored here.

## Pass rule

A run passes only when:

- every required reference is unique and traceable;
- the selected vendor and products are explicit;
- the customer-visible total is shown before simulated confirmation;
- changes require the scripted customer decision;
- one vendor's result does not alter a sibling implicitly;
- proof matches the active trip/order without OTP content;
- custody closes through delivery, pickup, return, or an owned case;
- every amount balances to zero difference or remains in a named exception state;
- no external side effect occurs.

## Result

Eight desk scenarios are structurally complete and arithmetically checked. This is evidence that the documents are internally consistent, not evidence that people can operate them successfully. A staffed Step 1.3 run remains blocked by Step 1.2 training and assignment evidence.
