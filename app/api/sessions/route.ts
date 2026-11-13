import { getSessionHandlers } from '../../server/runtime';

// node:crypto and node:fs are used by the session layer.
export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return getSessionHandlers().start(request);
}
