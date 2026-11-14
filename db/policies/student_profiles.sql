-- Row-level security for student_profiles: a transaction sees and writes only the rows of its verified organization.
ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS student_profiles_by_organization ON student_profiles;
CREATE POLICY student_profiles_by_organization ON student_profiles
  USING (org_id = fahim_current_org())
  WITH CHECK (org_id = fahim_current_org());
