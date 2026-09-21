-- 9.6: arrival at the customer's door is recorded with how far it can be
-- trusted, and the customer's code confirms it.
--
-- Until audit run 61 `arrive-customer` was the partner's word from anywhere,
-- and that word started the paid customer-unreachable wait. Now the device's
-- fix against the delivery address makes the arrival TRUSTED_LOCATION, or the
-- arrival stands UNVERIFIED with its reason -- the partner still proceeds,
-- because the customer reading their code to them is the proof of the door
-- (CUSTOMER_CONFIRMED) -- and only a trusted arrival earns waiting pay.

ALTER TABLE marketplace.delivery_assignments
  ADD COLUMN customer_arrival_kind text,
  ADD COLUMN customer_arrived_at timestamptz,
  ADD COLUMN customer_arrival_distance_metres integer,
  ADD COLUMN customer_arrival_claim_reason text,
  ADD CONSTRAINT delivery_assignment_customer_arrival_kind_allowed CHECK
    (customer_arrival_kind IS NULL
     OR customer_arrival_kind IN ('TRUSTED_LOCATION', 'UNVERIFIED', 'CUSTOMER_CONFIRMED')),
  ADD CONSTRAINT delivery_assignment_customer_arrival_distance CHECK
    (customer_arrival_distance_metres IS NULL
     OR customer_arrival_distance_metres BETWEEN 0 AND 100000),
  ADD CONSTRAINT delivery_assignment_customer_arrival_claim_reason_allowed CHECK
    (customer_arrival_claim_reason IS NULL
     OR customer_arrival_claim_reason IN
        ('NO_LOCATION', 'POOR_ACCURACY', 'OUT_OF_RANGE', 'NO_DESTINATION')),
  ADD CONSTRAINT delivery_assignment_customer_arrival_shape CHECK
    ((customer_arrival_kind IS NULL) = (customer_arrived_at IS NULL)),
  -- A trusted arrival has nothing to explain; any other kind says why.
  ADD CONSTRAINT delivery_assignment_customer_arrival_reason_shape CHECK
    (customer_arrival_kind IS DISTINCT FROM 'TRUSTED_LOCATION'
     OR customer_arrival_claim_reason IS NULL);

-- ARRIVED at the customer says how. NOT VALID: rows that arrived on the
-- partner's word before this migration stand.
ALTER TABLE marketplace.delivery_assignments
  ADD CONSTRAINT delivery_assignment_arrived_is_recorded CHECK
    (assignment_state <> 'ARRIVED' OR customer_arrival_kind IS NOT NULL) NOT VALID;
