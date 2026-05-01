import {
  getTimestampFreshness,
  type DataFreshnessLevel,
} from './data-freshness';
import { getUsStockMarketSession } from './us-stock-market-core';

export type SignalTone = 'green' | 'amber' | 'red' | 'neutral';

export const LEADERBOARD_FRESHNESS = {
  freshMs: 10 * 60 * 1000,
  delayedMs: 30 * 60 * 1000,
};

export const LIVE_FEED_FRESHNESS = {
  freshMs: 2 * 60 * 1000,
  delayedMs: 10 * 60 * 1000,
};

export const HEARTBEAT_FRESHNESS = {
  freshMs: 20 * 60 * 1000,
  delayedMs: 60 * 60 * 1000,
};

export function freshnessTone(level: DataFreshnessLevel): SignalTone {
  if (level === 'fresh') return 'green';
  if (level === 'delayed') return 'amber';
  if (level === 'stale') return 'red';
  return 'neutral';
}

export function riskTone(riskTag: string | null): SignalTone {
  if (riskTag === 'terminated' || riskTag === 'close_only') return 'red';
  if (riskTag === 'high_risk') return 'amber';
  return 'green';
}

export function marketSessionTone(
  phase: ReturnType<typeof getUsStockMarketSession>['phase']
): SignalTone {
  if (phase === 'open') return 'green';
  if (phase === 'pre_market' || phase === 'after_hours') return 'amber';
  return 'neutral';
}

export function buildArenaStatusStripModel(input: {
  leaderboardSnapshotAt: string | null;
  latestTradeAt: string | null;
  leaderHeartbeatAt: string | null;
  leaderRiskTag?: string | null;
  leaderCloseOnly?: boolean;
  nowMs?: number;
}) {
  const nowMs = input.nowMs ?? Date.now();
  const session = getUsStockMarketSession(new Date(nowMs));
  const leaderboardFreshness = getTimestampFreshness(
    input.leaderboardSnapshotAt,
    LEADERBOARD_FRESHNESS,
    nowMs
  );
  const liveFeedFreshness = getTimestampFreshness(
    input.latestTradeAt,
    LIVE_FEED_FRESHNESS,
    nowMs
  );
  const heartbeatFreshness = getTimestampFreshness(
    input.leaderHeartbeatAt,
    HEARTBEAT_FRESHNESS,
    nowMs
  );
  const effectiveRiskTag = input.leaderCloseOnly
    ? 'close_only'
    : input.leaderRiskTag ?? null;

  return {
    session,
    leaderboardFreshness,
    liveFeedFreshness,
    heartbeatFreshness,
    effectiveRiskTag,
    sessionTone: marketSessionTone(session.phase),
    leaderboardTone: freshnessTone(leaderboardFreshness.level),
    liveFeedTone: freshnessTone(liveFeedFreshness.level),
    heartbeatTone: freshnessTone(heartbeatFreshness.level),
    riskTone: riskTone(effectiveRiskTag),
  };
}
