-- Registry and approval trail for the capabilities FEATURES.md marks Gated.
--
-- Section 17 of FEATURES.md requires that a gated capability "must remain
-- unavailable until their named approvals and controls pass". Until now that
-- was a documentary rule with nothing enforcing it: any future contributor
-- could ship cash-on-delivery or prescription handling without the legal,
-- financial and privacy reviews those capabilities depend on.
--
-- A capability is unavailable unless an approval row names who approved it and
-- against what evidence. Approvals are append-only; withdrawing one is a new
-- row, never a deletion, so the record of what was live and when survives.

CREATE TABLE marketplace.gated_capabilities (
  capability_key text PRIMARY KEY,
  catalogue_id text NOT NULL UNIQUE,
  description text NOT NULL,
  required_gate text NOT NULL,
  state text NOT NULL DEFAULT 'UNAVAILABLE',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT gated_capability_key_shape CHECK (capability_key ~ '^[a-z][a-z0-9_.]{2,63}$'),
  CONSTRAINT gated_capability_catalogue_shape CHECK (catalogue_id ~ '^GAT-[0-9]{2}$'),
  CONSTRAINT gated_capability_state_allowed CHECK (state IN ('UNAVAILABLE', 'AVAILABLE'))
);

CREATE TABLE marketplace.gated_capability_approvals (
  approval_id uuid PRIMARY KEY,
  capability_key text NOT NULL,
  decision text NOT NULL,
  approver_user_id uuid NOT NULL,
  approver_role text NOT NULL,
  approval_reference text NOT NULL,
  evidence_note text NOT NULL,
  request_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT gated_approval_capability_fk FOREIGN KEY (capability_key)
    REFERENCES marketplace.gated_capabilities (capability_key) ON DELETE RESTRICT,
  CONSTRAINT gated_approval_approver_fk FOREIGN KEY (approver_user_id)
    REFERENCES marketplace.users (user_id) ON DELETE RESTRICT,
  CONSTRAINT gated_approval_decision_allowed CHECK (decision IN ('APPROVED', 'WITHDRAWN')),
  CONSTRAINT gated_approval_reference_shape CHECK (approval_reference ~ '^[A-Z0-9][A-Z0-9._:/-]{3,127}$'),
  CONSTRAINT gated_approval_role_shape CHECK (approver_role ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT gated_approval_evidence_present CHECK (length(btrim(evidence_note)) >= 12)
);

CREATE INDEX gated_capability_approvals_history
  ON marketplace.gated_capability_approvals (capability_key, recorded_at DESC, approval_id);

CREATE FUNCTION marketplace.reject_gated_approval_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Gated capability approvals are append-only';
END;
$$;

CREATE TRIGGER gated_capability_approvals_append_only
  BEFORE UPDATE OR DELETE ON marketplace.gated_capability_approvals
  FOR EACH ROW EXECUTE FUNCTION marketplace.reject_gated_approval_mutation();

INSERT INTO marketplace.gated_capabilities
  (capability_key, catalogue_id, description, required_gate)
VALUES
  ('gated.cash_on_delivery', 'GAT-01', 'Cash on delivery',
   'Cash custody, collection, change, failed delivery, fraud, refund, reconciliation, insurance and payout policy'),
  ('gated.pharmacy_ordering', 'GAT-02', 'Pharmacy ordering',
   'Jurisdiction legal review, verified licences, approved categories, pharmacist review, privacy, retention and audit controls'),
  ('gated.prescription_upload', 'GAT-03', 'Prescription upload',
   'Separate protected storage, access, consent, malware scanning, retention, deletion and human review'),
  ('gated.prescription_fulfilment', 'GAT-04', 'Prescription-item fulfilment',
   'Licensed human approval, no automatic prescription substitution, minimum necessary delivery data'),
  ('gated.alternative_delivery_proof', 'GAT-05', 'Alternative delivery proof',
   'Consent, acceptable scenarios, evidence access, fraud, retention, appeal and support policy');

INSERT INTO marketplace.capabilities
  (capability_key, actor_kind, resource_rule, description)
VALUES
  ('admin.gated.review', 'ADMIN', 'ADMIN_SCOPE',
   'Read the gated-capability register and record named approvals');

INSERT INTO marketplace.role_capabilities (role_key, capability_key)
VALUES ('CONFIG_APPROVER', 'admin.gated.review');
