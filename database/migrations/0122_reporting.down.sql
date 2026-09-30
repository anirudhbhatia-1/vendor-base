-- Snapshots, zone scopes and the access record cannot be represented before
-- this migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM marketplace.report_export_accesses)
     OR EXISTS (SELECT 1 FROM marketplace.report_exports
                 WHERE scope_kind <> 'GLOBAL' OR content IS NOT NULL) THEN
    RAISE EXCEPTION 'report export history exists; 0122 cannot be rolled back'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

DELETE FROM marketplace.role_capabilities
 WHERE capability_key = 'admin.reporting.export'
   AND role_key IN ('FINANCE_APPROVER', 'TRUST_APPROVER');

DROP TABLE marketplace.report_export_accesses;

ALTER TABLE marketplace.report_exports
  DROP CONSTRAINT report_export_scope_allowed,
  DROP CONSTRAINT report_export_period,
  DROP CONSTRAINT report_export_content_shape,
  DROP CONSTRAINT report_export_downloaded_purged,
  DROP CONSTRAINT report_export_classification_floor,
  DROP COLUMN scope_kind,
  DROP COLUMN scope_reference,
  DROP COLUMN period_from,
  DROP COLUMN period_to,
  DROP COLUMN content,
  DROP COLUMN content_sha256,
  DROP COLUMN purged_at;
