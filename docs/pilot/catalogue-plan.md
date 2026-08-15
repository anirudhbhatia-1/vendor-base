# Synthetic Fruit-and-Vegetable Catalogue Plan

**Catalogue ID:** `CAT-FV-BASE-01`  
**Environment:** Internal company testing only  
**Applies to:** `FV-01` through `FV-09`  
**Entries per vendor:** 20

Each synthetic vendor receives the same 20-entry base catalogue. Individual test scenarios may change stock state, final weight, or substitution outcome, but must preserve the original quoted history. Prices are deliberately omitted here because D-05 is open; tests must use clearly labelled synthetic fixture prices rather than production policy.

| Product ID | Synthetic product | Selling unit | Test behaviour |
|---|---|---|---|
| `PROD-FV-001` | Potato | 1 kg target weight | Variable weight |
| `PROD-FV-002` | Onion | 1 kg target weight | Variable weight |
| `PROD-FV-003` | Tomato | 1 kg target weight | Variable weight and freshness |
| `PROD-FV-004` | Cauliflower | 1 piece | Piece size varies |
| `PROD-FV-005` | Cabbage | 1 piece | Piece size varies |
| `PROD-FV-006` | Okra | 500 g target weight | Variable weight |
| `PROD-FV-007` | Brinjal | 500 g target weight | Substitution variant |
| `PROD-FV-008` | Green peas | 500 g target weight | Seasonal availability |
| `PROD-FV-009` | Carrot | 500 g target weight | Variable weight |
| `PROD-FV-010` | Cucumber | 500 g target weight | Variable weight |
| `PROD-FV-011` | Spinach | 1 bunch | Freshness and stock confidence |
| `PROD-FV-012` | Coriander | 1 bunch | Low-value add-on |
| `PROD-FV-013` | Green chilli | 100 g target weight | Small variable weight |
| `PROD-FV-014` | Lemon | Pack of 4 | Pack quantity |
| `PROD-FV-015` | Banana | 6-piece target pack | Final piece/weight confirmation |
| `PROD-FV-016` | Apple | 1 kg target weight | Grade substitution |
| `PROD-FV-017` | Orange | 1 kg target weight | Seasonal availability |
| `PROD-FV-018` | Pomegranate | 1 kg target weight | Material final-price change |
| `PROD-FV-019` | Papaya | 1 piece | Material weight variation |
| `PROD-FV-020` | Watermelon | 1 piece | Large weight variation |

## Test rules

- Every entry is synthetic and contains no supplier, barcode, image, or real vendor price.
- Availability must use the documented states: available, low stock, vendor confirms, or out of stock.
- Cart addition does not reserve stock. Any later test reservation follows the implementation state contract.
- Default substitution is none. A replacement requires a recorded synthetic customer preference or explicit test decision.
- Variable-weight results must display the change and follow the approved test outcome; they may not silently alter a payable amount.
- Images, if added later, must be licensed test assets without hidden location or personal metadata.

## Success and failure

Success means all nine vendors can load exactly 20 products and exercise their assigned workflow without relying on a real price or identity. A missing unit, invalid availability state, duplicate product ID, or accidental real-world data blocks that fixture from use until corrected.
