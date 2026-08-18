# Pilot Metric Dictionary

**Version:** `METRIC-T-01`
**Scope:** Internal validation and future controlled pilot measurement
**Money:** Integer paise with currency `INR`
**Durations:** Integer seconds; never infer missing values as zero

## Demand and customer metrics

| Metric | Unit/denominator | Formula | Required source events | Current evidence | Important exclusion |
|---|---|---|---|---|---|
| Fee-visible conversion | Percent of eligible requests shown a complete price | Confirmed requests ÷ eligible requests with `fee_shown` | Eligible request, fee shown, confirmation/abandonment | `NOT_OBSERVED` | Scripted confirmation is not conversion |
| Checkout-group completion | Percent of confirmed requests | Requests with all intended terminal results ÷ confirmed requests | Request confirmed and group terminal state | `SYNTHETIC_COVERAGE` | Report partial groups separately |
| Vendor-order completion | Percent of vendor orders | Completed vendor orders ÷ terminal vendor orders | Order created and terminal state | `SYNTHETIC_CALCULATION` | Pickup and delivery may be segmented |
| Cancellation rate | Percent of vendor orders | Pre-completion cancelled/expired orders ÷ terminal vendor orders | Cancellation/expiry reason and time | `SYNTHETIC_CALCULATION` | Controlled return is not ordinary cancellation |
| Refund incidence | Percent of vendor orders | Orders with any successful refund ÷ terminal vendor orders | Refund success and affected components | `SYNTHETIC_CALCULATION` | Separate full and partial refunds |
| Refund value ratio | Percent of captured value | Successful refund amount ÷ captured amount | Payment capture and refund success | `SYNTHETIC_CALCULATION` | Unknown/failed refunds are not successful |
| Repeat-order rate | Percent of eligible customers in interval | Customers with later confirmed request ÷ customers with prior eligible request | Privacy-approved stable customer key and ordered times | `NOT_OBSERVED` | Personas and repeated test operators are not customers |

## Vendor and fulfilment metrics

| Metric | Unit/denominator | Formula | Required source events | Current evidence | Important exclusion |
|---|---|---|---|---|---|
| Vendor response time | Seconds per vendor order; median and p90 | First valid accept/decline minus placed | Server/controlled clock placed and decision | `NOT_OBSERVED` | Deadline values are not observed duration |
| Vendor acceptance rate | Percent of offered vendor orders | Valid accepts ÷ valid offers | Offer/placed and first valid decision | `NOT_OBSERVED` | Script-selected branches are not behaviour |
| Preparation time | Seconds per accepted order; median and p90 | Ready minus accepted | Accepted and ready events | `NOT_OBSERVED` | Exclude customer-decision paused time separately |
| Pickup delay | Seconds per delivery order; median and p90 | Pickup minus ready | Ready, trusted arrival, pickup | `NOT_OBSERVED` | Report vendor wait separately |
| Delivery time | Seconds per delivered trip; median and p90 | Delivered minus pickup | Pickup and delivered events | `NOT_OBSERVED` | Returns are a separate duration |
| On-time completion | Percent of eligible orders | Completed within promised window ÷ completed eligible orders | Promise version/window and completion | `NOT_OBSERVED` | Do not count cancelled orders as on time |
| Return incidence | Percent of vendor orders entering custody | Returned orders ÷ orders with custody started | Custody start and return completion | `SYNTHETIC_CALCULATION` | Pre-pickup cancellation has no return |
| Package/proof mismatch | Count/rate per custody order | Mismatch cases ÷ custody-started orders | Package counts, proof outcome, case | `SYNTHETIC_COVERAGE` | No OTP content in analytics |

## Support and exception metrics

| Metric | Unit/denominator | Formula | Required source events | Current evidence | Important exclusion |
|---|---|---|---|---|---|
| Support load | Cases per 100 vendor orders and per 100 requests | Cases ÷ denominator × 100 | Unique case and affected refs | `SYNTHETIC_CALCULATION` | Script coverage is not staffing forecast |
| P0–P3 acknowledgement | Seconds and target-pass percent | Acknowledged minus opened; passes ÷ cases | Case open/severity/acknowledgement | `NOT_OBSERVED` | Written target is not actual response |
| Unowned-case rate | Percent of open cases | Open cases without current owner ÷ open cases | Case owner/handoff history | `SYNTHETIC_COVERAGE` | Closed scripted cases do not prove staffing |
| Payment-unknown incidence | Percent of authorization attempts | Initially unknown attempts ÷ attempts | Stable payment operation and provider outcome | `SYNTHETIC_CALCULATION` | Scripted result is not provider reliability |

## Money and unit-economics metrics

| Metric | Unit/denominator | Formula | Required source | Current evidence | Important exclusion |
|---|---|---|---|---|---|
| Customer captured amount | Paise total | Sum successful captures once | Reconciled fake payment rows | `SYNTHETIC_CALCULATION` | Not GMV or revenue when fully refunded |
| Customer net amount | Paise total | Captured minus successful refunds | Reconciled payment/refund rows | `SYNTHETIC_CALCULATION` | Excludes unresolved results |
| Vendor proceeds | Paise total and per completed order | Sum vendor payable; divide by completed orders | Settlement rows | `SYNTHETIC_CALCULATION` | Not vendor incremental profit |
| Partner pay | Paise total, per vendor order, and per paid trip/order | Sum outbound, wait, return, tip, adjustment | Earning/settlement rows | `SYNTHETIC_CALCULATION` | Not wage or earnings-per-active-hour |
| Platform contribution | Paise total and per vendor order | Customer net minus vendor payable minus partner payable | Balanced settlement rows | `SYNTHETIC_CALCULATION` | Omits payment, support, labour, insurance, tax, and infrastructure costs |
| Reconciliation difference | Paise | Customer net minus all allocations | Reconciled settlement rows | `SYNTHETIC_CALCULATION` | Must be zero; do not add unexplained adjustment |

## Required dimensions

When evidence exists, segment by evidence mode, cohort/policy version, zone, vendor, fulfilment method, terminal state, exception category, and language. Suppress small or privacy-sensitive groups in controlled real reporting. Never include exact address, phone, OTP, payment instrument, raw location, document content, or free-form case evidence.

## Threshold status

Business decision thresholds are `UNAPPROVED`. Step 1.4 defines measures; Step 1.5 must obtain explicit thresholds before comparing results. Data-integrity requirements such as zero unexplained financial difference are mandatory controls, not business-success thresholds.
