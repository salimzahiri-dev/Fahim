# Backlog

Ordered list of work for the pilot. Take the first unchecked task. Each task has a "done when" that can be checked. Tasks marked **(ask first)** need a decision from the owner before any code.

The order follows `VISION.md`: teaching loop first, then accounts and memory, then the platform.

## Stage A: tutor quality

- [x] A0. Pilot core: session engine, tools, lesson, exercise generator, Claude adapter, unit tests.
- [x] A1. Run `npm run bench` on the current code and fix the prompt or directives until no profile has a blocking flag. Known weak points from manual sessions: the tutor names the unit pitfall before any diagnosis, and adds a hint in its own voice during the reversed role.
  Done when: six profiles reach `summary` with no blocking flag on two consecutive runs, and the transcripts read well. Bench summary attached to the report.
- [ ] A2. **(owner task)** Have a 1re bac SM physics teacher review `modules/physics-1bac-sm/lessons/work-kinetic-energy.json`.
  Done when: corrections are applied and `validated` is `true`, with the reviewer and date noted in a decision record.

## Stage B: web interface for one session

- [x] B1. Add the Next.js application (TypeScript, Tailwind CSS, standalone output) under `/app`, without moving `/core`, `/modules` or `/providers`.
  Done when: `npm run dev` serves a page, `npm run build` succeeds, existing tests and typecheck still pass.
- [x] B2. Session API: one route to start a session and one to send an event, both calling `handleEvent`. Session state kept behind a `SessionStore` interface with an in-memory implementation. The student identity comes from a signed, http-only cookie set by the server, never from the request body.
  Done when: route tests cover the full loop with the scripted provider, an event for another student's session is refused, and the API key never reaches the browser.
- [ ] B3. Session screen, phone first: conversation, bet and formula buttons, message input, experiment area. It renders the `UiAction` list returned by the engine. Sami's lines (paragraphs starting with `Sami : `) are displayed as a different speaker.
  Done when: a full session can be played at 390 px wide and with the keyboard only.
- [ ] B4. Train simulation component (Canvas or SVG) driven only by the `params` and `result` of `show_simulation`: two speeds, two energy bars, the ratio.
  Done when: the component shows the values computed by the server and makes no network call.
- [ ] B5. Exercise panel and end-of-session summary panel. Formulas rendered with KaTeX.
  Done when: the summary shows the bet, the attempts and the misconceptions recorded during the session.

## Stage C: accounts and persistence

- [ ] C1. PostgreSQL migrations for `organizations`, `users`, `memberships`, `student_profiles`, `sessions`, `messages`, `misconceptions`, `access_log`, each data table with `org_id`, row-level security and an isolation test. A local database runs in Docker for tests.
  Done when: isolation tests prove a user of one organization can neither read nor write another's rows, using a non-owner database role.
- [ ] C2. PostgreSQL implementations of `SessionStore` and `MisconceptionStore`, setting `app.user_id` and `app.org_id` with `SET LOCAL` in each transaction.
  Done when: the full-loop route tests pass against PostgreSQL and a session survives a server restart.
- [ ] C3. **(ask first)** Sign-in for the pilot: five students, invitation codes, one organization. Choose the authentication library and record the decision.
  Done when: a student signs in with a code, finds their progress the next day, and cannot open another student's session.
- [ ] C4. Quotas and cost: a limit on sessions per student per day, and the cost of each session stored from the reported usage.
  Done when: the limit is enforced by a test and the stored cost matches the usage of the session.

## Stage D: ship the pilot

- [ ] D1. Dockerfile for the application and a compose file with PostgreSQL.
  Done when: a fresh clone starts with one command and a session can be played.
- [ ] D2. **(ask first)** Choose the host, deploy, set up a daily database backup copied to a second place.
  Done when: the pilot address works from a phone on mobile data and a restore from backup has been tried once.
- [ ] D3. Owner-only page: list of sessions with step reached, cost and transcript, for the daily review during the pilot.
  Done when: the page is reachable only by the owner account and every view is written to `access_log`.
- [ ] D4. **(owner task)** Pilot week: five students, three sessions each. Record completion rate, real cost per session, errors found, student feedback.

## Not now

Parents, teachers and organization admins; billing; a second lesson; the mathematics module; free-form statement of the law; "new values" button for the exercise. They come after the pilot results.
