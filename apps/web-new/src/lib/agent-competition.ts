import { getSqlClient, isDatabaseConfigured } from '@/db/postgres';
import type { AgentClaimStatus } from '@/db/schema';
import {
  COMPETITION_PHASE,
  LEADERBOARD_MIN_EXECUTED_ACTIONS,
} from '@/lib/trading-rules';

export type LeaderboardVisibilityStatus = 'visible' | 'pending_actions';

export type AgentCompetitionStatus = {
  competition_phase: typeof COMPETITION_PHASE;
  leaderboard_visibility_status: LeaderboardVisibilityStatus;
  required_executed_actions_for_visibility: number;
  executed_action_count: number;
};

function requireDatabaseMode() {
  if (!isDatabaseConfigured()) {
    throw new Error('Database mode is required for agent competition views');
  }
}

export async function getAgentCompetitionStatus(
  agentId: string,
  claimStatus: AgentClaimStatus | string | null | undefined
) {
  const executedActionCount = await countExecutedActionsForAgent(agentId);
  const requiredExecutedActions = LEADERBOARD_MIN_EXECUTED_ACTIONS;
  const leaderboardVisibilityStatus =
    claimStatus === 'claimed' && executedActionCount >= requiredExecutedActions
      ? 'visible'
      : 'pending_actions';

  return {
    competition_phase: COMPETITION_PHASE,
    leaderboard_visibility_status: leaderboardVisibilityStatus,
    required_executed_actions_for_visibility: requiredExecutedActions,
    executed_action_count: executedActionCount,
  };
}

export async function countExecutedActionsForAgent(agentId: string) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<{ total: number }[]>`
    select count(*)::int as total
    from decision_actions da
    inner join decision_submissions ds on ds.id = da.submission_id
    where ds.agent_id = ${agentId}
      and da.status in ('filled', 'partial')
  `;
  return Number(rows[0]?.total ?? 0);
}

export async function getLatestLeaderboardSnapshot() {
  requireDatabaseMode();
  const sql = getSqlClient();
  const latestRows = await sql<{ snapshot_at: string | Date | null }[]>`
    select snapshot_at
    from leaderboard_snapshots
    order by snapshot_at desc
    limit 1
  `;
  const latestTime = latestRows[0]?.snapshot_at ?? null;
  if (!latestTime) {
    return [];
  }

  const rows = await sql<
    {
      id: string;
      competition_id: string;
      agent_id: string;
      rank: number;
      return_rate: number;
      equity_value: number;
      change_24h: number;
      drawdown: number;
      model_name: string | null;
      top_tier: 'top_3' | 'top_10' | 'normal';
      rank_change_24h: number;
      snapshot_at: string | Date | null;
    }[]
  >`
    select
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
    from leaderboard_snapshots
    where snapshot_at = ${latestTime}
    order by rank asc
  `;

  return rows.map((row) => ({
    id: row.id,
    competitionId: row.competition_id,
    agentId: row.agent_id,
    rank: row.rank,
    returnRate: row.return_rate,
    equityValue: row.equity_value,
    change24h: row.change_24h,
    drawdown: row.drawdown,
    modelName: row.model_name,
    topTier: row.top_tier,
    rankChange24h: row.rank_change_24h,
    snapshotAt:
      row.snapshot_at instanceof Date ? row.snapshot_at.toISOString() : row.snapshot_at,
  }));
}

export async function getAgentLeaderboardRank(agentId: string) {
  requireDatabaseMode();
  const sql = getSqlClient();
  const rows = await sql<
    {
      id: string;
      competition_id: string;
      agent_id: string;
      rank: number;
      return_rate: number;
      equity_value: number;
      change_24h: number;
      drawdown: number;
      model_name: string | null;
      top_tier: 'top_3' | 'top_10' | 'normal';
      rank_change_24h: number;
      snapshot_at: string | Date | null;
    }[]
  >`
    select
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
    from leaderboard_snapshots
    where agent_id = ${agentId}
    order by snapshot_at desc
    limit 1
  `;
  const row = rows[0] ?? null;
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    competitionId: row.competition_id,
    agentId: row.agent_id,
    rank: row.rank,
    returnRate: row.return_rate,
    equityValue: row.equity_value,
    change24h: row.change_24h,
    drawdown: row.drawdown,
    modelName: row.model_name,
    topTier: row.top_tier,
    rankChange24h: row.rank_change_24h,
    snapshotAt:
      row.snapshot_at instanceof Date ? row.snapshot_at.toISOString() : row.snapshot_at,
  };
}
