import { getRiskMode, getRiskTagForAccount } from '@/lib/account-metrics';
import { buildExecutionPath } from '@/lib/execution-path';
import {
  buildPublicPositionView,
  formatDateInTimeZone,
  getAgentAccount,
  getClaimedAgents,
  getLatestLeaderboardSnapshots,
  getLatestMarketSnapshot,
  getPublicStore,
  roundToCents,
  toIsoString,
} from '@/lib/public-store-utils';
import { INITIAL_CAPITAL } from '@/lib/trading-rules';

type LeaderboardStoreRow = {
  snapshot: {
    agentId: string;
    competitionId: string;
    rank: number;
    returnRate: number;
    equityValue: number;
    change24h: number;
    drawdown: number;
    modelName: string | null;
    topTier: 'top_3' | 'top_10' | 'normal';
    rankChange24h: number;
    snapshotAt: string;
  };
  agent: {
    id: string;
    name: string;
    avatarUrl: string | null;
    modelName: string | null;
  };
  account: {
    availableCash: number;
    riskTag: 'high_risk' | 'close_only' | 'terminated' | null;
  } | null;
};

type PublicTopTier = 'top_3' | 'top_10' | 'normal';

export async function getPublicStatsFromStore() {
  const store = getPublicStore();
  const claimedAgents = getClaimedAgents(store);
  const claimedIds = new Set(claimedAgents.map((agent) => agent.id));
  const claimedAccounts = store.agentAccounts.filter((account) =>
    claimedIds.has(account.agentId)
  );
  const capitalTracked = claimedAccounts.reduce(
    (sum, account) =>
      sum +
      (account.displayEquity ?? account.totalEquity ?? account.initialCash ?? 0),
    0
  );
  const winners = claimedAccounts.filter(
    (account) =>
      (account.displayEquity ?? account.totalEquity ?? account.initialCash ?? 0) >
      account.initialCash
  ).length;

  return {
    agents: claimedAgents.length,
    capitalTracked: roundToCents(capitalTracked),
    winRate: claimedAccounts.length
      ? Math.round((winners / claimedAccounts.length) * 1000) / 10
      : 0,
    trackedAccounts: claimedAccounts.length,
  };
}

export async function getPublicLeaderboardFromStore(input: {
  page: number;
  pageSize: number;
}) {
  const rows = queryLatestPublicLeaderboardRowsFromStore();
  const start = (input.page - 1) * input.pageSize;
  const pageItems = rows.slice(start, start + input.pageSize);

  return {
    items: pageItems.map(mapLeaderboardRow),
    snapshotAt: rows[0]?.snapshot.snapshotAt ?? null,
    competitionId: rows[0]?.snapshot.competitionId ?? null,
    total: rows.length,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(rows.length / input.pageSize),
  };
}

export async function getPublicLeaderboardEntryFromStore(agentId: string) {
  const row =
    queryLatestPublicLeaderboardRowsFromStore().find(
      (item) => item.snapshot.agentId === agentId
    ) ?? null;
  if (!row) {
    return null;
  }

  const mapped = mapLeaderboardRow(row);
  return {
    rank: mapped.rank,
    agentId: mapped.agentId,
    competitionId: row.snapshot.competitionId,
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

export async function getPublicLiveTradesFromStore(input: {
  page: number;
  pageSize: number;
}) {
  const store = getPublicStore();
  const claimedAgents = new Map(
    getClaimedAgents(store).map((agent) => [agent.id, agent])
  );
  const actions = new Map(
    store.decisionActions.map((action) => [action.id, action])
  );
  const executions = new Map(
    store.tradeExecutions.map((execution) => [execution.actionId, execution])
  );

  const allItems = store.liveTradeEvents
    .filter((event) => claimedAgents.has(event.agentId))
    .slice()
    .sort(
      (left, right) =>
        new Date(right.executedAt).getTime() -
        new Date(left.executedAt).getTime()
    )
    .map((event) => {
      const agent = claimedAgents.get(event.agentId)!;
      const action = actions.get(event.actionId) ?? null;
      const execution = executions.get(event.actionId) ?? null;
      const account = getAgentAccount(store, event.agentId);

      return {
        id: event.id,
        agentId: event.agentId,
        agentName: agent.name,
        agentAvatar: agent.avatarUrl,
        symbol: event.symbol,
        market: action?.market ?? null,
        side: event.side,
        notionalUsd: event.notionalUsd,
        fillPrice: execution?.fillPrice ?? null,
        executionPath: buildExecutionPath(
          execution?.quoteSource,
          execution?.executionMethod
        ),
        positionRatio: event.positionRatio,
        outcomeName: event.outcomeName,
        reasonTag: event.reasonTag,
        displayRationale: event.displayRationale,
        riskTag: account?.riskTag ?? null,
        closeOnly: account?.riskTag === 'close_only',
        rankSnapshot: event.rankSnapshot,
        topTier: topTierFromRankSnapshot(event.rankSnapshot),
        executedAt: event.executedAt,
      };
    });

  const start = (input.page - 1) * input.pageSize;
  const items = allItems.slice(start, start + input.pageSize);

  return {
    items,
    total: allItems.length,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(allItems.length / input.pageSize),
  };
}

export async function getPublicHomeOverviewFromStore() {
  const store = getPublicStore();
  const now = new Date();
  const startOfLast24Hours = now.getTime() - 24 * 60 * 60 * 1000;
  const claimedAgents = new Map(
    getClaimedAgents(store).map((agent) => [agent.id, agent])
  );
  const actions = new Map(
    store.decisionActions.map((action) => [action.id, action])
  );
  const executions = new Map(
    store.tradeExecutions.map((execution) => [execution.actionId, execution])
  );
  const submissions = new Map(
    store.decisionSubmissions.map((submission) => [submission.id, submission])
  );
  const leaderboardEntries = new Map(
    queryLatestPublicLeaderboardRowsFromStore().map((row) => [
      row.snapshot.agentId,
      row.snapshot.rank,
    ])
  );

  const biggestTrade = store.liveTradeEvents
    .filter(
      (event) =>
        claimedAgents.has(event.agentId) &&
        event.notionalUsd > 0 &&
        new Date(event.executedAt).getTime() > startOfLast24Hours
    )
    .slice()
    .sort((left, right) => {
      if (right.notionalUsd !== left.notionalUsd) {
        return right.notionalUsd - left.notionalUsd;
      }

      return (
        new Date(right.executedAt).getTime() - new Date(left.executedAt).getTime()
      );
    })[0];

  const largestPosition = store.positions
    .filter(
      (position) =>
        claimedAgents.has(position.agentId) &&
        position.positionSize > 0 &&
        new Date(position.updatedAt).getTime() > startOfLast24Hours
    )
    .map((position) => {
      const view = buildPublicPositionView(store, position);
      const agent = claimedAgents.get(position.agentId)!;

      return {
        agentId: position.agentId,
        agentName: agent.name,
        symbol: position.symbol,
        market: position.market,
        outcomeName: position.outcomeName,
        positionSize: view.positionSize,
        entryPrice: view.avgPrice,
        marketPrice: view.marketPrice,
        marketValue: view.marketValue ?? 0,
      };
    })
    .sort((left, right) => right.marketValue - left.marketValue)[0] ?? null;

  const callRows = store.tradeExecutions
    .map((execution) => {
      const action = actions.get(execution.actionId);
      if (!action) return null;
      const submission = submissions.get(action.submissionId);
      if (!submission) return null;
      const agent = claimedAgents.get(submission.agentId);
      if (!agent) return null;
      if (!['filled', 'partial'].includes(action.status)) return null;
      if (!(execution.filledUnits > 0) || !(execution.fillPrice > 0)) return null;

      const latestQuote = getLatestMarketSnapshot(store, {
        symbol: action.symbol,
        market: action.market,
        outcomeId: action.outcomeId,
      });
      const matchedPosition =
        store.positions.find(
          (position) =>
            position.agentId === submission.agentId &&
            position.symbol === action.symbol &&
            position.market === action.market &&
            (position.eventId ?? '') === (action.eventId ?? '') &&
            (position.outcomeId ?? '') === (action.outcomeId ?? '')
        ) ?? null;
      const markPrice =
        latestQuote?.lastPrice ??
        matchedPosition?.marketPrice ??
        matchedPosition?.entryPrice ??
        execution.fillPrice;
      const callPnlUsd =
        action.side === 'buy'
          ? execution.filledUnits * (markPrice - execution.fillPrice) -
            execution.fee
          : execution.filledUnits * (execution.fillPrice - markPrice) -
            execution.fee;

      return {
        agentId: submission.agentId,
        agentName: agent.name,
        agentAvatar: agent.avatarUrl,
        symbol: action.symbol,
        market: action.market,
        side: action.side,
        outcomeName: action.outcomeName,
        reasonTag: action.reasonTag,
        displayRationale: action.displayRationale,
        filledUnits: execution.filledUnits,
        fillPrice: execution.fillPrice,
        markPrice,
        callPnlUsd,
        currentRank: leaderboardEntries.get(submission.agentId) ?? null,
        executedAt: execution.executedAt,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const bestCall =
    callRows.slice().sort((left, right) => right.callPnlUsd - left.callPnlUsd)[0] ??
    null;
  const worstCall =
    callRows.slice().sort((left, right) => left.callPnlUsd - right.callPnlUsd)[0] ??
    null;

  const currentNyDate = formatDateInTimeZone(now, 'America/New_York');
  const tradesToday = store.liveTradeEvents.filter(
    (event) =>
      claimedAgents.has(event.agentId) &&
      formatDateInTimeZone(event.executedAt, 'America/New_York') === currentNyDate
  ).length;

  return {
    tradesToday,
    bestCall,
    worstCall,
    biggestTrade: biggestTrade
      ? {
          id: biggestTrade.id,
          agentId: biggestTrade.agentId,
          agentName: claimedAgents.get(biggestTrade.agentId)?.name ?? 'Unknown',
          agentAvatar: claimedAgents.get(biggestTrade.agentId)?.avatarUrl ?? null,
          symbol: biggestTrade.symbol,
          market: actions.get(biggestTrade.actionId)?.market ?? null,
          side: biggestTrade.side,
          notionalUsd: biggestTrade.notionalUsd,
          fillPrice: executions.get(biggestTrade.actionId)?.fillPrice ?? null,
          executionPath: buildExecutionPath(
            executions.get(biggestTrade.actionId)?.quoteSource,
            executions.get(biggestTrade.actionId)?.executionMethod
          ),
          positionRatio: biggestTrade.positionRatio,
          outcomeName: biggestTrade.outcomeName,
          reasonTag: biggestTrade.reasonTag,
          displayRationale: biggestTrade.displayRationale,
          rankSnapshot: biggestTrade.rankSnapshot,
          topTier: topTierFromRankSnapshot(biggestTrade.rankSnapshot),
          executedAt: biggestTrade.executedAt,
        }
      : null,
    largestPosition,
  };
}

function queryLatestPublicLeaderboardRowsFromStore(): LeaderboardStoreRow[] {
  const store = getPublicStore();
  return getLatestLeaderboardSnapshots(store)
    .flatMap<LeaderboardStoreRow>((snapshot) => {
      const agent = store.agents.find((item) => item.id === snapshot.agentId);
      if (!agent || agent.claimStatus !== 'claimed') {
        return [];
      }

      const account = getAgentAccount(store, snapshot.agentId);

      return [{
        snapshot,
        agent: {
          id: agent.id,
          name: agent.name,
          avatarUrl: agent.avatarUrl,
          modelName: agent.modelName,
        },
        account: account
          ? {
              availableCash: account.availableCash,
              riskTag: account.riskTag,
            }
          : null,
      }];
    })
    .sort((left, right) => left.snapshot.rank - right.snapshot.rank);
}

function mapLeaderboardRow(row: LeaderboardStoreRow) {
  const equityValue = row.snapshot.equityValue ?? INITIAL_CAPITAL;
  const availableCash = row.account?.availableCash ?? INITIAL_CAPITAL;
  const computedRiskTag = getRiskTagForAccount(availableCash, equityValue);
  const riskTag =
    row.snapshot.drawdown <= -50
      ? 'high_risk'
      : computedRiskTag ?? row.account?.riskTag ?? null;

  return {
    rank: row.snapshot.rank,
    agentId: row.snapshot.agentId,
    agentName: row.agent.name,
    agentAvatar: row.agent.avatarUrl,
    returnRate: row.snapshot.returnRate ?? 0,
    equityValue,
    change24h: row.snapshot.change24h,
    drawdown: row.snapshot.drawdown,
    modelName: row.snapshot.modelName ?? row.agent.modelName,
    topTier: row.snapshot.topTier,
    rankChange24h: row.snapshot.rankChange24h ?? 0,
    riskTag,
    closeOnly:
      getRiskMode({
        riskTag,
        cash: availableCash,
        equity: equityValue,
      }) === 'close_only',
    snapshotAt: toIsoString(row.snapshot.snapshotAt),
  };
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
