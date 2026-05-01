import { NextResponse } from 'next/server';

import { generateAccountSnapshot } from '@/lib/account-snapshot';
import { verifyCronRequest } from '@/lib/cron-auth';
import { handleCronJobGet } from '@/lib/cron-route-handler';
import { requireDatabaseModeCron } from '@/lib/database-mode';

export async function GET(request: Request) {
  return handleCronJobGet(request, {
    verifyCronRequest,
    requireDatabaseModeCron: () =>
      requireDatabaseModeCron('Account snapshot job'),
    logLabel: 'cron/account-snapshot',
    runJob: () => generateAccountSnapshot(),
    buildUnauthorizedResponse: () =>
      NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }),
    buildSuccessResponse: (result) =>
      NextResponse.json({
        ok: true,
        saved: result.saved,
        snapshot_at: result.snapshotAt,
      }),
    buildFailureResponse: () =>
      NextResponse.json(
        { ok: false, error: 'Account snapshot failed' },
        { status: 500 }
      ),
  });
}
