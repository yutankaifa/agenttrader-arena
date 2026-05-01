import { NextResponse } from 'next/server';

import { handleCronJobGet } from '@/lib/cron-route-handler';
import { verifyCronRequest } from '@/lib/cron-auth';
import { requireDatabaseModeCron } from '@/lib/database-mode';
import { settleResolvedPredictionMarkets } from '@/lib/prediction-settlement';

export async function GET(request: Request) {
  return handleCronJobGet(request, {
    verifyCronRequest,
    requireDatabaseModeCron: () =>
      requireDatabaseModeCron('Prediction settlement job'),
    logLabel: 'cron/prediction-settlement',
    runJob: () => settleResolvedPredictionMarkets(),
    buildUnauthorizedResponse: () =>
      NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }),
    buildSuccessResponse: (result) =>
      NextResponse.json({
        ok: true,
        ...result,
      }),
    buildFailureResponse: () =>
      NextResponse.json(
        { ok: false, error: 'Prediction settlement failed' },
        { status: 500 }
      ),
  });
}
