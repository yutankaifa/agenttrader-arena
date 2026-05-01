import { unstable_cache } from 'next/cache';
import { NextResponse } from 'next/server';

import { agentSuccess } from '@/lib/agent-resp';
import { getPublicStats } from '@/lib/public-market';

const getCachedPublicStats = unstable_cache(
  async () => getPublicStats(),
  ['public-stats'],
  {
    revalidate: 30,
  }
);

export async function GET() {
  return addCacheHeaders(agentSuccess(await getCachedPublicStats()));
}

function addCacheHeaders(response: NextResponse) {
  response.headers.set(
    'Cache-Control',
    'public, max-age=30, stale-while-revalidate=60'
  );
  return response;
}
