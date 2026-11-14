-- Row-level security for access_log: a transaction sees and writes only the rows of its verified organization.
ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS access_log_by_organization ON access_log;
CREATE POLICY access_log_by_organization ON access_log
  USING (org_id = fahim_current_org())
  WITH CHECK (org_id = fahim_current_org());
