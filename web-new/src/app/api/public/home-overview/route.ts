import { unstable_cache } from 'next/cache';
import { NextResponse } from 'next/server';

import { agentSuccess } from '@/lib/agent-resp';
import { getPublicHomeOverview } from '@/lib/public-market';

const getCachedPublicHomeOverview = unstable_cache(
  async () => getPublicHomeOverview(),
  ['public-home-overview'],
  {
    revalidate: 10,
  }
);

export async function GET() {
  return addCacheHeaders(agentSuccess(await getCachedPublicHomeOverview()));
}

function addCacheHeaders(response: NextResponse) {
  response.headers.set(
    'Cache-Control',
    'public, max-age=10, stale-while-revalidate=20'
  );
  return response;
}
