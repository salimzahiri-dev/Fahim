import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../core/config';
import { InMemoryMisconceptionStore } from '../../core/memory/misconceptionStore';
import { InMemorySessionStore } from '../../core/session/sessionStore';
import { loadRegistries } from '../../modules';
import { ClaudeAdapter } from '../../providers/model/claudeAdapter';
import type { ModelProvider } from '../../providers/model/ModelProvider';
import { OfflineProvider } from '../../providers/model/offlineProvider';
import { createPool } from '../../providers/postgres/db';
import { PostgresInvitationDirectory } from '../../providers/postgres/invitations';
import { PostgresAccountDirectory, PostgresReviewStore } from '../../providers/postgres/review';
import { createReviewHandlers, type ReviewHandlers } from './review';
import { PostgresMisconceptionStore, PostgresSessionStore } from '../../providers/postgres/stores';
import { createSessionHandlers, type SessionHandlers } from './handlers';
import { PILOT_LESSON_ID, PILOT_ORG_ID } from './pilot';

/**
 * Application entry point: the only place in /app that wires real adapters and
 * reads secrets. Imported by route handlers only, so it never reaches the browser.
 */

type Env = NodeJS.ProcessEnv;

function cookieSecret(env: Env, production: boolean): string {
  const fromEnv = env.FAHIM_COOKIE_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (production) throw new Error('FAHIM_COOKIE_SECRET must be set (at least 32 characters) in production');
  // Development only: a per-process secret. Cookies stop being valid on restart, like the in-memory sessions.
  return randomBytes(32).toString('hex');
}

function modelProvider(env: Env, production: boolean): ModelProvider {
  // FAHIM_MODEL_PROVIDER=offline plays a session without the API, to test the interface for free.
  if (env.FAHIM_MODEL_PROVIDER === 'offline') {
    if (production) throw new Error('The offline model provider is for development only and is refused in production');
    return new OfflineProvider();
  }
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is missing on the server');
  return new ClaudeAdapter({ apiKey, baseUrl: env.ANTHROPIC_BASE_URL || undefined });
}

export interface Server {
  sessions: SessionHandlers;
  /** The owner's review pages; null without a database, where there is no owner account. */
  review: ReviewHandlers | null;
}

/** Builds the server from an environment. Throws on a configuration that must not start. */
export function buildServer(env: Env = process.env): Server {
  const config = loadConfig(env);
  const production = config.env === 'production';
  // With DATABASE_URL, sessions and the misconception map live in PostgreSQL; otherwise in memory.
  const db = env.DATABASE_URL ? createPool(env.DATABASE_URL) : null;
  // Decision 0002: anonymous students exist in development only, and only without a database
  // (a student in the database comes from an invitation, decision 0003).
  const anonymous = !production && !db;
  // One secret for every reader of the cookie.
  const secret = cookieSecret(env, production);

  const sessions = createSessionHandlers({
    service: {
      engine: {
        model: modelProvider(env, production),
        modelName: config.model,
        maxTokens: config.maxTokens,
        systemPrompt: readFileSync(path.join(process.cwd(), 'prompts', 'tutor.system.md'), 'utf8'),
        registries: loadRegistries(),
        misconceptions: db ? new PostgresMisconceptionStore(db) : new InMemoryMisconceptionStore(),
        rng: Math.random,
        env: config.env,
      },
      store: db ? new PostgresSessionStore(db, config) : new InMemorySessionStore(),
      newSessionId: randomUUID,
      maxSessionsPerDay: config.maxSessionsPerDay,
    },
    cookieSecret: secret,
    secureCookies: production,
    lessonId: PILOT_LESSON_ID,
    ...(db ? { invitations: new PostgresInvitationDirectory(db) } : {}),
    ...(!anonymous ? {} : { newStudent: () => ({ role: 'student' as const, orgId: PILOT_ORG_ID, studentId: randomUUID() }) }),
  });

  const review = db
    ? createReviewHandlers({ cookieSecret: secret, accounts: new PostgresAccountDirectory(db), review: new PostgresReviewStore(db) })
    : null;
  return { sessions, review };
}

/** The session API alone (kept for the tests that build it from an environment). */
export function buildSessionHandlers(env: Env = process.env): SessionHandlers {
  return buildServer(env).sessions;
}

// Kept on globalThis so development hot reloads do not drop the in-memory sessions.
const holder = globalThis as typeof globalThis & { __fahimServer?: Server };

function server(): Server {
  holder.__fahimServer ??= buildServer();
  return holder.__fahimServer;
}

export function getSessionHandlers(): SessionHandlers {
  return server().sessions;
}

export function getReviewHandlers(): ReviewHandlers | null {
  return server().review;
}
