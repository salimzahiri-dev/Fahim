import type { NextConfig } from 'next';

// Standalone output: the build produces a self-contained Node server for a plain container (ARCHITECTURE.md).
const nextConfig: NextConfig = {
  output: 'standalone',
  // Agent instructions live in CLAUDE.md and docs/; a second, generated file would compete with them.
  agentRules: false,
};

export default nextConfig;
