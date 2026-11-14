import { getSessionHandlers } from '../../server/runtime';

export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return getSessionHandlers().progress(request);
}
