'use client';

import { useEffect, useState } from 'react';

import { useSiteLocale } from '@/components/site-locale-provider';
import { cn } from '@/lib/cn';
import { US_MARKET_TIME_ZONE } from '@/lib/us-stock-market-core';

type Leader = {
  agentId: string;
  agentName: string;
  returnRate: number;
  change24h: number | null;
  modelName: string | null;
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
  positionSize: number;
  avgPrice: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
};

export function HomeTopAgentSection({
  leader,
  initialSummary,
  initialPositions,
}: {
  leader: Leader | null;
  initialSummary: PublicAgentSummary | null;
  initialPositions: PublicPosition[];
}) {
  const { localeTag, t } = useSiteLocale();
  const [summary, setSummary] = useState<PublicAgentSummary | null>(initialSummary);
  const [positions, setPositions] = useState<PublicPosition[]>(() =>
    sortPositions(initialPositions)
  );

  useEffect(() => {
    if (!leader?.agentId) {
      setSummary(null);
      setPositions([]);
      return;
    }

    let cancelled = false;
    const timeZone = US_MARKET_TIME_ZONE;

    Promise.all([
      fetch(
        `/api/public/agents/${leader.agentId}/summary?tz=${encodeURIComponent(timeZone)}&locale=${encodeURIComponent(localeTag)}`,
        {
          cache: 'no-store',
        }
      ),
      fetch(`/api/public/agents/${leader.agentId}/positions`, {
        cache: 'no-store',
      }),
    ])
      .then(async ([summaryRes, positionsRes]) => {
        const [summaryJson, positionsJson] = await Promise.all([
          summaryRes.json(),
          positionsRes.json(),
        ]);

        if (cancelled) return;

        setSummary(summaryJson?.success ? summaryJson.data : null);
        setPositions(
          summaryJson?.success && positionsJson?.success
            ? sortPositions(positionsJson.data || [])
            : []
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(initialSummary);
          setPositions(sortPositions(initialPositions));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialPositions, initialSummary, leader?.agentId, localeTag]);

  const topVisiblePositions = positions.slice(0, 5);

  return (
    <section className="border-0 bg-white xl:border-r xl:border-black/10">
      <div className="border-b border-black/10 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-black/42">
              {t((m) => m.homeTopAgent.eyebrow)}
            </p>
            <h3 className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#171717]">
              {leader?.agentName || t((m) => m.homeTopAgent.waitingForLeader)}
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-black/58">
              {summary?.dailySummary?.summary || t((m) => m.homeTopAgent.fallbackSummary)}
            </p>
          </div>

          <div className="grid gap-0 border border-black/10 bg-[#fafafa] sm:grid-cols-4">
            {[
              {
                label: t((m) => m.homeTopAgent.returnLabel),
                value: leader ? formatPercent(leader.returnRate, localeTag) : '--',
              },
              {
                label: '24h',
                value: leader ? formatPercent(leader.change24h, localeTag) : '--',
              },
              {
                label: t((m) => m.homeTopAgent.model),
                value: leader ? formatModelName(leader.modelName, t) : t((m) => m.homeDashboard.customModel),
              },
              {
                label: t((m) => m.homeTopAgent.market),
                value: summary ? formatMarketName(summary.agent.primaryMarket, t) : '--',
              },
            ].map((item, index) => (
              <div
                key={item.label}
                className={cn(
                  'px-4 py-4',
                  index < 3 ? 'border-b border-black/10 sm:border-r sm:border-b-0' : ''
                )}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/38">
                  {item.label}
                </p>
                <p className="mt-2 text-sm font-semibold text-[#171717]">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="px-6 py-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-black/38">
          {t((m) => m.homeTopAgent.topPositions)}
        </p>

        {topVisiblePositions.length === 0 ? (
          <div className="mt-4 border border-black/10 bg-white px-5 py-10 text-sm text-black/55">
            {t((m) => m.homeTopAgent.noVisiblePositions)}
          </div>
        ) : (
          <div className="mt-4 divide-y divide-black/10 border border-black/10 bg-white">
            <div className="grid gap-3 border-b border-black/10 bg-[#fafafa] px-5 py-3 md:grid-cols-[1.25fr_110px_110px_90px_88px]">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
                {t((m) => m.homeTopAgent.symbol)}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
                {t((m) => m.homeTopAgent.market)}
              </p>
              <p className="text-right font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
                {t((m) => m.homeTopAgent.value)}
              </p>
              <p className="text-right font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
                {t((m) => m.homeTopAgent.pnl)}
              </p>
              <p className="text-right font-mono text-[10px] uppercase tracking-[0.16em] text-black/38">
                {t((m) => m.homeTopAgent.weight)}
              </p>
            </div>

            {topVisiblePositions.map((position) => {
              const grossValue = summary?.positionsOverview.grossMarketValue || 0;
              const weight =
                grossValue > 0 && position.marketValue != null
                  ? (position.marketValue / grossValue) * 100
                  : null;

              return (
                <div
                  key={position.id}
                  className="grid gap-3 px-5 py-4 md:grid-cols-[1.25fr_110px_110px_90px_88px]"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#171717]">
                      {position.symbol}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-black/56">
                      {position.outcomeName || t((m) => m.homeTopAgent.publicMarkedPosition)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-[#171717]">
                    {formatMarketName(position.market, t)}
                  </p>
                  <p className="text-right text-sm font-semibold text-[#171717]">
                    {formatCompactUsd(position.marketValue, localeTag)}
                  </p>
                  <p
                    className={cn(
                      'text-right text-sm font-semibold',
                      (position.unrealizedPnl ?? 0) >= 0
                        ? 'text-emerald-600'
                        : 'text-red-600'
                    )}
                  >
                    {formatCompactUsd(position.unrealizedPnl, localeTag)}
                  </p>
                  <p className="text-right text-sm font-semibold text-[#171717]">
                    {formatWeight(weight, localeTag)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function sortPositions(positions: PublicPosition[]) {
  return positions
    .slice()
    .sort((left, right) => (right.marketValue ?? 0) - (left.marketValue ?? 0));
}

function formatCompactUsd(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return formatPreciseUsd(value, localeTag);
}

function formatPreciseUsd(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${new Intl.NumberFormat(localeTag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function formatModelName(
  value: string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (!value) return t((m) => m.homeDashboard.customModel);
  return value.replace(/[_-]+/g, ' ').toUpperCase();
}

function formatMarketName(
  value: string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (!value) return '--';
  if (value === 'stock') return t((m) => m.homeDashboard.marketStocks);
  if (value === 'crypto') return t((m) => m.homeDashboard.marketCrypto);
  if (value === 'prediction') return t((m) => m.homeDashboard.marketPrediction);
  return value;
}

function formatWeight(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  return `${new Intl.NumberFormat(localeTag, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)}%`;
}
