'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  PublicLiveTrade,
  PublicLiveTradesData,
  PublicLiveTradesResponse,
} from 'agenttrader-types';

import { useSiteLocale } from '@/components/site-locale-provider';
import { cn } from '@/lib/cn';
import { formatRelativeTimestamp } from '@/lib/relative-time';

export function LiveTradesPageClient({
  initialData,
}: {
  initialData: PublicLiveTradesData;
}) {
  const { localeTag, t } = useSiteLocale();
  const [trades, setTrades] = useState<PublicLiveTrade[]>(initialData.items);
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => setTick((value) => value + 1), 10_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/public/live-trades?limit=50', { cache: 'no-store' })
      .then((response) => response.json())
      .then((json: PublicLiveTradesResponse) => {
        if (!cancelled && json?.success && json.data?.items) {
          setTrades(json.data.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTrades(initialData.items);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialData.items]);

  if (!trades.length) {
    return (
      <div className="py-20 text-center text-black/55">
        {t((m) => m.liveTrades.empty)}
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {trades.map((trade) => (
        <article
          key={trade.id}
          className={cn(
            'rounded-xl border bg-white p-4 transition-colors hover:bg-[#fafafa]',
            trade.topTier === 'top_3' ? 'border-[#d7c06e]/70' : 'border-black/10'
          )}
        >
          <div className="flex items-center gap-3">
            <Link
              href={`/agents/${trade.agentId}`}
              className="flex shrink-0 items-center gap-2 hover:underline"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#efede7] text-xs font-bold text-[#171717]">
                {trade.agentName.charAt(0).toUpperCase()}
              </div>
              <span className="text-sm font-medium text-[#171717]">
                {trade.agentName}
              </span>
            </Link>
            {trade.rankSnapshot ? (
              <span className="text-xs text-black/48">(#{trade.rankSnapshot})</span>
            ) : null}
            <span
              className={cn(
                'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold',
                trade.side === 'buy'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-red-100 text-red-700'
              )}
            >
              {formatTradeSide(trade.side, t)}
            </span>
            <span className="text-sm font-medium text-[#171717]">
              {trade.outcomeName ? `${trade.symbol} · ${trade.outcomeName}` : trade.symbol}
            </span>
            <span className="text-sm text-black/56">
              {formatCompactUsd(trade.notionalUsd, localeTag)}
              {trade.fillPrice != null
                ? ` at ${formatTradeExecutionPrice(trade.fillPrice, trade.market ?? null, localeTag)}`
                : ''}
            </span>
            {trade.positionRatio != null ? (
              <span className="hidden text-xs text-black/48 sm:inline">
                {new Intl.NumberFormat(localeTag, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(trade.positionRatio * 100)}
                %
              </span>
            ) : null}
            {trade.reasonTag ? (
              <span className="hidden items-center rounded-full bg-[#f4f4f1] px-2.5 py-0.5 text-xs text-black/56 italic sm:inline-flex">
                {trade.reasonTag}
              </span>
            ) : null}
            <span className="ml-auto text-xs text-black/48">
              {formatRelativeTime(trade.executedAt, localeTag)}
            </span>
          </div>
          {trade.displayRationale ? (
            <p className="mt-2 pl-9 text-sm text-black/58">{trade.displayRationale}</p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function formatCurrency(value: number | null | undefined, locale: string) {
  if (value == null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat(locale || 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatCompactUsd(value: number | null | undefined, locale: string) {
  if (value == null || Number.isNaN(value)) return '--';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return formatCurrency(value, locale);
}

function formatTradeExecutionPrice(
  value: number | null | undefined,
  market: string | null | undefined,
  locale: string
) {
  if (value == null || Number.isNaN(value)) return '--';
  if (market === 'prediction') {
    return `${new Intl.NumberFormat(locale || 'en-US', {
      minimumFractionDigits: value * 100 < 10 ? 1 : 0,
      maximumFractionDigits: 1,
    }).format(value * 100)}c`;
  }

  const fractionDigits = value >= 1_000 ? 0 : value >= 1 ? 2 : 4;
  return new Intl.NumberFormat(locale || 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatTradeSide(side: string, t: ReturnType<typeof useSiteLocale>['t']) {
  const normalized = side.toUpperCase();
  if (normalized === 'BUY') return t((m) => m.homeDashboard.sideBuyUpper);
  if (normalized === 'SELL') return t((m) => m.homeDashboard.sideSellUpper);
  return normalized;
}

function formatRelativeTime(value: string | null | undefined, locale: string) {
  return formatRelativeTimestamp(value, locale);
}
