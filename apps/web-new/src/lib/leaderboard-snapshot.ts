import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import { createId } from '@/db/id';
import { countExecutedActionsForAgent } from '@/lib/agent-competition';
import { ensurePlatformCompetitionExists } from '@/lib/platform-context';
import {
  COMPETITION_PHASE,
  LEADERBOARD_MIN_EXECUTED_ACTIONS,
} from '@/lib/trading-rules';
import { roundUsd } from '@/lib/utils';

export async function generateLeaderboardSnapshot() {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for leaderboard snapshots');
  }

  const now = new Date();
  const snapshotAt = now.toISOString();
  let generated = 0;
  const sql = getSqlClient();
  const competitionId = await ensurePlatformCompetitionExists();
  const twentyFourHoursAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const accountRows = await sql<
    {
      agent_id: string;
      competition_id: string | null;
      initial_cash: number | null;
      display_equity: number | null;
      available_cash: number | null;
      total_equity: number | null;
      model_name: string | null;
      claim_status: string | null;
      agent_status: string;
    }[]
  >`
    select
      acct.agent_id,
      acct.competition_id,
      acct.initial_cash,
      acct.display_equity,
      acct.available_cash,
      acct.total_equity,
      a.model_name,
      a.claim_status,
      a.status as agent_status
    from agent_accounts acct
    inner join agents a on a.id = acct.agent_id
  `;

  const qualified: Array<{
    agentId: string;
    competitionId: string;
    returnRate: number;
    equityValue: number;
    change24h: number;
    drawdown: number;
    modelName: string | null;
  }> = [];

  for (const row of accountRows) {
    if (row.claim_status !== 'claimed' || row.agent_status === 'terminated') {
      continue;
    }

    const executedActionCount = await countExecutedActionsForAgent(row.agent_id);
    if (
      COMPETITION_PHASE === 'official' &&
      executedActionCount < LEADERBOARD_MIN_EXECUTED_ACTIONS
    ) {
      continue;
    }

    const snapshots = await sql<
      {
        ts: string | Date | null;
        drawdown: number | null;
        return_rate: number | null;
      }[]
    >`
      select
        ts,
        drawdown,
        return_rate
      from account_snapshots
      where agent_id = ${row.agent_id}
      order by ts desc
    `;
    const recentSnapshots = snapshots.filter((item) => {
      const ts = item.ts instanceof Date ? item.ts.toISOString() : item.ts;
      return ts != null && ts >= twentyFourHoursAgoIso;
    });
    const latestRecent = recentSnapshots[0] ?? null;
    const oldestRecent = recentSnapshots.at(-1) ?? null;
    const initialCash = row.initial_cash ?? 0;
    const equityValue = row.display_equity ?? row.total_equity ?? initialCash;

    qualified.push({
      agentId: row.agent_id,
      competitionId: row.competition_id ?? competitionId,
      returnRate:
        initialCash > 0 ? roundUsd(((equityValue - initialCash) / initialCash) * 100) : 0,
      equityValue,
      change24h:
        latestRecent && oldestRecent
          ? roundUsd((latestRecent.return_rate ?? 0) - (oldestRecent.return_rate ?? 0))
          : 0,
      drawdown: snapshots.length
        ? Math.min(...snapshots.map((item) => item.drawdown ?? 0))
        : 0,
      modelName: row.model_name,
    });
  }

  qualified.sort((a, b) => b.returnRate - a.returnRate);

  const previousRows = await sql<
    {
      agent_id: string;
      rank: number;
      snapshot_at: string | Date | null;
    }[]
  >`
    select
      agent_id,
      rank,
      snapshot_at
    from leaderboard_snapshots
    where snapshot_at >= ${twentyFourHoursAgoIso}
    order by snapshot_at asc
  `;
  const previousRankMap = new Map<string, number>();
  for (const row of previousRows) {
    if (!previousRankMap.has(row.agent_id)) {
      previousRankMap.set(row.agent_id, row.rank);
    }
  }

  for (const [index, row] of qualified.entries()) {
    const latestRows = await sql<{ rank: number }[]>`
      select rank
      from leaderboard_snapshots
      where agent_id = ${row.agentId}
      order by snapshot_at desc
      limit 1
    `;
    const previousRank = previousRankMap.get(row.agentId);
    const currentLatestRank = latestRows[0]?.rank;
    const rank = index + 1;

    await sql`
      insert into leaderboard_snapshots (
        id,
        competition_id,
        agent_id,
        rank,
        return_rate,
        equity_value,
        change_24h,
        drawdown,
        model_name,
        top_tier,
        rank_change_24h,
        snapshot_at
      ) values (
        ${createId('lb_snap')},
        ${row.competitionId},
        ${row.agentId},
        ${rank},
        ${row.returnRate},
        ${row.equityValue},
        ${row.change24h},
        ${row.drawdown},
        ${row.modelName},
        ${rank <= 3 ? 'top_3' : rank <= 10 ? 'top_10' : 'normal'},
        ${previousRank != null ? previousRank - rank : currentLatestRank != null ? currentLatestRank - rank : 0},
        ${snapshotAt}
      )
    `;
    generated += 1;
  }

  return { generated, snapshotAt };
}
