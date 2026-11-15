# 0005: Container image, local compose and the deployment environment

Date: 2026-11-14

## Context

Backlog D1 asks that a fresh clone starts with one command and that a session can be played. The image runs the Next.js production build, so `NODE_ENV` is always `production` inside it; until now that alone switched on the production guarantees (validated lessons only, no offline model, no anonymous student, secure cookies). With the lesson still unvalidated (A2) and no API spending allowed, no session could be played in a container.

## Decisions

1. **`FAHIM_ENV` states the deployment environment** (`production` or `development`). When it is not set, it follows `NODE_ENV`, so the image is production by default. Any other value refuses to start. Tested in `tests/unit/config.test.ts`.
2. **The image** (`Dockerfile`) is multi-stage: `app` holds only the standalone server, its static files and the prompt, runs as a non-root user and listens on port 3000. `tools` holds the full source for migrations and operator scripts. `.env` is excluded from the build context.
3. **The compose file** (`docker-compose.yml`) is for a local machine: PostgreSQL 17, an `init` service that applies migrations, gives the application role its login and, outside production only, prints a fresh invitation code for a local student, then the application on `127.0.0.1:3100`. Defaults: `FAHIM_ENV=development`, offline model, local-only database passwords. It passes no API key.

## Consequences

- One command: `docker compose up --build`; the access code is in the `init` output.
- A real deployment (D2) must set `FAHIM_ENV=production` (or leave it unset), real database passwords, `FAHIM_COOKIE_SECRET` and `ANTHROPIC_API_KEY`, and must not use the local defaults. In production the `init` service creates no local student.
- The cookie is not `Secure` in development, which the local `http://localhost` needs.

## Amendment (2026-11-15)

Accepted by the owner. The server logs a clear warning at startup whenever the environment is `development` (`instrumentation.ts`, `startupWarnings` in `core/config.ts`).
