# Synthetic Delivery-Tester Roles

**Owner:** Operations Lead
**Use:** Assign delivery and custody scenarios to authorized company testers
**Data classification:** Synthetic role and route data only
**Status:** Prepared for training; no public recruitment or real delivery authorized

## Role roster

| Role ID | Synthetic operating profile | Primary coverage | Secondary coverage | Status |
|---|---|---|---|---|
| `DPT-T-01` | Bicycle-style short-route tester | Offer, acceptance, vendor arrival, wait, pickup, delivery, proof | Customer unreachable and controlled return | `PREPARED_NOT_TRAINED` |
| `DPT-T-02` | Two-wheeler-style multi-package tester | Package count, reassignment, offline/reconnect, safe stop | Unsafe location, damaged package, disputed wait | `PREPARED_NOT_TRAINED` |

These are fictional workflow roles. They do not state that an assigned tester owns a vehicle, holds a licence, has insurance, passed a background check, or has any employment/contractor relationship. Real documents and classifications remain blocked.

## Protected assignment card

| Field | Entry |
|---|---|
| Rehearsal session | `<TEST-...>` |
| Role ID | `<DPT-T-01 or DPT-T-02>` |
| Protected operator assignment ref | `<access-controlled reference; no name in Git>` |
| Safety/data briefing version | `<version>` |
| Fictional vehicle token | `<VEH-T-...>` |
| Fake contact route | `<non-routable synthetic value>` |
| Allowed zones | `<ZONE-JPR-01...03 subset>` |
| Scenario and trip refs | `<scenario / TRIP-T-...>` |
| Training result | `<PASS / RETRAIN / NOT_RUN>` |
| Independent assessor/evidence | `<protected safe ref>` |
| Assignment start/end | `<timestamps>` |
| Stop authority understood | `<YES / NO>` |

## Mandatory capabilities

- Accept or decline a fictional offer without penalty pressure.
- View only zone-level destination before assignment and minimum exact synthetic address detail at the approved active stage.
- Confirm package count and fake pickup proof before accepting custody.
- Record trusted arrival, wait, reconnect, and departure once without duplicated earnings.
- Stop safely instead of responding while moving.
- Use no unsafe speed or time-pressure promise.
- Preserve custody during unreachable, refused, unsafe, damaged, or cancellation-after-pickup scenarios.
- Follow the authorized return path and record safe proof metadata without OTP content.
- Open a case and contact the named internal response owner.
- End access to exact synthetic destination/location when delivery or return closes.

## Safety briefing checklist

- [ ] The rehearsal uses no real package, sale, address, customer, shop, or public road delivery obligation.
- [ ] The tester may stop at any time without negative consequence.
- [ ] No interaction while moving is required.
- [ ] Exact synthetic location and contact access are purpose- and time-limited.
- [ ] OTP content, raw location history, and personal data are not copied into notes.
- [ ] An unresolved package/custody state is immediately handed to Operations.
- [ ] P0/P1 escalation targets and staffed-hours handoff are understood.
- [ ] Fake earnings and payout records are not wages, reimbursement, or a promise of payment.

## Scenario pairing

| Scenario | Initial role | Required second role/observer | Pass evidence |
|---|---|---|---|
| Normal delivery | `DPT-T-01` | Dispatcher observer | Matching packages, proof outcome, closed custody |
| Wait over included period | `DPT-T-01` | Finance observer | Completed minutes counted once; cap applied |
| Reassignment before pickup | `DPT-T-02` | Dispatcher observer | Old attempt closed; new ref; no dual active trip |
| Offline/reconnect | `DPT-T-02` | Support observer | No duplicate transition/proof/earning |
| Failure after pickup | Either | Operations observer | Case, return authorization, return proof, custody closure |
| Unsafe interaction | Either | Operations Lead | Immediate safe stop, scoped case, no permanent automatic punishment |

A role becomes `READY_FOR_REHEARSAL` only after common training, role assessment, safety briefing, fake-adapter check, and independent sign-off are recorded outside Git.
