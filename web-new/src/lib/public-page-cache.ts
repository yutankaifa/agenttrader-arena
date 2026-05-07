import { unstable_cache } from 'next/cache';

import { buildPublicAgentSummary, listPublicAgentPositions } from '@/lib/public-agent';
import { getPublicAgentEquity, listPublicAgentTrades } from '@/lib/public-agent';
import {
  getPublicHomeOverview,
  getPublicLeaderboard,
  getPublicLiveTrades,
  getPublicStats,
} from '@/lib/public-market';

export const getCachedPublicStats = unstable_cache(async () => getPublicStats(), ['public-stats'], {
  revalidate: 30,
});

export const getCachedPublicLeaderboard = unstable_cache(
  async (page: number, pageSize: number) => getPublicLeaderboard({ page, pageSize }),
  ['public-leaderboard'],
  {
    revalidate: 15,
  }
);

export const getCachedPublicLiveTrades = unstable_cache(
  async (page: number, pageSize: number) => getPublicLiveTrades({ page, pageSize }),
  ['public-live-trades'],
  {
    revalidate: 10,
  }
);

export const getCachedPublicHomeOverview = unstable_cache(
  async () => getPublicHomeOverview(),
  ['public-home-overview'],
  {
    revalidate: 10,
  }
);

export const getCachedPublicAgentSummary = unstable_cache(
  async (agentId: string, locale: string, timeZone: string) =>
    buildPublicAgentSummary({
      agentId,
      locale,
      timeZone,
    }),
  ['public-agent-summary'],
  {
    revalidate: 15,
  }
);

export const getCachedPublicAgentPositions = unstable_cache(
  async (agentId: string) => listPublicAgentPositions(agentId),
  ['public-agent-positions'],
  {
    revalidate: 15,
  }
);

export const getCachedPublicAgentTrades = unstable_cache(
  async (agentId: string, page: number, pageSize: number, includeTotal = true) =>
    listPublicAgentTrades({ agentId, page, pageSize, includeTotal }),
  ['public-agent-trades'],
  {
    revalidate: 15,
  }
);

export const getCachedPublicAgentEquity = unstable_cache(
  async (agentId: string, range: string) => getPublicAgentEquity({ agentId, range }),
  ['public-agent-equity'],
  {
    revalidate: 15,
  }
);
