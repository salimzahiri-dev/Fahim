import { getSessionHandlers } from '../../server/runtime';

export const runtime = 'nodejs';

export async function POST(): Promise<Response> {
  return getSessionHandlers().signOut();
}
