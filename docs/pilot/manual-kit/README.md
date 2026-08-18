# Internal Concierge Pilot Manual Kit

**Step:** Phase 1, Step 1.1  
**Environment:** Company-internal testing only  
**Timezone:** `Asia/Kolkata`  
**Operating window:** Monday–Saturday, 09:00–19:00  
**Owner:** Operations Lead

## Purpose

Use this kit to rehearse one complete neighbourhood-order workflow with fictional participants, products, addresses, contact details, money, routes, proofs, and incidents. It does not authorize recruitment, a real order, a real delivery, a real message, a real payment, or production use.

Blank templates belong in Git. Completed forms do not: keep them in the approved company-controlled test workspace with access limited to the roles named in each template. Stop immediately if a real name, shop, address, phone number, bank detail, credential, OTP, location, payment instrument, or external-provider response appears.

## Kit contents and order

| Order | File | Operator outcome | Next handoff |
|---:|---|---|---|
| 1 | [Identifiers and access](identifiers-and-access.md) | Reserve unique synthetic references and assign minimum access | Catalogue Test Operator |
| 2 | [Vendor catalogue](vendor-catalogue-template.md) | Publish one reviewed fictional price/availability snapshot | Customer Intake Operator |
| 3 | [Customer order intake](customer-order-intake-template.md) | Record informed confirmation of the visible final synthetic total | Vendor Confirmation Operator |
| 4 | [Vendor confirmation](vendor-confirmation-template.md) | Accept, decline, or request an explicit customer decision for one vendor order | Dispatcher or Support Test Operator |
| 5 | [Dispatch and proof](dispatch-and-proof-template.md) | Assign one trip, preserve custody, and record proof without copying OTP content | Finance Test Operator or Support Test Operator |
| 6 | [Refund and settlement](refund-and-settlement-template.md) | Explain and reconcile synthetic customer, vendor, partner, and platform amounts | Reconciliation Reviewer |
| 7 | [Incident and end-of-day checklists](incident-and-reconciliation-checklists.md) | Close or hand off every case and prove the session balances | Operations Lead |

## Session opening gate

- [ ] Create a session reference such as `TEST-20260817-A`; this is a fictional example, not a live session.
- [ ] Name the Operations Lead, Catalogue Test Operator, Customer Intake Operator, Vendor Confirmation Operator, Dispatcher, Support Test Operator, Finance Test Operator, and Reconciliation Reviewer in the protected workspace.
- [ ] Confirm all actors are authorized company team members or approved known testers.
- [ ] Use only synthetic vendors `FV-01` through `FV-09`, products `PROD-FV-001` through `PROD-FV-020`, and zones `ZONE-JPR-01` through `ZONE-JPR-03`.
- [ ] Confirm fake email, SMS, push, maps, OTP, payment, payout, and storage adapters cannot contact or charge anyone.
- [ ] Reserve identifiers before recording an order.
- [ ] Select at least one success and one failure scenario.
- [ ] Confirm the order can reasonably finish before 19:00; otherwise do not start it.

## Handoff rule

Every handoff records the source reference, destination role, timestamp with timezone, current state, unresolved items, and the receiving operator's acknowledgement. A blank, rejected, late, duplicated, or contradictory handoff opens a synthetic support case; it never authorizes an operator to invent missing facts.

## Stop conditions

Stop the affected session and notify the Operations Lead when:

- real or uncertain data appears;
- any adapter could create an external side effect;
- a reference is duplicated or cannot be traced;
- a payable total does not balance;
- custody or proof is unclear;
- an operator lacks the required role;
- a test crosses staffed hours without a named handoff owner.

Preserve only safe identifiers and a redacted description. Never paste the sensitive value into this repository or an ordinary issue.

## Completion condition

The session is complete only when every vendor order is terminal, every trip's custody is closed, every fake payment/refund/settlement state is explained, all cases are closed or assigned, totals balance to the paise, external-side-effect checks are negative, and the Operations Lead signs the end-of-day checklist.
