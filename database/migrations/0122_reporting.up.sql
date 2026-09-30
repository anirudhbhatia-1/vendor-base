-- 11.8: an export is a snapshot of one report over one period and scope,
-- classified at least as the report is, kept only until it is downloaded or
-- lapses, and every attempt to take it is recorded.
--
-- Until audit run 80 an export stored no content: redeeming it ran the report
-- again, at download time, over whatever the data then was, ignoring the
-- filters it recorded; its creation was not audited; a refused download left
-- no trace; and only incident commanders could export anything.

ALTER TABLE marketplace.report_exports
  ADD COLUMN scope_kind text NOT NULL DEFAULT 'GLOBAL',
  ADD COLUMN scope_reference text NOT NULL DEFAULT 'global',
  ADD COLUMN period_from timestamptz,
  ADD COLUMN period_to timestamptz,
  ADD COLUMN content jsonb,
  ADD COLUMN content_sha256 text,
  ADD COLUMN purged_at timestamptz;

-- Exports made before 0122 held no content; they are recorded as purged.
UPDATE marketplace.report_exports
   SET purged_at = COALESCE(downloaded_at, expires_at),
       period_from = created_at, period_to = created_at;

ALTER TABLE marketplace.report_exports
  ALTER COLUMN period_from SET NOT NULL,
  ALTER COLUMN period_to SET NOT NULL,
  ADD CONSTRAINT report_export_scope_allowed CHECK
    ((scope_kind = 'GLOBAL' AND scope_reference = 'global')
     OR (scope_kind = 'ZONE' AND scope_reference ~ '^[0-9a-f-]{36}$')),
  ADD CONSTRAINT report_export_period CHECK
    (period_from <= period_to AND period_to - period_from <= interval '92 days'),
  -- The content is held until it is taken or lapses, then only its hash.
  ADD CONSTRAINT report_export_content_shape CHECK
    ((content IS NULL) = (purged_at IS NOT NULL)
     AND (content IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$')),
  ADD CONSTRAINT report_export_downloaded_purged CHECK
    (downloaded_at IS NULL OR purged_at IS NOT NULL),
  -- Finance and risk figures are never exported below RESTRICTED. Not
  -- validated against exports made before 0122, which chose their own.
  ADD CONSTRAINT report_export_classification_floor CHECK
    (report_kind NOT IN ('FINANCE', 'RISK') OR classification = 'RESTRICTED') NOT VALID;

CREATE TABLE marketplace.report_export_accesses (
  report_export_access_id uuid PRIMARY KEY,
  report_export_id uuid NOT NULL
    REFERENCES marketplace.report_exports (report_export_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  outcome text NOT NULL,
  request_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT report_export_access_outcome CHECK (outcome IN
    ('DOWNLOADED', 'REFUSED_NOT_EXPORTER', 'REFUSED_ALREADY_TAKEN', 'REFUSED_EXPIRED'))
);
CREATE INDEX report_export_accesses_export
  ON marketplace.report_export_accesses (report_export_id, occurred_at);
CREATE TRIGGER report_export_accesses_append_only
  BEFORE UPDATE OR DELETE ON marketplace.report_export_accesses
  FOR EACH ROW EXECUTE FUNCTION marketplace.protect_configuration_history();

-- The approvers of a domain export its figures; commanders export any.
INSERT INTO marketplace.role_capabilities (role_key, capability_key) VALUES
  ('FINANCE_APPROVER', 'admin.reporting.export'),
  ('TRUST_APPROVER', 'admin.reporting.export')
ON CONFLICT DO NOTHING;
