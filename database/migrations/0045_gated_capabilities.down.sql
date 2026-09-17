DELETE FROM marketplace.role_capabilities WHERE capability_key = 'admin.gated.review';
DELETE FROM marketplace.capabilities WHERE capability_key = 'admin.gated.review';

DROP TRIGGER IF EXISTS gated_capability_approvals_append_only
  ON marketplace.gated_capability_approvals;
DROP FUNCTION IF EXISTS marketplace.reject_gated_approval_mutation();
DROP TABLE IF EXISTS marketplace.gated_capability_approvals;
DROP TABLE IF EXISTS marketplace.gated_capabilities;
