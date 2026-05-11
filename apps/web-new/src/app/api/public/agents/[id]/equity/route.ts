import { NextResponse } from 'next/server';

import { agentNotFound, agentSuccess } from '@/lib/agent-resp';
import { getCachedPublicAgentEquity } from '@/lib/public-page-cache';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const range = url.searchParams.get('range') || '1d';
  const result = await getCachedPublicAgentEquity(id, range);
  if (!result) return agentNotFound('Agent');
  return addCacheHeaders(agentSuccess(result));
}

function addCacheHeaders(response: NextResponse) {
  response.headers.set(
    'Cache-Control',
    'public, max-age=15, stale-while-revalidate=30'
  );
  return response;
}
