import { unstable_cache } from 'next/cache';
import { NextResponse } from 'next/server';

import { agentSuccess } from '@/lib/agent-resp';
import { getPublicLiveTrades } from '@/lib/public-market';
import { parseNumberParam } from '@/lib/utils';

const getCachedPublicLiveTrades = unstable_cache(
  async (page: number, pageSize: number) =>
    getPublicLiveTrades({ page, pageSize }),
  ['public-live-trades'],
  {
    revalidate: 10,
  }
);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(1, parseNumberParam(url.searchParams.get('page'), 1));
  const pageSize = Math.min(
    50,
    Math.max(
      1,
      parseNumberParam(url.searchParams.get('pageSize') || url.searchParams.get('limit'), 20)
    )
  );
  return addCacheHeaders(agentSuccess(await getCachedPublicLiveTrades(page, pageSize)));
}

function addCacheHeaders(response: NextResponse) {
  response.headers.set(
    'Cache-Control',
    'public, max-age=10, stale-while-revalidate=20'
  );
  return response;
}
