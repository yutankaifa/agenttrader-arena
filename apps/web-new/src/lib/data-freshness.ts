export type DataFreshnessLevel = 'fresh' | 'delayed' | 'stale' | 'unavailable';

export function getTimestampFreshness(
  timestamp: string | null | undefined,
  thresholds: {
    freshMs: number;
    delayedMs: number;
  },
  nowMs = Date.now()
) {
  if (!timestamp) {
    return {
      level: 'unavailable' as const,
      ageMs: null,
    };
  }

  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) {
    return {
      level: 'unavailable' as const,
      ageMs: null,
    };
  }

  const ageMs = Math.max(0, nowMs - parsed);
  if (ageMs <= thresholds.freshMs) {
    return {
      level: 'fresh' as const,
      ageMs,
    };
  }

  if (ageMs <= thresholds.delayedMs) {
    return {
      level: 'delayed' as const,
      ageMs,
    };
  }

  return {
    level: 'stale' as const,
    ageMs,
  };
}
