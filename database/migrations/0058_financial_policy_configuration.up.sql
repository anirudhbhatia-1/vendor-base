-- The fee model becomes versioned configuration instead of a frozen constant.
--
-- Every fee number the platform charges or pays lived in one `Object.freeze`
-- in `money-policy.ts`, and the quote stamped a hardcoded string literal —
-- 'SYNTH-POLICY-D05-LOCAL-V1' — as the policy that priced it. Changing a fee
-- meant shipping a deploy, and an order placed last week could not be shown to
-- have been priced under different rules, because every order claimed the same
-- version. MKT-10 requires the opposite: the exact policy version used for each
-- order is retained.
--
-- The values below are today's constants exactly, with one deliberate change.
-- The vendor commission was a flat 500 minor units per completed order, which
-- charges the same rupees on a ₹50 basket as on a ₹5,000 one. It becomes a rate
-- of 500 basis points — 5% — which is what a flat ₹5 already worked out to on
-- the ₹100 basket this platform's fixtures are built around, so a fresh
-- database prices as it did before while the number now scales with the sale.
--
-- Seeded directly as ACTIVE rather than driven through draft → validate →
-- approve → schedule, the same way 0009 seeds the notification channel policy:
-- this is the initial state the reviewed workflow starts from, not a change
-- made through it. The maker-checker constraint still applies, so the proposing
-- and approving references are distinct.

-- Configuration history is append-only and a version can only ever move
-- forward through its lifecycle, so this inserts the next version rather than a
-- fixed one, and does nothing when an active policy is already in place. That
-- makes the pair reversible: the down migration supersedes rather than deletes,
-- and re-applying this adds the successor it is entitled to.
INSERT INTO marketplace.configuration_versions
  (configuration_version_id, configuration_key, version_number, configuration_kind,
   value_type, configuration_value, scope_kind, scope_reference, status,
   proposed_by, validated_by, approved_by, request_id, correlation_id,
   effective_from, validated_at, approved_at, activated_at)
SELECT
  ('01890000-0000-7000-8000-' || lpad(to_hex(next.version_number), 12, '0'))::uuid,
  'finance.financial_policy',
  next.version_number,
  'SETTING',
  'JSON',
  '{
     "currency": "INR",
     "commission_basis_points": 500,
     "delivery_base_minor": 1500,
     "included_metres": 2000,
     "per_km_minor": 800,
     "outer_route_metres": 40000,
     "settlement_delay_seconds": 86400,
     "partner_base_minor": 2000,
     "partner_per_km_minor": 600,
     "partner_per_package_minor": 200,
     "wait_cap_minor": 1000,
     "wait_included_seconds": 300,
     "wait_per_completed_minute_minor": 100
   }'::jsonb,
  'GLOBAL',
  'global',
  'ACTIVE',
  '01890000-0000-7000-8000-00000000a001',
  '01890000-0000-7000-8000-00000000a002',
  '01890000-0000-7000-8000-00000000a003',
  '01890000-0000-7000-8000-00000000b001',
  '01890000-0000-7000-8000-00000000b001',
  TIMESTAMPTZ '2026-01-01 00:00:00Z',
  TIMESTAMPTZ '2026-01-01 00:00:00Z',
  TIMESTAMPTZ '2026-01-01 00:00:00Z',
  TIMESTAMPTZ '2026-01-01 00:00:00Z'
FROM (
  SELECT COALESCE(max(version_number), 0) + 1 AS version_number
    FROM marketplace.configuration_versions
   WHERE configuration_key = 'finance.financial_policy'
     AND scope_kind = 'GLOBAL' AND scope_reference = 'global'
) next
WHERE NOT EXISTS (
  SELECT 1 FROM marketplace.configuration_versions
   WHERE configuration_key = 'finance.financial_policy'
     AND scope_kind = 'GLOBAL' AND scope_reference = 'global'
     AND status = 'ACTIVE'
);
