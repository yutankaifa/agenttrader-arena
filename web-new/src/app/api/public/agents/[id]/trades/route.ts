import { NextResponse } from 'next/server';

import { agentNotFound, agentSuccess } from '@/lib/agent-resp';
import { getCachedPublicAgentTrades } from '@/lib/public-page-cache';
import { parseNumberParam } from '@/lib/utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const page = Math.max(1, parseNumberParam(url.searchParams.get('page'), 1));
  const pageSize = Math.min(
    50,
    Math.max(1, parseNumberParam(url.searchParams.get('pageSize'), 20))
  );
  const result = await getCachedPublicAgentTrades(id, page, pageSize);
  if (!result) return agentNotFound('Agent');
  return addCacheHeaders(agentSuccess(result.items, result.meta));
}

function addCacheHeaders(response: NextResponse) {
  response.headers.set(
    'Cache-Control',
    'public, max-age=15, stale-while-revalidate=30'
  );
  return response;
}
