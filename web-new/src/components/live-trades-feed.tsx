'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { useSiteLocale } from '@/components/site-locale-provider';
import { cn } from '@/lib/cn';
import { formatUsMarketDateTime } from '@/lib/us-market-time';

type LiveTradeItem = {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatar?: string | null;
  symbol: string;
  side: string;
  notionalUsd: number;
  fillPrice?: number | null;
  outcomeName: string | null;
  reasonTag: string | null;
  displayRationale: string | null;
  rankSnapshot?: number | null;
  executedAt: string | null;
};

export function LiveTradesFeed({
  items,
  relativeTime = false,
  live = false,
  refreshUrl,
  displaySize,
}: {
  items: LiveTradeItem[];
  relativeTime?: boolean;
  live?: boolean;
  refreshUrl?: string;
  displaySize?: number;
}) {
  const { localeTag, t } = useSiteLocale();
  const maxItems = displaySize ?? items.length;
  const [trades, setTrades] = useState<LiveTradeItem[]>(() => items.slice(0, maxItems));
  const [latestTradeId, setLatestTradeId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    setTrades(items.slice(0, maxItems));
  }, [items, maxItems]);

  useEffect(() => {
    if (!relativeTime) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 10_000);
    return () => window.clearInterval(timer);
  }, [relativeTime]);

  useEffect(() => {
    if (!live || !refreshUrl) return;

    let cancelled = false;

    const refreshTrades = async () => {
      try {
        const response = await fetch(refreshUrl, { cache: 'no-store' });
        const json = await response.json();

        if (!cancelled && json?.success) {
          const nextItems = ((json.data?.items || []) as LiveTradeItem[]).slice(0, maxItems);
          const incomingLatestTradeId = nextItems[0]?.id ?? null;

          setTrades((currentTrades) => {
            const previousLatestTradeId = currentTrades[0]?.id ?? null;
            if (
              incomingLatestTradeId &&
              incomingLatestTradeId !== previousLatestTradeId
            ) {
              setLatestTradeId(incomingLatestTradeId);
            }
            return nextItems;
          });
        }
      } catch {
        if (!cancelled) {
          setLatestTradeId(null);
        }
      }
    };

    void refreshTrades();
    const timer = window.setInterval(refreshTrades, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [live, maxItems, refreshUrl]);

  return (
    <div className="flex flex-1 flex-col divide-y divide-black/10">
      {trades.map((trade) => (
        <article
          key={`${trade.id}-${latestTradeId ?? 'base'}`}
          className={cn(
            'flex flex-1 flex-col justify-center px-6 py-5',
            trade.id === latestTradeId
              ? 'animate-[feed-enter_420ms_cubic-bezier(0.2,1,0.3,1)]'
              : latestTradeId
                ? 'animate-[feed-shift_320ms_ease-out]'
                : ''
          )}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {trade.agentAvatar ? (
                <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-black/5">
                  <Image
                    src={trade.agentAvatar}
                    alt={trade.agentName}
                    fill
                    sizes="32px"
                    className="object-cover"
                  />
                </span>
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#efede7] text-xs font-bold text-[#171717]">
                  {trade.agentName.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="flex min-w-0 items-baseline gap-1 text-base font-semibold tracking-[-0.03em] text-[#171717] md:text-lg">
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
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/38">
              {relativeTime
                ? formatRelativeTime(trade.executedAt, localeTag)
                : formatTime(trade.executedAt, localeTag)}
            </p>
          </div>

          <div className="mt-3 grid grid-cols-[auto_auto_1fr] items-center gap-x-6 gap-y-2 text-[15px] font-semibold tracking-[-0.01em] text-[#171717] sm:gap-x-8">
            <span className={cn('lowercase', getTradeTone(trade.side))}>
              {formatTradeSide(trade.side, t)}
            </span>
            <span>
              {trade.outcomeName ? `${trade.symbol} · ${trade.outcomeName}` : trade.symbol}
            </span>
            <span>
              {`${t((m) => m.liveTrades.amount)} ${formatPreciseUsd(trade.notionalUsd, localeTag)}`}
              {trade.fillPrice != null
                ? ` · ${t((m) => m.liveTrades.price)} ${formatPreciseUsd(trade.fillPrice, localeTag)}`
                : ''}
            </span>
          </div>

          <p className="mt-3 border-l border-black/12 pl-4 text-sm leading-7 text-black/58">
            {trade.displayRationale || trade.reasonTag || t((m) => m.liveTrades.marketMove)}
          </p>
        </article>
      ))}
    </div>
  );
}

function getTradeTone(side: string) {
  const normalized = side.toUpperCase();
  if (normalized === 'BUY') return 'text-emerald-600';
  if (normalized === 'SELL') return 'text-red-600';
  return 'text-[#171717]';
}

function formatTradeSide(side: string, t: ReturnType<typeof useSiteLocale>['t']) {
  const normalized = side.toUpperCase();
  if (normalized === 'BUY') return t((m) => m.homeDashboard.sideBuyLower);
  if (normalized === 'SELL') return t((m) => m.homeDashboard.sideSellLower);
  return side.toLowerCase();
}

function formatPreciseUsd(value: number | null | undefined, locale: string) {
  if (value == null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat(locale || 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTime(value: string | null | undefined, locale: string) {
  return formatUsMarketDateTime(value, locale, 'dateTime');
}

function formatRelativeTime(value: string | null | undefined, locale: string) {
  if (!value) return '--';
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return formatter.format(-seconds, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');
  return formatter.format(-Math.floor(hours / 24), 'day');
}
