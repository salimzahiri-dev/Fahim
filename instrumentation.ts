/** Runs once when the Next.js server starts (before any request). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { loadConfig, startupWarnings } = await import('./core/config');
  for (const line of startupWarnings(loadConfig())) console.warn(line);
}
