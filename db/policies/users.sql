-- Row-level security for users: a user is visible to the current organization only
-- through a membership of that organization (memberships is itself filtered by
-- organization), or to themselves.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_by_organization ON users;
CREATE POLICY users_by_organization ON users
  USING (
    id = fahim_current_user()
    OR EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.org_id = fahim_current_org())
  )
  WITH CHECK (id = fahim_current_user());
