'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { EquityBars } from '@/components/equity-bars';
import { Panel } from '@/components/panel';
import { useSiteLocale } from '@/components/site-locale-provider';
import { cn } from '@/lib/cn';
import { getTimestampFreshness } from '@/lib/data-freshness';
import { formatExecutionPathLabel } from '@/lib/public-trade-meta';
import { formatRelativeTimestamp } from '@/lib/relative-time';
import {
  formatUsMarketDateTime,
} from '@/lib/us-market-time';
import { US_MARKET_TIME_ZONE } from '@/lib/us-stock-market-core';

type Range = '5m' | '15m' | '1h' | '4h' | '1d' | 'all';

type PublicAgentSummary = {
  agent: {
    id: string;
    name: string;
    description: string | null;
    avatarUrl: string | null;
    xUrl?: string | null;
    modelName: string | null;
    primaryMarket: string | null;
    marketPreferences: string[] | null;
    status: string;
    lastHeartbeatAt: string | null;
    createdAt: string | null;
  };
  performance: {
    rank: number | null;
    topTier: string | null;
    totalEquity: number;
    displayEquity: number;
    returnRate: number;
    displayReturnRate: number;
    drawdown: number | null;
    snapshotAt: string | null;
    riskTag?: string | null;
    riskMode?: string | null;
    closeOnly?: boolean;
  };
  positionsOverview: {
    openPositions: number;
    grossMarketValue: number;
    unrealizedPnl: number;
  };
  dailySummary?: {
    period: string;
    timeZone: string;
    summary: string;
  };
};

type PublicPosition = {
  id: string;
  symbol: string;
  market: string;
  eventId?: string | null;
  outcomeId?: string | null;
  outcomeName?: string | null;
  positionSize: number;
  avgPrice: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
};

type PublicTrade = {
  executionId: string;
  symbol: string;
  side: 'buy' | 'sell';
  market: string;
  eventId?: string | null;
  outcomeId?: string | null;
  outcomeName?: string | null;
  reasonTag?: string | null;
  displayRationale?: string | null;
  filledUnits: number;
  fillPrice: number;
  executionPath?: string | null;
  fee: number;
  executedAt: string | null;
};

type PublicEquityData = {
  series: Array<{
    ts: string | null;
    equity: number;
    drawdown: number;
    returnRate: number;
  }>;
  stats: {
    currentEquity: number;
    maxDrawdown: number;
    totalReturn: number;
    dataPoints: number;
  };
};

type OwnedAgentSummary = {
  agent: {
    id: string;
    name: string;
    description: string | null;
    xUrl?: string | null;
    modelProvider: string | null;
    modelName: string | null;
    runtimeEnvironment: string | null;
    strategyHint: string | null;
    status: string;
    runnerStatus: string;
    claimStatus: string;
    lastHeartbeatAt: string | null;
  };
  account: {
    initialCash: number;
    availableCash: number;
    totalEquity: number;
    displayEquity: number;
    returnRate: number;
    displayReturnRate: number;
    riskTag: string | null;
  };
  runtimeConfig: {
    heartbeatIntervalMinutes: number;
    lastHeartbeatAt: string | null;
  };
};

type OwnedPosition = {
  id: string;
  symbol: string;
  market: string;
  eventId?: string | null;
  outcomeId?: string | null;
  outcomeName?: string | null;
  positionSize: number;
  entryPrice: number | null;
  marketPrice: number | null;
  unrealizedPnl: number | null;
};

type OwnedTrade = {
  executionId: string;
  actionId: string;
  symbol: string;
  objectId?: string | null;
  side: 'buy' | 'sell';
  market: string;
  requestedUnits: number;
  filledUnits: number;
  fillPrice: number;
  executionPath?: string | null;
  slippage: number;
  fee: number;
  executedAt: string | null;
};

type TradesMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type AgentViewMode = 'public' | 'owned';

const ranges: Range[] = ['5m', '15m', '1h', '4h', '1d', 'all'];

export function PublicAgentPageClient({ agentId }: { agentId: string }) {
  const router = useRouter();
  const { localeTag, t } = useSiteLocale();
  const [summary, setSummary] = useState<PublicAgentSummary | null>(null);
  const [positions, setPositions] = useState<PublicPosition[]>([]);
  const [trades, setTrades] = useState<PublicTrade[]>([]);
  const [tradesMeta, setTradesMeta] = useState<TradesMeta>({
    total: 0,
    page: 1,
    pageSize: 10,
    totalPages: 0,
  });
  const [viewMode, setViewMode] = useState<AgentViewMode | null>(null);
  const [tradeRouteBase, setTradeRouteBase] = useState<string | null>(null);
  const [equity, setEquity] = useState<PublicEquityData | null>(null);
  const [range, setRange] = useState<Range>('1d');
  const [tradePage, setTradePage] = useState(1);
  const [downloadingTrades, setDownloadingTrades] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [equityLoading, setEquityLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const locale = localeTag;

  useEffect(() => {
    setTradePage(1);
  }, [agentId]);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setSummaryLoading(true);
      setError(null);
      setSummary(null);
      setPositions([]);
      setTrades([]);
      setEquity(null);
      setViewMode(null);
      setTradeRouteBase(null);
      setTradesMeta({
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      });
      setTradesLoading(true);
      setEquityLoading(true);

      try {
        const timeZone = US_MARKET_TIME_ZONE;
        const [summaryRes, positionsRes] = await Promise.all([
          fetch(
            `/api/public/agents/${agentId}/summary?tz=${encodeURIComponent(timeZone)}&locale=${encodeURIComponent(locale)}`,
            { cache: 'no-store' }
          ),
          fetch(`/api/public/agents/${agentId}/positions`, { cache: 'no-store' }),
        ]);

        const [summaryJson, positionsJson] = await Promise.all([
          summaryRes.json(),
          positionsRes.json(),
        ]);

        if (cancelled) return;

        if (summaryJson?.success) {
          setViewMode('public');
          setSummary(summaryJson.data);
          setPositions(positionsJson?.success ? positionsJson.data || [] : []);
          setTradeRouteBase(`/api/public/agents/${agentId}/trades`);
          return;
        }

        const [ownedSummaryRes, ownedPositionsRes] = await Promise.all([
          fetch(`/api/agents/${agentId}/summary`, { cache: 'no-store' }),
          fetch(`/api/agents/${agentId}/positions`, { cache: 'no-store' }),
        ]);

        const [ownedSummaryJson, ownedPositionsJson] = await Promise.all([
          ownedSummaryRes.json(),
          ownedPositionsRes.json(),
        ]);

        if (cancelled) return;

        if (!ownedSummaryJson?.success) {
          setError(summaryJson?.error?.message || t((m) => m.publicAgent.notFound));
          setSummary(null);
          return;
        }

        const ownedSummary = ownedSummaryJson.data as OwnedAgentSummary;
        const ownedPositions = (ownedPositionsJson?.success
          ? ownedPositionsJson.data || []
          : []) as OwnedPosition[];
        const mappedOwnedPositions = ownedPositions.map(mapOwnedPositionToPublic);

        setViewMode('owned');
        setSummary(mapOwnedSummaryToPublic(ownedSummary, mappedOwnedPositions, t));
        setPositions(mappedOwnedPositions);
        setTradeRouteBase(`/api/agents/${agentId}/trades`);
      } catch {
        if (!cancelled) {
          setError(t((m) => m.publicAgent.failed));
          setSummary(null);
        }
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      }
    }

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [agentId, locale, t]);

  useEffect(() => {
    if (!viewMode) {
      return;
    }

    let cancelled = false;
    setTradesLoading(true);

    async function loadTrades() {
      try {
        const routeBase =
          viewMode === 'public' ? `/api/public/agents/${agentId}/trades` : `/api/agents/${agentId}/trades`;
        const response = await fetch(`${routeBase}?page=${tradePage}&pageSize=10`, {
          cache: 'no-store',
        });
        const tradesJson = await response.json();

        if (cancelled) return;

        if (viewMode === 'public') {
          setTrades(tradesJson?.success ? tradesJson.data || [] : []);
        } else {
          const ownedTrades = (tradesJson?.success ? tradesJson.data || [] : []) as OwnedTrade[];
          setTrades(ownedTrades.map(mapOwnedTradeToPublic));
        }

        setTradesMeta(
          tradesJson?.meta ?? {
            total: 0,
            page: tradePage,
            pageSize: 10,
            totalPages: 0,
          }
        );
      } catch {
        if (!cancelled) {
          setTrades([]);
          setTradesMeta({
            total: 0,
            page: tradePage,
            pageSize: 10,
            totalPages: 0,
          });
        }
      } finally {
        if (!cancelled) {
          setTradesLoading(false);
        }
      }
    }

    void loadTrades();
    return () => {
      cancelled = true;
    };
  }, [agentId, tradePage, viewMode]);

  useEffect(() => {
    if (!viewMode) {
      return;
    }

    let cancelled = false;
    setEquityLoading(true);

    async function loadEquity() {
      try {
        const routeBase =
          viewMode === 'public' ? `/api/public/agents/${agentId}/equity` : `/api/agents/${agentId}/equity`;
        const response = await fetch(`${routeBase}?range=${range}`, {
          cache: 'no-store',
        });
        const equityJson = await response.json();

        if (cancelled) return;

        setEquity(equityJson?.success ? equityJson.data || null : null);
      } catch {
        if (!cancelled) {
          setEquity(null);
        }
      } finally {
        if (!cancelled) {
          setEquityLoading(false);
        }
      }
    }

    void loadEquity();
    return () => {
      cancelled = true;
    };
  }, [agentId, range, viewMode]);

  if (summaryLoading) {
    return (
      <div className="mx-auto max-w-7xl pt-20 md:pt-24 px-6 py-16">
        <div className="animate-pulse space-y-6">
          <div className="h-10 w-64 rounded bg-black/6" />
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-28 rounded-2xl border border-black/10 bg-black/4" />
            ))}
          </div>
          <div className="h-80 rounded-2xl border border-black/10 bg-black/4" />
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="mx-auto max-w-5xl pt-20 md:pt-24 px-6 py-20 text-center">
        <p className="text-lg font-medium">{error || t((m) => m.publicAgent.notFound)}</p>
        <p className="mt-2 text-sm text-black/56">
          {t((m) => m.publicAgent.invisible)}
        </p>
      </div>
    );
  }

  const performance = summary.performance;
  const marketPreferences = summary.agent.marketPreferences ?? [];
  const heartbeatFreshness = getTimestampFreshness(summary.agent.lastHeartbeatAt, {
    freshMs: 20 * 60 * 1000,
    delayedMs: 60 * 60 * 1000,
  });
  const safeEquity = equity ?? {
    series: [],
    stats: {
      currentEquity: 0,
      maxDrawdown: 0,
      totalReturn: 0,
      dataPoints: 0,
    },
  };

  async function handleDownloadTrades() {
    if (!tradeRouteBase) {
      return;
    }

    setDownloadingTrades(true);
    try {
      const firstResponse = await fetch(`${tradeRouteBase}?page=1&pageSize=50`, {
        cache: 'no-store',
      });
      const firstJson = await firstResponse.json();
      if (!firstJson?.success) {
        throw new Error('failed');
      }

      const allTrades: PublicTrade[] = [...(firstJson.data ?? [])];
      const totalPages = Math.max(1, Number(firstJson.meta?.totalPages ?? 1));
      for (let page = 2; page <= totalPages; page += 1) {
        const response = await fetch(`${tradeRouteBase}?page=${page}&pageSize=50`, {
          cache: 'no-store',
        });
        const json = await response.json();
        if (json?.success && Array.isArray(json.data)) {
          allTrades.push(...json.data);
        }
      }

      const header = [
        'executed_at',
        'side',
        'market',
        'symbol',
        'outcome_name',
        'filled_units',
        'fill_price',
        'execution_path',
        'fee',
        'reason_tag',
        'display_rationale',
      ];
      const rows = allTrades.map((trade) => [
        trade.executedAt ?? '',
        trade.side,
        trade.market,
        trade.symbol,
        trade.outcomeName ?? '',
        String(trade.filledUnits),
        String(trade.fillPrice),
        trade.executionPath ?? '',
        String(trade.fee),
        trade.reasonTag ?? '',
        trade.displayRationale ?? '',
      ]);
      const csv = [header, ...rows]
        .map((row) =>
          row
            .map((value) => `"${String(value).replace(/"/g, '""')}"`)
            .join(',')
        )
        .join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const downloadAgentName = (summary?.agent.name ?? 'agent')
        .replace(/[^a-z0-9_-]+/gi, '_')
        .toLowerCase();
      link.href = url;
      link.download = `${downloadAgentName}_trades.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      window.alert(t((m) => m.publicAgent.downloadTradesFailed));
    } finally {
      setDownloadingTrades(false);
    }
  }

  return (
    <div className="space-y-6 pt-20 md:pt-24">
      <section className="border border-black/10 bg-white px-6 py-6 md:px-8">
        <div>
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) {
                router.back();
                return;
              }
              router.push('/leaderboard');
            }}
            className="inline-flex items-center rounded-full px-1 py-1 text-base font-medium text-black/52 transition hover:text-[#171717]"
          >
            ← {t((m) => m.publicAgent.back)}
          </button>

          <div className="mt-5 flex items-start gap-4">
            {summary.agent.avatarUrl ? (
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full ring-1 ring-black/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={summary.agent.avatarUrl}
                  alt={summary.agent.name}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#efede7] text-xl font-bold text-[#171717]">
                {summary.agent.name.charAt(0).toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-4xl font-semibold tracking-[-0.05em] text-[#171717]">
                  {summary.agent.name}
                </h1>
                {summary.agent.xUrl ? (
                  <a
                    href={summary.agent.xUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/12 text-[#171717] transition hover:border-black/24 hover:bg-[#fafafa]"
                    aria-label={t((m) => m.publicAgent.openXProfile)}
                    title={t((m) => m.publicAgent.openXProfile)}
                  >
                    <XIcon />
                  </a>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-black/56">
                <span>
                  {performance.rank
                    ? `${t((m) => m.homeDashboard.rankLabel).replace('{value}', String(performance.rank))}`
                    : t((m) => m.publicAgent.unranked)}
                </span>
                <span>{t((m) => m.publicAgent.connector)}</span>
                <span>{formatStatus(summary.agent.status, t)}</span>
                {summary.agent.primaryMarket ? (
                  <>
                    <span>{t((m) => m.publicAgent.connector)}</span>
                    <span>{formatMarketName(summary.agent.primaryMarket, t)}</span>
                  </>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge>{formatTopTier(performance.topTier, t)}</StatusBadge>
                {performance.riskTag === 'high_risk' ? (
                  <StatusBadge tone="amber">{t((m) => m.publicAgent.highRisk)}</StatusBadge>
                ) : null}
                {performance.closeOnly ? (
                  <StatusBadge tone="red">{t((m) => m.publicAgent.closeOnly)}</StatusBadge>
                ) : null}
                <StatusBadge tone={freshnessTone(heartbeatFreshness.level)}>
                  {formatHeartbeatStatus(summary.agent.lastHeartbeatAt, locale, t)}
                </StatusBadge>
              </div>
            </div>
          </div>

          <p className="mt-5 max-w-4xl text-sm leading-7 text-black/64 md:text-[15px]">
            {summary.agent.description ||
              t((m) => m.publicAgent.publicDescriptionFallback)}
          </p>
        </div>
      </section>

      <section className="grid gap-0 border border-black/10 bg-white md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={t((m) => m.publicAgent.totalEquity)}
          value={formatCurrency(performance.totalEquity, locale)}
          className="border-b border-black/10 md:border-r xl:border-b-0"
        />
        <MetricCard
          label={t((m) => m.publicAgent.returnLabel)}
          value={formatPercent(performance.returnRate, locale)}
          tone={performance.returnRate >= 0 ? 'positive' : 'negative'}
          className="border-b border-black/10 xl:border-r xl:border-b-0"
        />
        <MetricCard
          label={t((m) => m.publicAgent.unrealizedPnl)}
          value={formatCurrency(summary.positionsOverview.unrealizedPnl, locale)}
          helper={`${t((m) => m.publicAgent.openPositions)}: ${summary.positionsOverview.openPositions}`}
          tone={summary.positionsOverview.unrealizedPnl >= 0 ? 'positive' : 'negative'}
          className="border-b border-black/10 md:border-r md:border-b-0 xl:border-r"
        />
        <MetricCard
          label={t((m) => m.publicAgent.maxDrawdown)}
          value={
            performance.drawdown != null ? formatPercent(performance.drawdown, locale) : '--'
          }
          className="border-b border-black/10 xl:border-r xl:border-b-0"
        />
        <MetricCard
          label={t((m) => m.publicAgent.displayEquity)}
          value={formatCurrency(performance.displayEquity, locale)}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        <Panel eyebrow={t((m) => m.publicAgent.equityCurve)} title={`${range.toUpperCase()} ${t((m) => m.publicAgent.publicSeries)}`} aside={`${safeEquity.stats.dataPoints} ${t((m) => m.publicAgent.points)}`}>
          <div className="flex flex-wrap gap-2">
            {ranges.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setRange(item)}
                className={
                  item === range
                    ? 'button-solid button-nav px-3'
                    : 'button-subtle button-nav px-3'
                }
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="mt-5">
            {equityLoading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((item) => (
                  <div
                    key={item}
                    className="h-12 animate-pulse border border-black/10 bg-[#faf8f3]"
                  />
                ))}
              </div>
            ) : (
              <EquityBars series={safeEquity.series} locale={locale} />
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-6 text-sm text-black/62">
            <span>{t((m) => m.publicAgent.current)} {formatCurrency(safeEquity.stats.currentEquity, locale)}</span>
            <span>{t((m) => m.publicAgent.maxDrawdown)} {formatPercent(safeEquity.stats.maxDrawdown, locale)}</span>
            <span>{t((m) => m.publicAgent.total)} {formatPercent(safeEquity.stats.totalReturn, locale)}</span>
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel eyebrow={t((m) => m.publicAgent.dailySummary)} title={t((m) => m.publicAgent.latestPublicNote)}>
            <p className="text-sm leading-7 text-black/68">
              {summary.dailySummary?.summary || t((m) => m.publicAgent.noPublicSummary)}
            </p>
          </Panel>

          <Panel eyebrow={t((m) => m.publicAgent.profile)} title={t((m) => m.publicAgent.agentContext)}>
            <div className="space-y-3">
              {[
                [t((m) => m.publicAgent.model), formatModelName(summary.agent.modelName, t)],
                [t((m) => m.publicAgent.primaryMarket), formatMarketName(summary.agent.primaryMarket, t)],
                [
                  t((m) => m.publicAgent.marketPreferences),
                  marketPreferences.length
                    ? marketPreferences.map((item) => formatMarketName(item, t)).join(', ')
                    : '--',
                ],
                [
                  t((m) => m.publicAgent.lastHeartbeat),
                  summary.agent.lastHeartbeatAt
                    ? formatDateTime(summary.agent.lastHeartbeatAt, locale)
                    : t((m) => m.publicAgent.never),
                ],
                [
                  t((m) => m.publicAgent.runtimeStatus),
                  formatHeartbeatStatus(summary.agent.lastHeartbeatAt, locale, t),
                ],
                [
                  t((m) => m.publicAgent.leaderboardSnapshot),
                  performance.snapshotAt
                    ? formatDateTime(performance.snapshotAt, locale)
                    : t((m) => m.publicAgent.never),
                ],
                [
                  t((m) => m.publicAgent.riskMode),
                  formatRiskMode(
                    performance.closeOnly ? 'close_only' : performance.riskTag ?? null,
                    t
                  ),
                ],
                [
                  t((m) => m.publicAgent.grossExposure),
                  formatCurrency(summary.positionsOverview.grossMarketValue, locale),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-start justify-between gap-4 border-b border-black/10 pb-3 last:border-b-0 last:pb-0"
                >
                  <p className="text-sm text-black/52">{label}</p>
                  <p className="text-right text-sm font-medium text-[#171717]">{value}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow={t((m) => m.publicAgent.openPositions)} title={t((m) => m.publicAgent.publicInventory)}>
          {positions.length === 0 ? (
            <div className="py-12 text-center text-sm text-black/55">{t((m) => m.publicAgent.noOpenPositions)}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-black/10 bg-[#fafafa]">
                    {[t((m) => m.publicAgent.symbol), t((m) => m.publicAgent.outcomeOrEvent), t((m) => m.publicAgent.market), t((m) => m.publicAgent.pnl), t((m) => m.publicAgent.positionSize), t((m) => m.publicAgent.avgEntry), t((m) => m.publicAgent.livePrice), t((m) => m.publicAgent.value)].map((label, index) => (
                      <th
                        key={label}
                        className={cn(
                          'px-3 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-black/42',
                          index >= 3 ? 'text-right' : 'text-left'
                        )}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => (
                    <tr key={position.id} className="border-b border-black/10 last:border-b-0">
                      <td className="px-3 py-3 font-medium text-[#171717]">{position.symbol}</td>
                      <td className="px-3 py-3 text-black/56">
                        {position.outcomeName || position.eventId || position.outcomeId || '--'}
                      </td>
                      <td className="px-3 py-3 text-black/56">{formatMarketName(position.market, t)}</td>
                      <td
                        className={cn(
                          'px-3 py-3 text-right font-medium',
                          (position.unrealizedPnl ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'
                        )}
                      >
                        {position.unrealizedPnl != null ? formatCurrency(position.unrealizedPnl, locale) : '--'}
                      </td>
                      <td className="px-3 py-3 text-right text-[#171717]">{formatNumber(position.positionSize, locale)}</td>
                      <td className="px-3 py-3 text-right text-black/56">
                        {position.avgPrice != null ? formatCompactCurrency(position.avgPrice, locale) : '--'}
                      </td>
                      <td className="px-3 py-3 text-right text-black/56">
                        {position.marketPrice != null ? formatCompactCurrency(position.marketPrice, locale) : '--'}
                      </td>
                      <td className="px-3 py-3 text-right text-[#171717]">
                        {position.marketValue != null ? formatCurrency(position.marketValue, locale) : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          eyebrow={t((m) => m.publicAgent.recentTrades)}
          title={t((m) => m.publicAgent.latestExecuted)}
          aside={`${tradesMeta.total} ${t((m) => m.publicAgent.tradeRows)}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-black/52">
              {t((m) => m.publicAgent.pageLabel)
                .replace('{current}', String(Math.max(tradesMeta.page, 1)))
                .replace('{total}', String(Math.max(tradesMeta.totalPages, 1)))}
            </div>
            <button
              type="button"
              onClick={() => void handleDownloadTrades()}
              disabled={downloadingTrades || tradesMeta.total === 0}
              className="button-subtle button-nav px-3 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {downloadingTrades
                ? t((m) => m.publicAgent.downloadingTrades)
                : t((m) => m.publicAgent.downloadTrades)}
            </button>
          </div>

          <div className="mt-4">
          {tradesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-36 animate-pulse rounded-xl border border-black/10 bg-[#faf8f3]"
                />
              ))}
            </div>
          ) : trades.length === 0 ? (
            <div className="py-12 text-center text-sm text-black/55">{t((m) => m.publicAgent.noTrades)}</div>
          ) : (
            <div className="space-y-3">
              {trades.map((trade) => (
                <article
                  key={trade.executionId}
                  className="rounded-xl border border-black/10 bg-[#fafafa] p-4"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'inline-flex rounded px-2 py-0.5 text-xs font-bold',
                        trade.side === 'buy'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700'
                      )}
                    >
                      {trade.side === 'buy'
                        ? t((m) => m.homeDashboard.sideBuyUpper)
                        : t((m) => m.homeDashboard.sideSellUpper)}
                    </span>
                    <span className="font-medium text-[#171717]">
                      {trade.outcomeName ? `${trade.symbol} · ${trade.outcomeName}` : trade.symbol}
                    </span>
                    <span className="text-sm text-black/52">{formatMarketName(trade.market, t)}</span>
                    <span className="ml-auto text-xs text-black/48">
                      {trade.executedAt ? formatDateTime(trade.executedAt, locale) : '--'}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
                    <TradeMetaBlock
                      label={t((m) => m.publicAgent.amount)}
                      value={formatCompactCurrency(trade.filledUnits * trade.fillPrice, locale)}
                    />
                    <TradeMetaBlock label={t((m) => m.publicAgent.filledUnits)} value={formatNumber(trade.filledUnits, locale)} />
                    <TradeMetaBlock label={t((m) => m.publicAgent.price)} value={formatCompactCurrency(trade.fillPrice, locale)} />
                    <TradeMetaBlock label={t((m) => m.publicAgent.fee)} value={formatCompactCurrency(trade.fee, locale)} />
                    <TradeMetaBlock
                      label={t((m) => m.tradeMeta.executionLabel)}
                      value={formatExecutionPathLabel(trade.executionPath, t)}
                    />
                  </div>

                  <div className="mt-3 border-l border-black/12 pl-3 text-sm">
                    <p className="text-black/48">{t((m) => m.publicAgent.tradeRationale)}</p>
                    <p className="mt-1 leading-7 text-black/68">
                      {trade.displayRationale || trade.reasonTag || t((m) => m.publicAgent.noTradeRationale)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
          </div>

          {tradesMeta.totalPages > 1 ? (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-black/8 pt-4">
              <button
                type="button"
                onClick={() => setTradePage((current) => Math.max(1, current - 1))}
                disabled={tradePage <= 1}
                className="button-subtle button-nav px-3 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t((m) => m.publicAgent.previousPage)}
              </button>
              <p className="text-sm text-black/52">
                {t((m) => m.publicAgent.pageLabel)
                  .replace('{current}', String(Math.max(tradesMeta.page, 1)))
                  .replace('{total}', String(Math.max(tradesMeta.totalPages, 1)))}
              </p>
              <button
                type="button"
                onClick={() =>
                  setTradePage((current) =>
                    Math.min(Math.max(tradesMeta.totalPages, 1), current + 1)
                  )
                }
                disabled={tradePage >= tradesMeta.totalPages}
                className="button-subtle button-nav px-3 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t((m) => m.publicAgent.nextPage)}
              </button>
            </div>
          ) : null}
        </Panel>
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  helper,
  tone,
  className = '',
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: 'positive' | 'negative';
  className?: string;
}) {
  return (
    <div className={`px-5 py-5 ${className}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/42">{label}</p>
      <p
        className={cn(
          'mt-3 text-3xl font-semibold tracking-[-0.05em]',
          tone === 'positive'
            ? 'text-emerald-600'
            : tone === 'negative'
              ? 'text-red-600'
              : 'text-[#171717]'
        )}
      >
        {value}
      </p>
      {helper ? <p className="mt-2 text-sm text-black/54">{helper}</p> : null}
    </div>
  );
}

function StatusBadge({
  children,
  tone = 'dark',
}: {
  children: string;
  tone?: 'dark' | 'amber' | 'red' | 'green';
}) {
  const toneClass =
    tone === 'green'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'amber'
      ? 'bg-amber-100 text-amber-700'
      : tone === 'red'
        ? 'bg-red-100 text-red-700'
        : 'bg-[#171717] text-white';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] ${toneClass}`}
    >
      {children}
    </span>
  );
}

function TradeMetaBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-black/48">{label}</p>
      <p className="mt-1 font-medium text-[#171717]">{value}</p>
    </div>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M18.244 2H21.5l-7.118 8.135L22.75 22h-6.555l-5.13-7.22L4.75 22H1.5l7.611-8.698L1 2h6.72l4.636 6.524L18.244 2Zm-1.14 18h1.804L6.73 3.894H4.79L17.104 20Z" />
    </svg>
  );
}

function formatStatus(
  value: string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (!value) return '--';
  if (value === 'active') return t((m) => m.publicAgent.statusActive);
  if (value === 'registered') return t((m) => m.publicAgent.statusRegistered);
  if (value === 'paused') return t((m) => m.publicAgent.statusPaused);
  if (value === 'terminated') return t((m) => m.publicAgent.statusTerminated);
  return value;
}

function formatTopTier(
  value: string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (!value || value === 'normal') return t((m) => m.publicAgent.publicProfile);
  if (value === 'top_3') return t((m) => m.publicAgent.top3);
  if (value === 'top_10') return t((m) => m.publicAgent.top10);
  return value;
}

function formatMarketName(
  value: string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (!value) return '--';
  if (value === 'stock') return t((m) => m.publicAgent.marketStocks);
  if (value === 'crypto') return t((m) => m.publicAgent.marketCrypto);
  if (value === 'prediction') return t((m) => m.publicAgent.marketPrediction);
  return value;
}

function formatModelName(
  value: string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (!value) return t((m) => m.publicAgent.customModel);
  return value.replace(/[_-]+/g, ' ').toUpperCase();
}

function formatDateTime(value: string, locale: string) {
  return formatUsMarketDateTime(value, locale, 'dateTime');
}

function formatCurrency(value: number | null | undefined, locale: string) {
  if (value == null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat(locale || 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactCurrency(value: number, locale: string) {
  return new Intl.NumberFormat(locale || 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale || 'en-US').format(value);
}

function formatPercent(value: number, locale: string) {
  return `${value >= 0 ? '+' : ''}${new Intl.NumberFormat(locale || 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function formatHeartbeatStatus(
  lastHeartbeatAt: string | null | undefined,
  locale: string,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  const freshness = getTimestampFreshness(lastHeartbeatAt, {
    freshMs: 20 * 60 * 1000,
    delayedMs: 60 * 60 * 1000,
  });

  if (freshness.level === 'fresh' && lastHeartbeatAt) {
    return `${t((m) => m.publicAgent.heartbeatFresh)} · ${formatRelativeTimestamp(lastHeartbeatAt, locale)}`;
  }

  if (freshness.level === 'delayed' && lastHeartbeatAt) {
    return `${t((m) => m.publicAgent.heartbeatDelayed)} · ${formatRelativeTimestamp(lastHeartbeatAt, locale)}`;
  }

  if (freshness.level === 'stale' && lastHeartbeatAt) {
    return `${t((m) => m.publicAgent.heartbeatStale)} · ${formatRelativeTimestamp(lastHeartbeatAt, locale)}`;
  }

  return t((m) => m.publicAgent.heartbeatUnavailable);
}

function freshnessTone(level: ReturnType<typeof getTimestampFreshness>['level']) {
  if (level === 'fresh') return 'green' as const;
  if (level === 'delayed') return 'amber' as const;
  return 'red' as const;
}

function formatRiskMode(
  riskTag: string | null,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (riskTag === 'terminated') return t((m) => m.publicAgent.statusTerminated);
  if (riskTag === 'close_only') return t((m) => m.publicAgent.closeOnly);
  if (riskTag === 'high_risk') return t((m) => m.publicAgent.highRisk);
  return t((m) => m.publicAgent.riskNormal);
}

function mapOwnedSummaryToPublic(
  summary: OwnedAgentSummary,
  positions: PublicPosition[],
  t: ReturnType<typeof useSiteLocale>['t']
): PublicAgentSummary {
  const primaryMarket =
    summary.agent.runtimeEnvironment === 'stock'
      ? 'stock'
      : summary.agent.runtimeEnvironment === 'crypto'
        ? 'crypto'
        : summary.agent.runtimeEnvironment === 'prediction'
          ? 'prediction'
          : null;

  return {
    agent: {
      id: summary.agent.id,
      name: summary.agent.name,
      description: summary.agent.description,
      avatarUrl: null,
      xUrl: summary.agent.xUrl ?? null,
      modelName: summary.agent.modelName,
      primaryMarket,
      marketPreferences: primaryMarket ? [primaryMarket] : null,
      status: summary.agent.status,
      lastHeartbeatAt: summary.agent.lastHeartbeatAt,
      createdAt: null,
    },
    performance: {
      rank: null,
      topTier: null,
      totalEquity: summary.account.totalEquity,
      displayEquity: summary.account.displayEquity,
      returnRate: summary.account.returnRate,
      displayReturnRate: summary.account.displayReturnRate,
      drawdown: null,
      snapshotAt: null,
      riskTag: summary.account.riskTag,
      riskMode: null,
      closeOnly: summary.account.riskTag === 'close_only',
    },
    positionsOverview: {
      openPositions: positions.length,
      grossMarketValue: positions.reduce(
        (sum, item) => sum + (item.marketValue ?? 0),
        0
      ),
      unrealizedPnl: positions.reduce(
        (sum, item) => sum + (item.unrealizedPnl ?? 0),
        0
      ),
    },
    dailySummary: {
      period: 'owner_view',
      timeZone: US_MARKET_TIME_ZONE,
      summary:
        summary.agent.strategyHint ||
        t((m) => m.publicAgent.ownerViewSummary).replace('{value}', summary.agent.name),
    },
  };
}

function mapOwnedPositionToPublic(position: OwnedPosition): PublicPosition {
  const marketValue =
    position.marketPrice != null ? position.marketPrice * position.positionSize : null;

  return {
    id: position.id,
    symbol: position.symbol,
    market: position.market,
    eventId: position.eventId ?? null,
    outcomeId: position.outcomeId ?? null,
    outcomeName: position.outcomeName ?? null,
    positionSize: position.positionSize,
    avgPrice: position.entryPrice,
    marketPrice: position.marketPrice,
    marketValue,
    unrealizedPnl: position.unrealizedPnl,
  };
}

function mapOwnedTradeToPublic(trade: OwnedTrade): PublicTrade {
  return {
    executionId: trade.executionId,
    symbol: trade.symbol,
    side: trade.side,
    market: trade.market,
    eventId: null,
    outcomeId: null,
    outcomeName: null,
    reasonTag: null,
    displayRationale: null,
    filledUnits: trade.filledUnits,
    fillPrice: trade.fillPrice,
    executionPath: trade.executionPath ?? null,
    fee: trade.fee,
    executedAt: trade.executedAt,
  };
}
