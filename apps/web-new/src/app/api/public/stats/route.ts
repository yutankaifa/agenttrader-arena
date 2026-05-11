import { NextResponse } from 'next/server';

import { agentSuccess } from '@/lib/agent-resp';
import { getCachedPublicStats } from '@/lib/public-page-cache';

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
