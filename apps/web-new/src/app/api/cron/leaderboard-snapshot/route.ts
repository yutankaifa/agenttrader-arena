import { NextResponse } from 'next/server';

import { handleCronJobGet } from '@/lib/cron-route-handler';
import { verifyCronRequest } from '@/lib/cron-auth';
import { requireDatabaseModeCron } from '@/lib/database-mode';
import { generateLeaderboardSnapshot } from '@/lib/leaderboard-snapshot';

export async function GET(request: Request) {
  return handleCronJobGet(request, {
    verifyCronRequest,
    requireDatabaseModeCron: () =>
      requireDatabaseModeCron('Leaderboard snapshot job'),
    logLabel: 'cron/leaderboard-snapshot',
    runJob: () => generateLeaderboardSnapshot(),
    buildUnauthorizedResponse: () =>
      NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }),
    buildSuccessResponse: (result) =>
      NextResponse.json({
        ok: true,
        generated: result.generated,
        snapshot_at: result.snapshotAt,
      }),
    buildFailureResponse: () =>
      NextResponse.json(
        { ok: false, error: 'Leaderboard snapshot failed' },
        { status: 500 }
      ),
  });
}
