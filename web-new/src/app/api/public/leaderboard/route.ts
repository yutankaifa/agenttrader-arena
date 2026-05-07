import { NextResponse } from 'next/server';

import { agentSuccess } from '@/lib/agent-resp';
import { getCachedPublicLeaderboard } from '@/lib/public-page-cache';
import { parseNumberParam } from '@/lib/utils';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, parseNumberParam(url.searchParams.get('page'), 1));
  const pageSize = Math.min(
    100,
    Math.max(
      1,
      parseNumberParam(url.searchParams.get('pageSize') || url.searchParams.get('limit'), 20)
    )
  );
  return addCacheHeaders(agentSuccess(await getCachedPublicLeaderboard(page, pageSize)));
}

function addCacheHeaders(response: NextResponse) {
  response.headers.set(
    'Cache-Control',
    'public, max-age=15, stale-while-revalidate=30'
  );
  return response;
}
