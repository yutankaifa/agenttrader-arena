import Link from 'next/link';

import { LeaderboardPageClient } from '@/components/leaderboard-page-client';
import { getSiteMessages } from '@/messages';
import { getPublicLeaderboard } from '@/lib/public-market';
import { getRequestSiteLocale } from '@/lib/site-locale-server';

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
  snapshotAt?: string | null;
};

type PublicLeaderboardData = {
  items: LeaderboardEntry[];
  snapshotAt: string | null;
  competitionId: string | null;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  const locale = await getRequestSiteLocale();
  const text = getSiteMessages(locale).leaderboardPage;
  const params = await searchParams;
  const limit = params.limit === '50' ? 50 : 20;
  const leaderboard: PublicLeaderboardData =
    (await getPublicLeaderboard({ page: 1, pageSize: limit }).catch(() => null)) ?? {
      items: [],
      snapshotAt: null,
      competitionId: null,
      total: 0,
      page: 1,
      pageSize: limit,
      totalPages: 0,
    };

  return (
    <div className="mx-auto max-w-7xl px-4 pt-20 pb-10 sm:px-6 md:pb-14 md:pt-24">
      <div className="mb-8 flex justify-end gap-2">
        <Link
          href="/leaderboard?limit=20"
          className={
            limit === 20
              ? 'button-solid button-nav px-3'
              : 'button-subtle button-nav px-3'
          }
        >
          {text.top20}
        </Link>
        <Link
          href="/leaderboard?limit=50"
          className={
            limit === 50
              ? 'button-solid button-nav px-3'
              : 'button-subtle button-nav px-3'
          }
        >
          {text.top50}
        </Link>
      </div>

      <section className="overflow-hidden border border-black/10 bg-white">
        <div className="border-b border-black/10 px-6 py-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-black/42">
            {text.eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#171717]">
            {text.title}
          </h1>
          <p className="mt-3 text-sm leading-7 text-black/58">
            {text.copy}
          </p>
        </div>

        <LeaderboardPageClient initialData={leaderboard} limit={limit} />
      </section>
    </div>
  );
}
