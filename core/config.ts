/** Runtime configuration. Everything vendor- or cost-related is read here, never hard-coded elsewhere. */
export interface FahimConfig {
  model: string;
  maxTokens: number;
  priceInputPerMTok: number;
  priceOutputPerMTok: number;
  /** Sessions a student may start per calendar day (Africa/Casablanca). 0 means no limit. */
  maxSessionsPerDay: number;
  env: 'development' | 'production';
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) ? n : fallback;
}

/**
 * The deployment environment, which decides the production guarantees (validated
 * lessons only, no offline model, no anonymous students, secure cookies).
 * FAHIM_ENV states it explicitly; unset, it follows NODE_ENV, so a production
 * build is production unless told otherwise (decision 0005). Any other value is refused.
 */
function deploymentEnv(env: NodeJS.ProcessEnv): FahimConfig['env'] {
  const explicit = env.FAHIM_ENV;
  if (explicit === 'production' || explicit === 'development') return explicit;
  if (explicit) throw new Error(`FAHIM_ENV must be "production" or "development", not "${explicit}"`);
  return env.NODE_ENV === 'production' ? 'production' : 'development';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FahimConfig {
  return {
    model: env.FAHIM_MODEL || 'claude-sonnet-5-5',
    maxTokens: num(env.FAHIM_MAX_TOKENS, 1024),
    priceInputPerMTok: num(env.FAHIM_PRICE_INPUT_PER_MTOK, 2),
    priceOutputPerMTok: num(env.FAHIM_PRICE_OUTPUT_PER_MTOK, 10),
    maxSessionsPerDay: num(env.FAHIM_MAX_SESSIONS_PER_DAY, 3),
    env: deploymentEnv(env),
  };
}
