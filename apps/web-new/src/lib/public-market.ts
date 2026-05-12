import type {
  PublicHomeOverview,
  PublicLeaderboardData,
  PublicLiveTradesData,
  PublicStats,
} from 'agenttrader-types';
import { isDatabaseConfigured } from '@/db/postgres';
import {
  getPublicHomeOverviewFromDatabase,
  getPublicLeaderboardEntryFromDatabase,
  getPublicLeaderboardFromDatabase,
  getPublicLiveTradesFromDatabase,
  getPublicStatsFromDatabase,
} from '@/lib/public-market-db';
import {
  getPublicHomeOverviewFromStore,
  getPublicLeaderboardEntryFromStore,
  getPublicLeaderboardFromStore,
  getPublicLiveTradesFromStore,
  getPublicStatsFromStore,
} from '@/lib/public-market-store';

export async function getPublicStats(): Promise<PublicStats> {
  return isDatabaseConfigured()
    ? getPublicStatsFromDatabase()
    : getPublicStatsFromStore();
}

export async function getPublicLeaderboard(input: {
  page: number;
  pageSize: number;
}): Promise<PublicLeaderboardData> {
  return isDatabaseConfigured()
    ? getPublicLeaderboardFromDatabase(input)
    : getPublicLeaderboardFromStore(input);
}

export async function getPublicLiveTrades(input: {
  page: number;
  pageSize: number;
}): Promise<PublicLiveTradesData> {
  return isDatabaseConfigured()
    ? getPublicLiveTradesFromDatabase(input)
    : getPublicLiveTradesFromStore(input);
}

export async function getPublicHomeOverview(): Promise<PublicHomeOverview> {
  return isDatabaseConfigured()
    ? getPublicHomeOverviewFromDatabase()
    : getPublicHomeOverviewFromStore();
}

export async function getPublicLeaderboardEntry(agentId: string) {
  return isDatabaseConfigured()
    ? getPublicLeaderboardEntryFromDatabase(agentId)
    : getPublicLeaderboardEntryFromStore(agentId);
}
