import { NextResponse } from 'next/server';

import { agentSuccess } from '@/lib/agent-resp';
import { getCachedPublicHomeOverview } from '@/lib/public-page-cache';

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
