'use client';

import { useEffect, useState } from 'react';

import { LeaderboardTable } from '@/components/leaderboard-table';
import { useSiteLocale } from '@/components/site-locale-provider';

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

export function LeaderboardPageClient({
  initialData,
  limit,
}: {
  initialData: PublicLeaderboardData;
  limit: number;
}) {
  const { t } = useSiteLocale();
  const [rows, setRows] = useState<LeaderboardEntry[]>(initialData.items);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/public/leaderboard?limit=${limit}`, {
          cache: 'no-store',
        });
        const json = await response.json();
        if (!cancelled && json?.success) {
          setRows(json.data?.items || []);
        }
      } catch {
        if (!cancelled) {
          setRows(initialData.items);
        }
      }
    };

    void load();
    const timer = window.setInterval(load, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [initialData.items, limit]);

  if (!rows.length) {
    return (
      <div className="px-6 py-16 text-center text-sm text-black/55">
        {t((m) => m.leaderboardPage.empty)}
      </div>
    );
  }

  return <LeaderboardTable rows={rows} />;
}
