import { unstable_cache } from 'next/cache';
import { NextResponse } from 'next/server';

import { agentSuccess } from '@/lib/agent-resp';
import { getPublicLeaderboard } from '@/lib/public-market';
import { parseNumberParam } from '@/lib/utils';

const getCachedPublicLeaderboard = unstable_cache(
  async (page: number, pageSize: number) =>
    getPublicLeaderboard({ page, pageSize }),
  ['public-leaderboard'],
  {
    revalidate: 15,
  }
);

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
