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
import { createSessionHandlers, type SessionHandlers } from './handlers';
import { PILOT_LESSON_ID, PILOT_ORG_ID } from './pilot';

/**
 * Application entry point: the only place in /app that wires real adapters and
 * reads secrets. Imported by route handlers only, so it never reaches the browser.
 */


function cookieSecret(production: boolean): string {
  const fromEnv = process.env.FAHIM_COOKIE_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (production) throw new Error('FAHIM_COOKIE_SECRET must be set (at least 32 characters) in production');
  // Development only: a per-process secret. Cookies stop being valid on restart, like the in-memory sessions.
  return randomBytes(32).toString('hex');
}

function modelProvider(production: boolean): ModelProvider {
  // FAHIM_MODEL_PROVIDER=offline plays a session without the API, to test the interface for free.
  if (process.env.FAHIM_MODEL_PROVIDER === 'offline') {
    if (production) throw new Error('The offline model provider is for development only');
    return new OfflineProvider();
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is missing on the server');
  return new ClaudeAdapter({ apiKey, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined });
}

function build(): SessionHandlers {
  const config = loadConfig();
  const production = config.env === 'production';

  return createSessionHandlers({
    service: {
      engine: {
        model: modelProvider(production),
        modelName: config.model,
        maxTokens: config.maxTokens,
        systemPrompt: readFileSync(path.join(process.cwd(), 'prompts', 'tutor.system.md'), 'utf8'),
        registries: loadRegistries(),
        misconceptions: new InMemoryMisconceptionStore(),
        rng: Math.random,
        env: config.env,
      },
      store: new InMemorySessionStore(),
      newSessionId: randomUUID,
    },
    cookieSecret: cookieSecret(production),
    secureCookies: production,
    lessonId: PILOT_LESSON_ID,
    newStudent: () => ({ role: 'student', orgId: PILOT_ORG_ID, studentId: randomUUID() }),
  });
}

// Kept on globalThis so development hot reloads do not drop the in-memory sessions.
const holder = globalThis as typeof globalThis & { __fahimHandlers?: SessionHandlers };

export function getSessionHandlers(): SessionHandlers {
  holder.__fahimHandlers ??= build();
  return holder.__fahimHandlers;
}
