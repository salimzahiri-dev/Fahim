# 0002: Session API and student identity before sign-in

Date: 2026-11-14

## Context

Backlog B2 asks for an HTTP API around `handleEvent`, with the student identity taken from a signed, http-only cookie set by the server. Sign-in arrives only in C3, which needs an owner decision on the authentication library.

## Decisions

1. **Two routes.** `POST /api/sessions` starts a session of the pilot lesson. `POST /api/sessions/:id/events` sends one event (`bet`, `law_choice`, `message`). `start` is not a client event.
2. **Anonymous identity until C3.** When `POST /api/sessions` gets no valid cookie, the server creates a random student id in the organization `pilot` and sets the cookie. The cookie is `payload.HMAC-SHA256`, `HttpOnly`, `SameSite=Lax`, `Secure` in production, valid 30 days. It is signed with `FAHIM_COOKIE_SECRET` (required in production, a random per-process secret in development). Only `node:crypto` is used: no new dependency.
3. **The body never carries an identity.** Client events are parsed strictly: any extra field (`studentId`, `orgId`…) makes the request invalid (400) instead of being ignored.
4. **One permission function.** `core/access/access.ts` `canAccessStudent` decides. A session that exists but belongs to someone else answers 404, like a missing one, so its existence is not revealed.
5. **`SessionStore` calls are scoped by organization** so the PostgreSQL implementation (C2) can set `app.org_id` from them and rely on row-level security. The in-memory store already hides other organizations' rows.
6. **The browser receives only `sessionId`, `step`, `tutorText` and `ui`.** Never the transcript, the usage or the server state.
7. **One turn at a time per session.** Events for the same session are serialized in the process, so a double tap cannot run two model turns on the same state.
8. **Handlers use the standard Request and Response.** They are tested without Next.js; route files only forward to them. `app/server/runtime.ts` is the only place in `/app` that wires adapters and reads secrets.

## Consequences

- Clearing cookies starts a new anonymous student: acceptable for development, replaced by real sign-in in C3.
- The per-session lock holds within one process. With several server processes, the PostgreSQL store (C2) must lock the session row in its transaction.
- In development, a server restart invalidates cookies and in-memory sessions together.
