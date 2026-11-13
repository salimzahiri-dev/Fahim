import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, type FahimConfig } from '../core/config';
import { InMemoryMisconceptionStore } from '../core/memory/misconceptionStore';
import type { EngineDeps } from '../core/session/engine';
import { loadRegistries } from '../modules';
import { ClaudeAdapter } from '../providers/model/claudeAdapter';

/** Wires the real adapters for the command-line scripts. The only place that reads the API key. */
export function buildDeps(): { deps: EngineDeps; config: FahimConfig } {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the environment.
  }
  const config = loadConfig();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is missing. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  const promptPath = fileURLToPath(new URL('../prompts/tutor.system.md', import.meta.url));
  const deps: EngineDeps = {
    model: new ClaudeAdapter({ apiKey, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined }),
    modelName: config.model,
    maxTokens: config.maxTokens,
    systemPrompt: readFileSync(promptPath, 'utf8'),
    registries: loadRegistries(),
    misconceptions: new InMemoryMisconceptionStore(),
    rng: Math.random,
    env: config.env,
  };
  return { deps, config };
}
