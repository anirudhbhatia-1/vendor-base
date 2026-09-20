-- Real road distance and travel time (D-17).
--
-- Every distance in the system was ST_Distance: a straight line. D-05 prices
-- delivery and the partner's earning per *route* kilometre, and no travel time
-- existed at all. The routing module now asks a maps provider (Mapbox) or,
-- when none is configured or it cannot answer, makes a labelled estimate.
--
-- Routes are cached by rounded coordinate pair: a store and a saved address
-- are fixed points, so one order's quote, offer and settlement call the
-- provider once.
CREATE TABLE marketplace.route_cache (
  route_cache_id uuid PRIMARY KEY,
  provider text NOT NULL,
  profile text NOT NULL,
  origin_key text NOT NULL,
  destination_key text NOT NULL,
  distance_metres integer NOT NULL,
  duration_seconds integer NOT NULL,
  computed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT route_cache_provider_allowed CHECK (provider IN ('MAPBOX')),
  CONSTRAINT route_cache_profile_allowed CHECK (profile IN ('cycling', 'driving', 'walking')),
  CONSTRAINT route_cache_key_shape CHECK (
    origin_key ~ '^-?[0-9]{1,3}\.[0-9]{5},-?[0-9]{1,2}\.[0-9]{5}$'
    AND destination_key ~ '^-?[0-9]{1,3}\.[0-9]{5},-?[0-9]{1,2}\.[0-9]{5}$'),
  CONSTRAINT route_cache_amounts_sane CHECK (distance_metres >= 0 AND duration_seconds >= 0),
  CONSTRAINT route_cache_window CHECK (expires_at > computed_at),
  CONSTRAINT route_cache_pair_unique UNIQUE (provider, profile, origin_key, destination_key)
);
CREATE INDEX route_cache_expiry ON marketplace.route_cache (expires_at);

-- The route a quoted group was priced on, with where it came from, and the
-- promise made from it. Collection groups travel no route and carry nulls.
ALTER TABLE marketplace.checkout_quote_groups
  ADD COLUMN route_metres integer,
  ADD COLUMN route_seconds integer,
  ADD COLUMN route_source text,
  ADD COLUMN ready_after_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN arrives_after_seconds integer,
  ADD CONSTRAINT checkout_quote_group_route_source_allowed
    CHECK (route_source IS NULL OR route_source IN ('ESTIMATE', 'MAPBOX')),
  ADD CONSTRAINT checkout_quote_group_route_shape
    CHECK ((route_metres IS NULL) = (route_seconds IS NULL)
       AND (route_metres IS NULL) = (route_source IS NULL)
       AND (route_metres IS NULL OR (route_metres >= 0 AND route_seconds >= 0))),
  ADD CONSTRAINT checkout_quote_group_promise_shape
    CHECK (ready_after_seconds >= 0
       AND (arrives_after_seconds IS NULL OR arrives_after_seconds >= ready_after_seconds));

-- The promise in the customer's language, from the numbers the quote stores.
INSERT INTO marketplace.locale_keys (locale_key, namespace, audience, description) VALUES
  ('customer.quote.promise.ready', 'customer', 'CUSTOMER', 'Customer copy: collection promise, with {minutes}'),
  ('customer.quote.promise.arrives', 'customer', 'CUSTOMER', 'Customer copy: delivery promise, with {from}, {to} and {km}'),
  ('customer.quote.promise.estimated', 'customer', 'CUSTOMER', 'Customer copy: the road was estimated, not routed');

INSERT INTO marketplace.locale_translations (locale_key, language_code, translation) VALUES
  ('customer.quote.promise.ready', 'en', 'Ready in about {minutes} minutes.'),
  ('customer.quote.promise.arrives', 'en', 'Arrives in about {from}–{to} minutes, {km} km by road.'),
  ('customer.quote.promise.estimated', 'en', 'The road is estimated.'),
  -- Hindi copy carried forward for native-speaker review with the customer
  -- strings added in 0048.
  ('customer.quote.promise.ready', 'hi', 'लगभग {minutes} मिनट में तैयार।'),
  ('customer.quote.promise.arrives', 'hi', 'लगभग {from}–{to} मिनट में पहुँचेगा, सड़क से {km} कि.मी.।'),
  ('customer.quote.promise.estimated', 'hi', 'सड़क की दूरी अनुमानित है।');
