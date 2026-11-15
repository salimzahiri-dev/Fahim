# 0006: The owner account does not play sessions

Date: 2026-11-15 (owner request: a clear message or a marked test session, the simpler of the two)

## Decision

The owner account (role `platform_admin`, created with `npm run invite -- --owner`) reviews sessions; it does not play them. When it presses "Commencer la séance", the server answers `403 not_a_student` before any model call or database write, and the page says in French that this account is for the review page and that a session is played with a student code.

To try the tutor, the owner creates a student for themselves with `npm run invite -- --org "…" --name "Essai propriétaire"`.

## Why this option

A marked test session would need a flag on sessions, a student profile for the owner, and a filter in every pilot statistic, now and later. Each place that forgets the filter would mix test sessions into the pilot numbers. The refusal is one check in the start handler, with nothing to filter afterwards.

## Consequences

- The owner's own trial sessions, made with a separate student account, do appear in `/revue` and in costs. They can be recognized by the student's name. If this becomes a problem, revisit with a real "test" flag.
- The role is read from the database on each start (`resolveActor`), as on the review page.
- Test: `tests/db/review.test.ts`.
