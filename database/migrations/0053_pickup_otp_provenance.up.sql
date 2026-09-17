-- A pickup code has exactly one issuer, and the order records which.
--
-- Two endpoints minted a collection code into the same column. The customer's
-- "Show my collection code" (CUS-51) and the vendor's "Issue pickup code"
-- (VEN-35) both ran
--   UPDATE marketplace.vendor_orders SET pickup_otp_hash = ...
-- on the same row, so whichever ran last silently invalidated the other. A
-- customer who opened their code and then reached a counter where staff tapped
-- their own button was refused at handover, with nothing on either screen
-- explaining why.
--
-- FEATURES.md settles the ownership: CUS-51 has the customer complete pickup
-- "with a server-validated OTP or approved alternative proof", and VEN-35 has
-- staff *validate* it. A code the vendor issues and reads aloud verifies
-- nothing about who is standing at the counter, so it is not a peer of the
-- customer's code — it is the alternative-proof path, for a customer who
-- cannot show one.
--
-- Recording the issuer on the order makes the live code's provenance a
-- first-class fact at validation time, rather than something reconstructed by
-- walking the event stream. The *reason* for a fallback stays on the
-- append-only vendor_order_events row, which is the durable record.

ALTER TABLE marketplace.vendor_orders
  ADD COLUMN pickup_otp_issued_by text;

-- Backfill before constraining: a live code already exists on any order whose
-- handover is in flight, and the paired constraint below would reject it. The
-- issuer is not guessed — `vendor_order_events` already records who minted each
-- code as `actor_kind` on PICKUP_OTP_ISSUED, so the provenance comes from the
-- append-only record rather than from an assumption about which UI was used.
UPDATE marketplace.vendor_orders o
   SET pickup_otp_issued_by = CASE latest.actor_kind
                                WHEN 'customer' THEN 'CUSTOMER'
                                ELSE 'VENDOR_FALLBACK'
                              END
  FROM (
    SELECT DISTINCT ON (e.vendor_order_id) e.vendor_order_id, e.actor_kind
      FROM marketplace.vendor_order_events e
     WHERE e.event_type = 'PICKUP_OTP_ISSUED'
     ORDER BY e.vendor_order_id, e.occurred_at DESC
  ) latest
 WHERE latest.vendor_order_id = o.vendor_order_id
   AND o.pickup_otp_hash IS NOT NULL;

-- A live hash with no issuance event cannot have its provenance established, and
-- a code nobody can attribute must not be honoured at a counter. Pickup codes
-- are short-lived by design, so clearing these costs at most one re-issue.
UPDATE marketplace.vendor_orders
   SET pickup_otp_hash = NULL, pickup_otp_expires_at = NULL, pickup_otp_attempts = 0
 WHERE pickup_otp_hash IS NOT NULL
   AND pickup_otp_issued_by IS NULL;

ALTER TABLE marketplace.vendor_orders
  ADD CONSTRAINT vendor_order_pickup_otp_issuer_allowed
    CHECK (pickup_otp_issued_by IS NULL
        OR pickup_otp_issued_by IN ('CUSTOMER', 'VENDOR_FALLBACK')),
  -- The issuer travels with the code: present while one is live, cleared when
  -- it is redeemed or expires, exactly like the hash and its expiry.
  ADD CONSTRAINT vendor_order_pickup_otp_issuer_shape
    CHECK ((pickup_otp_hash IS NULL AND pickup_otp_issued_by IS NULL)
        OR (pickup_otp_hash IS NOT NULL AND pickup_otp_issued_by IS NOT NULL));

COMMENT ON COLUMN marketplace.vendor_orders.pickup_otp_issued_by IS
  'Which side minted the live pickup code. CUSTOMER is the default path (CUS-51); VENDOR_FALLBACK is the approved alternative proof for a customer who cannot show a code, and carries its reason on the PICKUP_OTP_ISSUED event.';
