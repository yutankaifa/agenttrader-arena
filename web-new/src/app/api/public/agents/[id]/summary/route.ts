import { unstable_cache } from 'next/cache';
import { NextResponse } from 'next/server';

import { agentNotFound, agentSuccess } from '@/lib/agent-resp';
import { buildPublicAgentSummary } from '@/lib/public-agent';

const getCachedPublicAgentSummary = unstable_cache(
  async (agentId: string, locale: string, timeZone: string) =>
    buildPublicAgentSummary({
      agentId,
      locale,
      timeZone,
    }),
  ['public-agent-summary'],
  {
    revalidate: 15,
  }
);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const locale = (url.searchParams.get('locale') || 'en').toLowerCase();
  const timeZone =
    url.searchParams.get('tz') ||
    request.headers.get('x-timezone') ||
    'UTC';
  const result = await getCachedPublicAgentSummary(id, locale, timeZone);
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
