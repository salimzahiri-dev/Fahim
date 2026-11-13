# Working rules for agents

This file is for every agent that writes code, content or tests for Fahim. Its purpose: each task stays on topic, respects the architecture and ends with a result that can be verified.

Read `VISION.md` first, then `ARCHITECTURE.md`. If a request contradicts these files, stop and report it: do not settle it alone.

## Before starting a task

1. Restate the task in one sentence and cite the point of `VISION.md` or the plan step it serves.
2. If you cannot find a point to cite, the task is off topic. Say so and ask for confirmation before writing anything.
3. List the files you intend to change. If the list goes beyond the requested scope, reduce it or ask.

## Staying on topic

- Do what is asked, nothing more. An improvement you notice along the way goes in the report; it is not implemented.
- Do not rewrite a working file for style.
- Do not add a dependency without explaining why the standard library or existing code is not enough.
- The project moves in this order: teaching loop, then accounts and memory, then SaaS platform. Do not build the next stage before the previous one is validated.

Examples of off-topic work unless requested: rankings between students, badges, messaging between users, native mobile app, Kubernetes, microservices, distributed cache, payment integration, full translation of the interface.

## Non-negotiable rules

### Teaching

- The tutor agent never gives the solution before the student's bet. Moving from one step to the next is decided by the server.
- No number in a statement or a solution is computed by the language model. Values and answers come from the generators.
- No invented lesson content. A lesson is written from a source validated by a teacher. If a source is missing, ask for it.
- A misconception has a stable code and a clear label. Do not create a new one if an existing one fits.

### Security and data

- Every new data table carries `org_id`, and ships with its row-level security policies and its isolation test in the same contribution.
- The identity of the student and of the organization always comes from the session verified by the server. Never from a parameter sent by the browser, never from a parameter chosen by the model.
- Every permission check goes through the single function in `/core/access`.
- The AI model key and other secrets are never written in code, tests, logs or a commit message.
- No personal student data in technical logs or test fixtures. Test data is fictional.
- Every screen where an adult views a student writes a line to the access log.

### Vendor independence

- No import of a vendor SDK in `/core`, `/modules` or `/app`. These SDKs are allowed only in `/providers`, behind an interface.
- Standard PostgreSQL only: no extension or function specific to a host.
- No feature specific to an application host. The container must start anywhere.
- The AI model name is read from configuration, never hard-coded.

## Code conventions

- TypeScript in strict mode. No `any` without a comment that justifies it.
- Code identifiers, comments, commit messages and project documents are in English. So is everything addressed to the model: prompts, directives, tool descriptions and tool results. Only what the student reads is in French: interface text and lesson content.
- Exercise generators and checking functions are pure functions: same inputs, same outputs, no network or database access.
- A SQL migration never modifies a migration already applied. Add a new one.
- The tutor agent's prompts are versioned files, not strings scattered through the code.
- Front end: React and TypeScript in Next.js, styling with Tailwind CSS, formulas with KaTeX. Do not introduce another framework or a UI library.
- Pages and components hold no business logic: they call `/core`.
- A simulation is a React component driven only by its parameters, with no network call.
- Every screen works at 390 px wide and with the keyboard. Touch targets are at least 44 px.
- A comment explains why, not what.

## Expected tests

| What you touch | Test to provide |
|---|---|
| An exercise generator or a check | Unit tests: boundary values, units, tolerance, typical errors recognized |
| A table or a security policy | Isolation test: a user of one organization neither reads nor writes in another |
| A permission rule | One test per role, including denials |
| The tutor's prompt or tools | A run of the simulated-student bench, results attached to the report |
| A screen | Check at 390 px and at 1280 px |

The bench contains at least these profiles: the student who demands the answer, the one who gets the unit wrong, the one who answers at random, the one who goes off topic, the one who tries to make the agent change role, the one who asks for another student's data.

## When to stop and ask

Stop and ask instead of deciding alone if:

- the task touches an open decision in `VISION.md`;
- you need to choose or change a vendor, an authentication library or the application framework;
- you need to delete data, modify an applied migration or change an existing security policy;
- the request contradicts a teaching principle or a rule in this file;
- you lack a source to write lesson content;
- you cannot verify your work (no database access, tests cannot be run).

A short question costs less than work that has to be redone.

## Definition of done

A task is done when all of these are true:

- the code does what was asked, and only that;
- the expected tests exist and pass;
- no non-negotiable rule is broken;
- no secret or real data has been added to the repository;
- the relevant documentation is up to date (`ARCHITECTURE.md` if the structure changes, a decision note if a structural choice was made);
- the report is written.

## End-of-task report

End every task with this report, short and factual:

```
Task: <one sentence>
Serves: <point of VISION.md or plan step>
Done: <what changed, main files>
Verified: <tests run and result; what could not be verified>
Not done: <what was asked and remains, with the reason>
To flag: <risks, questions, improvements noticed but not implemented>
```

If a test fails or a step was skipped, say so plainly. A report that hides a problem wastes more time than the problem itself.

## Working with several agents

- One agent, one task, one set of files. Two agents do not modify the same folder at the same time.
- The agent that writes the code is not the one that reviews it. Review checks the non-negotiable rules first, then the rest.
- The files in `/docs` are the shared reference. An agent modifies them only if the task requires it, and says so in its report.
