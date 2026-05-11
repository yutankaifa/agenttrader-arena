import { NextResponse } from 'next/server';

import { agentNotFound, agentSuccess } from '@/lib/agent-resp';
import { getCachedPublicAgentPositions } from '@/lib/public-page-cache';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await getCachedPublicAgentPositions(id);
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
