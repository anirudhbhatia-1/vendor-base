-- Copy for product-first browsing: search hits and category aisles (MKT-11, UX-08).
--
-- Search already ranked products, and a category tile already knew its aisle;
-- both were rendered as a filtered list of shops, so the customer surface had
-- no words for "here is the item" or "here is the aisle". These are the keys
-- those two grids ask for, plus the per-tile "from <shop>" label that keeps the
-- seller named on a tile that no store heading covers (MKT-01, EXC-02).
--
-- `ON CONFLICT DO NOTHING` guards a re-run, not an overlap: none of these keys
-- existed before, and a corrected translation shipped later must not be undone
-- by re-applying this one.

INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.aisle.close', 'customer', 'CUSTOMER', 'Customer copy: aisle close'),
  ('customer.aisle.empty.description', 'customer', 'CUSTOMER', 'Customer copy: aisle empty description'),
  ('customer.aisle.empty.title', 'customer', 'CUSTOMER', 'Customer copy: aisle empty title'),
  ('customer.aisle.eyebrow', 'customer', 'CUSTOMER', 'Customer copy: aisle eyebrow'),
  ('customer.aisle.loading', 'customer', 'CUSTOMER', 'Customer copy: aisle loading'),
  ('customer.product.sold_by', 'customer', 'CUSTOMER', 'Customer copy: product sold by'),
  ('customer.results.count', 'customer', 'CUSTOMER', 'Customer copy: results count'),
  ('customer.results.empty.description', 'customer', 'CUSTOMER', 'Customer copy: results empty description'),
  ('customer.results.empty.title', 'customer', 'CUSTOMER', 'Customer copy: results empty title'),
  ('customer.results.eyebrow', 'customer', 'CUSTOMER', 'Customer copy: results eyebrow'),
  ('customer.results.loading', 'customer', 'CUSTOMER', 'Customer copy: results loading'),
  ('customer.results.title', 'customer', 'CUSTOMER', 'Customer copy: results title')
ON CONFLICT (locale_key) DO NOTHING;

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.aisle.close', 'en', 'Back to aisles'),
  ('customer.aisle.empty.description', 'en', 'No shop near you has published anything in this aisle yet.'),
  ('customer.aisle.empty.title', 'en', 'This aisle is empty near you'),
  ('customer.aisle.eyebrow', 'en', 'Across every shop that reaches you'),
  ('customer.aisle.loading', 'en', 'Filling the aisle…'),
  ('customer.product.sold_by', 'en', 'from'),
  ('customer.results.count', 'en', 'items'),
  ('customer.results.empty.description', 'en', 'The shops below may still stock something close.'),
  ('customer.results.empty.title', 'en', 'No item matched that'),
  ('customer.results.eyebrow', 'en', 'Every item names its shop'),
  ('customer.results.loading', 'en', 'Looking…'),
  ('customer.results.title', 'en', 'Items matching')
ON CONFLICT (locale_key, language_code) DO NOTHING;

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.aisle.close', 'hi', 'गलियारों पर वापस'),
  ('customer.aisle.empty.description', 'hi', 'आपके पास की किसी दुकान ने इस गलियारे में अभी कुछ नहीं रखा है।'),
  ('customer.aisle.empty.title', 'hi', 'आपके पास यह गलियारा ख़ाली है'),
  ('customer.aisle.eyebrow', 'hi', 'आप तक पहुँचने वाली हर दुकान से'),
  ('customer.aisle.loading', 'hi', 'गलियारा भरा जा रहा है…'),
  ('customer.product.sold_by', 'hi', 'दुकान:'),
  ('customer.results.count', 'hi', 'चीज़ें'),
  ('customer.results.empty.description', 'hi', 'नीचे दी दुकानों में इससे मिलती-जुलती चीज़ हो सकती है।'),
  ('customer.results.empty.title', 'hi', 'इससे मिलती कोई चीज़ नहीं मिली'),
  ('customer.results.eyebrow', 'hi', 'हर चीज़ पर उसकी दुकान का नाम'),
  ('customer.results.loading', 'hi', 'ढूँढ रहे हैं…'),
  ('customer.results.title', 'hi', 'इससे मिलती चीज़ें')
ON CONFLICT (locale_key, language_code) DO NOTHING;
