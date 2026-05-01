'use client';

import { useEffect, useState } from 'react';

import { useSiteLocale } from '@/components/site-locale-provider';
import { formatUsMarketDateTime } from '@/lib/us-market-time';

type EquityPoint = {
  ts: string | null;
  equity: number;
  drawdown?: number;
  returnRate?: number;
};

const CHART_WIDTH = 720;
const CHART_HEIGHT = 240;
const PLOT_TOP = 20;
const PLOT_RIGHT = 18;
const PLOT_BOTTOM = 34;
const PLOT_LEFT = 64;

function buildPath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');
}

function formatCurrency(value: number, locale: string) {
  return new Intl.NumberFormat(locale || 'en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number, locale: string) {
  return `${value >= 0 ? '+' : ''}${new Intl.NumberFormat(locale || 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

function formatAxisCurrency(value: number, locale: string, spread: number) {
  const digits =
    spread < 1
      ? 4
      : spread < 10
        ? 3
        : spread < 100
          ? 2
          : spread < 1_000
            ? 1
            : 0;

  return new Intl.NumberFormat(locale || 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatTimeLabel(value: string | null, locale: string) {
  return formatUsMarketDateTime(value, locale, 'chart');
}

function formatHeaderTimeLabel(value: string | null, locale: string) {
  return formatUsMarketDateTime(value, locale, 'dateTime');
}

export function EquityBars({
  series,
  locale = 'en-US',
}: {
  series: EquityPoint[];
  locale?: string;
}) {
  const { t } = useSiteLocale();
  const visibleSeries = series
    .filter((item) => item.ts && Number.isFinite(item.equity))
    .slice(-48);
  const [selectedIndex, setSelectedIndex] = useState(visibleSeries.length - 1);

  useEffect(() => {
    setSelectedIndex(visibleSeries.length - 1);
  }, [visibleSeries.length]);

  if (!visibleSeries.length) {
    return <div className="text-sm text-black/55">{t((m) => m.publicAgent.noEquitySamplesYet)}</div>;
  }

  const safeSelectedIndex = Math.min(
    Math.max(selectedIndex, 0),
    Math.max(visibleSeries.length - 1, 0)
  );
  const values = visibleSeries.map((item) => item.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const rawSpread = max - min;
  const spread =
    rawSpread > 0 ? rawSpread : Math.max(Math.abs(max) * 0.0001, 0.01);
  const plotWidth = CHART_WIDTH - PLOT_LEFT - PLOT_RIGHT;
  const plotHeight = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;

  const points = visibleSeries.map((item, index) => {
    const x =
      PLOT_LEFT +
      (index / Math.max(visibleSeries.length - 1, 1)) * plotWidth;
    const y =
      CHART_HEIGHT -
      PLOT_BOTTOM -
      ((item.equity - min) / spread) * plotHeight;

    return {
      x,
      y,
      equity: item.equity,
      ts: item.ts,
      drawdown: item.drawdown ?? 0,
      returnRate: item.returnRate ?? 0,
    };
  });

  const selectedPoint = points[safeSelectedIndex] ?? points[points.length - 1];
  const linePath = buildPath(points);
  const areaPath = `${linePath} L ${points.at(-1)?.x.toFixed(2)} ${(CHART_HEIGHT - PLOT_BOTTOM).toFixed(2)} L ${points[0]?.x.toFixed(2)} ${(CHART_HEIGHT - PLOT_BOTTOM).toFixed(2)} Z`;
  const yTicks = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const value = max - spread * ratio;
    const y = PLOT_TOP + plotHeight * ratio;
    return { y, value };
  });
  const xTickIndexes = Array.from(
    new Set([
      0,
      Math.max(Math.floor((points.length - 1) / 2), 0),
      Math.max(points.length - 1, 0),
    ])
  );

  return (
    <div className="overflow-hidden rounded-[24px] border border-black/10 bg-[radial-gradient(circle_at_top,rgba(228,241,236,0.92),rgba(249,245,238,0.95)_48%,rgba(255,255,255,0.98))]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/8 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/40">
            {t((m) => m.publicAgent.equity)}
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-[#171717]">
            {formatCurrency(selectedPoint.equity, locale)}
          </p>
        </div>
        <div className="grid gap-1 text-right text-sm text-black/54">
          <p>{formatHeaderTimeLabel(selectedPoint.ts, locale)}</p>
          <p>
            {t((m) => m.publicAgent.returnLabel)} {formatPercent(selectedPoint.returnRate, locale)}
          </p>
          <p>
            {t((m) => m.publicAgent.drawdown)} {formatPercent(selectedPoint.drawdown, locale)}
          </p>
        </div>
      </div>

      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-64 w-full">
        {yTicks.map((tick) => (
          <g key={tick.y}>
            <line
              x1={PLOT_LEFT}
              x2={CHART_WIDTH - PLOT_RIGHT}
              y1={tick.y}
              y2={tick.y}
              stroke="rgba(0,0,0,0.08)"
              strokeDasharray="4 6"
            />
            <text
              x={PLOT_LEFT - 10}
              y={tick.y + 4}
              textAnchor="end"
              fontSize="10"
              fill="rgba(0,0,0,0.45)"
            >
              {formatAxisCurrency(tick.value, locale, spread)}
            </text>
          </g>
        ))}

        <line
          x1={PLOT_LEFT}
          x2={PLOT_LEFT}
          y1={PLOT_TOP}
          y2={CHART_HEIGHT - PLOT_BOTTOM}
          stroke="rgba(0,0,0,0.14)"
        />
        <line
          x1={PLOT_LEFT}
          x2={CHART_WIDTH - PLOT_RIGHT}
          y1={CHART_HEIGHT - PLOT_BOTTOM}
          y2={CHART_HEIGHT - PLOT_BOTTOM}
          stroke="rgba(0,0,0,0.14)"
        />

        <path d={areaPath} fill="rgba(34, 120, 96, 0.14)" />
        <path
          d={linePath}
          fill="none"
          stroke="rgba(13, 92, 73, 0.96)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />

        <line
          x1={selectedPoint.x}
          x2={selectedPoint.x}
          y1={PLOT_TOP}
          y2={CHART_HEIGHT - PLOT_BOTTOM}
          stroke="rgba(13, 92, 73, 0.24)"
          strokeDasharray="4 6"
        />
        <line
          x1={PLOT_LEFT}
          x2={CHART_WIDTH - PLOT_RIGHT}
          y1={selectedPoint.y}
          y2={selectedPoint.y}
          stroke="rgba(13, 92, 73, 0.18)"
          strokeDasharray="4 6"
        />

        {points.map((point, index) => {
          const active = index === safeSelectedIndex;
          return (
            <g key={`${point.ts ?? index}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={active ? '6' : '3.5'}
                fill={active ? 'rgba(255,255,255,1)' : 'rgba(13, 92, 73, 0.96)'}
                stroke="rgba(13, 92, 73, 0.96)"
                strokeWidth={active ? '3' : '0'}
              />
              <circle
                cx={point.x}
                cy={point.y}
                r="12"
                fill="transparent"
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => setSelectedIndex(index)}
              >
                <title>{`${formatTimeLabel(point.ts, locale)} ${formatCurrency(point.equity, locale)}`}</title>
              </circle>
            </g>
          );
        })}

        {xTickIndexes.map((index) => {
          const point = points[index];
          if (!point) {
            return null;
          }

          return (
            <g key={`${point.ts ?? index}-label`}>
              <line
                x1={point.x}
                x2={point.x}
                y1={CHART_HEIGHT - PLOT_BOTTOM}
                y2={CHART_HEIGHT - PLOT_BOTTOM + 6}
                stroke="rgba(0,0,0,0.16)"
              />
              <text
                x={point.x}
                y={CHART_HEIGHT - 10}
                textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
                fontSize="10"
                fill="rgba(0,0,0,0.45)"
              >
                {formatTimeLabel(point.ts, locale)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
