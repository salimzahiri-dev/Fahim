-- Row-level security for invitations: no direct access for the application role
-- (it has no grant); within an organization, rows are filtered like every other table.
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitations_by_organization ON invitations;
CREATE POLICY invitations_by_organization ON invitations
  USING (org_id = fahim_current_org())
  WITH CHECK (org_id = fahim_current_org());
