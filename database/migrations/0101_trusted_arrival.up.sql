-- 9.4: arrival at the store is trusted or confirmed, never merely claimed;
-- and the store carries a landmark so a written route exists beside the map.
--
-- Until audit run 59 `arrive-vendor` took the partner's word: any partner
-- could mark themselves at any store from anywhere, which started the wait
-- timer (and its pay) on nothing. Now an arrival is recorded as
-- TRUSTED_LOCATION when the device's position falls within the configured
-- radius of the store, or as VENDOR_CONFIRMED when the store confirms the
-- partner at the counter after a claim the position could not support.

ALTER TABLE marketplace.vendor_locations
  ADD COLUMN landmark text,
  ADD CONSTRAINT vendor_location_landmark_shape CHECK
    (landmark IS NULL OR length(landmark) BETWEEN 2 AND 120);

ALTER TABLE marketplace.delivery_assignments
  ADD COLUMN arrival_kind text,
  ADD COLUMN arrival_distance_metres integer,
  ADD COLUMN arrived_at timestamptz,
  ADD COLUMN arrival_claimed_at timestamptz,
  ADD COLUMN arrival_claim_reason text,
  ADD CONSTRAINT delivery_assignment_arrival_kind_allowed CHECK
    (arrival_kind IS NULL OR arrival_kind IN ('TRUSTED_LOCATION', 'VENDOR_CONFIRMED')),
  ADD CONSTRAINT delivery_assignment_arrival_distance CHECK
    (arrival_distance_metres IS NULL OR arrival_distance_metres BETWEEN 0 AND 100000),
  ADD CONSTRAINT delivery_assignment_arrival_claim_reason_allowed CHECK
    (arrival_claim_reason IS NULL
     OR arrival_claim_reason IN ('NO_LOCATION', 'POOR_ACCURACY', 'OUT_OF_RANGE')),
  -- A claim is a pair: when, and why the position could not support it.
  ADD CONSTRAINT delivery_assignment_arrival_claim_shape CHECK
    ((arrival_claimed_at IS NULL) = (arrival_claim_reason IS NULL)),
  -- A recorded arrival names how it was trusted and when.
  ADD CONSTRAINT delivery_assignment_arrival_shape CHECK
    ((arrival_kind IS NULL) = (arrived_at IS NULL));

-- AT_VENDOR means verified presence. NOT VALID: rows that reached AT_VENDOR
-- on the partner's word before this migration stay as they are; every row
-- written from now on must say how the arrival was trusted.
ALTER TABLE marketplace.delivery_assignments
  ADD CONSTRAINT delivery_assignment_at_vendor_is_verified CHECK
    (assignment_state <> 'AT_VENDOR' OR arrival_kind IS NOT NULL) NOT VALID;

-- The claim is an event in the attempt's history like any other.
ALTER TABLE marketplace.assignment_events
  DROP CONSTRAINT assignment_event_type_allowed,
  ADD CONSTRAINT assignment_event_type_allowed CHECK (event_type IN
    ('ASSIGNMENT_CREATED', 'OFFERED', 'ACCEPTED', 'ARRIVAL_CLAIMED', 'AT_VENDOR',
     'PICKUP_CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'DECLINED', 'OFFER_EXPIRED',
     'FAILED_PICKUP', 'REASSIGNED', 'CANCELLED', 'DELIVERY_FAILED',
     'RETURN_REQUIRED', 'RETURN_AUTHORIZED', 'RETURNING', 'RETURNED'));
