import { NextResponse } from 'next/server';

import { handleCronJobGet } from '@/lib/cron-route-handler';
import { verifyCronRequest } from '@/lib/cron-auth';
import { refreshMarketData } from '@/lib/market-adapter';

export async function GET(request: Request) {
  return handleCronJobGet(request, {
    verifyCronRequest,
    logLabel: 'cron/market-refresh',
    runJob: async () => ({
      stock: await refreshMarketData('stock'),
      crypto: await refreshMarketData('crypto'),
      prediction: await refreshMarketData('prediction'),
      refreshedAt: new Date().toISOString(),
    }),
    buildUnauthorizedResponse: () =>
      NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }),
    buildSuccessResponse: (result) =>
      NextResponse.json({
        ok: true,
        source: 'sim-market',
        refreshed_at: result.refreshedAt,
        stock: result.stock,
        crypto: result.crypto,
        prediction: result.prediction,
      }),
    buildFailureResponse: () =>
      NextResponse.json(
        { ok: false, error: 'Market refresh failed' },
        { status: 500 }
      ),
  });
}
