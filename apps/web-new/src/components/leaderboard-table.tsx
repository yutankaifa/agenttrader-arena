import Link from 'next/link';

import { useSiteLocale } from '@/components/site-locale-provider';
import { cn } from '@/lib/cn';

type LeaderboardRow = {
  rank: number | string;
  agentId: string;
  agentName: string;
  returnRate: number;
  equityValue: number;
  change24h: number | null;
  drawdown: number | null;
  modelName: string | null;
  rankChange24h?: number;
  riskTag?: string | null;
  closeOnly?: boolean;
};

export function LeaderboardTable({
  rows,
  pagination,
}: {
  rows: LeaderboardRow[];
  pagination?: {
    currentPage: number;
    totalPages: number;
    previousHref: string;
    nextHref: string;
  };
}) {
  const { localeTag, t } = useSiteLocale();

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] table-fixed border-separate border-spacing-0">
          <thead>
            <tr className="bg-[#fafafa]">
              <th className="w-[10%] border-b border-black/10 px-4 py-[15px] text-left font-mono text-[11px] uppercase tracking-[0.2em] text-black/42">
                {t((m) => m.homeDashboard.rank)}
              </th>
              <th className="w-[25%] border-b border-black/10 px-4 py-[15px] text-left font-mono text-[11px] uppercase tracking-[0.2em] text-black/42">
                {t((m) => m.homeDashboard.agent)}
              </th>
              <th className="w-[14%] border-b border-black/10 px-4 py-[15px] text-left font-mono text-[11px] uppercase tracking-[0.2em] text-black/42">
                {t((m) => m.homeDashboard.returnLabel)}
              </th>
              <th className="hidden w-[12%] border-b border-black/10 px-4 py-[15px] text-left font-mono text-[11px] uppercase tracking-[0.2em] text-black/42 lg:table-cell">
                {t((m) => m.homeDashboard.value)}
              </th>
              <th className="w-[10%] border-b border-black/10 px-4 py-[15px] text-left font-mono text-[11px] uppercase tracking-[0.2em] text-black/42">
                24h
              </th>
              <th className="hidden w-[13%] border-b border-black/10 px-4 py-[15px] text-left font-mono text-[11px] uppercase tracking-[0.2em] text-black/42 xl:table-cell">
                {t((m) => m.homeDashboard.maxDd)}
              </th>
              <th className="hidden w-[12%] border-b border-black/10 px-4 py-[15px] text-left font-mono text-[11px] uppercase tracking-[0.2em] text-black/42 md:table-cell">
                {t((m) => m.homeDashboard.model)}
              </th>
              <th className="hidden w-[8%] border-b border-black/10 px-4 py-[15px] text-center font-mono text-[11px] uppercase tracking-[0.2em] text-black/42 md:table-cell">
                {t((m) => m.homeDashboard.details)}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((agent) => (
              <tr key={agent.agentId} className="group transition hover:bg-[#fbfbfb]">
                <td className="border-b border-black/10 px-4 py-[18px] align-middle">
                  <div className="flex items-start gap-3">
                    <p className="text-[1.35rem] font-semibold tracking-[-0.05em] text-[#171717]">
                      {agent.rank}
                    </p>
                    <MovementIndicator value={agent.rankChange24h ?? 0} />
                  </div>
                </td>

                <td className="border-b border-black/10 px-4 py-[18px] align-middle">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link
                        href={`/agents/${agent.agentId}`}
                        className="block min-w-0 truncate text-[1.05rem] font-semibold whitespace-nowrap text-[#171717] underline-offset-4 transition hover:text-black/72 hover:underline"
                      >
                        {agent.agentName}
                      </Link>
                      <RankMedal className="shrink-0 self-center" rank={agent.rank} />
                      {agent.riskTag === 'high_risk' ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          {t((m) => m.publicAgent.highRisk)}
                        </span>
                      ) : null}
                      {agent.closeOnly ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                          {t((m) => m.publicAgent.closeOnly)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </td>

                <td className="border-b border-black/10 px-4 py-[18px] align-middle">
                  <p className="text-[1.35rem] font-semibold tracking-[-0.04em] text-[#171717]">
                    {formatPercent(agent.returnRate, localeTag)}
                  </p>
                </td>

                <td className="hidden border-b border-black/10 px-4 py-[18px] align-middle lg:table-cell">
                  <p className="text-[15px] font-medium text-[#171717]">
                    {formatCompactUsd(agent.equityValue, localeTag)}
                  </p>
                </td>

                <td className="border-b border-black/10 px-4 py-[18px] align-middle">
                  <p className="text-[15px] font-medium text-[#171717]">
                    {formatPercent(agent.change24h, localeTag)}
                  </p>
                </td>

                <td className="hidden border-b border-black/10 px-4 py-[18px] align-middle xl:table-cell">
                  <p className="text-[15px] font-medium text-[#171717]">
                    {formatPercent(agent.drawdown, localeTag)}
                  </p>
                </td>

                <td className="hidden border-b border-black/10 px-4 py-[18px] align-middle md:table-cell">
                  <p className="block truncate font-mono text-[11px] uppercase tracking-[0.18em] whitespace-nowrap text-black/52">
                    {formatModelName(agent.modelName, t)}
                  </p>
                </td>

                <td className="hidden border-b border-black/10 px-3 py-[18px] align-middle md:table-cell">
                  <div className="flex justify-center">
                    <Link
                      aria-label={t((m) => m.homeDashboard.showDetailsFor).replace(
                        '{value}',
                        agent.agentName
                      )}
                      href={`/agents/${agent.agentId}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/14 bg-white text-[1.15rem] leading-none font-semibold text-[#171717] transition hover:bg-[#171717] hover:text-white"
                    >
                      i
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination ? (
        <div className="flex items-center justify-end gap-3 border-t border-black/10 px-5 py-4">
          <p className="font-mono text-[11px] tracking-[0.18em] text-black/42 uppercase">
            {t((m) => m.homeDashboard.pageLabel)
              .replace('{current}', String(pagination.totalPages === 0 ? 0 : pagination.currentPage))
              .replace('{total}', String(pagination.totalPages))}
          </p>
          <div className="flex items-center gap-2">
            <Link
              aria-label={t((m) => m.homeDashboard.previousPage)}
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/12 bg-white text-[#171717] transition hover:bg-[#171717] hover:text-white',
                pagination.currentPage <= 1 &&
                  'pointer-events-none opacity-28 hover:bg-white hover:text-[#171717]'
              )}
              href={pagination.previousHref}
            >
              ‹
            </Link>
            <Link
              aria-label={t((m) => m.homeDashboard.nextPage)}
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/12 bg-white text-[#171717] transition hover:bg-[#171717] hover:text-white',
                (pagination.totalPages === 0 ||
                  pagination.currentPage >= pagination.totalPages) &&
                  'pointer-events-none opacity-28 hover:bg-white hover:text-[#171717]'
              )}
              href={pagination.nextHref}
            >
              ›
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}

function RankMedal({
  rank,
  className,
}: {
  rank: number | string;
  className?: string;
}) {
  const { t } = useSiteLocale();
  const numericRank = Number(rank);

  if (numericRank !== 1 && numericRank !== 2 && numericRank !== 3) {
    return null;
  }

  const medalStyle =
    numericRank === 1
      ? {
          borderColor: '#8d6c14',
          backgroundColor: '#cba33b',
          color: '#ffffff',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.28)',
        }
      : numericRank === 2
        ? {
            borderColor: '#737980',
            backgroundColor: '#bcc3ca',
            color: '#2b2f33',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.34)',
          }
        : {
            borderColor: '#744a2f',
            backgroundColor: '#b97d56',
            color: '#ffffff',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
          };

  return (
    <span
      aria-label={t((m) => m.homeDashboard.medalLabel).replace('{value}', String(numericRank))}
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full border text-[10px] leading-none font-semibold',
        className
      )}
      style={medalStyle}
      title={t((m) => m.homeDashboard.medalLabel).replace('{value}', String(numericRank))}
    >
      {numericRank}
    </span>
  );
}

function MovementIndicator({ value }: { value: number }) {
  if (value > 0) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[#171717]">
        ↑{value}
      </span>
    );
  }

  if (value < 0) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-black/46">
        ↓{Math.abs(value)}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.16em] text-black/36">
      — 0
    </span>
  );
}

function formatCompactUsd(value: number | null | undefined, localeTag: string) {
  if (value == null || Number.isNaN(value)) return '--';
  return new Intl.NumberFormat(localeTag, {
    style: 'currency',
    currency: 'USD',
    notation: Math.abs(value) >= 1_000 ? 'compact' : 'standard',
    minimumFractionDigits: Math.abs(value) >= 1_000 ? 0 : 2,
    maximumFractionDigits: Math.abs(value) >= 1_000 ? 2 : 2,
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
