# Fahim: instructions for coding agents

Fahim is a physics and mathematics tutor for Moroccan students in 1re bac sciences maths. It never gives the lesson first: the student bets, tests, then teaches.

## Read first, every session

1. `docs/VISION.md`: why the project exists and the teaching principles that are not negotiable.
2. `docs/ARCHITECTURE.md`: structure, isolation, vendor independence.
3. `docs/DEVSKILLS.md`: how to work here. Its rules apply to everything you do.
4. `docs/BACKLOG.md`: what to build next, in order.

## How to work

- Take the first unchecked task in `docs/BACKLOG.md`, unless the owner names another. One task per session.
- Before coding, restate the task in one sentence and list the files you expect to touch.
- Tasks marked **(ask first)** need a decision from the owner: stop and ask before writing code.
- Run `npm test` and `npm run typecheck` before every commit. Do not commit if either fails.
- When a task is done: tick it in `docs/BACKLOG.md`, commit, push, and write the end-of-task report defined in `docs/DEVSKILLS.md`.
- Commit messages are in English, imperative, one line, for example `Add session API route`.

## Commands

```
npm install
npm test            # offline unit tests, no API key needed
npm run typecheck
npm run chat        # one tutoring session in the terminal (needs .env)
npm run bench       # six simulated students against the real model (needs .env, costs about $1)
npm run bench -- role-change   # a single profile
```

The owner works on Windows PowerShell: chain commands with `;` or run them one at a time, not with `&&`.

## Things that must stay true

- The server decides the step of a session; the model never does.
- Before the bet, the model is shown neither the result nor the law. It never sees the expected answer of an exercise.
- Numbers shown to students and answer checks are computed by code.
- No tool takes a student or organization identifier.
- No vendor SDK outside `/providers`. The model name comes from configuration.
- Everything addressed to the model is in English. Only what the student reads is in French.
- `.env` holds the API key. Never print it, log it, commit it or paste it anywhere.

Each of these has a test in `tests/unit/`. If a change makes one of them fail, the change is wrong, not the test.

## After any change to the tutor's prompt, directives or tools

Run `npm run bench`, read the transcripts in `bench-output/`, and attach the bench summary to your report. The automatic flags are a safety net; judging whether the tutor teaches well takes reading the conversations.
