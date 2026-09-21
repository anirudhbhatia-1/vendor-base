ALTER TABLE marketplace.assignment_events
  DROP CONSTRAINT assignment_event_type_allowed,
  ADD CONSTRAINT assignment_event_type_allowed CHECK (event_type IN
    ('ASSIGNMENT_CREATED', 'OFFERED', 'ACCEPTED', 'AT_VENDOR', 'PICKUP_CONFIRMED',
     'EN_ROUTE', 'ARRIVED', 'DELIVERED', 'DECLINED', 'OFFER_EXPIRED',
     'FAILED_PICKUP', 'REASSIGNED', 'CANCELLED', 'DELIVERY_FAILED',
     'RETURN_REQUIRED', 'RETURN_AUTHORIZED', 'RETURNING', 'RETURNED'));

ALTER TABLE marketplace.delivery_assignments
  DROP CONSTRAINT delivery_assignment_at_vendor_is_verified,
  DROP CONSTRAINT delivery_assignment_arrival_shape,
  DROP CONSTRAINT delivery_assignment_arrival_claim_shape,
  DROP CONSTRAINT delivery_assignment_arrival_claim_reason_allowed,
  DROP CONSTRAINT delivery_assignment_arrival_distance,
  DROP CONSTRAINT delivery_assignment_arrival_kind_allowed,
  DROP COLUMN arrival_claim_reason,
  DROP COLUMN arrival_claimed_at,
  DROP COLUMN arrived_at,
  DROP COLUMN arrival_distance_metres,
  DROP COLUMN arrival_kind;

ALTER TABLE marketplace.vendor_locations
  DROP CONSTRAINT vendor_location_landmark_shape,
  DROP COLUMN landmark;
