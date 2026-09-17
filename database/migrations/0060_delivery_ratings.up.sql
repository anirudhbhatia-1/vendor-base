-- The shop and the delivery are two services, and were sharing one score.
--
-- `vendor_order_ratings` is the only rating in the platform, and the storefront
-- average is computed from it. A late or careless delivery therefore lowered
-- the shop's rating, and a shop that packed a perfect order carried a rider's
-- bad day on its own record. Neither party can act on a signal that measures
-- somebody else.
--
-- Keyed by the delivery attempt rather than the order, because the delivery is
-- what is being rated — a returned or re-offered attempt is a different piece
-- of work. One rating per attempt, from the customer whose order it was.
CREATE TABLE marketplace.delivery_assignment_ratings (
  delivery_assignment_id uuid PRIMARY KEY
    REFERENCES marketplace.delivery_assignments (delivery_assignment_id) ON DELETE RESTRICT,
  customer_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  review_note text CHECK (review_note IS NULL OR length(review_note) BETWEEN 1 AND 500),
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- A partner's ratings are read as an aggregate over a period, never as a list
-- traceable back to one customer at one door.
CREATE INDEX delivery_assignment_ratings_by_partner
  ON marketplace.delivery_assignment_ratings (partner_user_id, created_at DESC);
