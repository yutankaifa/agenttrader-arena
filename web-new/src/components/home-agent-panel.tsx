'use client';

import { type ReactNode } from 'react';

import { EquityBars } from '@/components/equity-bars';
import { useSiteLocale } from '@/components/site-locale-provider';
import { cn } from '@/lib/cn';
import { formatUsMarketDateTime } from '@/lib/us-market-time';

type PublicAgentSummary = {
  agent: {
    name?: string;
    description?: string | null;
    avatarUrl?: string | null;
    modelName?: string | null;
    primaryMarket: string | null;
    marketPreferences?: string[] | null;
    lastHeartbeatAt?: string | null;
  };
  performance?: {
    rank: number | null;
    totalEquity: number;
    returnRate: number;
    drawdown: number | null;
  };
  positionsOverview: {
    openPositions?: number;
    grossMarketValue: number;
  };
  dailySummary: {
    summary: string;
  };
};

type AgentPanelTrade = {
  executionId: string;
  symbol: string;
  side: string;
  market: string;
  outcomeName?: string | null;
  reasonTag?: string | null;
  displayRationale?: string | null;
  filledUnits: number;
  fillPrice: number;
  executedAt: string | null;
};

type AgentPanelEquityPoint = {
  ts: string | null;
  equity: number;
  drawdown: number;
  returnRate: number;
};

type AgentPanelEquity = {
  series: AgentPanelEquityPoint[];
};

export function HomeAgentPanel({
  summary,
  trades,
  equity,
  isLoading,
  localeTag,
  onClose,
}: {
  summary: PublicAgentSummary | null;
  trades: AgentPanelTrade[];
  equity: AgentPanelEquity | null;
  isLoading: boolean;
  localeTag: string;
  onClose: () => void;
}) {
  const { t } = useSiteLocale();

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label={t((m) => m.homeDashboard.closePanel)}
        className="absolute inset-0 bg-black/28"
        onClick={onClose}
        type="button"
      />
      <div className="absolute inset-y-0 right-0 w-full max-w-[560px] overflow-y-auto border-l border-black/10 bg-[#f6f6f3] shadow-[-10px_0_40px_rgba(0,0,0,0.08)]">
        <div className="sticky top-0 z-10 border-b border-black/10 bg-[#f6f6f3]/95 px-4 py-4 backdrop-blur-sm sm:px-6 sm:py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-black/42">
                {t((m) => m.homeDashboard.agentProfile)}
              </p>
              <div className="mt-3 flex items-start gap-4 pr-10">
                <AgentAvatar name={summary?.agent.name || 'A'} avatarUrl={summary?.agent.avatarUrl} />
                <div className="min-w-0">
                  <div className="flex items-start gap-3">
                    <h3 className="truncate text-2xl tracking-[-0.05em] text-[#171717]">
                      {summary?.agent.name || t((m) => m.homeDashboard.loading)}
                    </h3>
                    {summary?.performance?.rank && summary.performance.rank <= 3 ? (
                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[#d6ab36] text-[11px] font-semibold text-white">
                        {summary.performance.rank}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {summary?.performance?.rank ? (
                      <StatusPill>
                        {t((m) => m.homeDashboard.rankLabel).replace(
                          '{value}',
                          String(summary.performance.rank)
                        )}
                      </StatusPill>
                    ) : null}
                    {summary?.agent.primaryMarket ? (
                      <StatusPill>{formatMarketName(summary.agent.primaryMarket, t)}</StatusPill>
                    ) : null}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-black/56 sm:leading-7">
                {summary?.agent.description || t((m) => m.homeDashboard.panelDescriptionFallback)}
              </p>
            </div>
            <button
              aria-label={t((m) => m.homeDashboard.closePanel)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-xl leading-none text-[#171717] transition hover:bg-[#171717] hover:text-white"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
        </div>

        <div className="space-y-5 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6">
          {isLoading ? (
            <LoadingRows rows={6} />
          ) : !summary ? (
            <div className="border border-black/10 bg-white p-5 text-sm text-black/58">
              {t((m) => m.homeDashboard.unableToLoadProfile)}
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    label: t((m) => m.homeDashboard.currentRank),
                    value: summary.performance?.rank ? `#${summary.performance.rank}` : '--',
                  },
                  {
                    label: t((m) => m.homeDashboard.cumulativeReturn),
                    value: formatPercent(summary.performance?.returnRate, localeTag),
                  },
                  {
                    label: t((m) => m.homeDashboard.totalEquity),
                    value: formatCompactUsd(summary.performance?.totalEquity, localeTag),
                  },
                  {
                    label: t((m) => m.homeDashboard.maxDd),
                    value:
                      summary.performance?.drawdown != null
                        ? formatPercent(summary.performance.drawdown, localeTag)
                        : '--',
                  },
                ].map((metric) => (
                  <div key={metric.label} className="border border-black/10 bg-white p-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-black/42">
                      {metric.label}
                    </p>
                    <p className="mt-3 text-xl font-semibold tracking-[-0.04em] text-[#171717]">
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard
                  label={t((m) => m.homeDashboard.model)}
                  value={formatModelName(summary.agent.modelName, t)}
                />
                <MetricCard
                  label={t((m) => m.homeDashboard.market)}
                  value={formatMarketName(summary.agent.primaryMarket, t)}
                />
              </div>

              <div className="border border-black/10 bg-white p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-black/42">
                  {t((m) => m.homeDashboard.equityCurve)}
                </p>
                {!equity || equity.series.length === 0 ? (
                  <div className="mt-4 flex h-48 items-center justify-center text-sm text-black/45">
                    {t((m) => m.homeDashboard.noPublicEquityData)}
                  </div>
                ) : (
                  <div className="mt-4">
                    <EquityBars series={equity.series} locale={localeTag} />
                  </div>
                )}
              </div>

              <div className="border border-black/10 bg-white p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-black/42">
                  {t((m) => m.homeDashboard.profile)}
                </p>
                <div className="mt-4 space-y-3 text-sm leading-7 text-black/58">
                  <p>
                    {t((m) => m.homeDashboard.model)}: {formatModelName(summary.agent.modelName, t)}
                  </p>
                  <p>
                    {t((m) => m.homeDashboard.markets)}:{' '}
                    {formatPreferences(summary.agent.marketPreferences, t)}
                  </p>
                  <p>
                    {t((m) => m.homeDashboard.visibleExposure)}:{' '}
                    {formatCompactUsd(summary.positionsOverview.grossMarketValue, localeTag)}
                  </p>
                  <p>
                    {t((m) => m.homeDashboard.openPositions)}:{' '}
                    {summary.positionsOverview.openPositions ?? '--'}
                  </p>
                  {summary.agent.lastHeartbeatAt ? (
                    <p>
                      {t((m) => m.homeDashboard.lastHeartbeat)}:{' '}
                      {formatTime(summary.agent.lastHeartbeatAt, localeTag)}
                    </p>
                  ) : null}
                </div>
              </div>

              {summary.dailySummary?.summary ? (
                <div className="border border-black/10 bg-white p-5">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-black/42">
                    {t((m) => m.homeDashboard.dailySummary)}
                  </p>
                  <p className="mt-4 text-sm leading-7 text-black/58">{summary.dailySummary.summary}</p>
                </div>
              ) : null}

              <div className="border border-black/10 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-black/42">
                    {t((m) => m.homeDashboard.tradeLog)}
                  </p>
                  <StatusPill>
                    {t((m) => m.homeDashboard.tradesCount).replace('{value}', String(trades.length))}
                  </StatusPill>
                </div>
                {trades.length === 0 ? (
                  <p className="mt-4 text-sm text-black/58">
                    {t((m) => m.homeDashboard.noRecentPublicTrades)}
                  </p>
                ) : (
                  <div className="mt-4 divide-y divide-black/10 border border-black/10">
                    {trades.map((trade) => (
                      <div key={trade.executionId} className="space-y-3 px-4 py-4">
                        <div className="flex items-center justify-between gap-4">
                          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-black/38">
                            {formatTime(trade.executedAt, localeTag)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[15px] font-semibold tracking-[-0.01em] text-[#171717]">
                          <span className={cn('lowercase', getTradeTone(trade.side))}>
                            {formatTradeSideLabel(trade.side, t, 'lower')}
                          </span>
                          <span>
                            {trade.outcomeName ? `${trade.symbol} · ${trade.outcomeName}` : trade.symbol}
                          </span>
                          <span>
                            {formatCompactUsd(trade.filledUnits * trade.fillPrice, localeTag)}
                            {trade.fillPrice != null
                              ? ` at ${formatTradeExecutionPrice(trade.fillPrice, trade.market ?? null, localeTag)}`
                              : ''}
                          </span>
                        </div>
                        <p className="border-l border-black/12 pl-4 text-sm leading-7 text-black/58">
                          {trade.displayRationale ||
                            trade.reasonTag ||
                            t((m) => m.homeDashboard.noPublicTradeRationale)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-12 animate-pulse border border-black/10 bg-[#faf8f3]" />
      ))}
    </div>
  );
}

function AgentAvatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | null;
}) {
  if (avatarUrl) {
    return (
      <div className="relative flex size-12 shrink-0 overflow-hidden rounded-full border border-black/10 bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
      </div>
    );
  }

  return (
    <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-black/10 bg-white text-sm font-semibold text-[#171717]">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function StatusPill({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'solid';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em]',
        tone === 'solid'
          ? 'bg-[#171717] text-white'
          : 'border border-black/10 bg-white text-black/62'
      )}
    >
      {children}
    </span>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-black/10 bg-white p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-black/42">{label}</p>
      <p className="mt-3 text-sm font-semibold text-[#171717]">{value}</p>
    </div>
  );
}

function getTradeTone(side: string) {
  const normalized = side.toUpperCase();
  if (normalized === 'BUY') return 'text-emerald-600';
  if (normalized === 'SELL') return 'text-red-600';
  return 'text-[#171717]';
}

function formatTradeSideLabel(
  value: string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t'],
  mode: 'upper' | 'lower' = 'upper'
) {
  if (!value) return '--';
  const normalized = value.toUpperCase();
  if (normalized === 'BUY') {
    return mode === 'lower'
      ? t((m) => m.homeDashboard.sideBuyLower)
      : t((m) => m.homeDashboard.sideBuyUpper);
  }
  if (normalized === 'SELL') {
    return mode === 'lower'
      ? t((m) => m.homeDashboard.sideSellLower)
      : t((m) => m.homeDashboard.sideSellUpper);
  }
  return mode === 'lower' ? value.toLowerCase() : normalized;
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

function formatTradeExecutionPrice(
  value: number | null | undefined,
  market: string | null | undefined,
  localeTag: string
) {
  if (value == null || Number.isNaN(value)) return '--';
  if (market === 'prediction') {
    return `${new Intl.NumberFormat(localeTag, {
      minimumFractionDigits: value * 100 < 10 ? 1 : 0,
      maximumFractionDigits: 1,
    }).format(value * 100)}c`;
  }

  const fractionDigits = value >= 1_000 ? 0 : value >= 1 ? 2 : 4;
  return new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
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

function formatTime(value: string | null | undefined, localeTag: string) {
  return formatUsMarketDateTime(value, localeTag, 'dateTime');
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

function formatPreferences(
  value: string[] | string | null | undefined,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (!value) return '--';
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => formatMarketName(item, t)).join(', ') : '--';
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length
      ? parsed
          .map((item) => (typeof item === 'string' ? formatMarketName(item, t) : item))
          .join(', ')
      : '--';
  } catch {
    return value;
  }
}
