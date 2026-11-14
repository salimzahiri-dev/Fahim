-- 0002: sign-in with invitation codes (decision 0003).
-- A code is long and random; only its SHA-256 hash is stored. Before sign-in the
-- organization is unknown, so the lookup goes through fahim_sign_in, a
-- SECURITY DEFINER function that is the application's only way to read these
-- tables. It also limits failed attempts per client.

CREATE TABLE invitations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash   bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);
-- One usable code per person and organization: issuing a new one revokes the old one.
CREATE UNIQUE INDEX invitations_one_active ON invitations (org_id, user_id) WHERE revoked_at IS NULL;

-- Failed attempts per client (a hash of its address), in a sliding window. Not organization data.
CREATE TABLE sign_in_attempts (
  client        text PRIMARY KEY,
  window_start  timestamptz NOT NULL DEFAULT now(),
  failures      integer NOT NULL DEFAULT 0
);
ALTER TABLE sign_in_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sign_in_attempts FORCE ROW LEVEL SECURITY;
-- No policy and no grant: only fahim_sign_in touches this table.

CREATE FUNCTION fahim_sign_in(p_code_hash bytea, p_client text)
  RETURNS TABLE (status text, org_id uuid, user_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  max_failures CONSTANT integer := 10;
  window_length CONSTANT interval := interval '15 minutes';
  attempt sign_in_attempts%ROWTYPE;
  found_org uuid;
  found_user uuid;
BEGIN
  INSERT INTO sign_in_attempts (client) VALUES (p_client) ON CONFLICT (client) DO NOTHING;
  SELECT * INTO attempt FROM sign_in_attempts a WHERE a.client = p_client FOR UPDATE;
  IF attempt.window_start < now() - window_length THEN
    UPDATE sign_in_attempts a SET window_start = now(), failures = 0 WHERE a.client = p_client;
    attempt.failures := 0;
  END IF;
  IF attempt.failures >= max_failures THEN
    RETURN QUERY SELECT 'locked'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT i.org_id, i.user_id INTO found_org, found_user
    FROM invitations i
   WHERE i.code_hash = p_code_hash AND i.revoked_at IS NULL;
  IF found_user IS NULL THEN
    UPDATE sign_in_attempts a SET failures = a.failures + 1 WHERE a.client = p_client;
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  UPDATE sign_in_attempts a SET failures = 0, window_start = now() WHERE a.client = p_client;
  RETURN QUERY SELECT 'ok'::text, found_org, found_user;
END;
$$;

REVOKE ALL ON FUNCTION fahim_sign_in(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fahim_sign_in(bytea, text) TO fahim_app;
