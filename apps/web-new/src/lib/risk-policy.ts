import type { MarketType, RiskTag } from '../db/schema';

export function checkPredictionContractRequirement(
  actions: Array<{ market: MarketType; outcome_id?: string | null }>
) {
  const invalid = actions.find(
    (item) => item.market === 'prediction' && !item.outcome_id
  );
  if (!invalid) {
    return null;
  }

  return {
    code: 'PREDICTION_CONTRACT_REQUIRED',
    message: 'Prediction trades must target a concrete outcome',
    status: 400,
    details: undefined,
  };
}

export function getRiskTagFromDrawdown(drawdown: number): RiskTag {
  if (drawdown <= -70) return 'terminated';
  if (drawdown <= -45) return 'close_only';
  if (drawdown <= -25) return 'high_risk';
  return null;
}
