-- Row-level security for messages: a transaction sees and writes only the rows of its verified organization.
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS messages_by_organization ON messages;
CREATE POLICY messages_by_organization ON messages
  USING (org_id = fahim_current_org())
  WITH CHECK (org_id = fahim_current_org());
