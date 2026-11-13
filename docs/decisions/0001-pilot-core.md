# 0001: Scope and design of the pilot core

Date: 2026-11-13

## Context

The pilot needs the teaching loop working before any platform feature. `ARCHITECTURE.md` asks for a server-driven session and four agent tools.

## Decisions

1. **The bet and the law are button choices validated by the server.** The model never decides whether a bet or a formula is right. This makes "no solution before the bet" a property of the code.
2. **What the model sees depends on the step.** Before the bet, the per-turn context contains neither the simulation result nor the law. The expected answer of an exercise is never in the context.
3. **`launch_simulation` takes only a simulation id.** Parameters come from the lesson file, so the model cannot invent values.
4. **Server fallbacks.** If the model forgets a tool, the server acts itself: it opens the simulation after the bet, generates the exercise after the right formula, and checks a numeric answer the model judged without `check_answer` (that reply is discarded and rewritten from the server's verdict).
5. **One exercise per session.** A second draw would replace the values the student is working on. "New values" will be a student action in the interface, not a model decision.
6. **The reversed role ends after a fixed number of student replies** (set per lesson, 2 for the first lesson). The tutor judges the explanation in words and records a misconception if needed; the server ends the step.
7. **Bet and formula misconceptions are recorded by the server** from the lesson file, without relying on the model.
8. **Everything addressed to the model is in English**: the system prompt, the per-step directives, tool descriptions, tool results and diagnosis hints. Only what the student reads is in French: lesson content, exercise statements and solutions, and the two fallback tutor messages. The prompt tells the tutor to always write to the student in French.

## Consequences

- The engine is testable offline with a scripted provider; 14 tests cover the guarantees above.
- Free-form formulation of the law by the student is not supported yet. It can be added later as a second way to pass the law step.
- Storage is in memory. `MisconceptionStore` and the session state are plain interfaces, ready for a PostgreSQL implementation with row-level security.
