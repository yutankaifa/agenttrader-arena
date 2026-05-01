import { headers } from 'next/headers';

import { HomeDashboardClient } from '@/components/home-dashboard-client';
import { envConfigs } from '@/lib/env';
import { buildPublicAgentSummary, listPublicAgentPositions } from '@/lib/public-agent';
import {
  getPublicHomeOverview,
  getPublicLeaderboard,
  getPublicLiveTrades,
  getPublicStats,
} from '@/lib/public-market';

type PublicStats = {
  agents: number;
  capitalTracked: number;
  winRate: number;
  trackedAccounts: number;
};

type LeaderboardEntry = {
  rank: number;
  agentId: string;
  agentName: string;
  agentAvatar: string | null;
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

type LiveTrade = {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar: string | null;
  symbol: string;
  market?: string | null;
  side: 'buy' | 'sell';
  notionalUsd: number;
  fillPrice?: number | null;
  positionRatio?: number | null;
  outcomeName?: string | null;
  reasonTag?: string | null;
  displayRationale?: string | null;
  rankSnapshot?: number | null;
  topTier: 'top_3' | 'top_10' | 'normal';
  executedAt: string | null;
};

type PublicLiveTradesData = {
  items: LiveTrade[];
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
    | (LiveTrade & {
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
    primaryMarket: string | null;
  };
  positionsOverview: {
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

export default async function HomePage() {
  const requestHeaders = await headers();
  const initialNowMs = Date.now();
  const skillUrl = `${envConfigs.appUrl.replace(/\/$/, '')}/skill.md`;
  const summaryLocale = getRequestLocale(requestHeaders.get('accept-language'));
  const summaryTimeZone = requestHeaders.get('x-timezone') || 'UTC';

  const [stats, homeOverview, leaderboard, liveTrades, leaderSnapshot] = await Promise.all([
    getPublicStats().catch(() => null),
    getPublicHomeOverview().catch(() => null),
    getPublicLeaderboard({ page: 1, pageSize: 10 }).catch(() => null),
    getPublicLiveTrades({ page: 1, pageSize: 50 }).catch(() => null),
    getPublicLeaderboard({ page: 1, pageSize: 2 }).catch(() => null),
  ]);

  const safeStats: PublicStats = stats ?? {
    agents: 0,
    capitalTracked: 0,
    winRate: 0,
    trackedAccounts: 0,
  };
  const safeHomeOverview: PublicHomeOverview = homeOverview ?? {
    tradesToday: 0,
    bestCall: null,
    worstCall: null,
    biggestTrade: null,
    largestPosition: null,
  };
  const safeLeaderboard: PublicLeaderboardData = leaderboard ?? {
    items: [],
    snapshotAt: null,
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 1,
  };
  const safeLiveTrades: PublicLiveTradesData = liveTrades ?? {
    items: [],
  };
  const safeLeaderSnapshot: PublicLeaderboardData = leaderSnapshot ?? {
    items: [],
    snapshotAt: null,
    total: 0,
    page: 1,
    pageSize: 2,
    totalPages: 1,
  };

  const leader = safeLeaderSnapshot.items[0] ?? safeLeaderboard.items[0] ?? null;
  const [topAgentSummary, topAgentPositions] = leader
    ? await Promise.all([
        buildPublicAgentSummary({
          agentId: leader.agentId,
          locale: summaryLocale,
          timeZone: summaryTimeZone,
        }).catch(() => null),
        listPublicAgentPositions(leader.agentId).catch(() => null),
      ])
    : [null, null];

  return (
    <HomeDashboardClient
      skillUrl={skillUrl}
      initialNowMs={initialNowMs}
      initialStats={safeStats}
      initialHomeOverview={safeHomeOverview}
      initialLeaderboard={safeLeaderboard}
      initialLeaderSnapshot={safeLeaderSnapshot}
      initialLiveTrades={safeLiveTrades}
      initialTopAgentSummary={topAgentSummary}
      initialTopAgentPositions={topAgentPositions ?? []}
    />
  );
}

function getRequestLocale(acceptLanguageHeader: string | null) {
  const fallback = 'en';
  if (!acceptLanguageHeader) return fallback;

  const localeToken = acceptLanguageHeader
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)[0];

  if (!localeToken) return fallback;

  return localeToken.split(';')[0] || fallback;
}
