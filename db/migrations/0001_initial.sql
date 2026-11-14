-- 0001: organizations, accounts, sessions and the misconception map.
-- Every table holding organization data carries org_id. Row-level security
-- policies live in db/policies, one file per table, applied after migrations.
-- Standard PostgreSQL only (gen_random_uuid is built in since PostgreSQL 13).

-- The role the application connects as. It owns nothing and cannot bypass
-- row-level security; a deployment gives it LOGIN and a password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fahim_app') THEN
    CREATE ROLE fahim_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- The verified identity of the current transaction, set by the server with
-- set_config(..., true), the parameterised form of SET LOCAL. Unset means no access.
CREATE FUNCTION fahim_current_org() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;

CREATE FUNCTION fahim_current_user() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN ('school', 'center', 'family')),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A login identity. It can belong to several organizations through memberships,
-- so it carries no org_id; its policy shows it only through a membership of the current organization.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login         text UNIQUE,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('student', 'parent', 'teacher', 'org_admin', 'platform_admin')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, role)
);
CREATE INDEX memberships_user ON memberships (user_id);

CREATE TABLE student_profiles (
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  level       text NOT NULL DEFAULT '1bac',
  track       text NOT NULL DEFAULT 'sm',
  language    text NOT NULL DEFAULT 'fr',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

-- One tutoring session. `state` is the engine's SessionState; `revision` lets the
-- store refuse a save made from an outdated state.
CREATE TABLE sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  student_id     uuid NOT NULL,
  lesson_id      text NOT NULL,
  step           text NOT NULL,
  state          jsonb NOT NULL,
  revision       integer NOT NULL DEFAULT 0,
  input_tokens   bigint NOT NULL DEFAULT 0,
  output_tokens  bigint NOT NULL DEFAULT 0,
  cost_usd       numeric(12, 6) NOT NULL DEFAULT 0,
  started_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, student_id) REFERENCES student_profiles (org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX sessions_by_student ON sessions (org_id, student_id, started_at DESC);

CREATE TABLE messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      uuid NOT NULL,
  session_id  uuid NOT NULL,
  author      text NOT NULL CHECK (author IN ('student', 'tutor')),
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, session_id) REFERENCES sessions (org_id, id) ON DELETE CASCADE
);
CREATE INDEX messages_by_session ON messages (org_id, session_id, id);

CREATE TABLE misconceptions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid NOT NULL,
  student_id      uuid NOT NULL,
  code            text NOT NULL,
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'fixed')),
  seen_count      integer NOT NULL DEFAULT 1 CHECK (seen_count > 0),
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  next_review_at  timestamptz,
  UNIQUE (org_id, student_id, code),
  FOREIGN KEY (org_id, student_id) REFERENCES student_profiles (org_id, user_id) ON DELETE CASCADE
);

-- Trace of every adult access to a student's data. Append-only for the application.
CREATE TABLE access_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  actor_id    uuid NOT NULL REFERENCES users (id),
  student_id  uuid,
  action      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_log_by_org ON access_log (org_id, created_at DESC);

-- Least privilege for the application role. Accounts are created by the
-- operator scripts (as the owner), not by the application.
GRANT USAGE ON SCHEMA public TO fahim_app;
GRANT EXECUTE ON FUNCTION fahim_current_org(), fahim_current_user() TO fahim_app;
GRANT SELECT ON organizations, users, memberships, student_profiles TO fahim_app;
GRANT SELECT, INSERT, UPDATE ON sessions TO fahim_app;
GRANT SELECT, INSERT, DELETE ON messages TO fahim_app;
GRANT SELECT, INSERT, UPDATE ON misconceptions TO fahim_app;
GRANT SELECT, INSERT ON access_log TO fahim_app;
