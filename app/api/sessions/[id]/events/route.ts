import { getSessionHandlers } from '../../../../server/runtime';

export const runtime = 'nodejs';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return getSessionHandlers().event(request, id);
}
