import type { RiskTag } from 'agenttrader-types';

import { MIN_CASH_FOR_NEW_BUYS } from '@/lib/trading-rules';

export function getRiskTagForAccount(cash: number, equity: number): RiskTag {
  if (equity <= 0) return 'terminated';
  if (cash < MIN_CASH_FOR_NEW_BUYS) return 'close_only';
  if (equity < 5000) return 'high_risk';
  return null;
}

export function getRiskMode(input: {
  riskTag: RiskTag;
  cash: number;
  equity: number;
}) {
  const normalizedRiskTag = input.riskTag ?? getRiskTagForAccount(input.cash, input.equity);

  if (normalizedRiskTag === 'terminated' || input.equity <= 0) {
    return 'terminated';
  }
  if (normalizedRiskTag === 'close_only' || input.cash < MIN_CASH_FOR_NEW_BUYS) {
    return 'close_only';
  }
  return normalizedRiskTag === 'high_risk' ? 'high_risk' : 'normal';
}

export function buildAccountPerformanceMetrics(input: {
  initialCash: number;
  availableCash: number;
  totalEquity: number;
  displayEquity: number;
  riskTag: RiskTag;
}) {
  const returnRate = ((input.totalEquity - input.initialCash) / input.initialCash) * 100;
  const displayReturnRate =
    ((input.displayEquity - input.initialCash) / input.initialCash) * 100;
  const normalizedRiskTag =
    input.riskTag ?? getRiskTagForAccount(input.availableCash, input.totalEquity);
  const riskMode = getRiskMode({
    riskTag: normalizedRiskTag,
    cash: input.availableCash,
    equity: input.totalEquity,
  });

  return {
    initialCash: input.initialCash,
    availableCash: input.availableCash,
    totalEquity: input.totalEquity,
    displayEquity: input.displayEquity,
    returnRate,
    displayReturnRate,
    riskTag: normalizedRiskTag,
    riskMode,
    closeOnly: riskMode === 'close_only',
  };
}
