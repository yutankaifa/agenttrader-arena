import { getSqlClient } from '@/db/postgres';
import { buildAccountPerformanceMetrics, getRiskTagForAccount } from '@/lib/account-metrics';
import { ensureAgentAvatarUrlColumn } from '@/lib/agent-avatar-schema';
import { ensureAgentXUrlColumn } from '@/lib/agent-x';
import { refreshDisplayEquity } from '@/lib/display-equity';
import { buildExecutionPath } from '@/lib/execution-path';
import { getPublicLeaderboardEntryFromDatabase } from '@/lib/public-market-db';
import { normalizeTimestampToIsoString } from '@/lib/timestamp';
import { ensureTradeExecutionQuoteSourceColumn } from '@/lib/trade-execution-schema';
import { INITIAL_CAPITAL } from '@/lib/trading-rules';

const RANGE_MAP_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

type ClaimedPublicAgentRow = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  x_url: string | null;
  model_name: string | null;
  primary_market: string | null;
  market_preferences: string | null;
  status: string;
  last_heartbeat_at: string | Date | null;
  created_at: string | Date | null;
};

type PublicPositionRow = {
  id: string;
  symbol: string;
  market: string;
  event_id: string | null;
  outcome_id: string | null;
  outcome_name: string | null;
  position_size: number | null;
  avg_price: number | null;
  market_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  updated_at: string | Date | null;
};

type PublicTradeRow = {
  execution_id: string;
  symbol: string;
  side: string;
  market: string;
  event_id: string | null;
  outcome_id: string | null;
  outcome_name: string | null;
  reason_tag: string | null;
  display_rationale: string | null;
  filled_units: number;
  fill_price: number;
  quote_source: string | null;
  execution_method: string | null;
  fee: number;
  executed_at: string | Date | null;
};

type PublicAgentAccountRow = {
  initial_cash: number | null;
  available_cash: number | null;
  total_equity: number | null;
  display_equity: number | null;
  risk_tag: 'high_risk' | 'close_only' | 'terminated' | null;
};

export async function getClaimedPublicAgentFromDatabase(agentId: string) {
  await ensureAgentAvatarUrlColumn();
  await ensureAgentXUrlColumn();
  const sql = getSqlClient();
  const rows = await sql<ClaimedPublicAgentRow[]>`
    select
      id,
      name,
      description,
      avatar_url,
      x_url,
      model_name,
      primary_market,
      market_preferences,
      status,
      last_heartbeat_at,
      created_at
    from agents
    where id = ${agentId}
      and claim_status = 'claimed'
    limit 1
  `;

  const row = rows[0] ?? null;
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    avatarUrl: row.avatar_url,
    xUrl: row.x_url,
    modelName: row.model_name,
    primaryMarket: row.primary_market,
    marketPreferences: parseStringArray(row.market_preferences),
    status: row.status,
    lastHeartbeatAt: toIsoString(row.last_heartbeat_at),
    createdAt: toIsoString(row.created_at),
  };
}

export async function buildPublicAgentSummaryFromDatabase(input: {
  agentId: string;
  locale: string;
  timeZone: string;
  now?: Date;
}) {
  const { agentId, locale, timeZone, now = new Date() } = input;
  const agent = await getClaimedPublicAgentFromDatabase(agentId);
  if (!agent) {
    return null;
  }

  const sql = getSqlClient();
  const recentStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recentStartIso = recentStart.toISOString();
  const [accountRows, rawPositions, latestRank, recentSnapshots, tradingStats, dailySummaryRows] =
    await Promise.all([
      sql<PublicAgentAccountRow[]>`
        select
          initial_cash,
          available_cash,
          total_equity,
          display_equity,
          risk_tag
        from agent_accounts
        where agent_id = ${agentId}
        limit 1
      `,
      listPublicAgentPositionsFromDatabase(agentId),
      getPublicLeaderboardEntryFromDatabase(agentId),
      sql<
        {
          ts: string | Date | null;
          equity: number | null;
          return_rate: number | null;
        }[]
      >`
        select ts, equity, return_rate
        from account_snapshots
        where agent_id = ${agentId}
          and ts >= ${recentStartIso}
        order by ts desc
        limit 96
      `,
      getPublicAgentTradingStatsFromDatabase(agentId, recentStart),
      sql<
        {
          summary_date: string;
          summary: string;
          updated_at: string | Date | null;
        }[]
      >`
        select summary_date, summary, updated_at
        from agent_daily_summaries
        where agent_id = ${agentId}
        order by summary_date desc, updated_at desc
        limit 1
      `,
    ]);
  const positions = rawPositions ?? [];

  const account = accountRows[0] ?? null;
  const initialCash = account?.initial_cash ?? INITIAL_CAPITAL;
  const availableCash = account?.available_cash ?? initialCash;
  const totalMarketValue = positions.reduce(
    (sum, item) => sum + (item.marketValue ?? 0),
    0
  );
  const liveEquity = Math.round((availableCash + totalMarketValue) * 100) / 100;
  const totalEquity = liveEquity;
  const displayEquity = liveEquity;
  const metrics = buildAccountPerformanceMetrics({
    initialCash,
    availableCash,
    totalEquity,
    displayEquity,
    riskTag: getRiskTagForAccount(availableCash, totalEquity),
  });
  const marketBreakdown = positions.reduce(
    (acc, row) => {
      acc[row.market] = (acc[row.market] ?? 0) + (row.marketValue ?? 0);
      return acc;
    },
    {} as Record<string, number>
  );
  const topMarket =
    Object.entries(marketBreakdown).sort((left, right) => right[1] - left[1])[0]?.[0] ??
    null;
  const latestRecent = recentSnapshots[0] ?? null;
  const oldestRecent = recentSnapshots[recentSnapshots.length - 1] ?? null;
  const dailyReturn =
    latestRecent?.equity != null &&
    oldestRecent?.equity != null &&
    Math.max(oldestRecent.equity, 1) > 0
      ? Math.round(
          ((latestRecent.equity - oldestRecent.equity) /
            Math.max(oldestRecent.equity, 1)) *
            10000
        ) / 100
      : null;
  const dateLocale = locale.startsWith('zh') ? 'zh-CN' : 'en-US';
  const formatter = new Intl.DateTimeFormat(dateLocale, {
    timeZone,
    dateStyle: 'medium',
  });
  const summaryDate = formatter.format(now);
  const latestDailySummary = dailySummaryRows[0] ?? null;

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      avatarUrl: agent.avatarUrl,
      xUrl: agent.xUrl,
      modelName: agent.modelName,
      primaryMarket: agent.primaryMarket,
      marketPreferences: agent.marketPreferences,
      status: agent.status,
      lastHeartbeatAt: agent.lastHeartbeatAt,
      createdAt: agent.createdAt,
    },
    performance: {
      rank: latestRank?.rank ?? null,
      topTier: latestRank?.topTier ?? null,
      totalEquity: metrics.totalEquity,
      displayEquity: metrics.displayEquity,
      returnRate: metrics.returnRate,
      displayReturnRate: metrics.displayReturnRate,
      drawdown: latestRank?.drawdown ?? null,
      snapshotAt: latestRank?.snapshotAt ?? null,
      riskTag: metrics.riskTag,
      riskMode: metrics.riskMode,
      closeOnly: metrics.closeOnly,
    },
    positionsOverview: {
      openPositions: positions.length,
      grossMarketValue: Math.round(totalMarketValue * 100) / 100,
      unrealizedPnl:
        Math.round(
          positions.reduce((sum, item) => sum + (item.unrealizedPnl ?? 0), 0) * 100
        ) / 100,
    },
    dailySummary: {
      period: latestDailySummary?.summary_date ?? 'last_24h',
      timeZone,
      summary:
        latestDailySummary?.summary ??
        buildPublicDailySummary({
          locale,
          summaryDate,
          dailyReturn,
          recentTradesCount: tradingStats.recentTradesCount,
          buyCount: tradingStats.buyCount,
          sellCount: tradingStats.sellCount,
          recentTradeNotional: tradingStats.recentTradeNotional,
          openPositions: positions.length,
          topMarket,
          grossMarketValue: totalMarketValue,
          riskTag: metrics.riskTag,
        }),
    },
  };
}

export async function listPublicAgentPositionsFromDatabase(agentId: string) {
  const agent = await getClaimedPublicAgentFromDatabase(agentId);
  if (!agent) {
    return null;
  }

  const sql = getSqlClient();
  const rows = await sql<PublicPositionRow[]>`
    select
      p.id,
      p.symbol,
      p.market,
      p.event_id,
      p.outcome_id,
      p.outcome_name,
      p.position_size,
      p.entry_price as avg_price,
      coalesce(latest_quote.last_price, nullif(p.market_price, 0), p.entry_price, 0) as market_price,
      coalesce(latest_quote.last_price, nullif(p.market_price, 0), p.entry_price, 0) * coalesce(p.position_size, 0) as market_value,
      (
        coalesce(latest_quote.last_price, nullif(p.market_price, 0), p.entry_price, 0) -
        coalesce(p.entry_price, 0)
      ) * coalesce(p.position_size, 0) as unrealized_pnl,
      p.updated_at
    from positions p
    inner join agents a on a.id = p.agent_id
    left join lateral (
      select mds.last_price
      from market_data_snapshots mds
      left join market_instruments mi on mi.id = mds.instrument_id
      where (
        coalesce(p.outcome_id, '') <> '' and
        mds.instrument_id = p.symbol || '::' || p.outcome_id
      ) or (
        coalesce(p.outcome_id, '') = '' and (
          (mi.symbol = p.symbol and mi.market = p.market) or
          mds.instrument_id = p.symbol
        )
      )
      order by mds.quote_ts desc
      limit 1
    ) latest_quote on true
    where p.agent_id = ${agentId}
      and a.claim_status = 'claimed'
    order by p.symbol asc
  `;

  return rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    market: row.market,
    eventId: row.event_id,
    outcomeId: row.outcome_id,
    outcomeName: row.outcome_name,
    positionSize: row.position_size ?? 0,
    avgPrice: row.avg_price,
    marketPrice: row.market_price,
    marketValue: row.market_value,
    unrealizedPnl: row.unrealized_pnl,
    updatedAt: toIsoString(row.updated_at),
  }));
}

export async function listPublicAgentTradesFromDatabase(input: {
  agentId: string;
  page: number;
  pageSize: number;
  includeTotal?: boolean;
}) {
  await ensureTradeExecutionQuoteSourceColumn();
  const agent = await getClaimedPublicAgentFromDatabase(input.agentId);
  if (!agent) {
    return null;
  }

  const sql = getSqlClient();
  const offset = (input.page - 1) * input.pageSize;
  const totalRowsPromise = input.includeTotal === false
    ? Promise.resolve([{ count: 0 }])
    : sql<{ count: string | number }[]>`
      select count(*) as count
      from trade_executions te
      inner join decision_actions da on da.id = te.action_id
      inner join decision_submissions ds on ds.id = da.submission_id
      inner join agents a on a.id = ds.agent_id
      where ds.agent_id = ${input.agentId}
        and a.claim_status = 'claimed'
        and da.status in ('filled', 'partial')
    `;
  const [totalRows, rows] = await Promise.all([
    totalRowsPromise,
    sql<PublicTradeRow[]>`
      select
        te.id as execution_id,
        da.symbol,
        da.side,
        da.market,
        da.event_id,
        da.outcome_id,
        da.outcome_name,
        da.reason_tag,
        da.display_rationale,
        te.filled_units,
        te.fill_price,
        te.quote_source,
        te.execution_method,
        te.fee,
        te.executed_at
      from trade_executions te
      inner join decision_actions da on da.id = te.action_id
      inner join decision_submissions ds on ds.id = da.submission_id
      inner join agents a on a.id = ds.agent_id
      where ds.agent_id = ${input.agentId}
        and a.claim_status = 'claimed'
        and da.status in ('filled', 'partial')
      order by te.executed_at desc
      limit ${input.pageSize}
      offset ${offset}
    `,
  ]);

  const total = input.includeTotal === false ? 0 : Number(totalRows[0]?.count ?? 0);

  return {
    items: rows.map((row) => ({
      executionId: row.execution_id,
      symbol: row.symbol,
      side: row.side.toLowerCase(),
      market: row.market,
      eventId: row.event_id,
      outcomeId: row.outcome_id,
      outcomeName: row.outcome_name,
      reasonTag: row.reason_tag,
      displayRationale: row.display_rationale,
      filledUnits: row.filled_units,
      fillPrice: row.fill_price,
      executionPath: buildExecutionPath(row.quote_source, row.execution_method),
      fee: row.fee,
      executedAt: toIsoString(row.executed_at),
    })),
    meta: {
      total,
      page: input.page,
      pageSize: input.pageSize,
      totalPages: input.includeTotal === false ? 0 : Math.ceil(total / input.pageSize),
    },
  };
}

export async function getPublicAgentEquityFromDatabase(input: {
  agentId: string;
  range: string;
}) {
  const agent = await getClaimedPublicAgentFromDatabase(input.agentId);
  if (!agent) {
    return null;
  }

  const sql = getSqlClient();
  const duration = RANGE_MAP_MS[input.range];
  const cutoff = duration ? new Date(Date.now() - duration) : null;
  const cutoffIso = cutoff?.toISOString() ?? null;
  const rows = cutoff
    ? await sql<
        {
          ts: string | Date | null;
          equity: number | null;
          drawdown: number | null;
          return_rate: number | null;
        }[]
      >`
        select ts, equity, drawdown, return_rate
        from account_snapshots
        where agent_id = ${input.agentId}
          and ts >= ${cutoffIso}
        order by ts asc
      `
    : await sql<
        {
          ts: string | Date | null;
          equity: number | null;
          drawdown: number | null;
          return_rate: number | null;
        }[]
      >`
        select ts, equity, drawdown, return_rate
        from account_snapshots
        where agent_id = ${input.agentId}
        order by ts asc
      `;

  if (!rows.length) {
    const marked = await refreshDisplayEquity(input.agentId);
    const totalReturn =
      marked.initialCash > 0
        ? Math.round(((marked.displayEquity - marked.initialCash) / marked.initialCash) * 10000) / 100
        : 0;
    return {
      series: [],
      stats: {
        currentEquity: marked.displayEquity,
        maxDrawdown: 0,
        totalReturn,
        dataPoints: 0,
      },
    };
  }

  const marked = await refreshDisplayEquity(input.agentId);
  const liveReturn =
    marked.initialCash > 0
      ? Math.round(((marked.displayEquity - marked.initialCash) / marked.initialCash) * 10000) / 100
      : 0;
  const historicalPeak = Math.max(
    marked.displayEquity,
    ...rows.map((row) => row.equity ?? marked.displayEquity)
  );
  const liveDrawdown =
    historicalPeak > 0
      ? Math.round(((marked.displayEquity - historicalPeak) / historicalPeak) * 10000) / 100
      : 0;
  const lastRow = rows[rows.length - 1] ?? null;
  const seriesRows =
    (lastRow?.equity ?? null) !== marked.displayEquity
      ? [
          ...rows,
          {
            ts: new Date().toISOString(),
            equity: marked.displayEquity,
            drawdown: liveDrawdown,
            return_rate: liveReturn,
          },
        ]
      : rows;

  const series = seriesRows.map((row) => ({
    ts: toIsoString(row.ts),
    equity: row.equity ?? 0,
    drawdown: row.drawdown ?? 0,
    returnRate: row.return_rate ?? 0,
  }));

  return {
    series,
    stats: {
      currentEquity: marked.displayEquity,
      maxDrawdown: Math.min(...series.map((item) => item.drawdown)),
      totalReturn: liveReturn,
      dataPoints: series.length,
    },
  };
}

async function getPublicAgentTradingStatsFromDatabase(
  agentId: string,
  recentStart: Date
) {
  const sql = getSqlClient();
  const recentStartIso = recentStart.toISOString();
  const rows = await sql<
    {
      side: string;
      filled_units: number | null;
      fill_price: number | null;
    }[]
  >`
    select
      da.side,
      te.filled_units,
      te.fill_price
    from trade_executions te
    inner join decision_actions da on da.id = te.action_id
    inner join decision_submissions ds on ds.id = da.submission_id
    inner join agents a on a.id = ds.agent_id
    where ds.agent_id = ${agentId}
      and a.claim_status = 'claimed'
      and da.status in ('filled', 'partial')
      and te.executed_at >= ${recentStartIso}
    order by te.executed_at desc
    limit 200
  `;

  let buyCount = 0;
  let sellCount = 0;
  let recentTradeNotional = 0;
  for (const row of rows) {
    if (row.side === 'buy') buyCount += 1;
    if (row.side === 'sell') sellCount += 1;
    recentTradeNotional += (row.filled_units ?? 0) * (row.fill_price ?? 0);
  }

  return {
    recentTradesCount: rows.length,
    buyCount,
    sellCount,
    recentTradeNotional,
  };
}

function parseStringArray(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // Ignore invalid JSON and fall back below.
  }

  return value ? [value] : [];
}

function toIsoString(value: string | Date | null | undefined) {
  return normalizeTimestampToIsoString(value);
}

function buildPublicDailySummary(input: {
  locale: string;
  summaryDate: string;
  dailyReturn: number | null;
  recentTradesCount: number;
  buyCount: number;
  sellCount: number;
  recentTradeNotional: number;
  openPositions: number;
  topMarket: string | null;
  grossMarketValue: number;
  riskTag: string | null;
}) {
  if (input.locale.startsWith('zh')) {
    return buildChineseDailySummary(input);
  }

  return buildEnglishDailySummary(input);
}

function buildEnglishDailySummary(input: {
  summaryDate: string;
  dailyReturn: number | null;
  recentTradesCount: number;
  buyCount: number;
  sellCount: number;
  recentTradeNotional: number;
  openPositions: number;
  topMarket: string | null;
  grossMarketValue: number;
  riskTag: string | null;
}) {
  const parts: string[] = [];
  parts.push(`Daily summary for ${input.summaryDate}.`);

  if (input.dailyReturn == null) {
    parts.push('Not enough public equity data is available to calculate a full 24-hour return.');
  } else if (input.dailyReturn >= 0) {
    parts.push(`Public performance over the last 24 hours was positive at ${input.dailyReturn.toFixed(2)}%.`);
  } else {
    parts.push(`Public performance over the last 24 hours was ${input.dailyReturn.toFixed(2)}%.`);
  }

  if (input.recentTradesCount > 0) {
    parts.push(
      `The agent executed ${input.recentTradesCount} public trades in the last 24 hours (${input.buyCount} buys, ${input.sellCount} sells), with about $${Math.round(input.recentTradeNotional).toLocaleString()} in filled notional.`
    );
  } else {
    parts.push('No public trades were recorded in the last 24 hours.');
  }

  if (input.openPositions > 0) {
    const marketText = input.topMarket
      ? ` with the largest visible exposure in ${input.topMarket}`
      : '';
    parts.push(
      `It currently shows ${input.openPositions} open public positions and about $${Math.round(input.grossMarketValue).toLocaleString()} in gross visible exposure${marketText}.`
    );
  } else {
    parts.push('It currently has no open public positions.');
  }

  if (input.riskTag === 'close_only') {
    parts.push('The account is currently in close-only mode, so new buy actions are restricted.');
  } else if (input.riskTag === 'high_risk') {
    parts.push('The account is currently marked High Risk.');
  } else if (input.riskTag === 'terminated') {
    parts.push('The account is terminated.');
  }

  return parts.join(' ');
}

function buildChineseDailySummary(input: {
  summaryDate: string;
  dailyReturn: number | null;
  recentTradesCount: number;
  buyCount: number;
  sellCount: number;
  recentTradeNotional: number;
  openPositions: number;
  topMarket: string | null;
  grossMarketValue: number;
  riskTag: string | null;
}) {
  const parts: string[] = [];
  parts.push(`${input.summaryDate} 日报。`);

  if (input.dailyReturn == null) {
    parts.push('当前公开权益数据不足，暂时无法完整计算最近 24 小时收益率。');
  } else if (input.dailyReturn >= 0) {
    parts.push(`最近 24 小时公开表现为正，收益率约为 +${input.dailyReturn.toFixed(2)}%。`);
  } else {
    parts.push(`最近 24 小时公开表现为 ${input.dailyReturn.toFixed(2)}%。`);
  }

  if (input.recentTradesCount > 0) {
    parts.push(
      `最近 24 小时共有 ${input.recentTradesCount} 笔公开成交，其中买入 ${input.buyCount} 笔、卖出 ${input.sellCount} 笔，累计成交名义金额约 $${Math.round(input.recentTradeNotional).toLocaleString('en-US')}。`
    );
  } else {
    parts.push('最近 24 小时没有公开成交记录。');
  }

  if (input.openPositions > 0) {
    const marketText = input.topMarket ? `，当前公开敞口主要集中在${translateMarketNameZh(input.topMarket)}` : '';
    parts.push(
      `当前共有 ${input.openPositions} 个公开持仓，公开总敞口约 $${Math.round(input.grossMarketValue).toLocaleString('en-US')}${marketText}。`
    );
  } else {
    parts.push('当前没有公开持仓。');
  }

  if (input.riskTag === 'close_only') {
    parts.push('账户当前处于仅平仓状态，新买入动作会被限制。');
  } else if (input.riskTag === 'high_risk') {
    parts.push('账户当前被标记为高风险。');
  } else if (input.riskTag === 'terminated') {
    parts.push('账户当前已终止。');
  }

  return parts.join('');
}

function translateMarketNameZh(value: string) {
  if (value === 'stock') return '美股';
  if (value === 'crypto') return '加密市场';
  if (value === 'prediction') return '预测市场';
  return value;
}
