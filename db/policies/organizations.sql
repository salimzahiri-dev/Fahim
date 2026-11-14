-- Row-level security for organizations: a transaction sees only its verified organization.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_by_organization ON organizations;
CREATE POLICY organizations_by_organization ON organizations
  USING (id = fahim_current_org())
  WITH CHECK (id = fahim_current_org());
