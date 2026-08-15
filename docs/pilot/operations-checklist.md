# Internal Pilot Operations Checklist

**Environment:** Internal company testing only  
**Operating timezone:** Asia/Kolkata  
**Operations owner:** Operations Lead

## Test service and support coverage

| Coverage | Validation setting | Owner | Production effect |
|---|---|---|---|
| Synthetic ordering window | Monday–Saturday, 09:00–19:00 IST | Operations Lead | None |
| Scripted support coverage | Monday–Saturday, 09:00–19:00 IST | Support Test Operator | None |
| Test-session incident coordination | Only during a scheduled internal session | Operations Lead | None |
| Outside-hours behaviour | Block new test orders; preserve existing synthetic state for inspection | Operations Lead | None |

These hours are test settings, not promised customer service hours or staffing commitments.

## Before a test session

- [ ] Confirm the session uses only `ZONE-JPR-01` through `ZONE-JPR-03`.
- [ ] Confirm all vendors use IDs `FV-01` through `FV-09`; do not enter real business names.
- [ ] Confirm each vendor has exactly 20 entries from `CAT-FV-BASE-01`.
- [ ] Confirm customer, staff, partner, address, contact, payment, payout, and proof data are synthetic.
- [ ] Confirm email, SMS, push, maps, payment, payout, storage, and OTP integrations cannot contact or charge a real party.
- [ ] Assign an Operations Lead, Catalogue Test Operator, and Support Test Operator for the session.
- [ ] Select the scripted success and failure scenarios before starting.

## During a test session

- [ ] Keep each vendor order isolated from sibling vendor orders.
- [ ] Display fees and amounts as synthetic test values.
- [ ] Record substitutions and material weight/price changes as explicit decisions.
- [ ] Exercise at least one success, validation failure, timeout, duplicate request, retry, permission denial, empty state, stale state, offline/reconnect, and accessibility scenario when the applicable software exists.
- [ ] Do not improvise a financial adjustment, real-world delivery, or real notification.
- [ ] Stop immediately if real personal, financial, location, credential, or provider data appears.

## After a test session

- [ ] Reconcile synthetic checkout, child-order, refund, vendor, partner, and platform totals.
- [ ] Record defects using synthetic references only.
- [ ] Confirm no external message, charge, payout, upload, or delivery occurred.
- [ ] Reset reusable test state through a documented, non-destructive test procedure when one exists.
- [ ] Capture evidence needed for the next internal test without promoting settings to production policy.

## Failure and escalation

If real data or an external side effect is detected, stop the session, preserve safe diagnostic evidence, notify the Operations Lead and appropriate Security/Privacy owner, and do not copy the sensitive value into an issue or source file. Internal-test completion never authorizes public launch.
