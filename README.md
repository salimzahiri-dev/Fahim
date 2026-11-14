# Fahim

A physics and mathematics tutor for Moroccan students in 1re bac sciences maths. It never gives the lesson first: the student bets, tests, then teaches. See `docs/VISION.md`.

This repository currently holds the **pilot core**: the tutor's brain, with no web interface and no database yet.

## What is here

| Path | Content |
|---|---|
| `CLAUDE.md` | Entry point for coding agents |
| `docs/` | Vision, architecture, working rules for agents, backlog, decision records |
| `core/session/` | Session engine (server-driven state machine), agent tools, per-step context |
| `core/memory/` | Misconception map (in-memory for now, same interface as the future PostgreSQL one) |
| `core/billing/` | Session cost estimate |
| `providers/model/` | Vendor-neutral `ModelProvider` interface, Claude adapter (plain HTTPS, no SDK), scripted provider for tests |
| `modules/physics-1bac-sm/` | Lesson "Travail et énergie cinétique", its simulation and its exercise generator |
| `prompts/` | The tutor's system prompt (in English; the tutor writes to students in French) |
| `scripts/chat.ts` | A full session in the terminal |
| `tests/unit/` | Offline tests: generator, simulation, adapter, engine guarantees |
| `tests/bench/` | Simulated students played against the real tutor model |

## Run it

Requires Node 20.12 or later.

```bash
npm install
npm test            # offline, no API key needed
npm run typecheck

cp .env.example .env   # then put your API key in .env
npm run chat           # one session in the terminal
npm run bench          # six simulated students; transcripts in bench-output/
npm run bench -- role-change   # a single profile
```

In the terminal chat, type a choice id (`x2`, `b`) to press a button, anything else to write a message, `quit` to stop.

## Guarantees enforced by code, with a test for each

- The model is shown neither the measured result nor the law before the student has bet.
- The model never sees the expected answer of an exercise; only the checking tool knows it.
- The server, not the model, moves the session from one step to the next.
- Simulation values, exercise values and answer checks are computed by code.
- No tool accepts a student or organization identifier; extra parameters are refused.
- A tool is only usable at the steps where it makes sense.
- A lesson not validated by a teacher is refused when `NODE_ENV=production`.

## Status and limits

- **The lesson content has not been validated by a teacher.** `validated` is `false` in the lesson file; set it to `true` only after review.
- The bench and the terminal chat need an API key and have not been run against a real model yet. The first bench run is the next step: read the transcripts, then tune `prompts/tutor.system.md`.
- No web interface, accounts, database or container yet. They come next, in the order given in `docs/VISION.md`.

## Next steps

1. Run the bench, read the six transcripts, fix the prompt.
2. Have a 1re bac SM physics teacher review the lesson file.
3. Add the web interface (Next.js) on top of `handleEvent`, then PostgreSQL storage behind the existing interfaces.

## Database tests

The isolation tests run against a throwaway PostgreSQL in Docker (data in memory, port 55432 on 127.0.0.1):

```bash
npm run db:test:up     # start the test database
npm run test:db        # migrations + row-level security isolation tests
npm run db:test:down   # stop it
```

Migrations are numbered SQL files in `db/migrations`; row-level security policies are in `db/policies`, one file per table. `npm run db:migrate` applies both with `DATABASE_ADMIN_URL`.
