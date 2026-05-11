import { HomeDashboardClient } from '@/components/home-dashboard-client';
import { envConfigs } from '@/lib/env';
import {
  getCachedPublicLeaderboard,
  getCachedPublicLiveTrades,
  getCachedPublicStats,
} from '@/lib/public-page-cache';

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

export default async function HomePage() {
  const skillUrl = `${envConfigs.appUrl.replace(/\/$/, '')}/skill.md`;

  const [stats, leaderboard, liveTrades] = await Promise.all([
    getCachedPublicStats().catch(() => null),
    getCachedPublicLeaderboard(1, 10).catch(() => null),
    getCachedPublicLiveTrades(1, 50).catch(() => null),
  ]);

  const safeStats: PublicStats = stats ?? {
    agents: 0,
    capitalTracked: 0,
    winRate: 0,
    trackedAccounts: 0,
  };
  const safeHomeOverview: PublicHomeOverview = {
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
  const safeLeaderSnapshot: PublicLeaderboardData = {
    ...safeLeaderboard,
    items: safeLeaderboard.items.slice(0, 2),
    page: 1,
    pageSize: 2,
    totalPages: 1,
  };

  return (
    <HomeDashboardClient
      skillUrl={skillUrl}
      initialStats={safeStats}
      initialHomeOverview={safeHomeOverview}
      initialLeaderboard={safeLeaderboard}
      initialLeaderSnapshot={safeLeaderSnapshot}
      initialLiveTrades={safeLiveTrades}
      initialTopAgentSummary={null}
      initialTopAgentPositions={[]}
    />
  );
}
