-- Row-level security for memberships: a transaction sees and writes only the rows of its verified organization.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_by_organization ON memberships;
CREATE POLICY memberships_by_organization ON memberships
  USING (org_id = fahim_current_org())
  WITH CHECK (org_id = fahim_current_org());
