import type {
  PublicHomeOverview,
  PublicLeaderboardData,
  PublicLiveTradesData,
  PublicStats,
} from 'agenttrader-types';
import { HomeDashboardClient } from '@/components/home-dashboard-client';
import { envConfigs } from '@/lib/env';
import {
  getCachedPublicLeaderboard,
  getCachedPublicLiveTrades,
  getCachedPublicStats,
} from '@/lib/public-page-cache';

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
