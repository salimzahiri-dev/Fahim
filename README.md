# Fahim

A physics and mathematics tutor for Moroccan students in 1re bac sciences maths. It never gives the lesson first: the student bets, tests, then teaches. See `docs/VISION.md`.

This repository holds the pilot: one lesson ("Travail et énergie cinétique"), the tutor, a phone-first web app, sign-in with invitation codes and PostgreSQL storage with row-level security.

## Run it

### Everything in containers (one command)

Requires Docker.

```bash
docker compose up --build
```

Open http://localhost:3100 and sign in with the code printed by the `init` service. For a real server, see `docs/DEPLOY.md`. This local stack runs in development mode with the offline model (no API key, no cost) and local-only database passwords. See `docs/decisions/0005-container-and-environments.md` before any real deployment.

### For development

Requires Node 20.12 or later.

```bash
npm install
npm test               # offline unit tests, no API key, no database
npm run typecheck
npm run build

npm run dev            # web app at http://localhost:3000, in-memory storage
FAHIM_MODEL_PROVIDER=offline npm run dev   # same, without calling the model API

cp .env.example .env   # then fill it in; never commit .env
npm run chat           # one session in the terminal (calls the model API)
npm run bench          # six simulated students against the real model (about $1)
```

### Database

```bash
npm run db:test:up     # throwaway PostgreSQL for tests (127.0.0.1:55432, data in memory)
npm run test:db        # migrations, row-level security isolation, stores, sign-in, quotas
npm run db:test:down

npm run db:migrate     # apply db/migrations and db/policies with DATABASE_ADMIN_URL
npm run invite -- --org "Pilote Fahim" --name "Élève 1"     # create a student, print their code once
npm run invite -- --org "Pilote Fahim" --owner "Propriétaire"  # the owner account for the review page
npm run invite -- --org "Pilote Fahim" --replace <user id>    # new code, the old one stops working
```

The owner signs in with their code like a student, then opens `/revue` (the owner account cannot start a session; see decision 0006): the sessions of the organization with the step reached and the cost, and each transcript. The role is read from the database at each request; every view is written to `access_log` in the same transaction as the read. Anyone else gets a 404.

With `DATABASE_URL` set, the web app stores sessions and the misconception map in PostgreSQL and asks for an invitation code; without it, it keeps everything in memory and, in development only, gives each browser an anonymous student.

## Layout

| Path | Content |
|---|---|
| `CLAUDE.md`, `docs/` | Instructions for agents, vision, architecture, working rules, backlog, decision records |
| `core/session/` | Session engine (server-driven state machine), agent tools, per-step context, session service and store interface |
| `core/access/` | Identity, the single permission check, signed cookie, invitation codes |
| `core/memory/`, `core/billing/` | Misconception map interface; cost estimate and daily session limit |
| `core/review/` | The owner's session review: role resolution, review store interface, readable transcript |
| `providers/model/` | `ModelProvider` interface, Claude adapter (plain HTTPS), scripted and offline providers |
| `providers/postgres/` | Pool, `withIdentity` (sets `app.org_id`/`app.user_id` per transaction), PostgreSQL stores, invitations |
| `modules/physics-1bac-sm/` | The lesson, its simulation (computation and React view) and its exercise generator |
| `app/` | Next.js pages, API routes and server wiring |
| `db/` | Numbered SQL migrations, one row-level security policy file per table, migration runner |
| `prompts/` | The tutor's system prompt (in English; the tutor writes to students in French) |
| `tests/unit/`, `tests/db/`, `tests/bench/` | Offline tests, PostgreSQL tests, simulated students |

## Guarantees enforced by code, with tests

- The model is shown neither the measured result nor the law before the student has bet, and never sees the expected answer of an exercise.
- The server, not the model, moves the session from one step to the next.
- Simulation values, exercise values and answer checks are computed by code.
- No tool and no request body carries a student or organization identifier; identity comes from a signed, http-only cookie.
- Every organization table has row-level security, forced, and the application connects as a role that is neither owner nor superuser.
- Invitation codes are stored hashed, with a limit on failed attempts.
- In production: unvalidated lessons, the offline model and anonymous students are refused.

## Status

- **The lesson has not been validated by a teacher** (`validated: false`, backlog A2).
- Deployment is prepared but not done: `docker-compose.prod.yml` (Caddy for HTTPS, nightly encrypted backups to S3-compatible storage, restore script) and the steps and secrets in `docs/DEPLOY.md`. The host and the backup provider are the owner's choice (backlog D2).
