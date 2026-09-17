-- One active assignment per identity and role.
--
-- `role_assignments_user_active` (migration 0008) is a plain index, so nothing in
-- the schema forbade two ACTIVE rows for the same (user_id, role_key). The
-- invariant was held only by serialization inside application code: an advisory
-- lock plus two FOR UPDATE reads in `customer-enrolment.ts`, and, in the vendor,
-- partner and admin onboarding paths, by nothing at all.
--
-- Measured against this schema, three genuinely concurrent first-time enrolments
-- with that serialization removed insert three active CUSTOMER grants for one
-- person. A timing-dependent test cannot be relied on to catch that -- the same
-- race is invisible unless the connections are established in advance -- so the
-- constraint belongs in the database, where it holds regardless of which code
-- path writes and whether that path remembered to take a lock.
--
-- Scheduled and historical assignments are unaffected: this constrains ACTIVE
-- rows only, and revoked rows are excluded, so an identity may hold any number of
-- superseded or revoked assignments for the same role.
CREATE UNIQUE INDEX role_assignments_one_active_per_role
  ON marketplace.role_assignments (user_id, role_key)
  WHERE state = 'ACTIVE';
