-- Blank domain baseline: activate only the approved spatial capability.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS marketplace;

COMMENT ON SCHEMA marketplace IS
  'Authoritative Neighbourhood Store Marketplace domain schema; empty at Step 2.4';
