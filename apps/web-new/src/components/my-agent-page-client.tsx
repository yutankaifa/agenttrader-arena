'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useSiteLocale } from '@/components/site-locale-provider';
import { useOwnedAgents } from '@/hooks/use-owned-agents';
import { cn } from '@/lib/cn';
import { getTimestampFreshness } from '@/lib/data-freshness';
import {
  formatRiskStateLabel,
  getRiskStateTone,
} from '@/lib/public-trade-meta';
import { formatRelativeTimestamp } from '@/lib/relative-time';

type XLinkFeedback = {
  tone: 'neutral' | 'success' | 'error';
  message: string;
};

type XUrlUpdateResponse =
  | {
      success: true;
      data: {
        xUrl: string | null;
      };
    }
  | {
      success: false;
      error?: {
        message?: string;
      };
    };

function StatusBadge({ status }: { status: string }) {
  const { t } = useSiteLocale();
  const colors: Record<string, string> = {
    running: 'bg-emerald-100 text-emerald-700',
    ready: 'bg-blue-100 text-blue-700',
    paused: 'bg-amber-100 text-amber-700',
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

function getSharedXLink(agents: Array<{ xUrl?: string | null }>) {
  return agents.find((agent) => typeof agent.xUrl === 'string' && agent.xUrl.trim())?.xUrl ?? '';
}

export function MyAgentPageClient() {
  const router = useRouter();
  const { localeTag, t } = useSiteLocale();
  const { agents, authenticated, loading, loadAgents } = useOwnedAgents();
  const [pendingActionById, setPendingActionById] = useState<Record<string, string>>(
    {}
  );
  const [xLinkDraft, setXLinkDraft] = useState('');
  const [savedXLink, setSavedXLink] = useState('');
  const [xLinkFeedback, setXLinkFeedback] = useState<XLinkFeedback | null>(null);
  const [savingXLink, setSavingXLink] = useState(false);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(localeTag, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }),
    [localeTag]
  );
  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(localeTag, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [localeTag]
  );

  useEffect(() => {
    if (!loading && authenticated === false) {
      router.push('/sign-in?callbackURL=/my-agent');
    }
  }, [authenticated, loading, router]);

  useEffect(() => {
    const sharedXLink = getSharedXLink(agents);
    setSavedXLink(sharedXLink);
    setXLinkDraft(sharedXLink);
  }, [agents]);

  const hasUnsavedXLink = xLinkDraft.trim() !== savedXLink.trim();
  const savedXLinkDisplay = savedXLink
    ? savedXLink.replace(/^https?:\/\/(www\.)?/i, '')
    : '';

  async function runAgentAction(agentId: string, action: 'pause' | 'resume' | 'delete') {
    setPendingActionById((current) => ({ ...current, [agentId]: action }));

    try {
      if (action === 'delete') {
        const confirmed = window.confirm(t((m) => m.myAgent.deleteConfirm));
        if (!confirmed) {
          return;
        }
      }

      const response = await fetch(
        action === 'delete' ? `/api/agents/${agentId}` : `/api/agents/${agentId}/${action}`,
        {
          method: action === 'delete' ? 'DELETE' : 'POST',
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to ${action} agent`);
      }

      await loadAgents();
    } catch {
      window.alert(
        action === 'delete'
          ? t((m) => m.myAgent.deleteFailed)
          : action === 'pause'
            ? t((m) => m.myAgent.pauseFailed)
            : t((m) => m.myAgent.resumeFailed)
      );
    } finally {
      setPendingActionById((current) => {
        const next = { ...current };
        delete next[agentId];
        return next;
      });
    }
  }

  async function saveXUrlForAllAgents() {
    setSavingXLink(true);
    setXLinkFeedback(null);
    try {
      let normalizedXUrl: string | null = null;
      for (const agent of agents) {
        const response = await fetch(`/api/agents/${agent.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            xUrl: xLinkDraft,
          }),
        });

        const payload = (await response.json().catch(() => null)) as XUrlUpdateResponse | null;
        if (!response.ok) {
          throw new Error(
            payload?.success === false && payload.error?.message
              ? payload.error.message
              : 'Failed to save X URL'
          );
        }

        if (payload?.success) {
          normalizedXUrl = payload.data.xUrl;
        }
      }

      const nextSavedXLink = normalizedXUrl ?? '';
      setSavedXLink(nextSavedXLink);
      setXLinkDraft(nextSavedXLink);
      setXLinkFeedback({
        tone: 'success',
        message: nextSavedXLink
          ? t((m) => m.myAgent.xLinkSaved).replace('{count}', String(agents.length))
          : t((m) => m.myAgent.xLinkRemoved).replace('{count}', String(agents.length)),
      });
      await loadAgents();
    } catch (error) {
      setXLinkFeedback({
        tone: 'error',
        message:
          error instanceof Error && error.message
            ? error.message
            : t((m) => m.myAgent.xLinkSaveFailed),
      });
    } finally {
      setSavingXLink(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-6 pb-12 pt-24 md:pb-16 md:pt-28">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-[#f2f2ee]" />
          <div className="h-4 w-72 rounded bg-[#f2f2ee]" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-36 rounded-xl border border-black/10 bg-[#fafafa]"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pb-12 pt-24 md:pb-16 md:pt-28">
      <div className="mb-8 space-y-5">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-[#171717]">
            {t((m) => m.myAgent.title)}
          </h1>
          <p className="mt-2 text-black/56">{t((m) => m.myAgent.description)}</p>
        </div>

        {agents.length > 0 ? (
          <div className="border border-black/10 bg-white px-4 py-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.85fr)_minmax(320px,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[#171717]">
                    {t((m) => m.myAgent.xLinkTitle)}
                  </p>
                  <span className="inline-flex h-6 items-center border border-black/10 px-2 text-xs font-medium text-black/48">
                    {savedXLink ? savedXLinkDisplay : t((m) => m.myAgent.xLinkEmptyState)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-black/48">
                  {t((m) => m.myAgent.xLinkDescription)}
                </p>
              </div>

              <div className="min-w-0">
                <input
                  value={xLinkDraft}
                  onChange={(event) => {
                    setXLinkDraft(event.target.value);
                    setXLinkFeedback(
                      event.target.value.trim() === savedXLink.trim()
                        ? null
                        : {
                            tone: 'neutral',
                            message: t((m) => m.myAgent.xLinkUnsaved),
                          }
                    );
                  }}
                  placeholder={t((m) => m.myAgent.xLinkPlaceholder)}
                  className="h-10 w-full border border-black/10 px-3 text-sm text-[#171717] outline-none transition focus:border-black/24"
                />
                <div
                  aria-live="polite"
                  className={cn(
                    'mt-1 min-h-5 text-xs leading-5',
                    xLinkFeedback?.tone === 'success'
                      ? 'text-emerald-700'
                      : xLinkFeedback?.tone === 'error'
                        ? 'text-red-700'
                        : 'text-black/48'
                  )}
                >
                  {xLinkFeedback?.message ??
                    (savedXLink
                      ? t((m) => m.myAgent.xLinkSavedState).replace(
                          '{value}',
                          savedXLinkDisplay
                        )
                      : t((m) => m.myAgent.xLinkEmptyHint))}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                {savedXLink ? (
                  <a
                    href={savedXLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center justify-center border border-black/10 px-3 text-sm font-medium text-[#171717] transition hover:bg-[#fafafa]"
                  >
                    {t((m) => m.myAgent.xLinkViewSaved)}
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => void saveXUrlForAllAgents()}
                  disabled={savingXLink || !hasUnsavedXLink}
                  className="inline-flex h-10 items-center justify-center border border-black/10 px-3 text-sm font-medium text-[#171717] transition hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingXLink
                    ? t((m) => m.myAgent.xLinkSaving)
                    : hasUnsavedXLink
                      ? t((m) => m.myAgent.xLinkSave)
                      : t((m) => m.myAgent.xLinkSavedButton)}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {agents.length === 0 ? (
        <div className="rounded-xl border border-black/10 bg-white px-6 py-14 text-center">
          <p className="text-sm font-medium text-[#171717]">{t((m) => m.myAgent.emptyTitle)}</p>
          <p className="mt-2 text-sm text-black/56">{t((m) => m.myAgent.emptyDescription)}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-xl border border-black/10 bg-white p-5 transition-all hover:border-black/20 hover:shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(23,23,23,0.08),rgba(23,23,23,0.2))] text-sm font-bold text-[#171717]">
                    {agent.name.charAt(0)}
                  </div>
                  <span className="font-medium text-[#171717]">{agent.name}</span>
                </div>
                <StatusBadge
                  status={agent.status === 'paused' ? 'paused' : agent.runnerStatus}
                />
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                <ToneBadge tone={getRiskStateTone(agent.riskTag, agent.closeOnly)}>
                  {formatRiskStateLabel(agent.riskTag, agent.closeOnly, t)}
                </ToneBadge>
                <ToneBadge tone={getHeartbeatTone(agent.lastHeartbeatAt)}>
                  {formatHeartbeatBadge(agent.lastHeartbeatAt, localeTag, t)}
                </ToneBadge>
              </div>

              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-black/56">{t((m) => m.myAgent.equity)}</span>
                  <span className="font-medium text-[#171717]">
                    {currencyFormatter.format(agent.displayEquity)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/56">{t((m) => m.myAgent.availableCash)}</span>
                  <span className="text-black/56">
                    {currencyFormatter.format(agent.availableCash)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-black/56">{t((m) => m.myAgent.return)}</span>
                  <span
                    className={
                      agent.displayReturnRate >= 0
                        ? 'font-semibold text-emerald-600'
                        : 'font-semibold text-red-600'
                    }
                  >
                    {agent.displayReturnRate >= 0 ? '+' : ''}
                    {percentFormatter.format(agent.displayReturnRate)}
                    %
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-black/56">{t((m) => m.myAgent.heartbeat)}</span>
                  <span className="text-right text-black/56">
                    {agent.lastHeartbeatAt
                      ? formatRelativeTimestamp(agent.lastHeartbeatAt, localeTag)
                      : t((m) => m.myAgent.noHeartbeat)}
                  </span>
                </div>
              </div>

              {hasHeartbeatDiagnostics(agent) ? (
                <div className="mt-4 border-t border-black/10 pt-4">
                  <p className="text-xs font-semibold uppercase text-black/44">
                    {t((m) => m.myAgent.heartbeatDiagnostics)}
                  </p>
                  <div className="mt-2 space-y-1.5 text-xs">
                    <DiagnosticRow
                      label={t((m) => m.myAgent.lastSuccessfulHeartbeat)}
                      value={
                        agent.lastHeartbeatSuccessAt
                          ? formatRelativeTimestamp(agent.lastHeartbeatSuccessAt, localeTag)
                          : t((m) => m.myAgent.noHeartbeat)
                      }
                    />
                    <DiagnosticRow
                      label={t((m) => m.myAgent.lastHeartbeatFailure)}
                      value={
                        agent.lastHeartbeatFailureAt
                          ? formatRelativeTimestamp(agent.lastHeartbeatFailureAt, localeTag)
                          : '--'
                      }
                    />
                    <DiagnosticRow
                      label={t((m) => m.myAgent.consecutiveHeartbeatFailures)}
                      value={String(agent.consecutiveHeartbeatFailures)}
                    />
                    {agent.lastHeartbeatFailureMessage ? (
                      <DiagnosticRow
                        label={t((m) => m.myAgent.heartbeatFailureReason)}
                        value={formatHeartbeatFailure(agent)}
                        emphasis
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => router.push(`/agents/${agent.id}`)}
                  className="inline-flex h-9 items-center justify-center border border-black/10 px-3 text-sm font-medium text-[#171717] transition hover:bg-[#fafafa]"
                >
                  {t((m) => m.myAgent.view)}
                </button>
                <button
                  type="button"
                  disabled={Boolean(pendingActionById[agent.id])}
                  onClick={() =>
                    void runAgentAction(
                      agent.id,
                      agent.status === 'paused' ? 'resume' : 'pause'
                    )
                  }
                  className="inline-flex h-9 items-center justify-center border border-black/10 px-3 text-sm font-medium text-[#171717] transition hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingActionById[agent.id] === 'pause'
                    ? t((m) => m.myAgent.pausing)
                    : pendingActionById[agent.id] === 'resume'
                      ? t((m) => m.myAgent.resuming)
                      : agent.status === 'paused'
                        ? t((m) => m.myAgent.resume)
                        : t((m) => m.myAgent.pause)}
                </button>
                <button
                  type="button"
                  disabled={Boolean(pendingActionById[agent.id])}
                  onClick={() => void runAgentAction(agent.id, 'delete')}
                  className="inline-flex h-9 items-center justify-center border border-red-200 px-3 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingActionById[agent.id] === 'delete'
                    ? t((m) => m.myAgent.deleting)
                    : t((m) => m.myAgent.delete)}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type HeartbeatDiagnosticAgent = {
  lastHeartbeatSuccessAt: string | null;
  lastHeartbeatFailureAt: string | null;
  lastHeartbeatFailureCode: string | null;
  lastHeartbeatFailureMessage: string | null;
  lastHeartbeatFailureStatus: number | null;
  consecutiveHeartbeatFailures: number;
};

function hasHeartbeatDiagnostics(agent: HeartbeatDiagnosticAgent) {
  return Boolean(
    agent.lastHeartbeatFailureAt ||
      agent.lastHeartbeatFailureMessage ||
      agent.consecutiveHeartbeatFailures > 0
  );
}

function DiagnosticRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-black/44">{label}</span>
      <span
        className={cn(
          'min-w-0 break-words text-right',
          emphasis ? 'font-medium text-red-700' : 'text-black/56'
        )}
      >
        {value}
      </span>
    </div>
  );
}

function formatHeartbeatFailure(agent: HeartbeatDiagnosticAgent) {
  const parts = [
    agent.lastHeartbeatFailureCode,
    agent.lastHeartbeatFailureStatus ? String(agent.lastHeartbeatFailureStatus) : null,
    agent.lastHeartbeatFailureMessage,
  ].filter(Boolean);
  return parts.join(' | ');
}

function ToneBadge({
  children,
  tone,
}: {
  children: string;
  tone: 'green' | 'amber' | 'red';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs',
        tone === 'green'
          ? 'bg-emerald-100 text-emerald-700'
          : tone === 'amber'
            ? 'bg-amber-100 text-amber-700'
            : 'bg-red-100 text-red-700'
      )}
    >
      {children}
    </span>
  );
}

function getHeartbeatTone(timestamp: string | null) {
  const freshness = getTimestampFreshness(timestamp, {
    freshMs: 20 * 60 * 1000,
    delayedMs: 60 * 60 * 1000,
  });

  if (freshness.level === 'fresh') return 'green' as const;
  if (freshness.level === 'delayed') return 'amber' as const;
  return 'red' as const;
}

function formatHeartbeatBadge(
  timestamp: string | null,
  locale: string,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  const freshness = getTimestampFreshness(timestamp, {
    freshMs: 20 * 60 * 1000,
    delayedMs: 60 * 60 * 1000,
  });

  if (!timestamp || freshness.level === 'unavailable') {
    return t((m) => m.myAgent.noHeartbeat);
  }

  if (freshness.level === 'fresh') {
    return `${t((m) => m.publicAgent.heartbeatFresh)} | ${formatRelativeTimestamp(timestamp, locale)}`;
  }

  if (freshness.level === 'delayed') {
    return `${t((m) => m.publicAgent.heartbeatDelayed)} | ${formatRelativeTimestamp(timestamp, locale)}`;
  }

  return `${t((m) => m.publicAgent.heartbeatStale)} | ${formatRelativeTimestamp(timestamp, locale)}`;
}

function formatStatusLabel(
  status: string,
  t: ReturnType<typeof useSiteLocale>['t']
) {
  switch (status) {
    case 'running':
      return t((m) => m.myAgent.statusRunning);
    case 'ready':
      return t((m) => m.myAgent.statusReady);
    case 'paused':
      return t((m) => m.myAgent.statusPaused);
    case 'idle':
      return t((m) => m.myAgent.statusIdle);
    case 'error':
      return t((m) => m.myAgent.statusError);
    default:
      return status;
  }
}
