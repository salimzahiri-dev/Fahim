/** Runtime configuration. Everything vendor- or cost-related is read here, never hard-coded elsewhere. */
export interface FahimConfig {
  model: string;
  maxTokens: number;
  priceInputPerMTok: number;
  priceOutputPerMTok: number;
  /** Sessions a student may start in 24 hours. 0 means no limit. */
  maxSessionsPerDay: number;
  env: 'development' | 'production';
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FahimConfig {
  return {
    model: env.FAHIM_MODEL || 'claude-sonnet-5-5',
    maxTokens: num(env.FAHIM_MAX_TOKENS, 1024),
    priceInputPerMTok: num(env.FAHIM_PRICE_INPUT_PER_MTOK, 2),
    priceOutputPerMTok: num(env.FAHIM_PRICE_OUTPUT_PER_MTOK, 10),
    maxSessionsPerDay: num(env.FAHIM_MAX_SESSIONS_PER_DAY, 3),
    env: env.NODE_ENV === 'production' ? 'production' : 'development',
  };
}
