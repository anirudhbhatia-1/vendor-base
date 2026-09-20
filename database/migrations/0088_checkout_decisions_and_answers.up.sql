-- Phase 7.6: what the checkout says, and what it knows.
--
-- The customer's substitution rule -- ask me, let the store choose, refund
-- me -- was chosen per basket line and went no further: the quote did not
-- snapshot it, the content digest did not bind it, and the shop's order line
-- never carried it, so the checkout could not show the rule the order
-- proceeds under and the store never learnt it. Both lines carry it now.
ALTER TABLE marketplace.checkout_quote_lines
  ADD COLUMN substitution_preference text NOT NULL DEFAULT 'ASK_CUSTOMER'
    CHECK (substitution_preference IN ('NO_SUBSTITUTION', 'ASK_CUSTOMER', 'ALLOW_SAME_STORE'));
ALTER TABLE marketplace.vendor_order_lines
  ADD COLUMN substitution_preference text NOT NULL DEFAULT 'ASK_CUSTOMER'
    CHECK (substitution_preference IN ('NO_SUBSTITUTION', 'ASK_CUSTOMER', 'ALLOW_SAME_STORE'));

-- A declined payment, a quote that lapsed at placement and a basket that
-- changed since the quote all reached the customer as ORDER_STATE_CONFLICT --
-- "That step is not available yet. Check the job for what still has to happen
-- first." -- a sentence written for a shop's console. Each now has a code
-- and a sentence of its own.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('checkout.payment_declined', 'error', 'CUSTOMER',
    'Stable error PAYMENT_DECLINED: the provider declined the authorisation; nothing was charged'),
  ('checkout.quote_expired', 'error', 'CUSTOMER',
    'Stable error QUOTE_EXPIRED: the quote lapsed before the order was placed'),
  ('checkout.quote_changed', 'error', 'CUSTOMER',
    'Stable error QUOTE_CHANGED: the basket or the catalogue changed since the quote'),
  ('customer.checkout.declined.title', 'customer', 'CUSTOMER', 'Checkout: heading when the payment was declined'),
  ('customer.checkout.declined.body', 'customer', 'CUSTOMER', 'Checkout: what a decline means and what to do'),
  ('customer.checkout.changed.body', 'customer', 'CUSTOMER', 'Checkout: the basket changed since the quote, a fresh quote follows'),
  ('customer.checkout.interrupted.title', 'customer', 'CUSTOMER', 'Checkout: heading when no answer came back from the placement'),
  ('customer.checkout.interrupted.body', 'customer', 'CUSTOMER', 'Checkout: the order is not placed twice by checking'),
  ('customer.checkout.interrupted.check', 'customer', 'CUSTOMER', 'Checkout: button that re-asks with the same key'),
  ('customer.checkout.processing', 'customer', 'CUSTOMER', 'Checkout: live status while the order is being placed'),
  ('customer.quote.method', 'customer', 'CUSTOMER', 'Quote: label for the way the store gets the order to the customer'),
  ('customer.quote.decision', 'customer', 'CUSTOMER', 'Quote: label for the substitution rule the order proceeds under'),
  ('customer.quote.decision.ask_customer', 'customer', 'CUSTOMER', 'Quote: substitution rule, the store asks first'),
  ('customer.quote.decision.allow_same_store', 'customer', 'CUSTOMER', 'Quote: substitution rule, the store may choose a close match'),
  ('customer.quote.decision.no_substitution', 'customer', 'CUSTOMER', 'Quote: substitution rule, refund instead of replacing'),
  ('customer.quote.decision.mixed', 'customer', 'CUSTOMER', 'Quote: substitution rule differs per item'),
  ('customer.quote.no_buffer', 'customer', 'CUSTOMER', 'Quote: the authorised amount carries no buffer');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('checkout.payment_declined', 'en', 'Your bank declined the payment. Nothing was charged and your basket is unchanged.'),
  ('checkout.quote_expired', 'en', 'This quote expired before the order was placed. Get a fresh one.'),
  ('checkout.quote_changed', 'en', 'Your basket changed since this quote. Get a fresh one before paying.'),
  ('customer.checkout.declined.title', 'en', 'Your bank declined the payment'),
  ('customer.checkout.declined.body', 'en', 'Nothing was charged and your basket is unchanged. Choose another way to pay and try again with the fresh quote below.'),
  ('customer.checkout.changed.body', 'en', 'Your basket changed since that quote, so here is a fresh one.'),
  ('customer.checkout.interrupted.title', 'en', 'We did not hear back'),
  ('customer.checkout.interrupted.body', 'en', 'The connection dropped before we could tell you what happened. Checking does not place the order or charge you twice.'),
  ('customer.checkout.interrupted.check', 'en', 'Check what happened'),
  ('customer.checkout.processing', 'en', 'Placing your orders and asking your bank… keep this page open.'),
  ('customer.quote.method', 'en', 'How you get it'),
  ('customer.quote.decision', 'en', 'If something is out of stock'),
  ('customer.quote.decision.ask_customer', 'en', 'the store asks you before replacing it'),
  ('customer.quote.decision.allow_same_store', 'en', 'the store may choose a close match'),
  ('customer.quote.decision.no_substitution', 'en', 'it is refunded, never replaced'),
  ('customer.quote.decision.mixed', 'en', 'each item follows the rule you set for it'),
  ('customer.quote.no_buffer', 'en', 'No buffer is added: this is exactly the amount your bank is asked to hold.'),
  -- Hindi copy carried forward for native-speaker review.
  ('checkout.payment_declined', 'hi', 'आपके बैंक ने भुगतान अस्वीकार कर दिया। कुछ भी नहीं लिया गया और आपकी टोकरी वैसी ही है।'),
  ('checkout.quote_expired', 'hi', 'ऑर्डर देने से पहले यह कोटेशन समाप्त हो गया। नया लें।'),
  ('checkout.quote_changed', 'hi', 'इस कोटेशन के बाद आपकी टोकरी बदल गई। भुगतान से पहले नया कोटेशन लें।'),
  ('customer.checkout.declined.title', 'hi', 'आपके बैंक ने भुगतान अस्वीकार कर दिया'),
  ('customer.checkout.declined.body', 'hi', 'कुछ भी नहीं लिया गया और आपकी टोकरी वैसी ही है। भुगतान का दूसरा तरीका चुनें और नीचे दिए नए कोटेशन से फिर कोशिश करें।'),
  ('customer.checkout.changed.body', 'hi', 'उस कोटेशन के बाद आपकी टोकरी बदल गई, इसलिए यह नया कोटेशन है।'),
  ('customer.checkout.interrupted.title', 'hi', 'हमें जवाब नहीं मिला'),
  ('customer.checkout.interrupted.body', 'hi', 'हम आपको बता पाते उससे पहले कनेक्शन टूट गया। जाँच करने से ऑर्डर दोबारा नहीं लगता और न ही दोबारा भुगतान होता है।'),
  ('customer.checkout.interrupted.check', 'hi', 'देखें क्या हुआ'),
  ('customer.checkout.processing', 'hi', 'आपके ऑर्डर लगाए जा रहे हैं और बैंक से पूछा जा रहा है… यह पेज खुला रखें।'),
  ('customer.quote.method', 'hi', 'आपको कैसे मिलेगा'),
  ('customer.quote.decision', 'hi', 'अगर कुछ स्टॉक में न हो'),
  ('customer.quote.decision.ask_customer', 'hi', 'बदलने से पहले दुकान आपसे पूछेगी'),
  ('customer.quote.decision.allow_same_store', 'hi', 'दुकान मिलता-जुलता विकल्प चुन सकती है'),
  ('customer.quote.decision.no_substitution', 'hi', 'बदला नहीं जाएगा, पैसा वापस होगा'),
  ('customer.quote.decision.mixed', 'hi', 'हर सामान के लिए आपका तय किया नियम लागू होगा'),
  ('customer.quote.no_buffer', 'hi', 'कोई अतिरिक्त राशि नहीं जोड़ी गई: आपके बैंक से ठीक इतनी ही राशि रोकने को कहा जाता है।');
