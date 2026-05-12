import { buildAccountPerformanceMetrics, getRiskTagForAccount } from '@/lib/account-metrics';
import { buildExecutionPath } from '@/lib/execution-path';
import { getPublicLeaderboardEntryFromStore } from '@/lib/public-market-store';
import {
  buildPublicPositionView,
  getAgentAccount,
  getClaimedAgent,
  getPublicStore,
  getLiveEquity,
  roundToCents,
  toIsoString,
} from '@/lib/public-store-utils';
import { INITIAL_CAPITAL } from '@/lib/trading-rules';

const RANGE_MAP_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export async function getClaimedPublicAgentFromStore(agentId: string) {
  const store = getPublicStore();
  const agent = getClaimedAgent(store, agentId);
  if (!agent) {
    return null;
  }

  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    avatarUrl: agent.avatarUrl,
    xUrl: agent.xUrl ?? null,
    modelName: agent.modelName,
    primaryMarket: agent.primaryMarket,
    marketPreferences: agent.marketPreferences,
    status: agent.status,
    lastHeartbeatAt: agent.lastHeartbeatAt,
    createdAt: agent.createdAt,
  };
}

export async function buildPublicAgentSummaryFromStore(input: {
  agentId: string;
  locale: string;
  timeZone: string;
  now?: Date;
}) {
  const { agentId, locale, timeZone, now = new Date() } = input;
  const store = getPublicStore();
  const agent = getClaimedAgent(store, agentId);
  if (!agent) {
    return null;
  }

  const positions = listPublicAgentPositionsFromStoreInternal(store, agentId) ?? [];
  const account = getAgentAccount(store, agentId);
  const initialCash = account?.initialCash ?? INITIAL_CAPITAL;
  const { availableCash, grossMarketValue, totalEquity } = getLiveEquity(
    store,
    account,
    agentId
  );
  const latestRank = await getPublicLeaderboardEntryFromStore(agentId);
  const recentStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recentSnapshots = store.accountSnapshots
    .filter(
      (snapshot) =>
        snapshot.agentId === agentId &&
        new Date(snapshot.ts).getTime() >= recentStart.getTime()
    )
    .slice()
    .sort(
      (left, right) => new Date(right.ts).getTime() - new Date(left.ts).getTime()
    )
    .slice(0, 96);
  const tradingStats = getPublicAgentTradingStatsFromStore(store, agentId, recentStart);
  const latestDailySummary =
    store.agentDailySummaries
      .filter((summary) => summary.agentId === agentId)
      .slice()
      .sort((left, right) => {
        if (left.summaryDate !== right.summaryDate) {
          return right.summaryDate.localeCompare(left.summaryDate);
        }

        return (
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
      })[0] ?? null;

  const metrics = buildAccountPerformanceMetrics({
    initialCash,
    availableCash,
    totalEquity,
    displayEquity: totalEquity,
    riskTag: getRiskTagForAccount(availableCash, totalEquity),
  });
  const marketBreakdown = positions.reduce(
    (acc, position) => {
      acc[position.market] = (acc[position.market] ?? 0) + (position.marketValue ?? 0);
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
  const summaryDate = new Intl.DateTimeFormat(dateLocale, {
    timeZone,
    dateStyle: 'medium',
  }).format(now);

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      avatarUrl: agent.avatarUrl,
      xUrl: agent.xUrl ?? null,
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
      grossMarketValue,
      unrealizedPnl: roundToCents(
        positions.reduce((sum, position) => sum + (position.unrealizedPnl ?? 0), 0)
      ),
    },
    dailySummary: {
      period: latestDailySummary?.summaryDate ?? 'last_24h',
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
          grossMarketValue,
          riskTag: metrics.riskTag,
        }),
    },
  };
}

export async function listPublicAgentPositionsFromStore(agentId: string) {
  const store = getPublicStore();
  return listPublicAgentPositionsFromStoreInternal(store, agentId);
}

export async function listPublicAgentTradesFromStore(input: {
  agentId: string;
  page: number;
  pageSize: number;
  includeTotal?: boolean;
}) {
  const store = getPublicStore();
  const agent = getClaimedAgent(store, input.agentId);
  if (!agent) {
    return null;
  }

  const executions = store.tradeExecutions
    .map((execution) => {
      const action =
        store.decisionActions.find((item) => item.id === execution.actionId) ?? null;
      if (!action || !['filled', 'partial'].includes(action.status)) {
        return null;
      }

      const submission =
        store.decisionSubmissions.find(
          (item) =>
            item.id === action.submissionId && item.agentId === input.agentId
        ) ?? null;
      if (!submission) {
        return null;
      }

      return {
        executionId: execution.id,
        symbol: action.symbol,
        side: action.side,
        market: action.market,
        eventId: action.eventId,
        outcomeId: action.outcomeId,
        outcomeName: action.outcomeName,
        reasonTag: action.reasonTag,
        displayRationale: action.displayRationale,
        filledUnits: execution.filledUnits,
        fillPrice: execution.fillPrice,
        executionPath: buildExecutionPath(
          execution.quoteSource,
          execution.executionMethod
        ),
        fee: execution.fee,
        executedAt: execution.executedAt,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort(
      (left, right) =>
        new Date(right.executedAt).getTime() - new Date(left.executedAt).getTime()
    );

  const start = (input.page - 1) * input.pageSize;
  const items = executions.slice(start, start + input.pageSize);

  return {
    items,
    meta: {
      total: input.includeTotal === false ? 0 : executions.length,
      page: input.page,
      pageSize: input.pageSize,
      totalPages:
        input.includeTotal === false ? 0 : Math.ceil(executions.length / input.pageSize),
    },
  };
}

export async function getPublicAgentEquityFromStore(input: {
  agentId: string;
  range: string;
}) {
  const store = getPublicStore();
  const agent = getClaimedAgent(store, input.agentId);
  if (!agent) {
    return null;
  }

  const duration = RANGE_MAP_MS[input.range];
  const cutoff = duration ? Date.now() - duration : null;
  const account = getAgentAccount(store, input.agentId);
  const initialCash = account?.initialCash ?? INITIAL_CAPITAL;
  const currentValues = getLiveEquity(store, account, input.agentId);

  const rows = store.accountSnapshots
    .filter(
      (snapshot) =>
        snapshot.agentId === input.agentId &&
        (cutoff == null || new Date(snapshot.ts).getTime() >= cutoff)
    )
    .slice()
    .sort(
      (left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime()
    );

  if (!rows.length) {
    const totalReturn =
      initialCash > 0
        ? roundToCents(
            ((currentValues.totalEquity - initialCash) / initialCash) * 100
          )
        : 0;

    return {
      series: [],
      stats: {
        currentEquity: currentValues.totalEquity,
        maxDrawdown: 0,
        totalReturn,
        dataPoints: 0,
      },
    };
  }

  const liveReturn =
    initialCash > 0
      ? roundToCents(
          ((currentValues.totalEquity - initialCash) / initialCash) * 100
        )
      : 0;
  const historicalPeak = Math.max(
    currentValues.totalEquity,
    ...rows.map((row) => row.equity ?? currentValues.totalEquity)
  );
  const liveDrawdown =
    historicalPeak > 0
      ? roundToCents(
          ((currentValues.totalEquity - historicalPeak) / historicalPeak) * 100
        )
      : 0;
  const lastRow = rows[rows.length - 1] ?? null;
  const seriesRows =
    (lastRow?.equity ?? null) !== currentValues.totalEquity
      ? [
          ...rows,
          {
            ts: new Date().toISOString(),
            equity: currentValues.totalEquity,
            drawdown: liveDrawdown,
            returnRate: liveReturn,
          },
        ]
      : rows;

  const series = seriesRows.map((row) => ({
    ts: toIsoString(row.ts),
    equity: row.equity ?? 0,
    drawdown: row.drawdown ?? 0,
    returnRate: row.returnRate ?? 0,
  }));

  return {
    series,
    stats: {
      currentEquity: currentValues.totalEquity,
      maxDrawdown: Math.min(...series.map((item) => item.drawdown)),
      totalReturn: liveReturn,
      dataPoints: series.length,
    },
  };
}

export async function getPublicAgentSnapshotAuditFromStore(agentId: string) {
  const store = getPublicStore();
  const agent = getClaimedAgent(store, agentId);
  if (!agent) {
    return null;
  }

  const snapshot =
    store.accountSnapshots
      .filter((item) => item.agentId === agentId)
      .slice()
      .sort((left, right) => {
        if (left.drawdown !== right.drawdown) {
          return left.drawdown - right.drawdown;
        }
        return new Date(right.ts).getTime() - new Date(left.ts).getTime();
      })[0] ?? null;

  if (!snapshot) {
    return {
      snapshot: null,
      positions: [],
      coverage: 'none' as const,
    };
  }

  return {
    snapshot: {
      id: snapshot.id,
      ts: snapshot.ts,
      cash: snapshot.cash,
      equity: snapshot.equity,
      drawdown: snapshot.drawdown,
      returnRate: snapshot.returnRate,
    },
    positions: [],
    coverage: 'aggregate_only' as const,
  };
}

function listPublicAgentPositionsFromStoreInternal(
  store: ReturnType<typeof getPublicStore>,
  agentId: string
) {
  const agent = getClaimedAgent(store, agentId);
  if (!agent) {
    return null;
  }

  return store.positions
    .filter((position) => position.agentId === agentId)
    .slice()
    .sort((left, right) => left.symbol.localeCompare(right.symbol))
    .map((position) => buildPublicPositionView(store, position));
}

function getPublicAgentTradingStatsFromStore(
  store: ReturnType<typeof getPublicStore>,
  agentId: string,
  recentStart: Date
) {
  const submissionIds = new Set(
    store.decisionSubmissions
      .filter((submission) => submission.agentId === agentId)
      .map((submission) => submission.id)
  );
  const recentExecutions = store.tradeExecutions
    .map((execution) => {
      const action =
        store.decisionActions.find(
          (item) =>
            item.id === execution.actionId &&
            submissionIds.has(item.submissionId) &&
            ['filled', 'partial'].includes(item.status)
        ) ?? null;
      if (!action) {
        return null;
      }
      if (new Date(execution.executedAt).getTime() < recentStart.getTime()) {
        return null;
      }

      return {
        side: action.side,
        filledUnits: execution.filledUnits,
        fillPrice: execution.fillPrice,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  let buyCount = 0;
  let sellCount = 0;
  let recentTradeNotional = 0;

  for (const execution of recentExecutions) {
    if (execution.side === 'buy') buyCount += 1;
    if (execution.side === 'sell') sellCount += 1;
    recentTradeNotional += execution.filledUnits * execution.fillPrice;
  }

  return {
    recentTradesCount: recentExecutions.length,
    buyCount,
    sellCount,
    recentTradeNotional,
  };
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
    parts.push(
      'Not enough public equity data is available to calculate a full 24-hour return.'
    );
  } else if (input.dailyReturn >= 0) {
    parts.push(
      `Public performance over the last 24 hours was positive at ${input.dailyReturn.toFixed(2)}%.`
    );
  } else {
    parts.push(
      `Public performance over the last 24 hours was ${input.dailyReturn.toFixed(2)}%.`
    );
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
    parts.push(
      'The account is currently in close-only mode, so new buy actions are restricted.'
    );
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
    const marketText = input.topMarket
      ? `，当前公开敞口主要集中在${translateMarketNameZh(input.topMarket)}`
      : '';
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
