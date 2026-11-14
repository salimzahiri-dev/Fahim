# 0004: A correct value in another unit than the one asked

Date: 2026-11-14 (owner decision, to be confirmed by the reviewing teacher in A2)

## Decision

When a student gives the right value in another unit than the one asked (in the first lesson: joules instead of kJ):

- the answer counts as right and as one attempt;
- the tutor asks the student **once** to give it in the requested unit, and neither converts it nor writes the converted value;
- the student's next value is not a new attempt; the exercise is then solved whatever the reply, and the worked solution computed by code shows the conversion if it is still missing.

## How it is built

The generator marks such a diagnosis with `convertTo` (for example `'kJ'`). The core (`checkAnswer` in `core/session/tools.ts`) applies the rule without knowing the subject. Tests: `tests/unit/unitConversion.test.ts`.

## Not verified

The real model has not run on this rule: the owner stopped API spending, so no bench run was made after this change (`CLAUDE.md` asks for one after a change to the tools).
