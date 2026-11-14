-- Row-level security for misconceptions: a transaction sees and writes only the rows of its verified organization.
ALTER TABLE misconceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE misconceptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS misconceptions_by_organization ON misconceptions;
CREATE POLICY misconceptions_by_organization ON misconceptions
  USING (org_id = fahim_current_org())
  WITH CHECK (org_id = fahim_current_org());
