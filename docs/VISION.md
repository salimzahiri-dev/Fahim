# Fahim vision

This file says why the project exists and what it must remain. Every agent reads it before working. If a task serves no point in this document, it is off topic: see `DEVSKILLS.md`.

"Fahim" (Arabic for "the one who has understood") is a working name.

## In one sentence

Fahim is a physics and mathematics tutor for Moroccan students in the first year of the baccalaureate, mathematical sciences track (1re bac sciences maths). It never gives the lesson first: it makes the student bet, test, then teach.

## Who it is for

- **The student** in 1re bac sciences maths: wants to understand the phenomena and pass tests. Mostly uses a phone.
- **The parent**: wants to know whether their child is progressing, without reading the conversations.
- **The teacher**: wants to see where the class is stuck and assign lessons.
- **The organization admin** (school, tutoring center, family): manages accounts and the subscription.
- **The platform admin**: manages organizations, content, usage and costs.

## The problem

A student can recite a formula without knowing what it describes. A classic chatbot makes this worse: it gives the answer, the student copies it and learns nothing. Fahim must stimulate reasoning, not replace it.

## Teaching principles

These principles are not negotiable. A feature that contradicts one of them is rejected.

1. **The bet comes before the lesson.** The student commits to an answer before any explanation. Being wrong after betting sticks better than reading the right answer.
2. **The experiment settles it.** A simulation shows what really happens, with the values from the bet.
3. **The student builds the law.** Fahim asks short questions and gives graded hints. It does not give the solution up front.
4. **Calculations are done by code.** Numeric exercises and their solutions are never computed by the language model.
5. **Errors are diagnosed.** Fahim looks for where the error comes from (unit, sign, forgotten force) instead of only saying "wrong".
6. **The reversed role.** The student corrects "Sami", a classmate played by the agent, who makes the classic mistakes. Being able to explain proves understanding.
7. **Memory is about misconceptions.** Fahim remembers each student's precise confusions and brings them back a few days later. A grade per chapter is not enough.
8. **Content follows the official Moroccan curriculum.** No out-of-curriculum notion, no invented content. Lessons are validated by a teacher.

## The typical session (10 to 15 minutes)

| Step | What happens |
|---|---|
| 1. The trap | A real situation that misleads intuition. Example: "The Al Boraq train goes from 160 to 320 km/h. Its kinetic energy is multiplied by how much?" |
| 2. The bet | The student picks an answer. |
| 3. The experiment | The simulation opens and the student observes the result. |
| 4. The law | The student states the relation, guided by questions. |
| 5. The live exercise | New values on each attempt, answer checked by code, error diagnosed. |
| 6. The reversed role | The student corrects Sami. The misconception map is updated. |

In mathematics the loop is the same: a tangent sliding along a curve for the derivative, the terms of a sequence stacking up, a barycenter moving with its coefficients.

## What Fahim is not

- Not a tool that does homework for the student.
- Not a lecture in text or video.
- Not a surveillance tool: an adult sees a progress summary, not the detail of conversations (decision to confirm, see below).
- Not a social network or a game: no public ranking between students.

## Scope by stage

**Pilot.** One complete lesson, "Work and kinetic energy" (Travail et énergie cinétique), with the six-step loop. Five students. Goal: check that the loop works and measure the real cost of a session.

**Version 1.** A few physics lessons and a first mathematics lesson (differentiation). Student accounts, misconception map, progress view.

**SaaS platform.** Organizations, parent, teacher and admin roles, modules enabled per organization, billing.

The order matters: the platform is not built before the teaching loop has proven itself with real students.

## What is measured during the pilot

- The share of sessions completed to the end.
- The real cost of a session in model calls.
- Content or calculation errors found by the reviewing teacher.
- Student feedback: did they understand something they did not understand before?

No numeric target is set before the first measurements.

## Constraints

- **Students are minors.** Minimal data collection, consent from a parent, conversations kept for a limited time. Obligations under Moroccan personal data law must be checked before opening to a class.
- **Vendor independence.** The code depends on open standards. Every vendor is replaceable. Details in `ARCHITECTURE.md`.
- **Controlled cost.** Starting estimate: about $0.20 per session with Claude Sonnet 5.5, to be confirmed by the pilot. The budget available for the pilot is an API credit of $200 per month.
- **Phone first.** Every screen must work on a phone 390 px wide.
- **Language.** The interface, the lesson content and the exam vocabulary are in French. The agent may explain in Arabic or Darija if the student asks. Project documents and code are in English.

## Open decisions

Until the project owner settles them, agents apply the stated assumption and build nothing that makes it hard to change.

| Question | Working assumption |
|---|---|
| First customer: families or schools? | Families first, schools next. The data model handles both. |
| What does a parent see? | A summary: time spent, lessons, misconceptions. Not the text of conversations. |
| Final product name | "Fahim", working name. |
| Payment method | Not chosen. Out of scope until the pilot ends. |

## Glossary

- **Session**: one working session of a student on a lesson, in six steps.
- **Bet**: the answer the student commits to before the explanation.
- **Misconception**: a precise, named confusion, for example "kinetic energy is proportional to speed".
- **Misconception map**: the list of a student's misconceptions, with their state (new, in progress, fixed) and review date.
- **Sami**: the fictional classmate played by the agent during the reversed role.
- **Module**: a package of lessons, simulations and exercise generators for one subject and level.
- **Organization**: the customer in the SaaS sense, that is a school, a tutoring center or a family.
