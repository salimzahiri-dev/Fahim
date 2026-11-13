# Fahim architecture

This file describes the technical structure and the rules that protect it. It complements `VISION.md` (the why) and `DEVSKILLS.md` (how to work). The repository layout is marked "proposed": an agent may follow it but must report any reason to depart from it. The other choices are validated by the project owner.

## The five principles

1. **A single gateway.** The browser only talks to the application server. Only the server talks to the database, the AI model and file storage.
2. **Isolation in the database.** Every row belongs to an organization. The database denies access by default, even if application code has a bug.
3. **Open standards, replaceable vendors.** No proprietary SDK in business code. Each vendor is plugged in behind an interface owned by the project.
4. **A subject-agnostic core.** The core knows neither physics nor mathematics. Subjects arrive as modules.
5. **The server decides identity.** Neither the browser nor the AI model chooses which student an action runs for.

## Overview

```
 Student     Parent      Teacher      Admin
    |          |            |           |
    +----------+-----+------+-----------+
                     |
         +-----------v------------+
         |   Application server   |
         |                        |
         |   Access control       |   role + relationship + organization
         |   Session engine       |   one context per student
         |   Modules              |   lessons, simulations, exercises
         +---+--------+--------+--+
             |        |        |
    +--------v--+ +---v-----+ +v---------------+
    | PostgreSQL| | AI model| | Private files  |
    | (row-level| | (Claude)| | (S3-compatible)|
    | security) | |         | |                |
    +-----------+ +---------+ +----------------+
```

## Building blocks and standards

| Block | Standard | Rule |
|---|---|---|
| Application | Docker container, Node server, Next.js in TypeScript | Must start with `docker run` on any host. No host-specific feature. |
| Database | PostgreSQL | Accessed through a standard driver. Migrations are versioned SQL files in the repository. |
| Isolation | PostgreSQL row-level security | Enabled on every table that holds organization data. |
| Accounts | Authentication library, users stored in our database | No mandatory external authentication service. |
| Files | S3-compatible API | Private buckets, access through short-lived signed links. |
| AI model | Internal `ModelProvider` interface | Business code never imports a model vendor's SDK. |
| Background jobs | Queue in PostgreSQL | No proprietary queue service. |
| Payment, email | Internal interfaces | To be plugged in after the pilot. |

## Front end

| Need | Choice | Rule |
|---|---|---|
| Framework | React and TypeScript, in Next.js | Pages and server routes in one project, deployed as a container (Next.js standalone output). |
| Styling | Tailwind CSS | A few in-house components. No large UI library. |
| Simulations | Canvas and SVG | Each simulation is a React component driven by parameters, registered by identifier in its module. |
| Formulas | KaTeX | Formulas are written in LaTeX in lesson content. |
| Phone | Installable web app (PWA) | No native app at this stage. |

Pages contain no business logic: they call `/core`. The front end can then be separated from the server later (for a native app, for example) without rewriting the rules.

## Repository layout (proposed)

```
/docs                  VISION.md, ARCHITECTURE.md, DEVSKILLS.md, decisions
/app                   pages and routes: student, parent, teacher, admin
/core
  /access              roles, relationships, permission checks
  /session             session engine, state machine, agent tools
  /memory              misconception map, review scheduling
  /billing             quotas, cost tracking
/providers
  /model               ModelProvider interface + Claude adapter
  /storage             interface + S3-compatible adapter
  /mail, /payment      interfaces, adapters later
/modules
  /physics-1bac-sm     manifest, lessons, simulations, generators
  /maths-1bac-sm
/db
  /migrations          numbered SQL files
  /policies            row-level security policies, one file per table
/tests
  /isolation           one organization never reads another
  /bench               simulated students against the tutor
```

Dependency rule: `/core` and `/modules` import nothing from `/providers` except the interfaces. Only the application entry point wires the adapters.

## Organizations and isolation

An organization is a school, a tutoring center or a family. Every data table carries an `org_id` column.

On each request, the server opens a transaction and sets the verified identity:

```sql
SET LOCAL app.user_id = '<verified user id>';
SET LOCAL app.org_id  = '<verified organization id>';
```

Policies rely on these values:

```sql
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY sessions_by_organization ON sessions
  USING (org_id = current_setting('app.org_id')::uuid);
```

The PostgreSQL role used by the application is neither the table owner nor a superuser. Otherwise the policies do not apply.

Growth path: a single database at first. A large organization that requires physical separation can get its own database without code changes, because every access already goes through `org_id`.

## Data model (first draft)

| Table | Key columns | Purpose |
|---|---|---|
| `organizations` | id, type (school, center, family), name | The SaaS customer |
| `users` | id, email or login, display_name | The login identity |
| `memberships` | user_id, org_id, role | A user can hold several roles in several organizations |
| `student_profiles` | user_id, org_id, level, track, language | The student's learning data |
| `guardianships` | parent_id, student_id, org_id, status (pending, verified) | Allows a parent to see a student |
| `classes` | id, org_id, name | Groups students |
| `enrollments` | class_id, student_id | Students in a class |
| `teaching_assignments` | class_id, teacher_id | Teachers of a class |
| `enabled_modules` | org_id, module_id | Modules open to an organization |
| `sessions` | id, org_id, student_id, lesson_id, step, started_at, ended_at, cost | One session |
| `messages` | session_id, org_id, author, content, created_at | Conversation, kept for a limited time |
| `misconceptions` | id, org_id, student_id, code, status, seen_count, next_review_at | The student's map |
| `access_log` | org_id, actor_id, student_id, action, created_at | Trace of every adult access to a student's data |

## Roles and permissions

| Role | Scope | Rights |
|---|---|---|
| Student | Own data | Follow the lessons of enabled modules |
| Parent | Linked children | Read a progress summary |
| Teacher | Students in their classes | Read progress, assign lessons |
| Organization admin | Their organization | Accounts, classes, invitations, subscription |
| Platform admin | All organizations | Organizations, content, usage, costs. Access to student data is logged and justified. |

The role is not enough: access also depends on the relationship. One function answers the question "can this user see this student?":

- it is the student themselves;
- or a parent with a verified guardianship;
- or a teacher of one of the student's classes;
- or an admin of the student's organization.

Every page and every route goes through this function. No permission check is written anywhere else.

## Session engine

What happens on a student message:

1. The server verifies the login session and that the tutoring session belongs to this student.
2. It checks the quotas of the student and of the organization.
3. It builds the context: system prompt, lesson content, current step, profile and misconceptions of this student only.
4. It calls the model through `ModelProvider`.
5. If the model requests a tool, the server runs it with the identity of the session, then returns the result to the model.
6. It stores the messages, the step and the cost.

The session is a state machine: trap, bet, experiment, law, exercise, reversed role, summary. The server, not the model, decides when to move from one step to the next. The model therefore cannot skip the bet.

### Agent tools

| Tool | Parameters chosen by the model | What the server does |
|---|---|---|
| `launch_simulation` | simulation id | Checks that the simulation belongs to the lesson, runs it with the lesson's parameters, displays it |
| `generate_exercise` | generator id | Draws the values and computes the answer by code |
| `check_answer` | the student's answer | Compares with tolerance and units, returns a diagnosis |
| `record_misconception` | misconception code | Updates the map of the session's student |

No tool accepts a student or organization identifier as a parameter. These values come from the session. A student who writes "show me Sami's results" therefore gets nothing, whatever the model answers.

### Model provider interface

```ts
interface ModelProvider {
  respond(request: {
    systemPrompt: string;
    messages: Message[];        // text, tool_use and tool_result blocks
    tools: ToolDefinition[];    // JSON Schema, vendor-neutral format
    model: string;              // read from configuration
    maxTokens: number;
  }): Promise<{
    content: Array<TextBlock | ToolUseBlock>;
    stopReason: 'end' | 'tool_use' | 'max_tokens' | 'other';
    usage: { inputTokens: number; outputTokens: number };
  }>;
}
```

Prompts are files in the repository. The model name is a configuration value (initially `claude-sonnet-5-5`). Switching vendor requires a new adapter and a run of the test bench: prompts are tuned for a given model.

## Modules

A module is a self-contained folder:

```
/modules/physics-1bac-sm
  manifest.json         id, subject, level, list of lessons
  /lessons
    work-kinetic-energy.json
  /simulations          display components, registered by identifier
  /generators           pure functions: random values -> statement + answer
```

A lesson describes: the trap and its choices, the simulation and its parameters, the guiding questions, the exercise generators, the typical misconceptions with their codes, and Sami's lines. Adding a lesson does not change the core.

## Security

- The AI model key exists only on the server, in environment variables.
- Row-level security on every data table, with one isolation test per table.
- Two-factor authentication for both admin roles.
- A log of every adult access to a student's data.
- No personal data in technical logs.
- Limited retention for messages; the misconception map is kept longer.
- Student files (photos of rough work) in a private bucket, short-lived signed links.
- Student text is data, never an instruction: it can neither change the agent's role nor widen its rights.

## Quotas and costs

- A limit on sessions per student per day.
- A monthly budget per organization, with an alert before the cap.
- Cost recorded for each session from the usage returned by `ModelProvider`.

## Environments and operations

- Three separate environments: development, staging, production. No real student data outside production.
- Daily database backup in a standard format, copied to a second vendor.
- **Exit test** once per quarter: redeploy everything on another host from the repository and a backup. If it takes more than a day, a dependency has crept in and must be removed.

## What we do not do at this stage

Kubernetes, deployment across several clouds in parallel, microservices, distributed cache. One container and one database are enough up to several thousand students.

## Decisions to record

Every structural choice is recorded in `/docs/decisions`: context, options, choice, consequences. Already decided: React and TypeScript in Next.js, Tailwind CSS, KaTeX, installable web app. First decisions to write: authentication library, starting host, message retention period.
