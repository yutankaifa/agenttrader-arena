import type {
  PublicHomeOverview,
  PublicLeaderboardData,
  PublicLiveTradesData,
  PublicStats,
  PublicTopTier,
  RiskTag,
} from 'agenttrader-types';
import { getSqlClient } from '@/db/postgres';
import { getRiskMode, getRiskTagForAccount } from '@/lib/account-metrics';
import { ensureAgentAvatarUrlColumn } from '@/lib/agent-avatar-schema';
import { buildExecutionPath } from '@/lib/execution-path';
import { normalizeTimestampToIsoString } from '@/lib/timestamp';
import { ensureTradeExecutionQuoteSourceColumn } from '@/lib/trade-execution-schema';
import { INITIAL_CAPITAL } from '@/lib/trading-rules';

type PublicLeaderboardDatabaseRow = {
  public_rank: number;
  agent_id: string;
  competition_id: string | null;
  return_rate: number | null;
  equity_value: number | null;
  change_24h: number | null;
  drawdown: number | null;
  model_name: string | null;
  rank_change_24h: number | null;
  snapshot_at: string | Date | null;
  agent_name: string;
  agent_avatar: string | null;
  risk_tag: RiskTag;
  available_cash: number | null;
};

type PublicLeaderboardMetaRow = {
  snapshot_at: string | Date | null;
  competition_id: string | null;
  total: string | number;
};

type PublicTradeSide = 'buy' | 'sell';

type PublicLiveTradeDatabaseRow = {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_avatar: string | null;
  action_id: string | null;
  symbol: string;
  market: string | null;
  side: string;
  notional_usd: number | null;
  fill_price: number | null;
  quote_source: string | null;
  execution_method: string | null;
  position_ratio: number | null;
  outcome_name: string | null;
  reason_tag: string | null;
  display_rationale: string | null;
  risk_tag: RiskTag;
  rank_snapshot: number | null;
  executed_at: string | Date | null;
};

type LargestPositionDatabaseRow = {
  agent_id: string;
  agent_name: string;
  symbol: string;
  market: string;
  outcome_name: string | null;
  position_size: number | null;
  entry_price: number | null;
  market_price: number | null;
  market_value: number | null;
};

type HomeCallInsightDatabaseRow = {
  agent_id: string;
  agent_name: string;
  agent_avatar: string | null;
  symbol: string;
  market: string;
  side: string;
  outcome_name: string | null;
  reason_tag: string | null;
  display_rationale: string | null;
  filled_units: number;
  fill_price: number;
  mark_price: number;
  call_pnl_usd: number;
  current_rank: number | null;
  executed_at: string | Date | null;
};

export async function getPublicStatsFromDatabase(): Promise<PublicStats> {
  const sql = getSqlClient();
  const [agentRows, capitalRows, accountRows, winningRows] = await Promise.all([
    sql<{ count: string | number }[]>`
      select count(*) as count
      from agents
      where claim_status = 'claimed'
    `,
    sql<{ capital_tracked: number | null }[]>`
      select coalesce(sum(coalesce(acct.display_equity, acct.total_equity, acct.initial_cash)), 0) as capital_tracked
      from agent_accounts acct
      inner join agents a on a.id = acct.agent_id
      where a.claim_status = 'claimed'
    `,
    sql<{ count: string | number }[]>`
      select count(*) as count
      from agent_accounts acct
      inner join agents a on a.id = acct.agent_id
      where a.claim_status = 'claimed'
    `,
    sql<{ count: string | number }[]>`
      select count(*) as count
      from agent_accounts acct
      inner join agents a on a.id = acct.agent_id
      where a.claim_status = 'claimed'
        and coalesce(acct.display_equity, acct.total_equity, acct.initial_cash) > acct.initial_cash
    `,
  ]);

  const trackedAccounts = Number(accountRows[0]?.count ?? 0);
  const winners = Number(winningRows[0]?.count ?? 0);

  return {
    agents: Number(agentRows[0]?.count ?? 0),
    capitalTracked: Number(capitalRows[0]?.capital_tracked ?? 0),
    winRate: trackedAccounts ? Math.round((winners / trackedAccounts) * 1000) / 10 : 0,
    trackedAccounts,
  };
}

export async function getPublicLeaderboardFromDatabase(input: {
  page: number;
  pageSize: number;
}): Promise<PublicLeaderboardData> {
  await ensureAgentAvatarUrlColumn();
  const { rows, meta } = await queryLatestPublicLeaderboardPageFromDatabase(input);
  const total = Number(meta?.total ?? 0);

  return {
    items: rows.map(mapLeaderboardRow),
    snapshotAt: toIsoString(meta?.snapshot_at ?? null),
    competitionId: meta?.competition_id ?? null,
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

export async function getPublicLeaderboardEntryFromDatabase(agentId: string) {
  await ensureAgentAvatarUrlColumn();
  const row = await queryLatestPublicLeaderboardEntryFromDatabase(agentId);
  if (!row) {
    return null;
  }

  const mapped = mapLeaderboardRow(row);
  return {
    rank: mapped.rank,
    agentId: mapped.agentId,
    competitionId: row.competition_id,
    returnRate: mapped.returnRate,
    equityValue: mapped.equityValue,
    change24h: mapped.change24h,
    drawdown: mapped.drawdown,
    modelName: mapped.modelName,
    topTier: mapped.topTier,
    rankChange24h: mapped.rankChange24h,
    snapshotAt: mapped.snapshotAt,
  };
}

export async function getPublicLiveTradesFromDatabase(input: {
  page: number;
  pageSize: number;
}): Promise<PublicLiveTradesData> {
  await ensureAgentAvatarUrlColumn();
  await ensureTradeExecutionQuoteSourceColumn();
  const sql = getSqlClient();
  const offset = (input.page - 1) * input.pageSize;
  const [totalRows, itemRows] = await Promise.all([
    sql<{ count: string | number }[]>`
      select count(*) as count
      from live_trade_events e
      inner join agents a on a.id = e.agent_id
      where a.claim_status = 'claimed'
    `,
    sql<PublicLiveTradeDatabaseRow[]>`
      select
        e.id,
        e.agent_id,
        a.name as agent_name,
        a.avatar_url as agent_avatar,
        e.action_id,
        e.symbol,
        da.market,
        e.side,
        e.notional_usd,
        te.fill_price,
        te.quote_source,
        te.execution_method,
        e.position_ratio,
        e.outcome_name,
        e.reason_tag,
        e.display_rationale,
        acct.risk_tag,
        e.rank_snapshot,
        e.executed_at
      from live_trade_events e
      inner join agents a on a.id = e.agent_id
      left join trade_executions te on te.action_id = e.action_id
      left join decision_actions da on da.id = e.action_id
      left join lateral (
        select risk_tag
        from agent_accounts acct
        where acct.agent_id = e.agent_id
        order by acct.updated_at desc nulls last
        limit 1
      ) acct on true
      where a.claim_status = 'claimed'
      order by e.executed_at desc
      limit ${input.pageSize}
      offset ${offset}
    `,
  ]);

  const total = Number(totalRows[0]?.count ?? 0);

  return {
    items: itemRows.map((row) => ({
      id: row.id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      agentAvatar: row.agent_avatar,
      symbol: row.symbol,
      market: row.market,
      side: normalizePublicTradeSide(row.side),
      notionalUsd: row.notional_usd ?? 0,
      fillPrice: row.fill_price,
      executionPath: buildExecutionPath(row.quote_source, row.execution_method),
      positionRatio: row.position_ratio,
      outcomeName: row.outcome_name,
      reasonTag: row.reason_tag,
      displayRationale: row.display_rationale,
      riskTag: row.risk_tag,
      closeOnly: row.risk_tag === 'close_only',
      rankSnapshot: row.rank_snapshot,
      topTier: topTierFromRankSnapshot(row.rank_snapshot),
      executedAt: toIsoString(row.executed_at),
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
  };
}

export async function getPublicHomeOverviewFromDatabase(): Promise<PublicHomeOverview> {
  await ensureAgentAvatarUrlColumn();
  await ensureTradeExecutionQuoteSourceColumn();
  const sql = getSqlClient();

  const now = new Date();
  const startOfLast24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const startOfLast24HoursIso = startOfLast24Hours.toISOString();

  const [tradeRows, positionRows, tradesTodayRows, callRows] = await Promise.all([
    sql<PublicLiveTradeDatabaseRow[]>`
      select
        e.id,
        e.agent_id,
        a.name as agent_name,
        a.avatar_url as agent_avatar,
        e.action_id,
        e.symbol,
        da.market,
        e.side,
        e.notional_usd,
        te.fill_price,
        te.quote_source,
        te.execution_method,
        e.position_ratio,
        e.outcome_name,
        e.reason_tag,
        e.display_rationale,
        e.rank_snapshot,
        e.executed_at
      from live_trade_events e
      inner join agents a on a.id = e.agent_id
      left join trade_executions te on te.action_id = e.action_id
      left join decision_actions da on da.id = e.action_id
      where a.claim_status = 'claimed'
        and coalesce(e.notional_usd, 0) > 0
        and e.executed_at > ${startOfLast24HoursIso}
      order by e.notional_usd desc, e.executed_at desc
      limit 1
    `,
    sql<LargestPositionDatabaseRow[]>`
      select
        p.agent_id,
        a.name as agent_name,
        p.symbol,
        p.market,
        p.outcome_name,
        p.position_size,
        p.entry_price,
        coalesce(
          quote_exact.last_price,
          quote_instrument.last_price,
          nullif(p.market_price, 0),
          p.entry_price,
          0
        ) as market_price,
        coalesce(
          quote_exact.last_price,
          quote_instrument.last_price,
          nullif(p.market_price, 0),
          p.entry_price,
          0
        ) * coalesce(p.position_size, 0) as market_value
      from positions p
      inner join agents a on a.id = p.agent_id
      left join lateral (
        select mds.last_price
        from market_data_snapshots mds
        where mds.instrument_id = case
          when coalesce(p.outcome_id, '') <> '' then p.symbol || '::' || p.outcome_id
          else p.symbol
        end
        order by mds.quote_ts desc
        limit 1
      ) quote_exact on true
      left join lateral (
        select mds.last_price
        from market_instruments mi
        inner join market_data_snapshots mds on mds.instrument_id = mi.id
        where coalesce(p.outcome_id, '') = ''
          and mi.market = p.market
          and upper(mi.symbol) = upper(p.symbol)
        order by mds.quote_ts desc
        limit 1
      ) quote_instrument on true
      where a.claim_status = 'claimed'
        and coalesce(p.position_size, 0) > 0
        and p.updated_at > ${startOfLast24HoursIso}
      order by market_value desc
      limit 1
    `,
    sql<{ count: string | number }[]>`
      select count(*) as count
      from live_trade_events e
      inner join agents a on a.id = e.agent_id
      where a.claim_status = 'claimed'
        and timezone('America/New_York', e.executed_at)::date =
          timezone('America/New_York', now())::date
    `,
    sql<HomeCallInsightDatabaseRow[]>`
      with recent_calls as materialized (
        select
          te.id as execution_id,
          te.filled_units,
          te.fill_price,
          te.fee,
          te.executed_at,
          ds.agent_id,
          a.name as agent_name,
          a.avatar_url as agent_avatar,
          da.symbol,
          da.market,
          da.side,
          da.event_id,
          da.outcome_id,
          da.outcome_name,
          da.reason_tag,
          da.display_rationale
        from trade_executions te
        inner join decision_actions da on da.id = te.action_id
        inner join decision_submissions ds on ds.id = da.submission_id
        inner join agents a on a.id = ds.agent_id
        where a.claim_status = 'claimed'
          and da.status in ('filled', 'partial')
          and coalesce(te.filled_units, 0) > 0
          and coalesce(te.fill_price, 0) > 0
          and te.executed_at > ${startOfLast24HoursIso}
        order by te.executed_at desc
        limit 200
      )
      select
        rc.agent_id,
        rc.agent_name,
        rc.agent_avatar,
        rc.symbol,
        rc.market,
        rc.side,
        rc.outcome_name,
        rc.reason_tag,
        rc.display_rationale,
        rc.filled_units,
        rc.fill_price,
        coalesce(
          quote_exact.last_price,
          quote_instrument.last_price,
          matched_position.market_price,
          matched_position.entry_price,
          rc.fill_price
        ) as mark_price,
        case
          when upper(rc.side) = 'BUY' then
            rc.filled_units * (
              coalesce(
                quote_exact.last_price,
                quote_instrument.last_price,
                matched_position.market_price,
                matched_position.entry_price,
                rc.fill_price
              ) - rc.fill_price
            ) - coalesce(rc.fee, 0)
          when upper(rc.side) = 'SELL' then
            rc.filled_units * (
              rc.fill_price - coalesce(
                quote_exact.last_price,
                quote_instrument.last_price,
                matched_position.market_price,
                matched_position.entry_price,
                rc.fill_price
              )
            ) - coalesce(rc.fee, 0)
          else 0
        end as call_pnl_usd,
        latest_rank.rank as current_rank,
        rc.executed_at
      from recent_calls rc
      left join lateral (
        select ls.rank
        from leaderboard_snapshots ls
        where ls.agent_id = rc.agent_id
        order by ls.snapshot_at desc, ls.rank asc
        limit 1
      ) latest_rank on true
      left join lateral (
        select mds.last_price
        from market_data_snapshots mds
        where mds.instrument_id = case
          when coalesce(rc.outcome_id, '') <> '' then rc.symbol || '::' || rc.outcome_id
          else rc.symbol
        end
        order by mds.quote_ts desc
        limit 1
      ) quote_exact on true
      left join lateral (
        select mds.last_price
        from market_instruments mi
        inner join market_data_snapshots mds on mds.instrument_id = mi.id
        where coalesce(rc.outcome_id, '') = ''
          and mi.market = rc.market
          and upper(mi.symbol) = upper(rc.symbol)
        order by mds.quote_ts desc
        limit 1
      ) quote_instrument on true
      left join lateral (
        select p.market_price, p.entry_price
        from positions p
        where p.agent_id = rc.agent_id
          and p.symbol = rc.symbol
          and p.market = rc.market
          and coalesce(p.event_id, '') = coalesce(rc.event_id, '')
          and coalesce(p.outcome_id, '') = coalesce(rc.outcome_id, '')
        order by p.updated_at desc
        limit 1
      ) matched_position on true
      order by rc.executed_at desc
    `,
  ]);

  const bestCall = callRows
    .slice()
    .sort((left, right) => right.call_pnl_usd - left.call_pnl_usd)[0] ?? null;
  const worstCall = callRows
    .slice()
    .sort((left, right) => left.call_pnl_usd - right.call_pnl_usd)[0] ?? null;
  const biggestTrade = tradeRows[0]
    ? {
        id: tradeRows[0].id,
        agentId: tradeRows[0].agent_id,
        agentName: tradeRows[0].agent_name,
        agentAvatar: tradeRows[0].agent_avatar,
        symbol: tradeRows[0].symbol,
        market: tradeRows[0].market,
        side: normalizePublicTradeSide(tradeRows[0].side),
        notionalUsd: tradeRows[0].notional_usd ?? 0,
        fillPrice: tradeRows[0].fill_price,
        executionPath: buildExecutionPath(
          tradeRows[0].quote_source,
          tradeRows[0].execution_method
        ),
        positionRatio: tradeRows[0].position_ratio,
        outcomeName: tradeRows[0].outcome_name,
        reasonTag: tradeRows[0].reason_tag,
        displayRationale: tradeRows[0].display_rationale,
        rankSnapshot: tradeRows[0].rank_snapshot,
        topTier: topTierFromRankSnapshot(tradeRows[0].rank_snapshot),
        executedAt: toIsoString(tradeRows[0].executed_at),
      }
    : null;
  const largestPosition = positionRows[0]
    ? {
        agentId: positionRows[0].agent_id,
        agentName: positionRows[0].agent_name,
        symbol: positionRows[0].symbol,
        market: positionRows[0].market,
        outcomeName: positionRows[0].outcome_name,
        positionSize: positionRows[0].position_size,
        entryPrice: positionRows[0].entry_price,
        marketPrice: positionRows[0].market_price,
        marketValue: positionRows[0].market_value ?? 0,
      }
    : null;

  return {
    tradesToday: Number(tradesTodayRows[0]?.count ?? 0),
    bestCall: bestCall
      ? {
          agentId: bestCall.agent_id,
          agentName: bestCall.agent_name,
          agentAvatar: bestCall.agent_avatar,
          symbol: bestCall.symbol,
          market: bestCall.market,
          side: bestCall.side.toLowerCase(),
          outcomeName: bestCall.outcome_name,
          reasonTag: bestCall.reason_tag,
          displayRationale: bestCall.display_rationale,
          filledUnits: bestCall.filled_units,
          fillPrice: bestCall.fill_price,
          markPrice: bestCall.mark_price,
          callPnlUsd: bestCall.call_pnl_usd,
          currentRank: bestCall.current_rank,
          executedAt: toIsoString(bestCall.executed_at),
        }
      : null,
    worstCall: worstCall
      ? {
          agentId: worstCall.agent_id,
          agentName: worstCall.agent_name,
          agentAvatar: worstCall.agent_avatar,
          symbol: worstCall.symbol,
          market: worstCall.market,
          side: worstCall.side.toLowerCase(),
          outcomeName: worstCall.outcome_name,
          reasonTag: worstCall.reason_tag,
          displayRationale: worstCall.display_rationale,
          filledUnits: worstCall.filled_units,
          fillPrice: worstCall.fill_price,
          markPrice: worstCall.mark_price,
          callPnlUsd: worstCall.call_pnl_usd,
          currentRank: worstCall.current_rank,
          executedAt: toIsoString(worstCall.executed_at),
        }
      : null,
    biggestTrade,
    largestPosition,
  };
}

async function queryLatestPublicLeaderboardPageFromDatabase(input: {
  page: number;
  pageSize: number;
}) {
  const sql = getSqlClient();
  const offset = (input.page - 1) * input.pageSize;
  const [metaRows, rows] = await Promise.all([
    sql<PublicLeaderboardMetaRow[]>`
      with latest as (
        select max(ls.snapshot_at) as snapshot_at
        from leaderboard_snapshots ls
        inner join agents a on a.id = ls.agent_id
        where a.claim_status = 'claimed'
      )
      select
        latest.snapshot_at,
        max(ls.competition_id) filter (where a.id is not null) as competition_id,
        count(a.id) as total
      from latest
      left join leaderboard_snapshots ls on ls.snapshot_at = latest.snapshot_at
      left join agents a on a.id = ls.agent_id and a.claim_status = 'claimed'
      group by latest.snapshot_at
    `,
    sql<PublicLeaderboardDatabaseRow[]>`
      with latest as (
        select max(ls.snapshot_at) as snapshot_at
        from leaderboard_snapshots ls
        inner join agents a on a.id = ls.agent_id
        where a.claim_status = 'claimed'
      ),
      ranked as (
        select
          row_number() over (order by ls.rank asc, ls.agent_id asc) as public_rank,
          ls.agent_id,
          ls.competition_id,
          ls.return_rate,
          ls.equity_value,
          ls.change_24h,
          ls.drawdown,
          ls.model_name,
          ls.rank_change_24h,
          ls.snapshot_at,
          a.name as agent_name,
          a.avatar_url as agent_avatar,
          acct.risk_tag,
          acct.available_cash
        from leaderboard_snapshots ls
        inner join latest latest_snap on latest_snap.snapshot_at = ls.snapshot_at
        inner join agents a on a.id = ls.agent_id
        left join agent_accounts acct on acct.agent_id = ls.agent_id
        where a.claim_status = 'claimed'
      )
      select *
      from ranked
      order by public_rank asc
      limit ${input.pageSize}
      offset ${offset}
    `,
  ]);

  return {
    meta: metaRows[0] ?? null,
    rows,
  };
}

async function queryLatestPublicLeaderboardEntryFromDatabase(agentId: string) {
  await ensureAgentAvatarUrlColumn();
  const sql = getSqlClient();
  const rows = await sql<PublicLeaderboardDatabaseRow[]>`
    with latest as (
      select max(ls.snapshot_at) as snapshot_at
      from leaderboard_snapshots ls
      inner join agents a on a.id = ls.agent_id
      where a.claim_status = 'claimed'
    )
    select
      ls.rank as public_rank,
      ls.agent_id,
      ls.competition_id,
      ls.return_rate,
      ls.equity_value,
      ls.change_24h,
      ls.drawdown,
      ls.model_name,
      ls.rank_change_24h,
      ls.snapshot_at,
      a.name as agent_name,
      a.avatar_url as agent_avatar,
      acct.risk_tag,
      acct.available_cash
    from leaderboard_snapshots ls
    inner join latest latest_snap on latest_snap.snapshot_at = ls.snapshot_at
    inner join agents a on a.id = ls.agent_id
    left join agent_accounts acct on acct.agent_id = ls.agent_id
    where ls.agent_id = ${agentId}
      and a.claim_status = 'claimed'
    limit 1
  `;
  return rows[0] ?? null;
}

function mapLeaderboardRow(row: PublicLeaderboardDatabaseRow) {
  const computedRiskTag = getRiskTagForAccount(
    row.available_cash ?? INITIAL_CAPITAL,
    row.equity_value ?? INITIAL_CAPITAL
  );
  const riskTag: RiskTag =
    row.drawdown != null && row.drawdown <= -50
      ? 'high_risk'
      : computedRiskTag ?? row.risk_tag ?? null;

  return {
    rank: row.public_rank,
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentAvatar: row.agent_avatar,
    returnRate: row.return_rate ?? 0,
    equityValue: row.equity_value ?? 0,
    change24h: row.change_24h,
    drawdown: row.drawdown,
    modelName: row.model_name,
    topTier: topTierFromRankSnapshot(row.public_rank),
    rankChange24h: row.rank_change_24h ?? 0,
    riskTag,
    closeOnly:
      getRiskMode({
        riskTag,
        cash: row.available_cash ?? INITIAL_CAPITAL,
        equity: row.equity_value ?? INITIAL_CAPITAL,
      }) === 'close_only',
    snapshotAt: toIsoString(row.snapshot_at),
  };
}

function toIsoString(value: string | Date | null | undefined) {
  return normalizeTimestampToIsoString(value);
}

function topTierFromRankSnapshot(rank: number | null): PublicTopTier {
  if (rank == null) {
    return 'normal';
  }
  if (rank <= 3) {
    return 'top_3';
  }
  if (rank <= 10) {
    return 'top_10';
  }
  return 'normal';
}

function normalizePublicTradeSide(value: string): PublicTradeSide {
  return value.trim().toLowerCase() === 'sell' ? 'sell' : 'buy';
}
