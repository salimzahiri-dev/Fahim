-- Row-level security for sessions: a transaction sees and writes only the rows of its verified organization.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_by_organization ON sessions;
CREATE POLICY sessions_by_organization ON sessions
  USING (org_id = fahim_current_org())
  WITH CHECK (org_id = fahim_current_org());
