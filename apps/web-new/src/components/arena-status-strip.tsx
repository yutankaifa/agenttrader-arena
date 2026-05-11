'use client';

import { useEffect, useState } from 'react';

import { useSiteLocale } from '@/components/site-locale-provider';
import { cn } from '@/lib/cn';
import { type DataFreshnessLevel } from '@/lib/data-freshness';
import {
  buildArenaStatusStripModel,
  type SignalTone,
} from '@/lib/arena-status-strip-model';
import { formatRelativeTimestamp } from '@/lib/relative-time';
import { formatUsMarketDateTime } from '@/lib/us-market-time';

type ArenaStatusStripProps = {
  initialNowMs: number;
  leaderboardSnapshotAt: string | null;
  latestTradeAt: string | null;
  leaderHeartbeatAt: string | null;
  leaderRiskTag?: string | null;
  leaderCloseOnly?: boolean;
  className?: string;
};

type SignalCard = {
  label: string;
  value: string;
  detail: string;
  tone: SignalTone;
};

export function ArenaStatusStrip({
  initialNowMs,
  leaderboardSnapshotAt,
  latestTradeAt,
  leaderHeartbeatAt,
  leaderRiskTag,
  leaderCloseOnly = false,
  className,
}: ArenaStatusStripProps) {
  const { localeTag, t } = useSiteLocale();
  const [nowMs, setNowMs] = useState(initialNowMs);

  useEffect(() => {
    setNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const model = buildArenaStatusStripModel({
    leaderboardSnapshotAt,
    latestTradeAt,
    leaderHeartbeatAt,
    leaderRiskTag,
    leaderCloseOnly,
    nowMs,
  });
  const currentEtTime = formatUsMarketDateTime(
    new Date(nowMs).toISOString(),
    localeTag,
    'time'
  );
  const effectiveRiskTag = model.effectiveRiskTag;

  const signals: SignalCard[] = [
    {
      label: t((m) => m.homeDashboard.signalUsStocks),
      value: formatMarketSessionValue(model.session.phase, t),
      detail: t((m) => m.homeDashboard.marketClockDetail).replace(
        '{value}',
        currentEtTime
      ),
      tone: model.sessionTone,
    },
    {
      label: t((m) => m.homeDashboard.signalLeaderboardSnapshot),
      value: formatFreshnessValue(model.leaderboardFreshness.level, t),
      detail: leaderboardSnapshotAt
        ? t((m) => m.homeDashboard.lastUpdatedAt).replace(
            '{value}',
            formatRelativeTimestamp(leaderboardSnapshotAt, localeTag, nowMs)
          )
        : t((m) => m.homeDashboard.noSnapshotObserved),
      tone: model.leaderboardTone,
    },
    {
      label: t((m) => m.homeDashboard.signalLiveFeed),
      value: formatFreshnessValue(model.liveFeedFreshness.level, t),
      detail: latestTradeAt
        ? t((m) => m.homeDashboard.lastTradeAt).replace(
            '{value}',
            formatRelativeTimestamp(latestTradeAt, localeTag, nowMs)
          )
        : t((m) => m.homeDashboard.noTradeObserved),
      tone: model.liveFeedTone,
    },
    {
      label: t((m) => m.homeDashboard.signalLeaderHeartbeat),
      value: formatFreshnessValue(model.heartbeatFreshness.level, t),
      detail: leaderHeartbeatAt
        ? t((m) => m.homeDashboard.lastHeartbeatAt).replace(
            '{value}',
            formatRelativeTimestamp(leaderHeartbeatAt, localeTag, nowMs)
          )
        : t((m) => m.homeDashboard.noHeartbeatObserved),
      tone: model.heartbeatTone,
    },
    {
      label: t((m) => m.homeDashboard.signalLeaderRisk),
      value: formatRiskValue(effectiveRiskTag, t),
      detail: formatRiskDetail(effectiveRiskTag, t),
      tone: model.riskTone,
    },
  ];

  return (
    <div className={cn('mt-5 border border-black/10 bg-[#fafaf6]', className)}>
      <div className="border-b border-black/10 px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-black/42">
          {t((m) => m.homeDashboard.trustSignalsTitle)}
        </p>
        <p className="mt-2 text-sm text-black/58">
          {t((m) => m.homeDashboard.trustSignalsSubtitle)}
        </p>
      </div>
      <div className="grid gap-px bg-black/10 sm:grid-cols-2 xl:grid-cols-5">
        {signals.map((signal) => (
          <div key={signal.label} className="bg-white px-5 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/42">
              {signal.label}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span
                className={cn(
                  'inline-flex h-2.5 w-2.5 rounded-full',
                  signal.tone === 'green'
                    ? 'bg-emerald-500'
                    : signal.tone === 'amber'
                      ? 'bg-amber-500'
                      : signal.tone === 'red'
                        ? 'bg-red-500'
                        : 'bg-black/22'
                )}
              />
              <p className="text-lg font-semibold tracking-[-0.04em] text-[#171717]">
                {signal.value}
              </p>
            </div>
            <p className="mt-3 text-sm leading-6 text-black/56">{signal.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatFreshnessValue(
  level: DataFreshnessLevel,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (level === 'fresh') return t((m) => m.homeDashboard.freshState);
  if (level === 'delayed') return t((m) => m.homeDashboard.delayedState);
  if (level === 'stale') return t((m) => m.homeDashboard.staleState);
  return t((m) => m.homeDashboard.unavailableState);
}

function formatMarketSessionValue(
  phase: string,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (phase === 'open') return t((m) => m.homeDashboard.marketOpen);
  if (phase === 'pre_market') return t((m) => m.homeDashboard.marketPreMarket);
  if (phase === 'after_hours') return t((m) => m.homeDashboard.marketAfterHours);
  if (phase === 'holiday') return t((m) => m.homeDashboard.marketHoliday);
  return t((m) => m.homeDashboard.marketWeekend);
}

function formatRiskValue(
  riskTag: string | null,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (riskTag === 'terminated') return t((m) => m.homeDashboard.riskTerminated);
  if (riskTag === 'close_only') return t((m) => m.homeDashboard.riskCloseOnly);
  if (riskTag === 'high_risk') return t((m) => m.homeDashboard.riskHigh);
  return t((m) => m.homeDashboard.riskNormal);
}

function formatRiskDetail(
  riskTag: string | null,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  if (riskTag === 'terminated') {
    return t((m) => m.homeDashboard.riskTerminatedDetail);
  }
  if (riskTag === 'close_only') {
    return t((m) => m.homeDashboard.riskCloseOnlyDetail);
  }
  if (riskTag === 'high_risk') {
    return t((m) => m.homeDashboard.riskHighDetail);
  }
  return t((m) => m.homeDashboard.riskNormalDetail);
}
