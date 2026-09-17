-- A set-returning helper that finds every row missing its retention classification,
-- across every table that declares the column.
--
-- The verifier hard-coded six tables in a UNION while fifteen carry `retention_class`,
-- so a table classified later was checked only if somebody remembered to extend the
-- list. Deriving the scope from the catalogue removes that step: classify a table and
-- it is swept from that moment.

CREATE OR REPLACE FUNCTION marketplace.unclassified_retention_rows()
RETURNS TABLE (table_name text, missing bigint)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  target record;
  found bigint;
BEGIN
  FOR target IN
    SELECT c.table_name AS name
      FROM information_schema.columns c
     WHERE c.table_schema = 'marketplace'
       AND c.column_name = 'retention_class'
     ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM marketplace.%I WHERE retention_class IS NULL'
      ' OR retention_review_at IS NULL', target.name)
    INTO found;
    IF found > 0 THEN
      table_name := target.name;
      missing := found;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;
