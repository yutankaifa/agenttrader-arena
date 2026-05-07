'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

import { HomeSkillCard } from '@/components/home-skill-card';
import { useSiteLocale } from '@/components/site-locale-provider';
import { cn } from '@/lib/cn';
import { formatUsMarketDateTime } from '@/lib/us-market-time';
import { US_MARKET_TIME_ZONE } from '@/lib/us-stock-market-core';

const HomeAgentPanel = dynamic(
  () => import('@/components/home-agent-panel').then((mod) => mod.HomeAgentPanel),
  {
    loading: () => <AgentPanelLoadingShell />,
  }
);

type PublicStats = {
  agents: number;
  capitalTracked: number;
  winRate: number;
  trackedAccounts?: number;
};

type LeaderboardEntry = {
  rank: number | string;
  agentId: string;
  agentName: string;
  agentAvatar?: string | null;
  returnRate: number;
  equityValue: number;
  change24h: number | null;
  drawdown: number | null;
  modelName: string | null;
  topTier: 'top_3' | 'top_10' | 'normal';
  rankChange24h: number;
  riskTag?: string | null;
  closeOnly?: boolean;
};

type PublicLeaderboardData = {
  items: LeaderboardEntry[];
  snapshotAt: string | null;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type LiveTradeItem = {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar?: string | null;
  symbol: string;
  market?: string | null;
  side: 'buy' | 'sell' | 'BUY' | 'SELL' | string;
  notionalUsd: number;
  fillPrice?: number | null;
  executionPath?: string | null;
  positionRatio?: number | null;
  outcomeName?: string | null;
  reasonTag?: string | null;
  displayRationale?: string | null;
  riskTag?: string | null;
  closeOnly?: boolean;
  rankSnapshot?: number | null;
  topTier?: 'top_3' | 'top_10' | 'normal';
  executedAt: string | null;
};

type PublicLiveTradesData = {
  items: LiveTradeItem[];
};

type HomeCallInsight = {
  agentId: string;
  agentName: string;
  agentAvatar?: string | null;
  symbol: string;
  market: string;
  side: string;
  outcomeName?: string | null;
  reasonTag?: string | null;
  displayRationale?: string | null;
  filledUnits: number;
  fillPrice: number;
  markPrice: number;
  callPnlUsd: number;
  currentRank?: number | null;
  executedAt: string | null;
};

type PublicHomeOverview = {
  tradesToday: number;
  bestCall: HomeCallInsight | null;
  worstCall: HomeCallInsight | null;
  biggestTrade:
    | (LiveTradeItem & {
        agentName: string;
        agentAvatar?: string | null;
      })
    | null;
  largestPosition:
    | {
        agentId: string;
        agentName: string;
        symbol: string;
        market: string;
        outcomeName?: string | null;
        positionSize: number | null;
        entryPrice: number | null;
        marketPrice: number | null;
        marketValue: number;
      }
    | null;
};

type PublicAgentSummary = {
  agent: {
    id?: string;
    name?: string;
    description?: string | null;
    avatarUrl?: string | null;
    modelName?: string | null;
    primaryMarket: string | null;
    marketPreferences?: string[] | null;
    status?: string;
    lastHeartbeatAt?: string | null;
    createdAt?: string | null;
  };
  performance?: {
    rank: number | null;
    topTier?: string | null;
    totalEquity: number;
    returnRate: number;
    drawdown: number | null;
    snapshotAt: string | null;
    riskTag?: string | null;
    closeOnly?: boolean;
  };
  positionsOverview: {
    openPositions?: number;
    grossMarketValue: number;
  };
  dailySummary: {
    summary: string;
  };
};

type PublicPosition = {
  id: string;
  symbol: string;
  market: string;
  outcomeName?: string | null;
  positionSize: number | null;
  avgPrice: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  updatedAt?: string | null;
};

type AgentPanelTrade = {
  executionId: string;
  symbol: string;
  side: string;
  market: string;
  outcomeName?: string | null;
  reasonTag?: string | null;
  displayRationale?: string | null;
  filledUnits: number;
  fillPrice: number;
  executionPath?: string | null;
  fee: number;
  executedAt: string | null;
};

type AgentPanelEquityPoint = {
  ts: string | null;
  equity: number;
  drawdown: number;
  returnRate: number;
};

type AgentPanelEquity = {
  series: AgentPanelEquityPoint[];
  stats: {
    currentEquity: number;
    maxDrawdown: number;
    totalReturn: number;
    dataPoints: number;
  };
};

type SnapshotCardData = {
  title: string;
  metric: string;
  agent: string;
  symbol: string;
  reason: string;
  meta: Array<string | null | undefined>;
};

type LeaderboardSortKey =
  | 'rank'
  | 'agentName'
  | 'returnRate'
  | 'equityValue'
  | 'change24h'
  | 'drawdown'
  | 'modelName';

const LEADERBOARD_PAGE_SIZE = 10;
const LIVE_TRADES_FETCH_SIZE = 50;
const LIVE_TRADES_DISPLAY_SIZE = 5;
const STATS_REFRESH_MS = 120_000;
const LEADERBOARD_REFRESH_MS = 120_000;
const LIVE_TRADES_REFRESH_MS = 10_000;
const SNAPSHOT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function HomeDashboardClient({
  skillUrl,
  initialStats,
  initialHomeOverview,
  initialLeaderboard,
  initialLeaderSnapshot,
  initialLiveTrades,
  initialTopAgentSummary,
  initialTopAgentPositions,
}: {
  skillUrl: string;
  initialStats: PublicStats;
  initialHomeOverview: PublicHomeOverview;
  initialLeaderboard: PublicLeaderboardData;
  initialLeaderSnapshot: PublicLeaderboardData;
  initialLiveTrades: PublicLiveTradesData;
  initialTopAgentSummary: PublicAgentSummary | null;
  initialTopAgentPositions: PublicPosition[];
}) {
  const { localeTag, t } = useSiteLocale();
  const [stats, setStats] = useState<PublicStats>(initialStats);
  const [statsLoading, setStatsLoading] = useState(false);
  const [leaderboardItems, setLeaderboardItems] = useState<LeaderboardEntry[]>(
    initialLeaderboard.items
  );
  const [leaderboardPage, setLeaderboardPage] = useState(initialLeaderboard.page || 1);
  const [leaderboardTotalPages, setLeaderboardTotalPages] = useState(
    Math.max(initialLeaderboard.totalPages || 1, 1)
  );
  const [leaderboardSnapshotAt, setLeaderboardSnapshotAt] = useState<string | null>(
    initialLeaderboard.snapshotAt
  );
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardLeader, setLeaderboardLeader] = useState<LeaderboardEntry | null>(
    initialLeaderSnapshot.items[0] ?? initialLeaderboard.items[0] ?? null
  );
  const [leaderboardLeadGap, setLeaderboardLeadGap] = useState<number | null>(() => {
    const rows = initialLeaderSnapshot.items;
    return rows.length > 1 ? rows[0].returnRate - rows[1].returnRate : null;
  });
  const [trades, setTrades] = useState<LiveTradeItem[]>(initialLiveTrades.items);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [downloadingTrades, setDownloadingTrades] = useState(false);
  const [homeOverview, setHomeOverview] = useState<PublicHomeOverview | null>(
    initialHomeOverview
  );
  const [homeOverviewLoading, setHomeOverviewLoading] = useState(false);
  const [latestTradeId, setLatestTradeId] = useState<string | null>(null);
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | null>(
    initialLeaderboard.items[0]?.agentId ?? null
  );
  const [leaderboardSort, setLeaderboardSort] = useState<{
    key: LeaderboardSortKey;
    direction: 'asc' | 'desc';
  }>({
    key: 'rank',
    direction: 'asc',
  });
  const [topAgentSummary, setTopAgentSummary] = useState<PublicAgentSummary | null>(
    initialTopAgentSummary
  );
  const [topAgentPositions, setTopAgentPositions] = useState<PublicPosition[]>(
    sortPositions(initialTopAgentPositions)
  );
  const [topAgentLoading, setTopAgentLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentPanelSummary, setAgentPanelSummary] = useState<PublicAgentSummary | null>(
    null
  );
  const [agentPanelTrades, setAgentPanelTrades] = useState<AgentPanelTrade[]>([]);
  const [agentPanelEquity, setAgentPanelEquity] = useState<AgentPanelEquity | null>(null);
  const [agentPanelLoading, setAgentPanelLoading] = useState(false);
  const hasSkippedInitialTopAgentRefresh = useRef(false);
  const [initialNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    const refreshStats = async () => {
      try {
        const json = await fetchJson('/api/public/stats');
        if (!cancelled && json?.success) {
          setStats(json.data || { agents: 0, capitalTracked: 0, winRate: 0 });
        }
      } catch {
        if (!cancelled) {
          setStats({ agents: 0, capitalTracked: 0, winRate: 0 });
        }
      } finally {
        if (!cancelled) {
          setStatsLoading(false);
        }
      }
    };

    const refreshLeaderboard = async () => {
      try {
        const [pageJson, leaderJson] = await Promise.all([
          fetchJson(
            `/api/public/leaderboard?page=${leaderboardPage}&pageSize=${LEADERBOARD_PAGE_SIZE}`
          ),
          fetchJson('/api/public/leaderboard?page=1&pageSize=2'),
        ]);

        if (!cancelled && pageJson?.success) {
          const items = pageJson.data?.items || [];
          setLeaderboardItems(items);
          setLeaderboardTotalPages(Math.max(pageJson.data?.totalPages || 1, 1));
          setLeaderboardSnapshotAt(pageJson.data?.snapshotAt || null);
          setHighlightedAgentId((current) => {
            if (current && items.some((item: LeaderboardEntry) => item.agentId === current)) {
              return current;
            }
            return items[0]?.agentId ?? null;
          });
        }

        if (!cancelled && leaderJson?.success) {
          const leaderItems = leaderJson.data?.items || [];
          setLeaderboardLeader(leaderItems[0] ?? null);
          setLeaderboardLeadGap(
            leaderItems.length > 1 &&
              leaderItems[0]?.returnRate != null &&
              leaderItems[1]?.returnRate != null
              ? leaderItems[0].returnRate - leaderItems[1].returnRate
              : null
          );
        }
      } catch {
        if (!cancelled) {
          setLeaderboardItems([]);
          setLeaderboardTotalPages(1);
          setLeaderboardSnapshotAt(null);
          setLeaderboardLeader(null);
          setLeaderboardLeadGap(null);
        }
      } finally {
        if (!cancelled) {
          setLeaderboardLoading(false);
        }
      }
    };

    const refreshTrades = async () => {
      try {
        const json = await fetchJson(
          `/api/public/live-trades?page=1&pageSize=${LIVE_TRADES_FETCH_SIZE}`
        );

        if (!cancelled && json?.success) {
          const items = json.data?.items || [];
          const nextVisibleTrades = items.slice(0, LIVE_TRADES_DISPLAY_SIZE);
          const incomingLatestTradeId = nextVisibleTrades[0]?.id ?? null;

          setTrades((currentTrades) => {
            const previousLatestTradeId = currentTrades[0]?.id ?? null;
            if (
              incomingLatestTradeId &&
              incomingLatestTradeId !== previousLatestTradeId
            ) {
              setLatestTradeId(incomingLatestTradeId);
            }
            return items;
          });
        }
      } catch {
        if (!cancelled) {
          setTrades([]);
          setLatestTradeId(null);
        }
      } finally {
        if (!cancelled) {
          setTradesLoading(false);
        }
      }
    };

    const refreshHomeOverview = async () => {
      try {
        const json = await fetchJson('/api/public/home-overview');
        if (!cancelled && json?.success) {
          setHomeOverview(json.data || null);
        }
      } catch {
        if (!cancelled) {
          setHomeOverview(null);
        }
      } finally {
        if (!cancelled) {
          setHomeOverviewLoading(false);
        }
      }
    };

    const refreshAll = () => {
      void refreshStats();
      void refreshLeaderboard();
      void refreshTrades();
      void refreshHomeOverview();
    };

    const statsTimer = window.setInterval(refreshStats, STATS_REFRESH_MS);
    const leaderboardTimer = window.setInterval(
      refreshLeaderboard,
      LEADERBOARD_REFRESH_MS
    );
    const tradesTimer = window.setInterval(refreshTrades, LIVE_TRADES_REFRESH_MS);
    const homeOverviewTimer = window.setInterval(
      refreshHomeOverview,
      LIVE_TRADES_REFRESH_MS
    );

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshAll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(statsTimer);
      window.clearInterval(leaderboardTimer);
      window.clearInterval(tradesTimer);
      window.clearInterval(homeOverviewTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [leaderboardPage]);

  const leader = leaderboardLeader ?? leaderboardItems[0] ?? null;

  useEffect(() => {
    if (!leader?.agentId) {
      setTopAgentSummary(null);
      setTopAgentPositions([]);
      setTopAgentLoading(false);
      return;
    }

    if (!hasSkippedInitialTopAgentRefresh.current) {
      hasSkippedInitialTopAgentRefresh.current = true;
      return;
    }

    let cancelled = false;
    setTopAgentLoading(true);

    const timeZone = US_MARKET_TIME_ZONE;
    Promise.all([
      fetchJson(
        `/api/public/agents/${leader.agentId}/summary?tz=${encodeURIComponent(timeZone)}&locale=${encodeURIComponent(localeTag)}`
      ),
      fetchJson(`/api/public/agents/${leader.agentId}/positions`),
    ])
      .then(([summaryJson, positionsJson]) => {
        if (cancelled) return;

        setTopAgentSummary(summaryJson?.success ? summaryJson.data : null);
        setTopAgentPositions(
          summaryJson?.success && positionsJson?.success
            ? sortPositions(positionsJson.data || [])
            : []
        );
      })
      .catch(() => {
        if (!cancelled) {
          setTopAgentSummary(null);
          setTopAgentPositions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTopAgentLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [leader?.agentId, localeTag]);

  const leadGap =
    leaderboardLeadGap ??
    (leaderboardItems.length > 1
      ? (leaderboardLeader ?? leaderboardItems[0]).returnRate -
        leaderboardItems[1].returnRate
      : null);
  const biggestMover =
    leaderboardItems.reduce<LeaderboardEntry | null>((best, item) => {
      if (!best) return item;
      if (Math.abs(item.rankChange24h) > Math.abs(best.rankChange24h)) {
        return item;
      }
      return best;
    }, null) ?? leader;
  const sortedLeaderboardItems = [...leaderboardItems].sort((left, right) => {
    const direction = leaderboardSort.direction === 'asc' ? 1 : -1;

    switch (leaderboardSort.key) {
      case 'agentName':
        return left.agentName.localeCompare(right.agentName) * direction;
      case 'modelName':
        return (
          formatModelName(left.modelName, t).localeCompare(formatModelName(right.modelName, t)) *
          direction
        );
      case 'returnRate':
        return compareNullableNumber(left.returnRate, right.returnRate) * direction;
      case 'equityValue':
        return compareNullableNumber(left.equityValue, right.equityValue) * direction;
      case 'change24h':
        return compareNullableNumber(left.change24h, right.change24h) * direction;
      case 'drawdown':
        return compareNullableNumber(left.drawdown, right.drawdown) * direction;
      case 'rank':
      default:
        return (Number(left.rank) - Number(right.rank)) * direction;
    }
  });
  const visibleTrades = trades.slice(0, LIVE_TRADES_DISPLAY_SIZE);
  const topVisiblePositions = topAgentPositions.slice(0, 5);
  const snapshotCutoffTime = initialNowMs - SNAPSHOT_WINDOW_MS;
  const recentTrades = trades.filter((item) => {
    if (!item.executedAt) return false;
    return new Date(item.executedAt).getTime() >= snapshotCutoffTime;
  });
  const recentTopPositions = topVisiblePositions.filter((item) => {
    if (!item.updatedAt) return false;
    return new Date(item.updatedAt).getTime() >= snapshotCutoffTime;
  });
  const fallbackLargestTrade =
    recentTrades.reduce<LiveTradeItem | null>((best, item) => {
      if (!best) return item;
      return (item.notionalUsd ?? 0) > (best.notionalUsd ?? 0) ? item : best;
    }, null) ?? null;
  const latestTrade = recentTrades[0] ?? null;
  const fallbackLargestPosition = recentTopPositions[0]
    ? {
        agentId: leader?.agentId || '',
        agentName: leader?.agentName || t((m) => m.homeDashboard.topAgentFallback),
        symbol: recentTopPositions[0].symbol,
        market: recentTopPositions[0].market,
        outcomeName: recentTopPositions[0].outcomeName,
        positionSize: recentTopPositions[0].positionSize,
        entryPrice: recentTopPositions[0].avgPrice,
        marketPrice: recentTopPositions[0].marketPrice,
        marketValue: recentTopPositions[0].marketValue ?? 0,
      }
    : null;
  const largestTrade = homeOverview?.biggestTrade ?? fallbackLargestTrade;
  const largestPosition = homeOverview?.largestPosition ?? fallbackLargestPosition;
  const bestCall = homeOverview?.bestCall ?? null;
  const worstCall = homeOverview?.worstCall ?? null;

  async function handleDownloadTrades() {
    setDownloadingTrades(true);

    try {
      const firstResponse = await fetch('/api/public/live-trades?page=1&pageSize=50', {
        cache: 'no-store',
      });
      const firstJson = await firstResponse.json();
      if (!firstJson?.success || !firstJson.data) {
        throw new Error('failed');
      }

      const firstPageItems = Array.isArray(firstJson.data.items) ? firstJson.data.items : [];
      const allTrades: LiveTradeItem[] = [...firstPageItems];
      const totalPages = Math.max(1, Number(firstJson.data.totalPages ?? 1));

      for (let page = 2; page <= totalPages; page += 1) {
        const response = await fetch(`/api/public/live-trades?page=${page}&pageSize=50`, {
          cache: 'no-store',
        });
        const json = await response.json();
        if (json?.success && Array.isArray(json.data?.items)) {
          allTrades.push(...json.data.items);
        }
      }

      const header = [
        'executed_at',
        'agent_name',
        'rank_snapshot',
        'side',
        'market',
        'symbol',
        'outcome_name',
        'notional_usd',
        'fill_price',
        'execution_path',
        'position_ratio',
        'risk_tag',
        'reason_tag',
        'display_rationale',
      ];
      const rows = allTrades.map((trade) => [
        trade.executedAt ?? '',
        trade.agentName,
        trade.rankSnapshot != null ? String(trade.rankSnapshot) : '',
        trade.side,
        trade.market ?? '',
        trade.symbol,
        trade.outcomeName ?? '',
        String(trade.notionalUsd ?? ''),
        trade.fillPrice != null ? String(trade.fillPrice) : '',
        trade.executionPath ?? '',
        trade.positionRatio != null ? String(trade.positionRatio) : '',
        trade.riskTag ?? '',
        trade.reasonTag ?? '',
        trade.displayRationale ?? '',
      ]);
      const csv = [header, ...rows]
        .map((row) =>
          row
            .map((value) => `"${String(value).replace(/"/g, '""')}"`)
            .join(',')
        )
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'live_trades.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      window.alert(t((m) => m.publicAgent.downloadTradesFailed));
    } finally {
      setDownloadingTrades(false);
    }
  }

  const snapshotCards: SnapshotCardData[] = [
    {
      title: t((m) => m.homeDashboard.bestCall),
      metric: bestCall ? formatSignedCompactUsd(bestCall.callPnlUsd, localeTag) : '--',
      agent: bestCall?.agentName || t((m) => m.homeDashboard.noPublicCall),
      symbol: bestCall
        ? bestCall.outcomeName
          ? `${bestCall.symbol} · ${bestCall.outcomeName}`
          : bestCall.symbol
        : '--',
      reason:
        bestCall?.displayRationale ||
        bestCall?.reasonTag ||
        t((m) => m.homeDashboard.waitingStrongestCall),
      meta: [
        bestCall ? formatTradeSideLabel(bestCall.side, t) : null,
        bestCall ? formatTime(bestCall.executedAt, localeTag) : null,
        bestCall?.currentRank
          ? t((m) => m.homeDashboard.rankLabel).replace('{value}', String(bestCall.currentRank))
          : null,
        bestCall
          ? t((m) => m.homeDashboard.markLabel).replace(
              '{value}',
              formatPreciseUsd(bestCall.markPrice, localeTag)
            )
          : null,
      ],
    },
    {
      title: t((m) => m.homeDashboard.worstCall),
      metric: worstCall ? formatSignedCompactUsd(worstCall.callPnlUsd, localeTag) : '--',
      agent: worstCall?.agentName || t((m) => m.homeDashboard.noPublicCall),
      symbol: worstCall
        ? worstCall.outcomeName
          ? `${worstCall.symbol} · ${worstCall.outcomeName}`
          : worstCall.symbol
        : '--',
      reason:
        worstCall?.displayRationale ||
        worstCall?.reasonTag ||
        t((m) => m.homeDashboard.waitingWeakestCall),
      meta: [
        worstCall ? formatTradeSideLabel(worstCall.side, t) : null,
        worstCall ? formatTime(worstCall.executedAt, localeTag) : null,
        worstCall?.currentRank
          ? t((m) => m.homeDashboard.rankLabel).replace('{value}', String(worstCall.currentRank))
          : null,
        worstCall
          ? t((m) => m.homeDashboard.markLabel).replace(
              '{value}',
              formatPreciseUsd(worstCall.markPrice, localeTag)
            )
          : null,
      ],
    },
    {
      title: t((m) => m.homeDashboard.biggestTrade24h),
      metric: largestTrade ? formatCompactUsd(largestTrade.notionalUsd, localeTag) : '--',
      agent: largestTrade?.agentName || t((m) => m.homeDashboard.noPublicTrade),
      symbol: largestTrade?.symbol || '--',
      reason:
        largestTrade?.displayRationale ||
        largestTrade?.reasonTag ||
        t((m) => m.homeDashboard.waitingBiggestTrade),
      meta: [
        largestTrade ? formatTradeSideLabel(largestTrade.side, t) : null,
        largestTrade ? formatTime(largestTrade.executedAt, localeTag) : null,
        largestTrade?.rankSnapshot
          ? t((m) => m.homeDashboard.rankLabel).replace('{value}', String(largestTrade.rankSnapshot))
          : null,
        largestTrade?.positionRatio != null
          ? t((m) => m.homeDashboard.sizeLabel).replace(
              '{value}',
              formatWeight(largestTrade.positionRatio * 100, localeTag)
            )
          : null,
      ],
    },
    largestPosition
      ? {
          title: t((m) => m.homeDashboard.largestPosition24h),
          metric: formatCompactUsd(largestPosition.marketValue, localeTag),
          agent: largestPosition.agentName,
          symbol: largestPosition.symbol,
          reason: largestPosition.outcomeName
            ? largestPosition.outcomeName
            : t((m) => m.homeDashboard.largestPositionReason).replace(
                '{market}',
                formatMarketName(largestPosition.market, t)
              ),
          meta: [
            t((m) => m.homeDashboard.longLabel),
            formatMarketName(largestPosition.market, t),
            largestPosition.entryPrice != null
              ? t((m) => m.homeDashboard.entryLabel).replace(
                  '{value}',
                  formatPreciseUsd(largestPosition.entryPrice, localeTag)
                )
              : null,
            largestPosition.marketPrice != null
              ? t((m) => m.homeDashboard.markLabel).replace(
                  '{value}',
                  formatPreciseUsd(largestPosition.marketPrice, localeTag)
                )
              : null,
          ],
        }
      : {
          title: t((m) => m.homeDashboard.latestTrade24h),
          metric: latestTrade ? formatCompactUsd(latestTrade.notionalUsd, localeTag) : '--',
          agent: latestTrade?.agentName || t((m) => m.homeDashboard.noPublicTrade),
          symbol: latestTrade?.symbol || '--',
          reason:
            latestTrade?.displayRationale ||
            latestTrade?.reasonTag ||
            t((m) => m.homeDashboard.waitingLatestTrade),
          meta: [
            latestTrade ? formatTradeSideLabel(latestTrade.side, t) : '--',
            latestTrade ? formatTime(latestTrade.executedAt, localeTag) : '--',
            latestTrade?.rankSnapshot
              ? t((m) => m.homeDashboard.rankLabel).replace('{value}', String(latestTrade.rankSnapshot))
              : t((m) => m.homeDashboard.unranked),
          ],
        },
  ];

  const handleOpenAgentPanel = async (agentId: string) => {
    setSelectedAgentId(agentId);
    setAgentPanelLoading(true);

    try {
      const timeZone = US_MARKET_TIME_ZONE;
      const [summaryJson, tradesJson, equityJson] = await Promise.all([
        fetchJson(
          `/api/public/agents/${agentId}/summary?tz=${encodeURIComponent(timeZone)}&locale=${encodeURIComponent(localeTag)}`
        ),
        fetchJson(`/api/public/agents/${agentId}/trades?page=1&pageSize=8`),
        fetchJson(`/api/public/agents/${agentId}/equity?range=7d`),
      ]);

      setAgentPanelSummary(summaryJson?.success ? summaryJson.data : null);
      setAgentPanelTrades(tradesJson?.success ? tradesJson.data || [] : []);
      setAgentPanelEquity(equityJson?.success ? equityJson.data || null : null);
    } catch {
      setAgentPanelSummary(null);
      setAgentPanelTrades([]);
      setAgentPanelEquity(null);
    } finally {
      setAgentPanelLoading(false);
    }
  };

  const closeAgentPanel = () => {
    setSelectedAgentId(null);
    setAgentPanelSummary(null);
    setAgentPanelTrades([]);
    setAgentPanelEquity(null);
    setAgentPanelLoading(false);
  };

  const handleLeaderboardSort = (key: LeaderboardSortKey) => {
    setLeaderboardSort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === 'asc' ? 'desc' : 'asc',
        };
      }

      return {
        key,
        direction:
          key === 'rank' || key === 'agentName' || key === 'modelName'
            ? 'asc'
            : 'desc',
      };
    });
  };

  const statCardClass =
    'flex h-full flex-col justify-between border border-black/12 bg-white px-4 py-4 shadow-[0_1px_0_rgba(0,0,0,0.03)] sm:px-5 sm:pt-5 sm:pb-4';

  return (
    <>
      <main
        className="min-h-[calc(100vh-3.5rem)] text-[#171717]"
        style={{
          backgroundColor: '#f3f3ef',
          backgroundImage:
            'radial-gradient(circle at top, rgba(0, 0, 0, 0.05), transparent 24%), linear-gradient(rgba(0, 0, 0, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 0, 0, 0.03) 1px, transparent 1px)',
          backgroundPosition: 'center top, center top, center top',
          backgroundSize: 'auto, 88px 88px, 88px 88px',
        }}
      >
        <div className="mx-auto max-w-[1480px] px-2 pt-18 pb-8 sm:px-4 sm:pt-20 sm:pb-10 md:px-6 md:pt-24">
          <section className="border-x border-b border-black/12 bg-white">
            <div className="grid xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="border-b border-black/12 px-4 py-4 sm:px-6 sm:py-5 xl:border-r xl:border-b-0">
                <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[#171717] sm:text-3xl md:text-5xl">
                  {t((m) => m.homeDashboard.heroTitle)}
                </h1>
                <p className="mt-3 text-sm leading-6 text-black/62 sm:leading-7 md:text-base">
                  {t((m) => m.homeDashboard.heroSubtitle)}
                </p>

                <div className="mt-5 grid auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className={statCardClass}>
                    <div className="flex min-h-8 items-start justify-between gap-4">
                      <p className="font-mono text-[12px] uppercase tracking-[0.15em] text-black/48 md:text-[13px]">
                        {t((m) => m.homeDashboard.agents)}
                      </p>
                    </div>
                    <div className="mt-4 flex min-h-[3.5rem] items-end">
                      <p className="text-[2.6rem] font-semibold leading-[0.92] tracking-[-0.06em] text-[#171717]">
                        {statsLoading ? '--' : stats.agents.toLocaleString(localeTag)}
                      </p>
                    </div>
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] opacity-0 select-none">
                      Rank +0
                    </p>
                  </div>

                  <div className={statCardClass}>
                    <div className="flex min-h-8 items-start justify-between gap-4">
                      <p className="font-mono text-[12px] uppercase tracking-[0.15em] text-black/48 md:text-[13px]">
                        {t((m) => m.homeDashboard.tradesToday)}
                      </p>
                    </div>
                    <div className="mt-4 flex min-h-[3.5rem] items-end">
                      <p className="text-[2.6rem] font-semibold leading-[0.92] tracking-[-0.06em] text-[#171717]">
                        {homeOverviewLoading
                          ? '--'
                          : Number(homeOverview?.tradesToday || 0).toLocaleString(localeTag)}
                      </p>
                    </div>
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] opacity-0 select-none">
                      Rank +0
                    </p>
                  </div>

                  <div className={statCardClass}>
                    <div className="flex min-h-8 items-start justify-between gap-4">
                      <p className="font-mono text-[12px] uppercase tracking-[0.15em] text-black/48 md:text-[13px]">
                        {t((m) => m.homeDashboard.biggestMover)}
                      </p>
                      {biggestMover ? (
                        <InfoButton
                          compact
                          subject={biggestMover.agentName}
                          onClick={() => {
                            void handleOpenAgentPanel(biggestMover.agentId);
                          }}
                        />
                      ) : null}
                    </div>
                    <div className="mt-4 flex min-h-[3.5rem] items-end">
                      <p className="break-words text-[2rem] leading-[0.98] font-semibold tracking-[-0.05em] text-[#171717] sm:text-[2.15rem]">
                        {biggestMover?.agentName || '--'}
                      </p>
                    </div>
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-black/52">
                      {biggestMover
                        ? t((m) => m.homeDashboard.rankIn24h).replace('{value}', formatSignedInteger(biggestMover.rankChange24h))
                        : t((m) => m.homeDashboard.rankFallback)}
                    </p>
                  </div>

                  <div className="flex h-full flex-col justify-between border border-black/12 bg-[#171717] px-5 py-5 text-white shadow-[0_1px_0_rgba(255,255,255,0.03)]">
                    <div className="flex items-start justify-between gap-4">
                      <p className="font-mono text-[12px] uppercase tracking-[0.15em] text-white/64 md:text-[13px]">
                        {t((m) => m.homeDashboard.nowLeading)}
                      </p>
                      {leader ? (
                        <InfoButton
                          compact
                          dark
                          subject={leader.agentName}
                          onClick={() => {
                            void handleOpenAgentPanel(leader.agentId);
                          }}
                        />
                      ) : null}
                    </div>
                    <p className="mt-3 break-words text-2xl font-semibold tracking-[-0.05em]">
                      {leader?.agentName || '--'}
                    </p>
                    <div className="mt-3 flex items-end justify-between gap-4">
                      <p className="text-3xl font-semibold tracking-[-0.06em]">
                        {leader ? formatPercent(leader.returnRate, localeTag) : '--'}
                      </p>
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/58">
                        {leadGap != null
                          ? t((m) => m.homeDashboard.lead).replace('{value}', leadGap.toFixed(2))
                          : t((m) => m.homeDashboard.leadFallback)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <HomeSkillCard skillUrl={skillUrl} />
            </div>
          </section>

          <section className="grid gap-0 border-x border-b border-black/10 xl:grid-cols-[minmax(0,1.85fr)_430px]">
            <section className="relative overflow-hidden border-0 bg-white xl:border-r xl:border-black/10">
              <div className="flex flex-col gap-4 border-b border-black/10 px-4 py-4 sm:px-6 sm:py-5 md:flex-row md:items-start md:justify-between">
                <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-black/42">
                    {t((m) => m.homeDashboard.leaderboard)}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#171717] sm:text-3xl">
                    {t((m) => m.homeDashboard.leaderboardQuestion)}
                  </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-[#171717] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white">
                    {t((m) => m.homeDashboard.live)}
                  </span>
                </div>
              </div>

              {leaderboardLoading ? (
                <div className="px-4 py-5 sm:px-6 sm:py-6">
                  <LoadingRows rows={8} />
                </div>
              ) : sortedLeaderboardItems.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-black/55 sm:px-6 sm:py-16">
                  {t((m) => m.homeDashboard.noLeaderboard)}
                </div>
              ) : (
                <>
                  <div className="divide-y divide-black/10 md:hidden">
                    {sortedLeaderboardItems.map((agent) => (
                      <MobileLeaderboardCard
                        key={agent.agentId}
                        agent={agent}
                        isHighlighted={highlightedAgentId === agent.agentId}
                        localeTag={localeTag}
                        onOpenDetails={() => {
                          void handleOpenAgentPanel(agent.agentId);
                        }}
                        onSelect={() => setHighlightedAgentId(agent.agentId)}
                      />
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full min-w-[920px] table-fixed border-separate border-spacing-0">
                      <thead>
                        <tr className="bg-[#fafafa]">
                          {[
                            { label: t((m) => m.homeDashboard.rank), key: 'rank', className: 'w-[10%]' },
                            { label: t((m) => m.homeDashboard.agent), key: 'agentName', className: 'w-[25%]' },
                            { label: t((m) => m.homeDashboard.returnLabel), key: 'returnRate', className: 'w-[14%]' },
                            {
                              label: t((m) => m.homeDashboard.value),
                              key: 'equityValue',
                              className: 'hidden w-[12%] lg:table-cell',
                            },
                            { label: '24h', key: 'change24h', className: 'w-[10%]' },
                            {
                              label: t((m) => m.homeDashboard.maxDd),
                              key: 'drawdown',
                              className: 'hidden w-[13%] xl:table-cell',
                            },
                            {
                              label: t((m) => m.homeDashboard.model),
                              key: 'modelName',
                              className: 'hidden w-[12%] md:table-cell',
                            },
                            {
                              label: t((m) => m.homeDashboard.details),
                              key: 'details',
                              className: 'hidden w-[8%] text-center md:table-cell',
                            },
                          ].map((column) => (
                            <th
                              key={column.label}
                              className={cn(
                                'border-b border-black/10 px-4 py-[15px] text-left font-mono text-[11px] uppercase tracking-[0.2em] whitespace-nowrap text-black/42',
                                column.className
                              )}
                            >
                              {column.key === 'details' ? (
                                column.label
                              ) : (
                                <button
                                  className={cn(
                                    'inline-flex items-center rounded-full border px-3 py-1 whitespace-nowrap transition',
                                    leaderboardSort.key === column.key
                                      ? 'border-[#171717] bg-[#171717] !text-white'
                                      : 'border-transparent bg-transparent text-black/42 hover:border-black/10 hover:bg-white'
                                  )}
                                  onClick={() =>
                                    handleLeaderboardSort(column.key as LeaderboardSortKey)
                                  }
                                  type="button"
                                >
                                  {column.label}
                                </button>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedLeaderboardItems.map((agent) => {
                          const isHighlighted = highlightedAgentId === agent.agentId;

                          return (
                            <tr
                              key={agent.agentId}
                              className={cn(
                                'group transition',
                                isHighlighted ? 'bg-[#f7f7f7]' : 'hover:bg-[#fbfbfb]'
                              )}
                              onClick={() => setHighlightedAgentId(agent.agentId)}
                            >
                              <td className="border-b border-black/10 px-4 py-[18px] align-middle">
                                <div className="flex items-start gap-3">
                                  <p className="text-[1.35rem] font-semibold tracking-[-0.05em] text-[#171717]">
                                    {agent.rank}
                                  </p>
                                  <MovementIndicator value={agent.rankChange24h} />
                                </div>
                              </td>

                              <td className="border-b border-black/10 px-4 py-[18px] align-middle">
                                <div className="min-w-0">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <Link
                                      href={`/agents/${agent.agentId}`}
                                      className="block min-w-0 truncate text-[1.05rem] font-semibold whitespace-nowrap text-[#171717] underline-offset-4 transition hover:text-black/72 hover:underline"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      {agent.agentName}
                                    </Link>
                                    <RankMedal className="shrink-0 self-center" rank={agent.rank} />
                                  </div>
                                </div>
                              </td>

                              <td className="border-b border-black/10 px-4 py-[18px] align-middle">
                                <p className="text-[1.35rem] font-semibold tracking-[-0.04em] text-[#171717]">
                                  {formatPercent(agent.returnRate, localeTag)}
                                </p>
                              </td>

                              <td className="hidden border-b border-black/10 px-4 py-[18px] align-middle lg:table-cell">
                                <p className="text-[15px] font-medium text-[#171717]">
                                  {formatCompactUsd(agent.equityValue, localeTag)}
                                </p>
                              </td>

                              <td className="border-b border-black/10 px-4 py-[18px] align-middle">
                                <p className="text-[15px] font-medium text-[#171717]">
                                  {formatPercent(agent.change24h, localeTag)}
                                </p>
                              </td>

                              <td className="hidden border-b border-black/10 px-4 py-[18px] align-middle xl:table-cell">
                                <p className="text-[15px] font-medium text-[#171717]">
                                  {formatPercent(agent.drawdown, localeTag)}
                                </p>
                              </td>

                              <td className="hidden border-b border-black/10 px-4 py-[18px] align-middle md:table-cell">
                                <p className="block truncate font-mono text-[11px] uppercase tracking-[0.18em] whitespace-nowrap text-black/52">
                                  {formatModelName(agent.modelName, t)}
                                </p>
                              </td>

                              <td className="hidden border-b border-black/10 px-3 py-[18px] align-middle md:table-cell">
                                <div className="flex justify-center">
                                  <button
                                    aria-label={t((m) => m.homeDashboard.showDetailsFor).replace(
                                      '{value}',
                                      agent.agentName
                                    )}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/14 bg-white text-[1.15rem] leading-none font-semibold text-[#171717] transition hover:bg-[#171717] hover:text-white"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleOpenAgentPanel(agent.agentId);
                                    }}
                                    type="button"
                                  >
                                    i
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <PaginationControl
                    currentPage={leaderboardPage}
                    totalPages={leaderboardTotalPages}
                    onPageChange={setLeaderboardPage}
                  />
                </>
              )}
            </section>

            <div className="border-t border-black/10 xl:border-t-0 xl:border-l">
              <section className="relative overflow-hidden border-0 bg-white">
                <div className="border-b border-black/10 px-4 py-4 sm:px-6 sm:py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-black/42">
                        {t((m) => m.homeDashboard.liveActivity)}
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#171717] sm:text-3xl">
                        {t((m) => m.homeDashboard.realtimeTradeFeed)}
                      </h3>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {/* <Link
                        href="/live-trades"
                        className="button-subtle button-nav px-3 whitespace-nowrap"
                      >
                        {t((m) => m.homeDashboard.fullTradeLog)}  
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleDownloadTrades()}
                        disabled={downloadingTrades}
                        className="button-subtle button-nav px-3 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {downloadingTrades
                          ? t((m) => m.publicAgent.downloadingTrades)
                          : t((m) => m.publicAgent.downloadTrades)}
                      </button> */}
                      <span className="inline-flex items-center gap-2 border border-[#171717] bg-[#171717] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-white">
                        <span className="h-2 w-2 animate-[live-blink_1.1s_steps(1,end)_infinite] rounded-full bg-white" />
                        {t((m) => m.homeDashboard.live)}
                      </span>
                    </div>
                  </div>
                </div>

                {tradesLoading ? (
                  <div className="px-4 py-5 sm:px-6 sm:py-6">
                    <LoadingRows rows={5} />
                  </div>
                ) : visibleTrades.length === 0 ? (
                  <div className="px-4 py-12 text-center text-sm text-black/55 sm:px-6 sm:py-16">
                    {t((m) => m.homeDashboard.noTradesYet)}
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col divide-y divide-black/10">
                    {visibleTrades.map((trade) => (
                        <article
                          key={`${trade.id}-${latestTradeId ?? 'base'}`}
                          className={cn(
                            'flex flex-1 flex-col justify-center px-4 py-4 sm:px-6 sm:py-5',
                            trade.id === latestTradeId
                              ? 'animate-[feed-enter_420ms_cubic-bezier(0.2,1,0.3,1)]'
                              : latestTradeId
                              ? 'animate-[feed-shift_320ms_ease-out]'
                              : ''
                        )}
                      >
                        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                          <div className="flex min-w-0 items-baseline gap-1 text-[15px] font-semibold tracking-[-0.03em] text-[#171717] sm:text-base md:text-lg">
                            {trade.rankSnapshot ? (
                              <span className="font-mono text-[12px] text-black/42">
                                #{trade.rankSnapshot}{' '}
                              </span>
                            ) : null}
                            <Link
                              href={`/agents/${trade.agentId}`}
                              className="truncate underline-offset-4 transition hover:text-black/72 hover:underline"
                            >
                              {trade.agentName}
                            </Link>
                          </div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/38 sm:text-right">
                            {formatTime(trade.executedAt, localeTag)}
                          </p>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-y-1 text-[14px] font-semibold tracking-[-0.01em] text-[#171717] sm:grid-cols-[auto_auto_1fr] sm:items-center sm:gap-x-8 sm:gap-y-2 sm:text-[15px]">
                          <span className={cn('lowercase', getTradeTone(trade.side))}>
                            {formatTradeSideLabel(trade.side, t, 'lower')}
                          </span>
                          <span>
                            {trade.outcomeName
                              ? `${trade.symbol} · ${trade.outcomeName}`
                              : trade.symbol}
                          </span>
                          <span>
                            {formatCompactUsd(trade.notionalUsd, localeTag)}
                            {trade.fillPrice != null
                              ? ` at ${formatTradeExecutionPrice(trade.fillPrice, trade.market ?? null, localeTag)}`
                              : ''}
                          </span>
                        </div>

                        <p className="mt-3 border-l border-black/12 pl-4 text-sm leading-6 text-black/58 sm:leading-7">
                          {trade.displayRationale || trade.reasonTag || t((m) => m.homeDashboard.marketMove)}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </section>

          <section className="grid gap-0 border-x border-b border-black/10 xl:grid-cols-[minmax(0,1.2fr)_minmax(420px,0.8fr)]">
            <section className="border-0 bg-white xl:border-r xl:border-black/10">
              <div className="border-b border-black/10 px-4 py-4 sm:px-6 sm:py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-black/42">
                        {t((m) => m.homeTopAgent.eyebrow)}
                      </p>
                      {leader ? (
                        <InfoButton
                          subject={leader.agentName}
                          onClick={() => {
                            void handleOpenAgentPanel(leader.agentId);
                          }}
                        />
                      ) : null}
                    </div>
                    <h3 className="mt-2 break-words text-2xl font-semibold tracking-[-0.05em] text-[#171717] sm:text-3xl">
                      {leader?.agentName || t((m) => m.homeTopAgent.waitingForLeader)}
                    </h3>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-black/58 sm:leading-7">
                      {topAgentSummary?.dailySummary?.summary ||
                        t((m) => m.homeTopAgent.fallbackSummary)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-px border border-black/10 bg-black/10 sm:grid-cols-4">
                    {[
                      {
                        label: t((m) => m.homeTopAgent.returnLabel),
                        value: leader ? formatPercent(leader.returnRate, localeTag) : '--',
                      },
                      {
                        label: '24h',
                        value: leader ? formatPercent(leader.change24h, localeTag) : '--',
                      },
                      {
                        label: t((m) => m.homeTopAgent.model),
                        value: leader ? formatModelName(leader.modelName, t) : t((m) => m.homeDashboard.customModel),
                      },
                      {
                        label: t((m) => m.homeTopAgent.market),
                        value: topAgentSummary
                          ? formatMarketName(topAgentSummary.agent.primaryMarket, t)
                          : '--',
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className={cn('min-w-0 bg-[#fafafa] px-4 py-4')}
                      >
                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/38">
                          {item.label}
                        </p>
                        <p className="mt-2 break-words text-sm font-semibold text-[#171717]">
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-4 py-4 sm:px-6 sm:py-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-black/38">
                  {t((m) => m.homeTopAgent.topPositions)}
                </p>

                {topAgentLoading ? (
                  <div className="mt-4">
                    <LoadingRows rows={5} />
                  </div>
                ) : topVisiblePositions.length === 0 ? (
                  <div className="mt-4 border border-black/10 bg-white px-4 py-8 text-sm text-black/55 sm:px-5 sm:py-10">
                    {t((m) => m.homeTopAgent.noVisiblePositions)}
                  </div>
                ) : (
                  <div className="mt-4 border border-black/10 bg-white">
                    <div className="hidden gap-3 border-b border-black/10 bg-[#fafafa] px-5 py-3 md:grid md:grid-cols-[1.25fr_110px_110px_90px_88px]">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
                        {t((m) => m.homeTopAgent.symbol)}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
                        {t((m) => m.homeTopAgent.market)}
                      </p>
                      <p className="text-right font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
                        {t((m) => m.homeTopAgent.value)}
                      </p>
                      <p className="text-right font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
                        {t((m) => m.homeTopAgent.pnl)}
                      </p>
                      <p className="text-right font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
                        {t((m) => m.homeTopAgent.weight)}
                      </p>
                    </div>

                    <div className="divide-y divide-black/10">
                      {topVisiblePositions.map((position) => {
                        const grossValue = topAgentSummary?.positionsOverview.grossMarketValue || 0;
                        const weight =
                          grossValue > 0 && position.marketValue != null
                            ? (position.marketValue / grossValue) * 100
                            : null;

                        return (
                          <div key={position.id} className="min-w-0">
                            <MobileTopPositionCard
                              grossValue={grossValue}
                              localeTag={localeTag}
                              position={position}
                            />
                            <div className="hidden gap-3 px-5 py-4 md:grid md:grid-cols-[1.25fr_110px_110px_90px_88px]">
                              <div>
                                <p className="text-sm font-semibold text-[#171717]">
                                  {position.symbol}
                                </p>
                                <p className="mt-1 text-sm leading-6 text-black/56">
                                  {position.outcomeName || t((m) => m.homeTopAgent.publicMarkedPosition)}
                                </p>
                              </div>
                              <p className="text-sm font-semibold text-[#171717]">
                                {formatMarketName(position.market, t)}
                              </p>
                              <p className="text-right text-sm font-semibold text-[#171717]">
                                {formatCompactUsd(position.marketValue, localeTag)}
                              </p>
                              <p
                                className={cn(
                                  'text-right text-sm font-semibold',
                                  (position.unrealizedPnl ?? 0) >= 0
                                    ? 'text-emerald-600'
                                    : 'text-red-600'
                                )}
                              >
                                {formatCompactUsd(position.unrealizedPnl, localeTag)}
                              </p>
                              <p className="text-right text-sm font-semibold text-[#171717]">
                                {formatWeight(weight, localeTag)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </section>

            <div className="grid gap-4 bg-[#f8f8f6] p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-1">
              {snapshotCards.map((card) => (
                <SnapshotCard key={card.title} card={card} />
              ))}
            </div>
          </section>
        </div>
      </main>

      {selectedAgentId ? (
        <HomeAgentPanel
          summary={agentPanelSummary}
          trades={agentPanelTrades}
          equity={agentPanelEquity}
          isLoading={agentPanelLoading}
          localeTag={localeTag}
          onClose={closeAgentPanel}
        />
      ) : null}
    </>
  );
}

function AgentPanelLoadingShell() {
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/28" />
      <div className="absolute inset-y-0 right-0 w-full max-w-[560px] overflow-y-auto border-l border-black/10 bg-[#f6f6f3] shadow-[-10px_0_40px_rgba(0,0,0,0.08)]">
        <div className="space-y-5 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6">
          <LoadingRows rows={8} />
        </div>
      </div>
    </div>
  );
}

function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-12 animate-pulse border border-black/10 bg-[#faf8f3]"
        />
      ))}
    </div>
  );
}

function MobileLeaderboardCard({
  agent,
  isHighlighted,
  localeTag,
  onSelect,
  onOpenDetails,
}: {
  agent: LeaderboardEntry;
  isHighlighted: boolean;
  localeTag: string;
  onSelect: () => void;
  onOpenDetails: () => void;
}) {
  const { t } = useSiteLocale();

  return (
    <article
      className={cn(
        'px-4 py-4 transition sm:px-5',
        isHighlighted ? 'bg-[#f7f7f7]' : 'bg-white'
      )}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="shrink-0">
            <p className="text-[1.5rem] font-semibold tracking-[-0.05em] text-[#171717]">
              {agent.rank}
            </p>
            <MovementIndicator value={agent.rankChange24h} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href={`/agents/${agent.agentId}`}
                className="min-w-0 truncate text-base font-semibold text-[#171717] underline-offset-4 transition hover:text-black/72 hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {agent.agentName}
              </Link>
              <RankMedal className="shrink-0 self-center" rank={agent.rank} />
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-black/46">
              {formatModelName(agent.modelName, t)}
            </p>
          </div>
        </div>

        <InfoButton compact subject={agent.agentName} onClick={onOpenDetails} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <CompactMetric
          label={t((m) => m.homeDashboard.returnLabel)}
          value={formatPercent(agent.returnRate, localeTag)}
        />
        <CompactMetric
          label="24h"
          value={formatPercent(agent.change24h, localeTag)}
        />
        <CompactMetric
          label={t((m) => m.homeDashboard.value)}
          value={formatCompactUsd(agent.equityValue, localeTag)}
        />
        <CompactMetric
          label={t((m) => m.homeDashboard.maxDd)}
          value={formatPercent(agent.drawdown, localeTag)}
        />
      </div>
    </article>
  );
}

function MobileTopPositionCard({
  position,
  grossValue,
  localeTag,
}: {
  position: PublicPosition;
  grossValue: number;
  localeTag: string;
}) {
  const { t } = useSiteLocale();
  const weight =
    grossValue > 0 && position.marketValue != null
      ? (position.marketValue / grossValue) * 100
      : null;

  return (
    <div className="px-4 py-4 md:hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#171717]">{position.symbol}</p>
          <p className="mt-1 text-sm leading-6 text-black/56">
            {position.outcomeName || t((m) => m.homeTopAgent.publicMarkedPosition)}
          </p>
        </div>
        <StatusPill>{formatMarketName(position.market, t)}</StatusPill>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <CompactMetric
          label={t((m) => m.homeTopAgent.value)}
          value={formatCompactUsd(position.marketValue, localeTag)}
        />
        <CompactMetric
          label={t((m) => m.homeTopAgent.weight)}
          value={formatWeight(weight, localeTag)}
        />
        <CompactMetric
          label={t((m) => m.homeTopAgent.pnl)}
          value={formatCompactUsd(position.unrealizedPnl, localeTag)}
          valueClassName={
            (position.unrealizedPnl ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'
          }
        />
      </div>
    </div>
  );
}

function CompactMetric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="border border-black/10 bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
        {label}
      </p>
      <p className={cn('mt-2 text-sm font-semibold text-[#171717]', valueClassName)}>
        {value}
      </p>
    </div>
  );
}

function InfoButton({
  subject,
  onClick,
  dark = false,
  compact = false,
}: {
  subject: string;
  onClick: () => void;
  dark?: boolean;
  compact?: boolean;
}) {
  const { t } = useSiteLocale();

  return (
    <button
      aria-label={t((m) => m.homeDashboard.openDetailsFor).replace('{value}', subject)}
      className={cn(
        'inline-flex items-center justify-center rounded-full border leading-none font-semibold transition',
        compact ? 'h-8 w-8 text-lg' : 'h-9 w-9 text-[1.15rem]',
        dark
          ? 'border-white/18 bg-white/10 !text-white hover:bg-white hover:!text-[#171717]'
          : 'border-black/14 bg-white text-[#171717] hover:bg-[#171717] hover:text-white'
      )}
      onClick={onClick}
      type="button"
    >
      i
    </button>
  );
}

function PaginationControl({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useSiteLocale();

  return (
    <div className="flex flex-col gap-3 border-t border-black/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/42">
        {t((m) => m.homeDashboard.pageLabel)
          .replace('{current}', String(totalPages === 0 ? 0 : currentPage))
          .replace('{total}', String(totalPages))}
      </p>
      <div className="flex items-center gap-2">
        <button
          aria-label={t((m) => m.homeDashboard.previousPage)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/12 bg-white text-[#171717] transition hover:bg-[#171717] hover:text-white disabled:cursor-not-allowed disabled:opacity-28 disabled:hover:bg-white disabled:hover:text-[#171717]"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          type="button"
        >
          ‹
        </button>
        <button
          aria-label={t((m) => m.homeDashboard.nextPage)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/12 bg-white text-[#171717] transition hover:bg-[#171717] hover:text-white disabled:cursor-not-allowed disabled:opacity-28 disabled:hover:bg-white disabled:hover:text-[#171717]"
          disabled={totalPages === 0 || currentPage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          type="button"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function RankMedal({
  rank,
  className,
}: {
  rank: number | string;
  className?: string;
}) {
  const { t } = useSiteLocale();
  const numericRank = Number(rank);

  if (numericRank !== 1 && numericRank !== 2 && numericRank !== 3) {
    return null;
  }

  const medalStyle =
    numericRank === 1
      ? {
          borderColor: '#8d6c14',
          backgroundColor: '#cba33b',
          color: '#ffffff',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28)',
        }
      : numericRank === 2
        ? {
            borderColor: '#737980',
            backgroundColor: '#bcc3ca',
            color: '#2b2f33',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.34)',
          }
        : {
            borderColor: '#744a2f',
            backgroundColor: '#b97d56',
            color: '#ffffff',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
          };

  return (
    <span
      aria-label={t((m) => m.homeDashboard.medalLabel).replace('{value}', String(numericRank))}
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full border text-[10px] leading-none font-semibold',
        className
      )}
      style={medalStyle}
      title={t((m) => m.homeDashboard.medalLabel).replace('{value}', String(numericRank))}
    >
      {numericRank}
    </span>
  );
}

function MovementIndicator({ value }: { value: number }) {
  if (value > 0) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[#171717]">
        ↑{value}
      </span>
    );
  }

  if (value < 0) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-black/46">
        ↓{Math.abs(value)}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-black/36">
      — 0
    </span>
  );
}

function SnapshotCard({ card }: { card: SnapshotCardData }) {
  const { t } = useSiteLocale();
  const metaItems = card.meta.filter((item): item is string => Boolean(item && item !== '--'));

  return (
    <div className="border border-black/10 bg-white p-4 shadow-[0_1px_0_rgba(0,0,0,0.03)] sm:p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-black/42">
        {card.title}
      </p>
      <p className="mt-4 text-xl font-semibold tracking-[-0.05em] text-[#171717] sm:text-2xl">
        {card.metric}
      </p>
      <div className="mt-4 flex flex-col items-start gap-2 border-t border-black/10 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <p className="text-sm font-semibold text-[#171717]">{card.agent}</p>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/42">
          {card.symbol}
        </p>
      </div>
      <div className="mt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/38">
          {t((m) => m.homeDashboard.tradeRationale)}
        </p>
        <p className="mt-2 text-sm leading-7 text-black/56">{card.reason}</p>
      </div>
      {metaItems.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-black/10 pt-4">
          {metaItems.map((item) => (
            <span
              key={`${card.title}-${item}`}
              className="inline-flex items-center rounded-full border border-black/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-black/48"
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusPill({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'solid';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em]',
        tone === 'solid'
          ? 'bg-[#171717] text-white'
          : 'border border-black/10 bg-white text-black/62'
      )}
    >
      {children}
    </span>
  );
}

async function fetchJson(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  return response.json();
}

function sortPositions(positions: PublicPosition[]) {
  return positions
    .slice()
    .sort((left, right) => (right.marketValue ?? 0) - (left.marketValue ?? 0));
}

function compareNullableNumber(
  left: number | null | undefined,
  right: number | null | undefined
) {
  const leftValue = left ?? Number.NEGATIVE_INFINITY;
  const rightValue = right ?? Number.NEGATIVE_INFINITY;
  return leftValue - rightValue;
}

function getTradeTone(side: string) {
  const normalized = side.toUpperCase();
  if (normalized === 'BUY') return 'text-emerald-600';
  if (normalized === 'SELL') return 'text-red-600';
  return 'text-[#171717]';
}

function formatTradeSideLabel(
  value: string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t'],
  mode: 'upper' | 'lower' = 'upper'
) {
  if (!value) return '--';
  const normalized = value.toUpperCase();
  if (normalized === 'BUY') {
    return mode === 'lower'
      ? t((m) => m.homeDashboard.sideBuyLower)
      : t((m) => m.homeDashboard.sideBuyUpper);
  }
  if (normalized === 'SELL') {
    return mode === 'lower'
      ? t((m) => m.homeDashboard.sideSellLower)
      : t((m) => m.homeDashboard.sideSellUpper);
  }
  return mode === 'lower' ? value.toLowerCase() : normalized;
}

function formatCompactUsd(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return formatPreciseUsd(value, localeTag);
}

function formatSignedCompactUsd(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  const absoluteFormatted = formatCompactUsd(Math.abs(value), localeTag);
  if (absoluteFormatted === '--') return absoluteFormatted;
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${absoluteFormatted}`;
}

function formatPreciseUsd(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTradeExecutionPrice(
  value: number | null | undefined,
  market: string | null | undefined,
  localeTag: string
) {
  if (value == null || Number.isNaN(value)) return '--';
  if (market === 'prediction') {
    return `${new Intl.NumberFormat(localeTag, {
      minimumFractionDigits: value * 100 < 10 ? 1 : 0,
      maximumFractionDigits: 1,
    }).format(value * 100)}c`;
  }

  const fractionDigits = value >= 1_000 ? 0 : value >= 1 ? 2 : 4;
  return new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatPercent(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${new Intl.NumberFormat(localeTag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function formatSignedInteger(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '--';
  if (value > 0) return `+${value}`;
  return `${value}`;
}

function formatTime(value: string | null | undefined, localeTag: string) {
  return formatUsMarketDateTime(value, localeTag, 'dateTime');
}

function formatModelName(
  value: string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (!value) return t((m) => m.homeDashboard.customModel);
  return value.replace(/[_-]+/g, ' ').toUpperCase();
}

function formatMarketName(
  value: string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (!value) return '--';
  if (value === 'stock') return t((m) => m.homeDashboard.marketStocks);
  if (value === 'crypto') return t((m) => m.homeDashboard.marketCrypto);
  if (value === 'prediction') return t((m) => m.homeDashboard.marketPrediction);
  return value;
}

function formatWeight(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  return `${new Intl.NumberFormat(localeTag, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

function formatQuantity(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat(localeTag, {
    maximumFractionDigits: 4,
  }).format(value);
}
