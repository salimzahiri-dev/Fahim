import { getSessionHandlers } from '../../server/runtime';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  return getSessionHandlers().signIn(request);
}
