'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { useSiteLocale } from '@/components/site-locale-provider';
import { useOwnedAgents } from '@/hooks/use-owned-agents';

function StatusBadge({ status }: { status: string }) {
  const { t } = useSiteLocale();
  const colors: Record<string, string> = {
    running: 'bg-emerald-100 text-emerald-700',
    ready: 'bg-blue-100 text-blue-700',
    idle: 'bg-[#f5f5f5] text-black/52',
    error: 'bg-red-100 text-red-700',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        colors[status] || colors.idle
      }`}
    >
      {formatStatusLabel(status, t)}
    </span>
  );
}

export function SetupAgentsSidebar({
  signInHref,
}: {
  signInHref: string;
}) {
  const { localeTag, t } = useSiteLocale();
  const { agents, authenticated, loading, loadAgents } = useOwnedAgents();

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(localeTag, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }),
    [localeTag]
  );

  const visibleAgents = agents.slice(0, 3);
  const hasMoreAgents = agents.length > visibleAgents.length;

  return (
    <div className="sticky top-24 rounded-xl border border-black/10 bg-white">
      <div className="flex items-center justify-between border-b border-black/10 px-6 py-4">
        <h3 className="text-sm font-semibold tracking-wider uppercase text-[#171717]">
          {t((m) => m.setupSidebar.title)}
        </h3>
        <button
          className="rounded-md p-1.5 text-black/48 transition-colors hover:bg-[#fafafa] hover:text-[#171717]"
          onClick={() => void loadAgents()}
          title={t((m) => m.setupSidebar.refresh)}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </button>
      </div>

      {loading ? (
        <div className="space-y-3 px-6 py-6">
          {[0, 1].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-xl border border-black/10 bg-[#fafafa]"
            />
          ))}
        </div>
      ) : authenticated === false ? (
        <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-black/20">
            <svg
              aria-hidden="true"
              className="h-5 w-5 text-black/30"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-[#171717]">{t((m) => m.setupSidebar.signInTitle)}</p>
            <p className="mt-1 text-xs leading-relaxed text-black/56">
              {t((m) => m.setupSidebar.signInDescription)}
            </p>
          </div>
          <Link href={signInHref} className="button-secondary">
            {t((m) => m.setupSidebar.signIn)}
          </Link>
        </div>
      ) : agents.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-sm font-medium text-[#171717]">{t((m) => m.setupSidebar.emptyTitle)}</p>
          <p className="mt-2 text-xs leading-relaxed text-black/56">
            {t((m) => m.setupSidebar.emptyDescription)}
          </p>
        </div>
      ) : (
        <div className="space-y-3 px-4 py-4">
          {visibleAgents.map((agent) => (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              className="block rounded-xl border border-black/10 bg-[#fafafa] p-4 transition-colors hover:bg-[#f2f2ee]"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#171717]">
                    {agent.name}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-black/48">{agent.id}</p>
                </div>
                <StatusBadge status={agent.runnerStatus} />
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-black/52">{t((m) => m.setupSidebar.equity)}</span>
                  <span className="font-medium text-[#171717]">
                    {currencyFormatter.format(agent.totalEquity)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-black/52">{t((m) => m.setupSidebar.availableCash)}</span>
                  <span className="text-black/58">
                    {currencyFormatter.format(agent.availableCash)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-black/52">{t((m) => m.setupSidebar.return)}</span>
                  <span
                    className={
                      agent.returnRate >= 0
                        ? 'font-semibold text-emerald-600'
                        : 'font-semibold text-red-600'
                    }
                  >
                    {agent.returnRate >= 0 ? '+' : ''}
                    {new Intl.NumberFormat(localeTag, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }).format(agent.returnRate)}
                    %
                  </span>
                </div>
              </div>
            </Link>
          ))}

          {hasMoreAgents ? (
            <Link
              href="/my-agent"
              className="inline-flex px-2 pt-1 text-xs font-medium text-black/56 hover:text-[#171717]"
            >
              {t((m) => m.setupSidebar.viewAll)}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

function formatStatusLabel(
  status: string,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  switch (status) {
    case 'running':
      return t((m) => m.setupSidebar.statusRunning);
    case 'ready':
      return t((m) => m.setupSidebar.statusReady);
    case 'paused':
      return t((m) => m.setupSidebar.statusPaused);
    case 'idle':
      return t((m) => m.setupSidebar.statusIdle);
    case 'error':
      return t((m) => m.setupSidebar.statusError);
    default:
      return status;
  }
}
