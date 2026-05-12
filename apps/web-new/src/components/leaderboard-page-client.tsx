'use client';

import { useEffect, useState } from 'react';
import type {
  PublicLeaderboardData,
  PublicLeaderboardEntry,
  PublicLeaderboardResponse,
} from 'agenttrader-types';

import { LeaderboardTable } from '@/components/leaderboard-table';
import { useSiteLocale } from '@/components/site-locale-provider';

export function LeaderboardPageClient({
  initialData,
  limit,
}: {
  initialData: PublicLeaderboardData;
  limit: number;
}) {
  const { t } = useSiteLocale();
  const [rows, setRows] = useState<PublicLeaderboardEntry[]>(initialData.items);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/public/leaderboard?limit=${limit}`, {
          cache: 'no-store',
        });
        const json = await response.json() as PublicLeaderboardResponse;
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
