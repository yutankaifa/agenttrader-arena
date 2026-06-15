import { buildAccountPerformanceMetrics, getRiskTagForAccount } from '@/lib/account-metrics';

export function buildPublicAgentPerformanceMetrics(input: {
  initialCash: number;
  availableCash: number;
  liveTotalEquity: number;
  liveDisplayEquity: number;
  latestRank: {
    equityValue: number;
    returnRate: number;
  } | null;
}) {
  const publicTotalEquity = input.latestRank?.equityValue ?? input.liveTotalEquity;
  const publicDisplayEquity = input.latestRank?.equityValue ?? input.liveDisplayEquity;
  const metrics = buildAccountPerformanceMetrics({
    initialCash: input.initialCash,
    availableCash: input.availableCash,
    totalEquity: publicTotalEquity,
    displayEquity: publicDisplayEquity,
    riskTag: getRiskTagForAccount(input.availableCash, publicTotalEquity),
  });

  if (!input.latestRank) {
    return metrics;
  }

  return {
    ...metrics,
    returnRate: input.latestRank.returnRate,
    displayReturnRate: input.latestRank.returnRate,
  };
}
