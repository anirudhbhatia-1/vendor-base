# Fictional Customer Personas

**Owner:** Customer Test Coordinator
**Use:** Allocate scripted customer behaviour to authorized company testers
**Data classification:** Synthetic; no real names, phones, addresses, payment instruments, or order history
**Status:** Prepared for training, not evidence of recruitment or demand

Each persona represents a test scenario, not a demographic claim or a real person. A tester may operate several personas in separate sessions, but must not reuse an order, payment, address, or case reference.

| Persona ID | Zone | Language path | Fulfilment | Primary scenario | Expected decision/failure coverage | Status |
|---|---|---|---|---|---|---|
| `CUS-T-01` | `ZONE-JPR-01` | English | Delivery | Normal single-vendor order | Confirm final price and successful handoff | `PREPARED_NOT_TRAINED` |
| `CUS-T-02` | `ZONE-JPR-01` | Hindi | Delivery | Normal single-vendor order | Hindi notice and final-price comprehension | `PREPARED_NOT_TRAINED` |
| `CUS-T-03` | `ZONE-JPR-01` | English | Delivery | Out-of-stock item | Remove unavailable line and recompute visible total | `PREPARED_NOT_TRAINED` |
| `CUS-T-04` | `ZONE-JPR-01` | Hindi | Delivery | Approved substitution | Explicitly approve one replacement | `PREPARED_NOT_TRAINED` |
| `CUS-T-05` | `ZONE-JPR-01` | English | Delivery | Rejected substitution | Reject replacement without changing sibling lines | `PREPARED_NOT_TRAINED` |
| `CUS-T-06` | `ZONE-JPR-01` | Hindi | Delivery | Variable weight | Approve a material final-weight/price change | `PREPARED_NOT_TRAINED` |
| `CUS-T-07` | `ZONE-JPR-02` | English | Pickup | Customer pickup | Fake proof succeeds without a delivery trip | `PREPARED_NOT_TRAINED` |
| `CUS-T-08` | `ZONE-JPR-02` | Hindi | Delivery | Vendor timeout | Order expires and fake refund is traceable | `PREPARED_NOT_TRAINED` |
| `CUS-T-09` | `ZONE-JPR-02` | English | Delivery | Fake payment decline | No confirmed order or duplicate payment | `PREPARED_NOT_TRAINED` |
| `CUS-T-10` | `ZONE-JPR-02` | Hindi | Delivery | Fake payment unknown | Hold state until reconciliation under same payment ref | `PREPARED_NOT_TRAINED` |
| `CUS-T-11` | `ZONE-JPR-02` | English | Delivery | Duplicate intake | Original result returned; no second order | `PREPARED_NOT_TRAINED` |
| `CUS-T-12` | `ZONE-JPR-02` | Hindi | Delivery | Customer unreachable | Controlled return after pickup | `PREPARED_NOT_TRAINED` |
| `CUS-T-13` | `ZONE-JPR-03` | English | Delivery | Incorrect fictional address | Support case and controlled return | `PREPARED_NOT_TRAINED` |
| `CUS-T-14` | `ZONE-JPR-03` | Hindi | Delivery | Customer refuses package | Custody preserved through return proof | `PREPARED_NOT_TRAINED` |
| `CUS-T-15` | `ZONE-JPR-03` | English | Delivery | Partial item refund | Delivery/partner earning retained; components balance | `PREPARED_NOT_TRAINED` |
| `CUS-T-16` | `ZONE-JPR-03` | Hindi | Delivery | Full item refund | Vendor fee becomes zero and refund balances | `PREPARED_NOT_TRAINED` |
| `CUS-T-17` | `ZONE-JPR-03` | English | Delivery | Multi-package handoff | Package count matches at pickup and delivery | `PREPARED_NOT_TRAINED` |
| `CUS-T-18` | `ZONE-JPR-03` | Hindi | Delivery | Offline/reconnect | No duplicated transition, proof, or wait earning | `PREPARED_NOT_TRAINED` |
| `CUS-T-19` | `ZONE-JPR-01` | English | Delivery | Optional consent refusal | Order continues without optional processing | `PREPARED_NOT_TRAINED` |
| `CUS-T-20` | `ZONE-JPR-02` | Hindi | Delivery | Support escalation | P1 acknowledgement and staffed-hours handoff | `PREPARED_NOT_TRAINED` |

## Persona assignment card

Store the completed card only in the protected company workspace.

| Field | Entry |
|---|---|
| Rehearsal session | `<TEST-...>` |
| Persona ID | `<CUS-T-01...20>` |
| Protected operator assignment ref | `<access-controlled reference; no name in Git>` |
| Fictional customer alias | `<synthetic>` |
| Fictional address token | `<ADDR-T-...>` |
| Fake contact route | `<non-routable synthetic value>` |
| Scenario briefing version | `<version>` |
| Common training result | `<PASS / RETRAIN / NOT_RUN>` |
| Customer-role training result | `<PASS / RETRAIN / NOT_RUN>` |
| Assessor/evidence ref | `<protected safe ref>` |
| Assignment start/end | `<timestamps>` |

## Readiness rules

- The operator understands the customer sees the complete final price before confirmation, not the internal fee calculation.
- Every store group becomes a separate vendor order.
- Default substitution is none; changed weight/price or replacement follows explicit preference/decision.
- The operator uses fictional address/contact/payment information only.
- A fake payment decline, timeout, or unknown result is not converted into success.
- The operator can open a case, stop the scenario, and identify the next handoff.
- Optional consent refusal cannot be used to pressure or block an otherwise valid synthetic order.

Passing a scripted persona proves only that the operator followed the rehearsal. It is not customer research, conversion, repeat-order, satisfaction, or willingness-to-pay evidence.
